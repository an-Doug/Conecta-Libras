/* Vocabulário de sinais e conversão texto -> quadros-chave.
 *
 * ATENÇÃO: as poses abaixo são APROXIMAÇÕES de protótipo, feitas à mão.
 * Antes de qualquer uso real, devem ser validadas/refeitas com intérpretes
 * de Libras e pessoas surdas. Cada letra tem configuração de dedos, abertura
 * entre dedos, orientação da mão e (J, Z) um pequeno percurso; ainda assim são
 * aproximações. Números só de 0 a 5.
 *
 * Convenção de pose (por braço, "r" = direito do avatar, "l" = esquerdo):
 *   sx  elevação do ombro para frente (rad, 0 = braço caído, ~1.57 = horizontal)
 *   sz  abertura lateral do ombro (rad, negativo = cruzando o corpo)
 *   el  flexão do cotovelo (rad)
 *   ro  giro do antebraço (rad): 0 palma p/ cima, ~1.57 palma p/ dentro, ~3.14 palma p/ baixo
 *   wx  flexão do punho, wz desvio lateral do punho (rad)
 *   f   curvatura dos dedos [polegar, indicador, médio, anelar, mínimo], 0 = estendido, 1 = fechado
 *   sp  abertura lateral de cada dedo (rad, + = em direção ao polegar; polegar: + = afasta da palma)
 *   tc  polegar cruzando à frente da mão (0..1)
 */

const arm = (o = {}) => ({ sx: 0, sz: 0.12, el: 0.12, ro: 1.4, wx: 0, wz: 0, f: [0.3, 0.3, 0.3, 0.3, 0.3], sp: [0, 0, 0, 0, 0], tc: 0, ...o });
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

/* Datilologia (alfabeto manual) e números 0-5.
 * Cada entrada: f = curvatura dos dedos; sp = abertura entre dedos; tc = polegar à frente;
 * o = orientação do braço/pulso (sobrescreve BASE); path = quadros extras com movimento (J, Z).
 * BASE deixa a mão levemente girada (~3/4) para a câmera ver o desenho dos dedos; letras que precisam
 * ser vistas de lado (C, D, O...) giram mais o antebraço (ro menor); G/H apontam para o lado (wz);
 * P/Q apontam para baixo (wx). */
const BASE = { sx: 0.8, sz: 0.28, el: 1.7, ro: 2.3, wx: 0, wz: 0 };
const SIDE = { ro: 1.6 };            // mão vista de perfil
const ACROSS = { ro: 1.9, wz: -0.9, wx: 0.2 }; // dedos apontando para o lado (G, H)
const DOWN = { wx: 0.95, ro: 2.0 };    // dedos apontando para baixo/frente (P, Q)
const L = (f, extra = {}) => ({ f, ...extra });

