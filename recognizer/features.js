// features.js — pré-processamento de landmarks para o modelo de Libras.
// ESPELHO de ml/train_libras.py (seção "CONTRATO DE FEATURES"). Se mudar um, mude o outro e
// rode o teste de paridade (recognizer/test/parity.test.mjs) com o parity.json gerado no treino.
//
// Formato de um frame (o que o app produz a cada imagem da câmera):
//   { t: ms, hands: [esquerda|null, direita|null], pose: [[x,y] x7] | null }
//   cada mão = 21 pontos [x,y]; x JÁ multiplicado por (largura/altura do vídeo) — ver makeFrame().

export const CONTRACT = {
  version: 1, T: 32, FEAT_DIM: 184,
  POSE_IDX: [0, 11, 12, 13, 14, 15, 16],   // nariz, ombros, cotovelos, punhos
  SH_L: 1, SH_R: 2, WR_L: 5, WR_R: 6,
  ACTIVE_Y: 1.6, TRIM_MARGIN: 2,
};
const { T, FEAT_DIM, POSE_IDX, SH_L, SH_R, WR_L, WR_R, ACTIVE_Y, TRIM_MARGIN } = CONTRACT;

/** Confere se o vocab.json carregado combina com este código. */
export function assertContract(vocab) {
  if (vocab.version !== CONTRACT.version || vocab.T !== T || vocab.feat_dim !== FEAT_DIM ||
      JSON.stringify(vocab.features?.pose_idx) !== JSON.stringify(POSE_IDX)) {
    throw new Error("Modelo e features.js estão fora de sincronia (contrato diferente).");
  }
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * Monta um frame a partir dos resultados do MediaPipe Tasks Vision.
 * handLms: result.landmarks do HandLandmarker | poseLms: result.landmarks[0] do PoseLandmarker
 * Os lados NÃO vêm do "handedness" (que depende de espelhamento): cada mão é ligada ao punho do
 * Pose mais próximo (índice 15 = esquerda anatômica, 16 = direita), igual ao dataset de treino.
 */
export function makeFrame(handLms, poseLms, aspect, t) {
  const pose = poseLms ? POSE_IDX.map((i) => [poseLms[i].x * aspect, poseLms[i].y]) : null;
  const hs = (handLms || []).slice(0, 2).map((h) => h.map((p) => [p.x * aspect, p.y]));
  const hands = [null, null];
  if (hs.length === 1) {
    const w = hs[0][0];
    const left = pose ? dist(w, pose[WR_L]) <= dist(w, pose[WR_R]) : false;
    hands[left ? 0 : 1] = hs[0];
  } else if (hs.length === 2) {
    const [a, b] = hs;
    let straight;
    if (pose) straight = dist(a[0], pose[WR_L]) + dist(b[0], pose[WR_R]) <= dist(a[0], pose[WR_R]) + dist(b[0], pose[WR_L]);
    else straight = a[0][0] >= b[0][0];   // sem pose: imagem não espelhada => esquerda anatômica = x maior
    hands[0] = straight ? a : b; hands[1] = straight ? b : a;
  }
  return { t, hands, pose };
}

/** Mão "ativa" = punho acima de (ombros + ACTIVE_Y larguras de ombro). Mesmo critério do treino. */
export function isActive(frame) {
  if (!frame.pose) return false;
  const l = frame.pose[SH_L], r = frame.pose[SH_R];
  const cy = (l[1] + r[1]) / 2, s = Math.max(dist(l, r), 1e-3);
  return frame.hands.some((h) => h && (h[0][1] - cy) / s < ACTIVE_Y);
}

/** round-half-up de i*(n-1)/(T-1), em inteiros (idêntico ao Python). */
export function resampleIdx(n, t = T) {
  return Array.from({ length: t }, (_, i) => Math.floor((2 * i * (n - 1) + (t - 1)) / (2 * (t - 1))));
}

/** Preenche frames sem pose com a última pose válida (e a primeira, no início). */
export function fillPose(frames) {
  const first = frames.find((f) => f.pose);
  if (!first) return null;
  let last = first.pose;
  return frames.map((f) => { if (f.pose) last = f.pose; return f.pose ? f : { ...f, pose: last }; });
}

/** Exatamente T frames (com pose) -> Float32Array(T * FEAT_DIM). */
export function featurize(frames) {
  const n = frames.length;
  if (n !== T) throw new Error(`featurize espera ${T} frames, recebeu ${n}`);
  const cx = [], cy = [], sw = [];
  for (const f of frames) {
    const l = f.pose[SH_L], r = f.pose[SH_R];
    cx.push((l[0] + r[0]) / 2); cy.push((l[1] + r[1]) / 2); sw.push(dist(l, r));
  }
  const c0 = median(cx), c1 = median(cy), s = Math.max(median(sw), 1e-3);
  const out = new Float32Array(n * FEAT_DIM);
  frames.forEach((f, t) => {
    let o = t * FEAT_DIM;
    for (const p of f.pose) { out[o++] = (p[0] - c0) / s; out[o++] = (p[1] - c1) / s; }              // 14
    for (let h = 0; h < 2; h++) {                                                                      // 84
      const H = f.hands[h];
      if (!H) { o += 42; continue; }
      for (const p of H) { out[o++] = (p[0] - c0) / s; out[o++] = (p[1] - c1) / s; }
    }
    for (let h = 0; h < 2; h++) {                                                                      // 84
      const H = f.hands[h];
      if (!H) { o += 42; continue; }
      const w = H[0];
      let m = 0;
      for (const p of H) m = Math.max(m, dist(p, w));
      m = Math.max(m, 1e-3);
      for (const p of H) { out[o++] = (p[0] - w[0]) / m; out[o++] = (p[1] - w[1]) / m; }
    }
    out[o++] = f.hands[0] ? 1 : 0; out[o++] = f.hands[1] ? 1 : 0;                                     // 2
  });
  return out;
}

/** Segmento de duração livre (já aparado) -> features prontas para o modelo. */
export function segmentToFeatures(frames) {
  const filled = fillPose(frames);
  if (!filled) return null;
  return featurize(resampleIdx(filled.length).map((i) => filled[i]));
}

/**
 * Corta a câmera em sinais: começa quando uma mão sobe, termina quando as mãos ficam
 * paradas/abaixadas por `endMs`. Devolve o segmento (array de frames) ou null.
 * Cada sinal precisa de uma "pausa" com as mãos baixas (como no dataset de treino).
 */
export class SignSegmenter {
  constructor({ endMs = 300, minActiveMs = 300, maxMs = 5000 } = {}) {
    Object.assign(this, { endMs, minActiveMs, maxMs });
    this.reset();
  }
  reset() { this.pre = []; this.seg = null; this.lastPose = null; }
  get recording() { return !!this.seg; }
  push(frame) {
    if (frame.pose) this.lastPose = frame.pose;
    if (!this.lastPose) return null;
    const f = frame.pose ? frame : { ...frame, pose: this.lastPose };
    const act = isActive(f);
    if (!this.seg) {
      if (!act) { this.pre.push(f); if (this.pre.length > TRIM_MARGIN) this.pre.shift(); return null; }
      this.seg = { frames: [...this.pre, f], lastIdx: this.pre.length, t0: f.t, tLast: f.t };
      this.pre = [];
      return null;
    }
    const s = this.seg;
    s.frames.push(f);
    if (act) { s.lastIdx = s.frames.length - 1; s.tLast = f.t; }
    if (f.t - s.tLast < this.endMs && f.t - s.t0 <= this.maxMs) return null;
    this.seg = null;
    const frames = s.frames.slice(0, s.lastIdx + TRIM_MARGIN + 1);
    return s.tLast - s.t0 >= this.minActiveMs ? frames : null;
  }
}
