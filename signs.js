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
 *   tc  polegar para a frente da palma (0..1); tb  dobra da ponta do polegar (0..1)
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
 * Cada entrada: f = curvatura dos dedos; sp = abertura entre dedos; tc/tb = polegar à frente / dobra da ponta;
 * o = orientação do braço/pulso (sobrescreve BASE); path = movimento (quadros extras).
 *
 * Orientação: BASE deixa a mão de perfil, voltada para cima e levemente girada (~3/4) para a câmera ver
 * o desenho dos dedos. Exceções (como no alfabeto de referência): C, O (de perfil, vendo o "círculo"),
 * M, N, Q (dedos para baixo), P e X (mão na horizontal, apontando para fora).
 * Contatos do polegar (D, F, O, S, T, U) e as orientações de P, Q e X foram calculados numericamente contra a geometria do rig,
 * para a ponta do polegar realmente tocar o dedo.
 *
 * path: cada quadro usa deslocamentos RELATIVOS à orientação da letra (dsx, dsz, del, dro, dwx, dwz); com
 * abs:true os valores são absolutos (Z). lin:true = velocidade constante (movimento contínuo, sem "tranco").
 * hold:false = o primeiro quadro do percurso já é a posição inicial (K sobe a mão). */
const BASE = { sx: 0.8, sz: 0.28, el: 1.7, ro: 2.3, wx: 0, wz: 0 };
const SIDE = { ro: 1.6 };                          // mão vista de perfil (olhando pelo lado do polegar)
const UP = { sx: 0.95 };                           // levanta um pouco a mão para ver melhor
// orientações calculadas por busca numérica (dedos/palma na direção desejada, mão à vista):
const OUT = { sx: 0.95, sz: 0.19, el: 1.87, ro: 2.72, wx: 0.27, wz: -1.48 }; // dedos na horizontal, para fora, palma à vista (P, X)
const PTDOWN = { sx: 1.08, sz: 0.24, el: 0.85, ro: 1.41, wx: -0.95, wz: -1.54 }; // dedos para baixo, de lado para a câmera (Q)
const L = (f, extra = {}) => ({ f, ...extra });

