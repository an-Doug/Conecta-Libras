#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera um frames.csv / classes.csv SINTÉTICOS com o mesmo esquema do dataset real
(multilingual-islr-mediapipe), para testar o pipeline em segundos sem baixar 14 GB.

Os "sinais" são trajetórias de mão distintas por classe, com variação por sinalizante,
frames de repouso no início/fim (para testar o corte) e falhas de detecção.
NÃO serve para avaliar qualidade de reconhecimento.

    python make_fake_frames.py --out fake [--swap-hands]
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

ap = argparse.ArgumentParser()
ap.add_argument("--out", default="fake")
ap.add_argument("--classes", type=int, default=6)
ap.add_argument("--signers", type=int, default=5)
ap.add_argument("--reps", type=int, default=6)
ap.add_argument("--swap-hands", action="store_true", help="simula hand_0 = direita (testa a conferência automática)")
a = ap.parse_args()
rng = np.random.default_rng(1)
out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)

# esquema real: metadados + face(468) + hand_0(21) + pose(33) + hand_1(21), cada ponto com x,y,z
meta = ["dataset", "class_id", "sample_id", "sequence_id", "signer_id", "frame_id", "source_frame_id", "split",
        "missing_hand_0", "missing_hand_1", "missing_pose", "missing_face"]
cols = (meta + [f"face_{i}_{x}" for i in range(468) for x in "xyz"] + [f"hand_0_{i}_{x}" for i in range(21) for x in "xyz"]
        + [f"pose_{i}_{x}" for i in range(33) for x in "xyz"] + [f"hand_1_{i}_{x}" for i in range(21) for x in "xyz"])
cidx = {c: i for i, c in enumerate(cols)}

# "mão" modelo: 21 pontos (pulso + 4 por dedo), com abertura que varia por classe
base = np.zeros((21, 2))
for f in range(5):
    ang = np.deg2rad(-60 + 30 * f)
    for k in range(4):
        base[1 + f * 4 + k] = [np.sin(ang) * (k + 1) * 0.35, -np.cos(ang) * (k + 1) * 0.5]

rows = []
for c in range(a.classes):
    cid = f"minds::{c}"
    w, ph, amp = 1.0 + 0.7 * c, 0.9 * c, 0.05 + 0.02 * c
    spread = 0.7 + 0.12 * c
    for sg in range(a.signers):
        sh = np.array([0.5 + rng.normal(0, 0.02), 0.38 + rng.normal(0, 0.02)])
        sw = 0.11 + rng.normal(0, 0.008)                    # meia largura de ombro (coord. normalizadas)
        for r in range(a.reps):
            sid = f"minds::{c}-{sg}-{r}"
            n_rest, n_act = rng.integers(8, 14), rng.integers(40, 60)
            n = 2 * n_rest + n_act
            for t in range(n):
                row = np.full(len(cols), np.nan)
                active = n_rest <= t < n_rest + n_act
                u = (t - n_rest) / n_act
                row[:12] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
                # pose: pontos 0 (nariz), 11/12 (ombros), 13/14 (cotovelos), 15/16 (punhos)
                # imagem NÃO espelhada: esquerda anatômica = x maior
                P = {0: sh + [0, -0.12], 11: sh + [sw, 0], 12: sh - [sw, 0],
                     13: sh + [sw + 0.03, 0.12], 14: sh + [-sw - 0.03, 0.12]}
                if active:
                    cx = sh[0] - sw - 0.05 + amp * np.cos(w * 6.28 * u + ph)
                    cy = sh[1] + 0.05 + amp * np.sin(w * 6.28 * u + ph) - 0.15 * u * (c % 2)
                    wr_r = np.array([cx, cy])
                    wr_l = sh + [sw + 0.05, 0.25 - 0.25 * (c % 3 == 0)]
                else:
                    wr_r, wr_l = sh + [-sw, 0.75], sh + [sw, 0.75]       # repouso: mãos baixas
                P[15], P[16] = wr_l, wr_r
                for k, p in P.items():
                    row[cidx[f"pose_{k}_x"]], row[cidx[f"pose_{k}_y"]], row[cidx[f"pose_{k}_z"]] = p[0], p[1], 0.0
                size = 0.03 * (sw / 0.11)
                for name, wr, shown in (("L", wr_l, active and c % 3 == 0 or not active), ("R", wr_r, True)):
                    if not shown or rng.random() < 0.03:
                        continue
                    slot = 0 if name == "L" else 1
                    if a.swap_hands:
                        slot = 1 - slot
                    pts = wr + base * size * (spread if name == "R" else 1.0)
                    for j in range(21):
                        row[cidx[f"hand_{slot}_{j}_x"]], row[cidx[f"hand_{slot}_{j}_y"]], row[cidx[f"hand_{slot}_{j}_z"]] = \
                            pts[j, 0] + rng.normal(0, 0.001), pts[j, 1] + rng.normal(0, 0.001), 0.0
                row[cidx["frame_id"]] = t
                rows.append((row, "minds", cid, sid, f"S{sg:02d}"))
# monta o DataFrame em blocos para economizar memória
df = pd.DataFrame([r[0] for r in rows], columns=cols)
df["dataset"] = [r[1] for r in rows]
df["class_id"] = [r[2] for r in rows]
df["sample_id"] = [r[3] for r in rows]
df["sequence_id"] = df["sample_id"]
df["signer_id"] = [r[4] for r in rows]
df["frame_id"] = df["frame_id"].astype(int)
df["split"] = ""
for m in ("missing_hand_0", "missing_hand_1", "missing_pose", "missing_face"):
    df[m] = False
df.to_csv(out / "frames.csv", index=False, float_format="%.5f")
pd.DataFrame({"class_id": [f"minds::{c}" for c in range(a.classes)], "source_class_id": range(a.classes),
              "label": [f"Sinal{c}" for c in range(a.classes)], "category_name": "fake"}).to_csv(out / "classes.csv", index=False)
print(f"{len(df)} frames, {df['sample_id'].nunique()} amostras -> {out}/frames.csv")
