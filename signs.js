/* Vocabulário de sinais e conversão texto -> quadros-chave.
 *
 * ATENÇÃO: as poses abaixo são APROXIMAÇÕES de protótipo, feitas à mão.
 * Antes de qualquer uso real, devem ser validadas/refeitas com intérpretes
 * de Libras e pessoas surdas. Letras que compartilham a mesma configuração de
 * mão (ex.: H/U/R) não são diferenciadas por orientação ou movimento aqui.
 *
 * Convenção de pose (por braço, "r" = direito do avatar, "l" = esquerdo):
 *   sx  elevação do ombro para frente (rad, 0 = braço caído, ~1.57 = horizontal)
 *   sz  abertura lateral do ombro (rad, negativo = cruzando o corpo)
 *   el  flexão do cotovelo (rad)
 *   ro  giro do antebraço (rad): 0 palma p/ cima, ~1.57 palma p/ dentro, ~3.14 palma p/ baixo
 *   wx  flexão do punho, wz desvio lateral do punho (rad)
 *   f   curvatura dos dedos [polegar, indicador, médio, anelar, mínimo], 0 = estendido, 1 = fechado
 */

const arm = (o = {}) => ({ sx: 0, sz: 0.12, el: 0.12, ro: 1.4, wx: 0, wz: 0, f: [0.3, 0.3, 0.3, 0.3, 0.3], ...o });
export const pose = (r = {}, l = {}, head = {}) => ({ r: arm(r), l: arm(l), head: { rx: 0, ry: 0, ...head } });
export const REST = pose();

const OPEN = [0, 0, 0, 0, 0];
const FIST = [0.7, 1, 1, 1, 1];
const POINT = [0.8, 0, 1, 1, 1];

/* Sinais de palavras inteiras (chave sem acento, minúscula). Cada item: quadros { pose, t (transição), h (pausa) } */
const f = (p, t = 0.45, h = 0.1) => ({ pose: p, t, h });
const wave = (wz) => f(pose({ sx: 0.3, sz: 0.4, el: 2.6, ro: 3.1, wz, f: OPEN }), 0.25, 0);

export const SIGNS = {
  oi: [f(pose({ sx: 0.3, sz: 0.4, el: 2.6, ro: 3.1, f: OPEN })), wave(0.5), wave(-0.5), wave(0.5), wave(0)],
  ola: null, // alias definido abaixo
  tchau: null,
  sim: [
    f(pose({ sx: 0.5, sz: 0.15, el: 1.5, ro: 1.5, wx: 0, f: FIST })),
    f(pose({ sx: 0.5, sz: 0.15, el: 1.5, ro: 1.5, wx: 0.6, f: FIST }), 0.2, 0),
    f(pose({ sx: 0.5, sz: 0.15, el: 1.5, ro: 1.5, wx: -0.2, f: FIST }), 0.2, 0),
    f(pose({ sx: 0.5, sz: 0.15, el: 1.5, ro: 1.5, wx: 0.6, f: FIST }), 0.2, 0.1),
  ],
  nao: [
    f(pose({ sx: 0.5, sz: 0.2, el: 1.7, ro: 1.5, f: POINT })),
    f(pose({ sx: 0.5, sz: 0.2, el: 1.7, ro: 1.5, wz: 0.5, f: POINT }), 0.18, 0),
    f(pose({ sx: 0.5, sz: 0.2, el: 1.7, ro: 1.5, wz: -0.5, f: POINT }), 0.18, 0),
    f(pose({ sx: 0.5, sz: 0.2, el: 1.7, ro: 1.5, wz: 0.5, f: POINT }), 0.18, 0.1),
  ],
  eu: [f(pose({ sx: 0.2, sz: 0, el: 2.0, ro: 1.5, wx: 1.6, f: POINT }), 0.5, 0.5)], // dedo apontando para o peito
  voce: [f(pose({ sx: 1.2, sz: 0.1, el: 0.5, ro: 1.5, f: POINT }), 0.5, 0.5)],
  obrigado: [
    f(pose({ sx: 0.3, sz: 0.15, el: 2.4, ro: 3.0, f: OPEN }), 0.5, 0.1),
    f(pose({ sx: 0.9, sz: 0.15, el: 1.3, ro: 3.0, f: OPEN }), 0.5, 0.3),
  ],
};
SIGNS.ola = SIGNS.oi;
SIGNS.tchau = SIGNS.oi;
SIGNS.obrigada = SIGNS.obrigado;

/* Datilologia aproximada: curvaturas [polegar, indicador, médio, anelar, mínimo] */
const ALPHA = {
  a: [0.2, 1, 1, 1, 1], b: [0.9, 0, 0, 0, 0], c: [0.3, 0.5, 0.5, 0.5, 0.5], d: [0.5, 0, 1, 1, 1],
  e: [0.8, 0.9, 0.9, 0.9, 0.9], f: [0.6, 0.7, 0, 0, 0], g: [0.2, 0.1, 1, 1, 1], h: [0.7, 0, 0, 1, 1],
  i: [0.8, 1, 1, 1, 0], j: [0.8, 1, 1, 1, 0], k: [0.2, 0, 0.1, 1, 1], l: [0, 0, 1, 1, 1],
  m: [0.9, 1, 1, 1, 0.9], n: [0.9, 1, 1, 0.9, 0.9], o: [0.5, 0.6, 0.6, 0.6, 0.6], p: [0.2, 0, 0.1, 1, 1],
  q: [0.2, 0.1, 1, 1, 1], r: [0.8, 0, 0, 1, 1], s: [0.6, 1, 1, 1, 1], t: [0.5, 1, 1, 1, 1],
  u: [0.8, 0, 0, 1, 1], v: [0.8, 0, 0, 1, 1], w: [0.8, 0, 0, 0, 1], x: [0.8, 0.5, 1, 1, 1],
  y: [0, 1, 1, 1, 0], z: [0.8, 0, 1, 1, 1],
};
const letterPose = (ch) => pose({ sx: 0.45, sz: 0.2, el: 1.9, ro: 2.6, f: ALPHA[ch] });

export function normalizeWord(w) {
  return w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}
export function tokenize(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).map((w) => ({ raw: w, key: normalizeWord(w) })).filter((w) => w.key);
}

/* Converte um texto em uma lista de quadros-chave. Palavra conhecida -> sinal; desconhecida -> soletrada. */
export function textToFrames(text) {
  const frames = [];
  for (const { raw, key } of tokenize(text)) {
    const sign = SIGNS[key];
    if (sign) {
      sign.forEach((fr, i) => frames.push({ ...fr, word: i === 0 ? raw : undefined }));
    } else {
      const letters = [...key].filter((c) => ALPHA[c]);
      if (!letters.length) { frames.push({ pose: REST, t: 0.2, h: 0.2, word: raw, skipped: true }); continue; }
      letters.forEach((c, i) => frames.push({
        pose: letterPose(c), t: i === 0 ? 0.45 : 0.28, h: 0.3,
        word: i === 0 ? raw : undefined, spelled: letters.slice(0, i + 1).join(" ").toUpperCase(),
      }));
    }
    frames.push({ pose: REST, t: 0.35, h: 0.15 }); // respiro entre palavras
  }
  return frames;
}
