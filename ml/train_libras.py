#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
train_libras.py — Conecta Libras

Baixa landmarks públicos de Libras (Hugging Face), treina um ENCODER de sequências
(1D-CNN) e exporta tudo o que o navegador precisa:

    out/
      model/model.json + group1-shard*.bin   encoder em formato TF.js (layers-model)
      refs.f32                                embeddings de referência (float32, L2-normalizados)
      vocab.json                              rótulos, contrato de features e métricas
      parity.json                             fixture p/ testar o features.js (NÃO publicar)
      report.json                             métricas e tamanhos dos arquivos

Fonte dos dados: https://huggingface.co/datasets/danielelvs/multilingual-islr-mediapipe
(MIT; coordenadas derivadas do MINDS-Libras e do LIBRAS-UFOP — mantenha as citações das
bases originais). O frames.csv tem ~14 GB: ele é baixado uma vez (cache do Hugging Face) e
lido em blocos, só com as colunas necessárias. O resultado fica em cache (--cache).

Uso rápido
    pip install -r requirements.txt
    python train_libras.py --out out                       # baixa o dataset (~14 GB) e treina
    python train_libras.py --out out --copy-to ../models/libras-v1   # treina e já copia o modelo para o app
    python train_libras.py --csv /dados/frames.csv --classes /dados/classes.csv --out out
    python make_fake_frames.py --out fake && \
    python train_libras.py --csv fake/frames.csv --classes fake/classes.csv --out out_fake --epochs 15   # teste rápido