const ALPHA = {
  a: L([0.05, 1, 1, 1, 1]),
  b: L([0.9, 0, 0, 0, 0], { tc: 0.55 }),
  c: L([0.35, 0.5, 0.5, 0.5, 0.5], { o: SIDE }),
  d: L([0.6, 0, 1, 1, 1], { tc: 0.5, o: { ro: 1.7, wz: 0.1 } }),
  e: L([0.85, 0.95, 0.95, 0.95, 0.95], { tc: 0.8, o: { wx: 0.15 } }),
  f: L([0.75, 0.8, 0, 0, 0], { tc: 0.35, sp: [0, 0, -0.1, -0.2, -0.3] }),
  g: L([0.05, 0.05, 1, 1, 1], { o: ACROSS }),
  h: L([0.8, 0.05, 0.05, 1, 1], { o: ACROSS, tc: 0.3 }),
  i: L([0.85, 1, 1, 1, 0]),
  j: L([0.85, 1, 1, 1, 0], { path: [{ wz: 0.1 }, { wz: 0.5, sx: -0.12 }, { wz: 0.95, sx: -0.18 }] }),
  k: L([0.1, 0, 0.2, 1, 1], { sp: [0, 0.3, -0.25, 0, 0], tc: 0.1 }),
  l: L([0, 0, 1, 1, 1], { o: { ro: 2.7 } }),
  m: L([0.95, 0.85, 0.85, 0.85, 1], { tc: 0.9, o: { wx: 0.55, ro: 2.6 } }),
  n: L([0.95, 0.85, 0.85, 1, 1], { tc: 0.9, o: { wx: 0.55, ro: 2.6 } }),
  o: L([0.55, 0.65, 0.65, 0.65, 0.65], { tc: 0.25, o: SIDE }),
  p: L([0.1, 0, 0.2, 1, 1], { sp: [0, 0.3, -0.25, 0, 0], tc: 0.1, o: DOWN }),
  q: L([0.05, 0.05, 1, 1, 1], { o: DOWN }),
  r: L([0.85, 0.02, 0, 1, 1], { sp: [0, -0.28, 0.28, 0, 0] }),
  s: L([0.95, 1, 1, 1, 1], { tc: 1 }),
  t: L([0.7, 1, 1, 1, 1], { tc: 0.55, sp: [0.25, 0, 0, 0, 0] }),
  u: L([0.85, 0, 0, 1, 1]),
  v: L([0.85, 0, 0, 1, 1], { sp: [0, 0.22, -0.22, 0, 0] }),
  w: L([0.9, 0, 0, 0, 1], { sp: [0, 0.3, 0, -0.3, 0] }),
  x: L([0.85, 0.55, 1, 1, 1], { o: SIDE }),
  y: L([0, 1, 1, 1, 0], { sp: [0.3, 0, 0, 0, -0.3] }),
  z: L([0.85, 0, 1, 1, 1], { path: [{ wz: -0.5, sx: 0.05 }, { wz: 0.5, sx: 0.05 }, { wz: -0.5, sx: -0.2 }, { wz: 0.5, sx: -0.2 }] }),
  // números (0 a 5)
  0: L([0.55, 0.65, 0.65, 0.65, 0.65], { tc: 0.25, o: SIDE }),
  1: L([0.85, 0, 1, 1, 1]),
  2: L([0.85, 0, 0, 1, 1], { sp: [0, 0.12, -0.12, 0, 0] }),
  3: L([0, 0, 0, 1, 1], { sp: [0.3, 0.1, -0.1, 0, 0] }),
  4: L([0.9, 0, 0, 0, 0], { sp: [0, 0.12, 0, -0.1, -0.2], tc: 0.4 }),
  5: L([0, 0, 0, 0, 0], { sp: [0.35, 0.15, 0.03, -0.1, -0.22] }),
};
const letterPose = (ch, over = {}) => {
  const s = ALPHA[ch];
  return pose({ ...BASE, ...s.o, ...over, f: s.f, sp: s.sp ?? [0, 0, 0, 0, 0], tc: s.tc ?? 0 });
};
/* quadros de uma letra: pose estática + (J, Z) pequeno percurso; letra repetida ganha um "toque" para aparecer 2x */
function letterFrames(ch, first, repeated) {
  const fr = [];
  if (repeated) fr.push({ pose: letterPose(ch, { sx: BASE.sx - 0.14, wx: (ALPHA[ch].o?.wx ?? 0) + 0.2 }), t: 0.14, h: 0 });
  fr.push({ pose: letterPose(ch), t: first ? 0.45 : 0.3, h: ALPHA[ch].path ? 0.05 : 0.3 });
  for (const [i, p] of (ALPHA[ch].path ?? []).entries()) {
    fr.push({ pose: letterPose(ch, p), t: 0.2, h: i === ALPHA[ch].path.length - 1 ? 0.25 : 0 });
  }
  return fr;
}

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
      letters.forEach((c, i) => {
        const fr = letterFrames(c, i === 0, i > 0 && letters[i - 1] === c);
        fr.forEach((q, j) => frames.push({
          ...q,
          word: i === 0 && j === 0 ? raw : undefined,
          spelled: j === fr.length - 1 || j === 0 ? letters.slice(0, i + 1).join(" ").toUpperCase() : undefined,
        }));
      });
    }
    frames.push({ pose: REST, t: 0.35, h: 0.15 }); // respiro entre palavras
  }
  return frames;
}
