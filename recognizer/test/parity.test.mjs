// Teste de paridade Python <-> JavaScript.
//   npm i -D @tensorflow/tfjs
//   python -m http.server 8765 --directory ml/out &        (serve model/, refs.f32, vocab.json, parity.json)
//   node recognizer/test/parity.test.mjs http://127.0.0.1:8765/
import * as tf from "@tensorflow/tfjs";
import { CONTRACT, makeFrame, resampleIdx, featurize, fillPose, SignSegmenter } from "../features.js";
import { loadRecognizer } from "../recognizer.js";

const base = process.argv[2] || "http://127.0.0.1:8765/";
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FALHA ") + msg); if (!cond) fails++; };
const l2 = (v) => { const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1; return v.map((x) => x / n); };

const P = await (await fetch(base + "parity.json")).json();
const { n, aspect } = P;

// reconstrói os frames "como vieram da câmera" (x ainda sem multiplicar pelo aspect)
const rawHands = [], rawPose = [];
for (let t = 0; t < n; t++) {
  const hs = [0, 1].map((h) => {
    const pts = [];
    for (let j = 0; j < 21; j++) {
      const o = ((t * 2 + h) * 21 + j) * 2, x = P.hands[o], y = P.hands[o + 1];
      if (x === null || y === null) return null;
      pts.push({ x, y, z: 0 });
    }
    return pts;
  });
  rawHands.push(hs);
  rawPose.push(Array.from({ length: 7 }, (_, k) => ({ x: P.pose[(t * 7 + k) * 2], y: P.pose[(t * 7 + k) * 2 + 1], z: 0 })));
}
// monta landmarks de 33 pontos do Pose e entrega as mãos na ordem TROCADA (direita primeiro)
const toFrame = (t) => {
  const pose33 = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  CONTRACT.POSE_IDX.forEach((idx, k) => { pose33[idx] = rawPose[t][k]; });
  const [L, R] = rawHands[t];
  return makeFrame([R, L].filter(Boolean), pose33, aspect, t * 33);
};
const frames = Array.from({ length: n }, (_, t) => toFrame(t));

console.log("makeFrame");
let slotsOk = true;
frames.forEach((f, t) => {
  for (let h = 0; h < 2; h++) {
    const exp = rawHands[t][h];
    if (!!exp !== !!f.hands[h]) slotsOk = false;
    else if (exp && Math.abs(f.hands[h][5][0] - exp[5].x * aspect) > 1e-9) slotsOk = false;
  }
});
ok(slotsOk, "mãos entregues em ordem trocada voltam aos slots certos (esquerda=0, direita=1)");

console.log("features");
const idx = resampleIdx(n);
ok(JSON.stringify(idx) === JSON.stringify(P.idx), "resampleIdx idêntico ao Python");
const feats = featurize(idx.map((i) => fillPose(frames)[i]));
let maxd = 0;
P.features.forEach((v, i) => { maxd = Math.max(maxd, Math.abs((v ?? 0) - feats[i])); });
ok(feats.length === P.features.length && maxd < 1e-4, `features iguais ao Python (diferença máx ${maxd.toExponential(2)})`);

console.log("modelo TF.js");
const rec = await loadRecognizer({ baseUrl: base, tf });
const emb = rec.embed(frames);
const exp = l2(P.embedding);
const cos = emb.reduce((a, x, i) => a + x * exp[i], 0);
ok(cos > 0.999, `embedding do TF.js ≈ Keras (cosseno ${cos.toFixed(6)})`);
const res = rec.classify(frames);
ok(res.top[0].label === P.label && res.accepted, `classifica “${P.label}” → ${res.top.map((t) => `${t.label} ${t.score.toFixed(2)}`).join(", ")}`);

console.log("sinais ensinados pelo usuário");
rec.setUserReferences([{ label: "MeuSinal", e: Array.from(emb) }]);
ok(rec.classify(frames).top[0].label === "MeuSinal" || rec.classify(frames).top[0].score > 0.999, "referência do usuário entra no ranking");
rec.setUserReferences([]);
ok(!rec.labels.includes("MeuSinal") && rec.refs.length === rec.vocab.n_refs, "remover referências do usuário restaura o modelo base");

console.log("segmentador");
const rest = (t) => ({ t, hands: [null, null], pose: frames[0].pose });
const stream = [];
let t = 0;
for (let i = 0; i < 20; i++) stream.push(rest((t += 33)));
for (const f of frames) stream.push({ ...f, t: (t += 33) });
for (let i = 0; i < 20; i++) stream.push(rest((t += 33)));
const seg = new SignSegmenter();
const out = stream.map((f) => seg.push(f)).filter(Boolean);
ok(out.length === 1, `1 segmento detectado (${out.length})`);
if (out.length === 1) {
  ok(Math.abs(out[0].length - n) <= 4, `duração do segmento ≈ original (${out[0].length} vs ${n} frames)`);
  const r2 = rec.classify(out[0]);
  ok(r2.top[0].label === P.label, `segmento recortado é reconhecido como “${r2.top[0].label}”`);
}
console.log(fails ? `\n${fails} falha(s)` : "\nTudo certo.");
process.exit(fails ? 1 : 0);