O CONTRATO DE FEATURES (seção abaixo) precisa ser idêntico ao recognizer/features.js.
"""
from __future__ import annotations

import argparse
import json
import os
import pickle
import sys
import time
import unicodedata
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
os.environ.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")

import numpy as np

# ============================================================================
# CONTRATO DE FEATURES — espelhado em recognizer/features.js. Se mudar aqui, mude lá.
# ============================================================================
CONTRACT_VERSION = 1
T = 32                              # frames por sequência após reamostragem
POSE_IDX = [0, 11, 12, 13, 14, 15, 16]   # nariz, ombros, cotovelos, punhos (MediaPipe Pose)
SH_L, SH_R = 1, 2                   # posição dos ombros dentro de POSE_IDX
WR_L, WR_R = 5, 6                   # posição dos punhos dentro de POSE_IDX
N_HAND = 21
ACTIVE_Y = 1.6                      # mão "ativa" se o punho está acima de (ombros + 1,6 larguras de ombro)
TRIM_MARGIN = 2                     # frames extras mantidos ao aparar o início/fim parado
FEAT_DIM = 14 + 84 + 84 + 2         # pose global + mãos globais + forma local das mãos + presença
# Convenção dos slots de mão: 0 = mão ESQUERDA anatômica (perto do punho esquerdo do Pose, índice 15),
# 1 = mão DIREITA (índice 16). O script confere isso no dataset (--hand-order auto).
# Aspect: x é multiplicado por largura/altura do vídeo, para as coordenadas ficarem proporcionais em pixels.
DEFAULT_ASPECT = {"minds": 16 / 9, "ufop": 16 / 9}   # MINDS = 1920x1080; UFOP: ASSUMIDO (verifique)


def shoulder_ref(pose):
    l, r = pose[:, SH_L], pose[:, SH_R]
    return (l + r) / 2.0, np.linalg.norm(l - r, axis=1)


def fill_pose(pose):
    """Preenche frames sem pose com o último frame válido (e o primeiro, no início)."""
    ok = ~np.isnan(pose).any(axis=(1, 2))
    if not ok.any():
        return None
    n = len(pose)
    idx = np.where(ok, np.arange(n), -1)
    idx = np.maximum.accumulate(idx)
    idx[idx < 0] = int(np.flatnonzero(ok)[0])
    return pose[idx]


def active_mask(hands, pose):
    c, s = shoulder_ref(pose)
    s = np.maximum(s, 1e-3)
    wr = hands[:, :, 0, :]                                  # [n,2,2]
    present = ~np.isnan(wr).any(-1)
    with np.errstate(invalid="ignore"):
        rel_y = (wr[..., 1] - c[:, None, 1]) / s[:, None]   # >0 = abaixo dos ombros
        act = present & (rel_y < ACTIVE_Y)
    return act.any(1)


def trim_active(hands, pose, margin=TRIM_MARGIN, min_active=8):
    act = np.flatnonzero(active_mask(hands, pose))
    if len(act) < min_active:
        return hands, pose
    a, b = max(act[0] - margin, 0), min(act[-1] + margin + 1, len(hands))
    return hands[a:b], pose[a:b]


def resample_idx(n, t=T):
    """round-half-up de i*(n-1)/(t-1), em aritmética inteira (idêntico no JS)."""
    return (2 * np.arange(t) * (n - 1) + (t - 1)) // (2 * (t - 1))


def featurize(hands, pose):
    """hands [T,2,21,2] (NaN = ausente), pose [T,7,2] (completo) -> [T, FEAT_DIM] float32."""
    n = len(hands)
    c_all, s_all = shoulder_ref(pose)
    c = np.median(c_all, axis=0)
    s = max(float(np.median(s_all)), 1e-3)
    pg = ((pose - c) / s).reshape(n, -1)
    hp = ~np.isnan(hands).any(axis=(2, 3))                  # [n,2]
    with np.errstate(invalid="ignore"):
        hg = (hands - c) / s
        q = hands - hands[:, :, 0:1, :]
        sc = np.maximum(np.sqrt((q ** 2).sum(-1)).max(-1), 1e-3)
        hl = q / sc[:, :, None, None]
    m = hp[:, :, None, None]
    hg = np.where(m, hg, 0.0).reshape(n, -1)
    hl = np.where(m, hl, 0.0).reshape(n, -1)
    return np.concatenate([pg, hg, hl, hp.astype(np.float32)], axis=1).astype(np.float32)


def prep_eval(s):
    h, p = s["hands_t"], s["pose_t"]
    i = resample_idx(len(h))
    return featurize(h[i], p[i])


def prep_train(s, rng):
    h, p = s["hands_t"], s["pose_t"]
    n = len(h)
    lo, hi = rng.uniform(0.0, 0.12), rng.uniform(0.88, 1.0)       # variação de velocidade/recorte
    i = np.rint(np.linspace(lo * (n - 1), hi * (n - 1), T)).astype(int)
    h, p = h[i].copy(), p[i].copy()
    c = np.median(shoulder_ref(p)[0], axis=0)
    th, sx = np.deg2rad(rng.uniform(-8, 8)), rng.uniform(0.85, 1.18)  # rotação e proporção da imagem
    R = np.array([[np.cos(th), -np.sin(th)], [np.sin(th), np.cos(th)]], np.float32)
    k = np.array([sx, 1.0], np.float32)

    def tf(a):
        return ((a - c) * k) @ R.T + c

    h, p = tf(h), tf(p)
    h += rng.normal(0, 0.002, h.shape).astype(np.float32)
    p += rng.normal(0, 0.002, p.shape).astype(np.float32)
    h[rng.random((T, 2)) < 0.03] = np.nan                         # falhas de detecção
    return featurize(h, p)


# ============================================================================
# DADOS
# ============================================================================
INVALID_LABELS = {"", "<na>", "nan", "none", "null", "n/a"}


def valid_label(x):
    """False para rótulos vazios/NA (pandas devolve <NA> quando o classes.csv tem um rótulo em branco)."""
    return str(x).strip().lower() not in INVALID_LABELS


# o dataset grava rótulos sem acento; a voz do navegador pronuncia "Maca" (maca) diferente de "Maçã" (fruta)
DISPLAY_FIX = {"america": "América", "maca": "Maçã"}


def norm_label(s):
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower().strip()
    return " ".join(s.split())


def load_raw(csv_path, classes_path, datasets, aspect, hand_order):
    import pyarrow as pa
    import pyarrow.csv as pacsv

    hand_cols = [f"hand_{h}_{j}_{a}" for h in (0, 1) for j in range(N_HAND) for a in "xy"]
    pose_cols = [f"pose_{k}_{a}" for k in POSE_IDX for a in "xy"]
    meta = ["dataset", "class_id", "sample_id", "signer_id", "frame_id"]
    types = {c: pa.float32() for c in hand_cols + pose_cols}
    types.update({"dataset": pa.string(), "class_id": pa.string(), "sample_id": pa.string(),
                  "signer_id": pa.string(), "frame_id": pa.int64()})
    try:
        reader = pacsv.open_csv(
            csv_path,
            read_options=pacsv.ReadOptions(block_size=64 << 20, use_threads=True),
            convert_options=pacsv.ConvertOptions(include_columns=meta + hand_cols + pose_cols,
                                                 column_types=types, strings_can_be_null=True))
    except (pa.ArrowInvalid, KeyError) as e:
        sys.exit(f"Não consegui ler as colunas esperadas do CSV ({e}).\n"
                 "Compare com o data_dictionary.csv do dataset e ajuste hand_cols/pose_cols/meta em load_raw().")
    acc, t0, nb = {}, time.time(), 0
    for batch in reader:
        nb += 1
        df = batch.to_pandas()
        df = df[df["dataset"].isin(datasets)]
        for sid, g in df.groupby("sample_id", sort=False):
            d = acc.setdefault(sid, {"ds": g["dataset"].iat[0], "cid": g["class_id"].iat[0],
                                     "signer": str(g["signer_id"].iat[0]), "fr": [], "x": []})
            d["fr"].append(g["frame_id"].to_numpy())
            d["x"].append(g[hand_cols + pose_cols].to_numpy(np.float32))
        if nb % 10 == 0:
            print(f"  lidos {nb} blocos · {len(acc)} amostras · {time.time() - t0:.0f}s", flush=True)
    print(f"  leitura concluída: {len(acc)} amostras em {time.time() - t0:.0f}s")

    import pandas as pd
    cls = pd.read_csv(classes_path, dtype="string")
    cid2label = dict(zip(cls["class_id"], cls["label"]))

    bad = sorted(c for c, l in cid2label.items() if not valid_label(l) and c.split("::")[0] in datasets)
    if bad:
        print(f"  classes SEM rótulo no classes.csv (serão descartadas): {', '.join(bad[:12])}{' …' if len(bad) > 12 else ''}")
    samples, dropped, no_label = [], 0, 0
    for sid, d in acc.items():
        fr = np.concatenate(d["fr"])
        X = np.concatenate(d["x"])[np.argsort(fr, kind="stable")]
        hands = X[:, :84].reshape(-1, 2, N_HAND, 2).copy()
        pose = fill_pose(X[:, 84:].reshape(-1, len(POSE_IDX), 2).copy())
        label = cid2label.get(d["cid"])
        if not valid_label(label):
            no_label += 1
            continue
        if pose is None or len(X) < 8 or np.isnan(hands).all():
            dropped += 1
            continue
        a = aspect.get(d["ds"], 16 / 9)
        hands[..., 0] *= a
        pose[..., 0] *= a
        samples.append({"id": sid, "ds": d["ds"], "signer": f'{d["ds"]}:{d["signer"]}',
                        "label": str(label), "hands": hands, "pose": pose})
    print(f"  {len(samples)} amostras válidas ({dropped} descartadas por dados incompletos, "
          f"{no_label} sem rótulo no classes.csv)")
    return fix_hand_order(samples, hand_order)


def fix_hand_order(samples, mode):
    """Confere se hands[:,0] é a mão esquerda (perto do punho 15 do Pose)."""
    votes, total = 0, 0
    for s in samples:
        w0, w1 = s["hands"][:, 0, 0, :], s["hands"][:, 1, 0, :]
        pl, pr = s["pose"][:, WR_L], s["pose"][:, WR_R]
        for w in (w0, w1):
            ok = ~np.isnan(w).any(1)
            if not ok.any():
                continue
            dl, dr = np.linalg.norm(w[ok] - pl[ok], axis=1), np.linalg.norm(w[ok] - pr[ok], axis=1)
            sign = 1 if w is w0 else -1          # w0 deveria estar perto da esquerda, w1 da direita
            votes += int(((dl < dr) if sign == 1 else (dr < dl)).sum())
            total += int(ok.sum())
    frac = votes / max(total, 1)
    print(f"  conferência de lado das mãos: {frac * 100:.1f}% dos frames com hand_0=esquerda / hand_1=direita")
    swap = (mode == "swap") or (mode == "auto" and frac < 0.5)
    if swap:
        print("  -> invertendo os slots das mãos para seguir a convenção 0=esquerda, 1=direita")
        for s in samples:
            s["hands"] = s["hands"][:, ::-1].copy()
    elif mode == "auto" and frac < 0.8:
        print("  AVISO: a convenção de lado ficou ambígua; confira os dados antes de confiar no modelo.")
    return samples


def split_by_signer(samples, val_frac, seed):
    rng, val = np.random.default_rng(seed), set()
    for ds in sorted({s["ds"] for s in samples}):
        signers = sorted({s["signer"] for s in samples if s["ds"] == ds})
        rng.shuffle(signers)
        if len(signers) > 1:
            val.update(signers[: max(1, round(len(signers) * val_frac))])
    return val


# ============================================================================
# MODELO
# ============================================================================
def build_models(n_classes, emb_dim, lr, total_steps):
    import tensorflow as tf
    import tf_keras as keras
    from tf_keras import layers

    inp = keras.Input((T, FEAT_DIM), name="seq")
    x = inp
    for i, (f, k, d) in enumerate([(64, 5, 1), (96, 5, 2), (128, 3, 4)], 1):
        x = layers.Conv1D(f, k, padding="same", dilation_rate=d, use_bias=False, name=f"conv{i}")(x)
        x = layers.BatchNormalization(name=f"bn{i}")(x)
        x = layers.Activation("relu", name=f"act{i}")(x)
    bins = layers.Flatten(name="flat")(layers.AveragePooling1D(8, name="bins")(x))   # 4 janelas no tempo
    peak = layers.GlobalMaxPooling1D(name="peak")(x)
    x = layers.Concatenate(name="cat")([bins, peak])
    x = layers.Dropout(0.3, name="drop")(x)
    emb = layers.Dense(emb_dim, name="embedding")(x)
    encoder = keras.Model(inp, emb, name="encoder")

    class CosineHead(layers.Layer):
        """Logits por similaridade de cosseno (só no treino; NÃO é exportado)."""
        def __init__(self, n, scale=16.0, **kw):
            super().__init__(**kw)
            self.n, self.scale = n, scale

        def build(self, shape):
            self.w = self.add_weight(name="w", shape=(shape[-1], self.n), initializer="glorot_uniform")

        def call(self, e):
            return self.scale * tf.matmul(tf.math.l2_normalize(e, axis=-1), tf.math.l2_normalize(self.w, axis=0))

    model = keras.Model(inp, CosineHead(n_classes, name="head")(emb), name="trainer")
    sched = keras.optimizers.schedules.CosineDecay(lr, total_steps)
    model.compile(optimizer=keras.optimizers.Adam(sched),
                  loss=keras.losses.CategoricalCrossentropy(from_logits=True, label_smoothing=0.1),
                  metrics=["accuracy"])
    return encoder, model


def l2n(a):
    return a / np.maximum(np.linalg.norm(a, axis=1, keepdims=True), 1e-8)


def knn_scores(q, refs, ref_y, n_classes):
    sims = q @ refs.T
    out = np.full((len(q), n_classes), -1.0, np.float32)
    for c in range(n_classes):
        m = ref_y == c
        if m.any():
            out[:, c] = sims[:, m].max(1)
    return out


def evaluate(encoder, tr, va, ytr, yva, n_classes, ds_va):
    rtr = encoder.predict(tr, batch_size=256, verbose=0)
    mu = rtr.mean(0)                                   # centralizar espalha os ângulos: o cosseno vira uma confiança útil
    etr = l2n(rtr - mu)
    eva = l2n(encoder.predict(va, batch_size=256, verbose=0) - mu)
    sc = knn_scores(eva, etr, ytr, n_classes)
    top = np.argsort(-sc, axis=1)[:, :3]
    top1 = float((top[:, 0] == yva).mean())
    top3 = float((top == yva[:, None]).any(1).mean())
    per = {str(d): float((top[ds_va == d, 0] == yva[ds_va == d]).mean()) for d in sorted(set(ds_va))}
    ok = top[:, 0] == yva
    # ponto de partida p/ rejeitar "não sei": mantém ~90% dos acertos na validação
    min_sim = float(np.percentile(sc.max(1)[ok], 10)) if ok.any() else 0.6
    return top1, top3, per, min_sim


def pick_refs(samples, y, max_per_class, seed):
    """Escolhe até K referências por classe, alternando entre sinalizantes."""
    rng, keep = np.random.default_rng(seed), []
    for c in np.unique(y):
        idx = np.flatnonzero(y == c)
        by = {}
        for i in idx:
            by.setdefault(samples[i]["signer"], []).append(i)
        for v in by.values():
            rng.shuffle(v)
        order = []
        while len(order) < min(max_per_class, len(idx)):
            for k in list(by):
                if by[k]:
                    order.append(by[k].pop())
                    if len(order) >= max_per_class:
                        break
        keep.extend(order)
    return np.array(sorted(keep))


# ============================================================================
# EXPORTAÇÃO TF.js (formato layers-model, escrito à mão: o pacote Python
# `tensorflowjs` não instala de forma confiável no Python 3.12+/NumPy 2)
# ============================================================================
def export_tfjs(model, out_dir, quantize):
    out_dir.mkdir(parents=True, exist_ok=True)
    specs, blobs = [], []
    for w in model.weights:
        a = w.numpy().astype(np.float32)
        spec = {"name": w.name.split(":")[0], "shape": list(a.shape), "dtype": "float32"}
        if quantize == "float16":
            a = a.astype(np.float16)
            spec["quantization"] = {"dtype": "float16", "original_dtype": "float32"}
        specs.append(spec)
        blobs.append(a.tobytes())
    data = b"".join(blobs)
    shard = 4 * 1024 * 1024
    n = max(1, -(-len(data) // shard))
    paths = []
    for i in range(n):
        p = f"group1-shard{i + 1}of{n}.bin"
        (out_dir / p).write_bytes(data[i * shard:(i + 1) * shard])
        paths.append(p)
    import tf_keras
    (out_dir / "model.json").write_text(json.dumps({
        "format": "layers-model",
        "generatedBy": f"keras v{tf_keras.__version__}",
        "convertedBy": "train_libras.py",
        "modelTopology": json.loads(model.to_json()),
        "weightsManifest": [{"paths": paths, "weights": specs}],
    }))


def jsonable(a, nd=6):
    a = np.asarray(a, dtype=np.float64)
    return [None if np.isnan(v) else round(float(v), nd) for v in a.ravel()]


# ============================================================================
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="out")
    ap.add_argument("--repo", default="danielelvs/multilingual-islr-mediapipe")
    ap.add_argument("--csv", help="frames.csv local (se omitido, baixa do Hugging Face: ~14 GB)")
    ap.add_argument("--classes", help="classes.csv local")
    ap.add_argument("--datasets", nargs="+", default=["minds", "ufop"])
    ap.add_argument("--cache", help="cache das amostras (padrão: <out>/cache_samples.pkl)")
    ap.add_argument("--rebuild-cache", action="store_true")
    ap.add_argument("--hand-order", choices=["auto", "keep", "swap"], default="auto")
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--emb", type=int, default=128)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--val-frac", type=float, default=0.2)
    ap.add_argument("--max-refs-per-class", type=int, default=30)
    ap.add_argument("--quantize", choices=["float16", "none"], default="float16")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--copy-to", metavar="PASTA",
                    help="ao terminar, copia model/, refs.f32 e vocab.json para esta pasta do app "
                         "(ex.: ..\\models\\libras-v1); substitui o modelo anterior")
    a = ap.parse_args()

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    cache = Path(a.cache) if a.cache else out / "cache_samples.pkl"
    aspect = dict(DEFAULT_ASPECT)

    # ---------- 1. dados ----------
    if cache.exists() and not a.rebuild_cache:
        print(f"[1/5] Lendo cache {cache}")
        with open(cache, "rb") as f:            # arquivo gerado por este próprio script
            samples = pickle.load(f)
    else:
        csv_path, classes_path = a.csv, a.classes
        if not csv_path or not classes_path:
            from huggingface_hub import hf_hub_download
            print("[1/5] Baixando do Hugging Face (frames.csv tem ~14 GB; fica em cache e retoma se cair)…")
            classes_path = classes_path or hf_hub_download(a.repo, "classes.csv", repo_type="dataset")
            csv_path = csv_path or hf_hub_download(a.repo, "frames.csv", repo_type="dataset")
        print(f"[1/5] Extraindo {a.datasets} de {csv_path}")
        samples = load_raw(csv_path, classes_path, set(a.datasets), aspect, a.hand_order)
        with open(cache, "wb") as f:
            pickle.dump(samples, f, protocol=4)
    n0 = len(samples)
    samples = [s for s in samples if valid_label(s["label"])]      # também limpa caches antigos (rótulo "<NA>")
    if len(samples) < n0:
        print(f"      {n0 - len(samples)} amostras sem rótulo válido (ex.: '<NA>') removidas")
    if not samples:
        sys.exit("Nenhuma amostra encontrada. Confira --datasets e os arquivos de entrada.")

    # vocabulário: une rótulos iguais entre bases (ignorando acento/caixa)
    keys, display = [], {}
    for s in samples:
        k = norm_label(s["label"])
        display.setdefault(k, s["label"])
        s["key"] = k
    keys = sorted(display)
    k2i = {k: i for i, k in enumerate(keys)}
    labels = [DISPLAY_FIX.get(k, display[k]) for k in keys]
    for s in samples:
        s["y"] = k2i[s["key"]]
        s["hands_t"], s["pose_t"] = trim_active(s["hands"], s["pose"])
    n_classes = len(labels)
    val_signers = split_by_signer(samples, a.val_frac, a.seed)
    train = [s for s in samples if s["signer"] not in val_signers]
    val = [s for s in samples if s["signer"] in val_signers]
    print(f"      {len(samples)} amostras · {n_classes} sinais · treino {len(train)} / validação {len(val)} "
          f"(sinalizantes de validação: {sorted(val_signers)})")
    if not val:
        sys.exit("Sem sinalizantes para validação (precisa de >1 por base).")

    # ---------- 2. treino ----------
    print("[2/5] Treinando")
    import tf_keras as keras
    keras.utils.set_random_seed(a.seed)
    rng = np.random.default_rng(a.seed)
    ytr = np.array([s["y"] for s in train])
    yva = np.array([s["y"] for s in val])
    ds_va = np.array([s["ds"] for s in val])
    steps = -(-len(train) // a.batch)
    encoder, model = build_models(n_classes, a.emb, a.lr, a.epochs * steps)
    print(f"      encoder: {encoder.count_params():,} parâmetros")
    Xva = np.stack([prep_eval(s) for s in val])
    Xtr_clean = np.stack([prep_eval(s) for s in train])
    Y = np.eye(n_classes, dtype=np.float32)[ytr]
    t0 = time.time()
    for ep in range(a.epochs):
        Xtr = np.stack([prep_train(s, rng) for s in train])
        h = model.fit(Xtr, Y, batch_size=a.batch, epochs=1, shuffle=True, verbose=0)
        if (ep + 1) % 5 == 0 or ep == a.epochs - 1:
            t1, t3, _, _ = evaluate(encoder, Xtr_clean, Xva, ytr, yva, n_classes, ds_va)
            print(f"      época {ep + 1:3d}/{a.epochs}  loss {h.history['loss'][0]:.3f}  "
                  f"val(kNN, sinalizante novo) top1 {t1 * 100:5.1f}%  top3 {t3 * 100:5.1f}%  [{time.time() - t0:.0f}s]",
                  flush=True)
    top1, top3, per, min_sim = evaluate(encoder, Xtr_clean, Xva, ytr, yva, n_classes, ds_va)

    # ---------- 3. referências (vocabulário) ----------
    print("[3/5] Gerando embeddings de referência")
    Xall = np.concatenate([Xtr_clean, Xva])
    yall = np.concatenate([ytr, yva])
    allsamples = train + val
    sel = pick_refs(allsamples, yall, a.max_refs_per_class, a.seed)
    R = encoder.predict(Xall[sel], batch_size=256, verbose=0)
    mu = R.mean(0)
    E = l2n(R - mu).astype(np.float32)
    (out / "refs.f32").write_bytes(E.tobytes())

    # ---------- 4. exportação ----------
    print("[4/5] Exportando para TF.js")
    export_tfjs(encoder, out / "model", a.quantize)
    vocab = {
        "version": CONTRACT_VERSION, "T": T, "feat_dim": FEAT_DIM, "embedding_dim": a.emb,
        "build": int(time.time()), "embedding_mean": [round(float(v), 6) for v in mu],
        "labels": labels, "suggested_min_sim": round(min_sim, 3), "n_refs": int(len(sel)), "ref_labels": [int(v) for v in yall[sel]],
        "refs_file": "refs.f32", "datasets": a.datasets,
        "features": {"pose_idx": POSE_IDX, "active_y": ACTIVE_Y, "trim_margin": TRIM_MARGIN,
                     "aspect": "x * (largura/altura do vídeo)"},
        "metrics": {"val_top1": round(top1, 4), "val_top3": round(top3, 4),
                    "val_top1_por_base": {k: round(v, 4) for k, v in per.items()},
                    "validacao": "sinalizantes inéditos (kNN sobre embeddings do treino)"},
    }
    (out / "vocab.json").write_text(json.dumps(vocab, ensure_ascii=False))

    # fixture de paridade p/ o features.js
    s0 = val[0]
    h, p = s0["hands_t"][:64], s0["pose_t"][:64]
    asp = aspect.get(s0["ds"], 16 / 9)
    i = resample_idx(len(h))
    feats = featurize(h[i], p[i])
    emb = encoder.predict(feats[None], verbose=0)[0]
    hr, pr = h.copy(), p.copy()
    hr[..., 0] /= asp
    pr[..., 0] /= asp
    (out / "parity.json").write_text(json.dumps({
        "aspect": asp, "n": int(len(h)), "hands": jsonable(hr), "pose": jsonable(pr),
        "idx": [int(v) for v in i], "features": jsonable(feats), "embedding": jsonable(emb, 7),
        "label": s0["label"]}))

    # ---------- 5. relatório ----------
    sizes = {}
    for f in sorted(out.rglob("*")):
        if f.is_file() and f.name != "cache_samples.pkl":
            sizes[str(f.relative_to(out))] = f.stat().st_size
    (out / "report.json").write_text(json.dumps({"metrics": vocab["metrics"], "bytes": sizes,
                                                  "n_classes": n_classes, "n_train": len(train),
                                                  "n_val": len(val)}, ensure_ascii=False, indent=2))
    if a.copy_to:
        import shutil
        dst = Path(a.copy_to)
        dst.mkdir(parents=True, exist_ok=True)
        if (dst / "model").exists():
            shutil.rmtree(dst / "model")            # evita sobrar pedaços do modelo antigo
        shutil.copytree(out / "model", dst / "model")
        shutil.copy2(out / "refs.f32", dst / "refs.f32")
        shutil.copy2(out / "vocab.json", dst / "vocab.json")
        print(f"      copiado para {dst.resolve()}: model/, refs.f32, vocab.json")
    print("[5/5] Concluído")
    print(f"      validação (sinalizante inédito): top1 {top1 * 100:.1f}% · top3 {top3 * 100:.1f}%  {per}")
    print("      tamanhos (o que o navegador baixa):")
    for k, v in sizes.items():
        if k not in ("parity.json", "report.json"):
            print(f"        {k:34s} {v / 1024:9.1f} KB")


if __name__ == "__main__":
    main()