const ALPHA = {
  a: L([0.7, 1, 1, 1, 1], { tc: 0.15, tb: 0.45 }),                       // polegar encostado ao lado do punho
  b: L([0.9, 0, 0, 0, 0], { tc: 0.55 }),
  c: L([0.6, 0.4, 0.4, 0.4, 0.4], { tc: 0.6, o: SIDE }),                 // polegar oposto aos dedos (abertura do C)
  d: L([0.8, 0, 0.95, 0.95, 0.95], { tc: 1.0, tb: 0.1, o: { ro: 1.55 } }), // polegar toca o dedo médio (círculo)
  e: L([0.9, 0.95, 0.95, 0.95, 0.95], { tc: 0.5, tb: 0.3, o: { wx: 0.15 } }),
  f: L([0.6, 0.8, 0, 0, 0], { tc: 0.9, tb: 0, sp: [0, 0, -0.1, -0.2, -0.3] }), // círculo polegar+indicador, 3 dedos em pé
  g: L([0.05, 0.05, 1, 1, 1], { o: { ro: 1.6 } }),                       // mão em pé, de perfil
  h: L([1, 0.05, 0.05, 1, 1], { tc: 0.7, tb: 0.4, sp: [0, 0.1, -0.1, 0, 0], o: { ro: 1.6 },
    path: [{ dro: 0.35, t: 0.18, lin: true }, { dro: -0.35, t: 0.3, lin: true }, { dro: 0, t: 0.18, lin: true, h: 0.2 }] }), // pequeno giro
  i: L([0.85, 1, 1, 1, 0]),
  j: L([0.85, 1, 1, 1, 0], { path: [ // risca um J: desce suave e curva para fora, sem baixar o braço todo
    { dsx: -0.05, dwz: -0.05, t: 0.2, lin: true }, { dsx: -0.12, dwz: -0.12, t: 0.2, lin: true },
    { dsx: -0.17, dwz: -0.4, t: 0.2, lin: true }, { dsx: -0.17, dwz: -0.8, dro: -0.15, t: 0.2, lin: true, h: 0.25 }] }),
  k: L([0.1, 0, 0.2, 1, 1], { sp: [0, 0.3, -0.25, 0, 0], tc: 0.1, hold: false,
    path: [{ dsx: -0.3, t: 0.45 }, { dsx: 0.05, t: 0.55, lin: true, h: 0.25 }] }), // mão sobe com os dedos na mesma posição
  l: L([0, 0, 1, 1, 1], { o: { ro: 2.7 } }),
  m: L([0.95, 0.05, 0.05, 0.05, 1], { tc: 0.6, tb: 0.5, o: { wx: 0.55, ro: 2.6 } }),  // 3 dedos retos para baixo
  n: L([0.95, 0.05, 0.05, 1, 1], { tc: 0.6, tb: 0.5, o: { wx: 0.55, ro: 2.6 } }),     // 2 dedos retos para baixo
  o: L([0.6, 0.8, 0.8, 0.8, 0.8], { tc: 0.9, tb: 0, o: { ro: 1.35, ...UP } }),          // polegar fecha com o indicador
  p: L([0.1, 0, 0.2, 1, 1], { sp: [0, 0.3, -0.25, 0, 0], tc: 0.1, o: OUT }),
  q: L([0.05, 0.05, 1, 1, 1], { o: PTDOWN }),                                       // dedos para baixo
  r: L([0.85, 0.02, 0, 1, 1], { sp: [0, -0.28, 0.28, 0, 0] }),
  s: L([0.9, 1, 1, 1, 1], { tc: 0.6, tb: 0.1, o: UP }),
  t: L([1, 0, 0, 1, 1], { tc: 0.6, tb: 0.7, o: UP }),                    // polegar sobre os dedos dobrados
  u: L([1, 0, 0, 1, 1], { tc: 1.1, tb: 0, o: UP }),
  v: L([0.85, 0, 0, 1, 1], { sp: [0, 0.22, -0.22, 0, 0] }),
  w: L([0.9, 0, 0, 0, 1], { sp: [0, 0.3, 0, -0.3, 0] }),
  x: L([0.6, 0.85, 1, 1, 1], { tc: 0.9, tb: 0.1, o: OUT,                 // pinça (gancho) e puxa de lado
    path: [{ dsz: -0.15, dwz: 0.55, t: 0.55, lin: true, h: 0.2 }] }),
  y: L([0, 1, 1, 1, 0], { sp: [0.3, 0, 0, 0, -0.3] }),
  z: L([0.7, 0, 1, 1, 1], { tc: 0.3, tb: 0.3, path: [{ abs: true, wz: -0.5, sx: 0.05 }, { abs: true, wz: 0.5, sx: 0.05 },
    { abs: true, wz: -0.5, sx: -0.2 }, { abs: true, wz: 0.5, sx: -0.2 }] }),
  // números (0 a 5)
  0: L([0.6, 0.8, 0.8, 0.8, 0.8], { tc: 0.9, tb: 0, o: { ro: 1.35, ...UP } }),
  1: L([0.85, 0, 1, 1, 1]),
  2: L([0.85, 0, 0, 1, 1], { sp: [0, 0.12, -0.12, 0, 0] }),
  3: L([0, 0, 0, 1, 1], { sp: [0.3, 0.1, -0.1, 0, 0] }),
  4: L([0.9, 0, 0, 0, 0], { sp: [0, 0.12, 0, -0.1, -0.2], tc: 0.4 }),
  5: L([0, 0, 0, 0, 0], { sp: [0.35, 0.15, 0.03, -0.1, -0.22] }),
};
const letterPose = (ch, over = {}) => {
  const s = ALPHA[ch];
  return pose({ ...BASE, ...s.o, ...over, f: s.f, sp: s.sp ?? [0, 0, 0, 0, 0], tc: s.tc ?? 0, tb: s.tb ?? 0 });
};
/* pose de um quadro do percurso: relativo à orientação da letra (ou absoluto com abs:true) */
function pathPose(ch, p) {
  const ori = { ...BASE, ...ALPHA[ch].o }, over = {};
  for (const [k, v] of Object.entries(p)) {
    if (/^d(sx|sz|el|ro|wx|wz)$/.test(k)) over[k.slice(1)] = ori[k.slice(1)] + v;
    else if (/^(sx|sz|el|ro|wx|wz)$/.test(k)) over[k] = v;
  }
  return letterPose(ch, over);
}
/* quadros de uma letra: pose estática + (H, J, K, X, Z) percurso; letra repetida ganha um "toque" para aparecer 2x */
function letterFrames(ch, first, repeated) {
  const s = ALPHA[ch], fr = [];
  if (repeated) fr.push({ pose: letterPose(ch, { sx: (s.o?.sx ?? BASE.sx) - 0.14, wx: (s.o?.wx ?? 0) + 0.2 }), t: 0.14, h: 0 });
  if (s.hold !== false) fr.push({ pose: letterPose(ch), t: first ? 0.45 : 0.3, h: s.path ? 0.05 : 0.3 });
  (s.path ?? []).forEach((p, i, arr) => fr.push({
    pose: pathPose(ch, p), t: p.t ?? 0.2, lin: !!p.lin, h: p.h ?? (i === arr.length - 1 ? 0.25 : 0),
  }));
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
