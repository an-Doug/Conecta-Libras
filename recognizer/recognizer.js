// recognizer.js — carrega o encoder TF.js + vocabulário e classifica sinais por kNN de embeddings.
import { CONTRACT, assertContract, segmentToFeatures } from "./features.js";

const TFJS_URL = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js";

/** Carrega o TF.js (script UMD) só quando a câmera for usada. */
export function loadTf() {
  if (globalThis.tf) return Promise.resolve(globalThis.tf);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = TFJS_URL; s.async = true;
    s.onload = () => resolve(globalThis.tf);
    s.onerror = () => reject(new Error("Não foi possível carregar o TensorFlow.js"));
    document.head.append(s);
  });
}

const l2 = (v) => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return v.map((x) => x / n); };

export class SignRecognizer {
  constructor({ tf, model, vocab, refs }) {
    this.tf = tf; this.model = model; this.vocab = vocab;
    this.D = vocab.embedding_dim;
    this.labels = [...vocab.labels];
    this.refs = Array.from({ length: vocab.n_refs }, (_, i) => refs.subarray(i * this.D, (i + 1) * this.D));
    this.refLabels = [...vocab.ref_labels];
    this.minSim = vocab.suggested_min_sim ?? 0.6;
  }

  /** Embedding (L2-normalizado) de um segmento de frames; null se não houver pose. */
  embed(frames) {
    const feats = segmentToFeatures(frames);
    if (!feats) return null;
    const { tf } = this;
    const y = tf.tidy(() => this.model.predict(tf.tensor3d(feats, [1, CONTRACT.T, CONTRACT.FEAT_DIM])));
    const e = Float32Array.from(y.dataSync());
    y.dispose();
    return Float32Array.from(l2(e));
  }

  /** Top-k hipóteses [{label, score}] (score = similaridade de cosseno com a melhor referência da classe). */
  rank(emb, k = 3) {
    const best = new Map();
    for (let i = 0; i < this.refs.length; i++) {
      const r = this.refs[i]; let d = 0;
      for (let j = 0; j < this.D; j++) d += r[j] * emb[j];
      const c = this.refLabels[i];
      if (d > (best.get(c) ?? -2)) best.set(c, d);
    }
    return [...best].sort((a, b) => b[1] - a[1]).slice(0, k).map(([c, score]) => ({ label: this.labels[c], score }));
  }

  classify(frames, k = 3) {
    const emb = this.embed(frames);
    if (!emb) return null;
    const top = this.rank(emb, k);
    return { top, accepted: top[0].score >= this.minSim, embedding: emb };
  }

  /** "Ensinar sinal": guarda só o embedding (128 números) — persista no IndexedDB/localStorage. */
  addReference(label, embedding) {
    let c = this.labels.indexOf(label);
    if (c < 0) { c = this.labels.length; this.labels.push(label); }
    this.refs.push(Float32Array.from(embedding)); this.refLabels.push(c);
  }

  /** Substitui todas as referências do usuário ([{label, e}]) mantendo as do modelo base. */
  setUserReferences(list) {
    const n = this.vocab.n_refs;
    this.refs.length = n; this.refLabels.length = n; this.labels.length = this.vocab.labels.length;
    for (const r of list) this.addReference(r.label, r.e);
  }
}

/** baseUrl: pasta com model/, refs.f32 e vocab.json (ex.: "models/libras-v1/"). */
export async function loadRecognizer({ baseUrl = "models/libras-v1/", tf = null } = {}) {
  tf = tf || (await loadTf());
  try { await tf.setBackend("cpu"); } catch {}          // modelo minúsculo, 1 inferência por sinal: CPU basta
  await tf.ready();
  const [vocab, refsBuf, model] = await Promise.all([
    fetch(baseUrl + "vocab.json").then((r) => r.json()),
    fetch(baseUrl + "refs.f32").then((r) => r.arrayBuffer()),
    tf.loadLayersModel(baseUrl + "model/model.json"),
  ]);
  assertContract(vocab);
  const refs = new Float32Array(refsBuf);
  if (refs.length !== vocab.n_refs * vocab.embedding_dim) throw new Error("refs.f32 não combina com vocab.json");
  return new SignRecognizer({ tf, model, vocab, refs });
}
