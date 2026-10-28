/* Esqueleto 3D do avatar "Conecta Libras": herói em estilo cartoon (cabelo, olhos grandes,
 * traje azul com emblema, capa curta). Só primitivas, sem arquivos de modelo.
 *
 * CONTRATO com avatar.js (não mudar): buildRig(THREE) -> { root, arms, head, torso, apply(pose), idle(now) }
 *   - apply(pose) usa a mesma convenção de ângulos de signs.js (sx, sz, el, ro, wx, wz, f[5], head).
 *   - idle(now) é opcional: piscar de olhos (chamado a cada quadro).
 * Recebe o THREE por parâmetro para poder ser testado fora do navegador. */

const C = {
  skin: 0xf1b98f, skinShade: 0xe3a37a, hair: 0x4a2c1a, suit: 0x1f4fb0, gold: 0xf5b82e,
  cuff: 0x32b6dd, outline: 0x0d1f3d, eyeWhite: 0xffffff, iris: 0x5a3720, pupil: 0x141018, mouth: 0x8a3b30,
};

/* Emblema do peito: mão dentro de um balão de fala, desenhada num canvas (sem imagem externa). */
function emblemTexture(THREE) {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  g.fillStyle = "#1f4fb0"; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
  g.fillStyle = "#ffffff"; g.strokeStyle = "#ffffff"; g.lineWidth = 6;
  g.beginPath(); g.arc(128, 122, 96, 0, 7); g.fill(); // balão
  g.beginPath(); g.moveTo(70, 190); g.lineTo(52, 232); g.lineTo(104, 206); g.closePath(); g.fill(); // cauda
  g.fillStyle = "#1f4fb0"; g.strokeStyle = "#1f4fb0"; g.lineCap = "round"; g.lineJoin = "round";
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); g.fill(); };
  rr(94, 118, 68, 60, 22); // palma
  [[98, 70, 14, 64], [117, 58, 14, 76], [136, 62, 14, 72], [155, 78, 14, 58]].forEach(([x, y, w, h]) => rr(x, y, w, h, 7)); // dedos
  g.save(); g.translate(92, 150); g.rotate(-0.7); rr(-8, -34, 15, 44, 7); g.restore(); // polegar
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildRig(THREE) {
  const root = new THREE.Group();
  // rampa de 3 tons (suave, sem faixa escura no rosto)
  const ramp = new THREE.DataTexture(new Uint8Array([170, 215, 255]), 3, 1, THREE.RedFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
  const skin = toon(C.skin), suit = toon(C.suit), gold = toon(C.gold), hairMat = toon(C.hair), cuffMat = toon(C.cuff);
  const outlineMat = new THREE.MeshBasicMaterial({ color: C.outline, side: THREE.BackSide });

  /* mesh com contorno opcional (casco invertido) */
  const mesh = (geo, mat, x = 0, y = 0, z = 0, outline = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (outline) { const o = new THREE.Mesh(geo, outlineMat); o.scale.setScalar(1 + outline); m.add(o); }
    return m;
  };

  /* ---- tronco, cinto, emblema, pernas ---- */
  const torso = mesh(new THREE.CapsuleGeometry(0.19, 0.42, 6, 18), suit, 0, 1.1, 0, 0.035);
  torso.scale.z = 0.7; // avatar.js anima torso.scale.y (respiração): não pendurar nada aqui dentro
  root.add(torso);

  const belt = mesh(new THREE.CylinderGeometry(0.193, 0.193, 0.07, 24), gold, 0, 0.93, 0, 0.04);
  belt.scale.z = 0.7; root.add(belt);
  const buckle = mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.02, 16), gold, 0, 0.93, 0.142, 0.06);
  buckle.rotation.x = Math.PI / 2; root.add(buckle);

  const tex = emblemTexture(THREE);
  const emblem = new THREE.Mesh(
    new THREE.CircleGeometry(0.078, 32),
    new THREE.MeshBasicMaterial(tex ? { map: tex, transparent: true } : { color: 0xffffff }),
  );
  emblem.position.set(0, 1.2, 0.138); root.add(emblem);

  for (const x of [-0.09, 0.09]) root.add(mesh(new THREE.CapsuleGeometry(0.075, 0.3, 4, 12), suit, x, 0.58, 0, 0.04));

  /* ---- capa curta e rígida, presa só nas costas (não cobre as mãos) ---- */
  const capeShape = new THREE.Shape();
  capeShape.moveTo(-0.2, 0); capeShape.lineTo(0.2, 0); capeShape.lineTo(0.26, -0.62); capeShape.lineTo(-0.26, -0.62); capeShape.closePath();
  const cape = new THREE.Mesh(new THREE.ShapeGeometry(capeShape), toon(C.gold, { side: THREE.DoubleSide }));
  cape.position.set(0, 1.42, -0.15); cape.rotation.x = 0.14; root.add(cape);
  for (const x of [-0.12, 0.12]) root.add(mesh(new THREE.SphereGeometry(0.026, 12, 10), gold, x, 1.43, 0.1)); // fecho da capa

  /* ---- pescoço e cabeça ---- */
  root.add(mesh(new THREE.CylinderGeometry(0.05, 0.062, 0.1, 14), skin, 0, 1.5, 0));
  const head = new THREE.Group(); head.position.set(0, 1.56, 0); root.add(head);
  const face = mesh(new THREE.SphereGeometry(0.19, 32, 24), skin, 0, 0.14, 0, 0.03);
  head.add(face);
  const hc = new THREE.Group(); hc.position.set(0, 0.14, 0); head.add(hc); // origem do rosto (centro da cabeça)

  // cabelo: esfera deslocada para trás/cima + topete
  hc.add(mesh(new THREE.SphereGeometry(0.205, 28, 20), hairMat, 0, 0.03, -0.035, 0.03));
  [[0.1, 0.17, 0.09, 0.06], [0.03, 0.19, 0.11, 0.065], [-0.05, 0.19, 0.1, 0.06], [-0.12, 0.15, 0.08, 0.05], [0.0, 0.215, 0.03, 0.06]]
    .forEach(([x, y, z, r]) => hc.add(mesh(new THREE.SphereGeometry(r, 14, 10), hairMat, x, y, z, 0.05)));
  for (const s of [-1, 1]) { // orelhas
    const ear = mesh(new THREE.SphereGeometry(0.04, 12, 10), skin, s * 0.2, -0.015, 0, 0.05); ear.scale.set(0.55, 1, 0.8); hc.add(ear);
  }
  hc.add(mesh(new THREE.SphereGeometry(0.02, 12, 10), toon(C.skinShade), 0, -0.03, 0.188)); // nariz

  // olhos grandes (grupo por olho, para piscar)
  const eyes = [];
  for (const s of [-1, 1]) {
    const eye = new THREE.Group(); eye.position.set(s * 0.072, 0.02, 0); hc.add(eye);
    const white = new THREE.Mesh(new THREE.SphereGeometry(0.046, 18, 14), new THREE.MeshBasicMaterial({ color: C.eyeWhite }));
    white.position.z = 0.156; white.scale.set(1, 1.18, 0.45); eye.add(white);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: C.iris }));
    iris.position.set(s * 0.004, 0, 0.168); iris.scale.set(1, 1.1, 0.5); eye.add(iris);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 10), new THREE.MeshBasicMaterial({ color: C.pupil }));
    pupil.position.set(s * 0.004, 0, 0.176); pupil.scale.z = 0.5; eye.add(pupil);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    glint.position.set(s * 0.004 + 0.011, 0.014, 0.183); eye.add(glint);
    eyes.push(eye);
    // sobrancelha
    const brow = mesh(new THREE.CapsuleGeometry(0.009, 0.05, 4, 8), hairMat, s * 0.076, 0.095, 0.152);
    brow.rotation.set(0, s * 0.45, Math.PI / 2 + s * 0.12); hc.add(brow);
  }

  // sorriso: arco de torus voltado para baixo
  const arc = Math.PI * 0.8;
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.0065, 6, 24, arc), new THREE.MeshBasicMaterial({ color: C.mouth }));
  mouth.position.set(0, -0.034, 0.168); mouth.rotation.z = -Math.PI / 2 - arc / 2; hc.add(mouth);

  /* ---- braços (mesma hierarquia e eixos do rig anterior; mãos maiores para ficarem legíveis) ---- */
  const arms = {};
  for (const [key, side] of [["r", -1], ["l", 1]]) { // r fica do lado -X (esquerda de quem vê)
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.27, 1.34, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(0.065, 16, 12), suit, 0, 0, 0, 0.05));
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.052, 0.2, 4, 12), suit, 0, -0.15, 0, 0.05));
    const elbow = new THREE.Group(); elbow.position.y = -0.3; shoulder.add(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.048, 14, 10), suit));
    elbow.add(mesh(new THREE.CapsuleGeometry(0.043, 0.19, 4, 12), suit, 0, -0.137, 0, 0.05));
    elbow.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16), cuffMat, 0, -0.235, 0, 0.06)); // punho ciano
    const wrist = new THREE.Group(); wrist.position.y = -0.27; elbow.add(wrist);
    wrist.add(mesh(new THREE.BoxGeometry(0.11, 0.115, 0.04), skin, 0, -0.0575, 0));

    const fingers = [];
    const thumb = new THREE.Group(); thumb.position.set(-side * 0.065, -0.04, 0); wrist.add(thumb);
    thumb.add(mesh(new THREE.CapsuleGeometry(0.012, 0.04, 3, 8), skin, 0, -0.032, 0));
    fingers.push({ pivots: [thumb], thumb: true });
    for (let k = 0; k < 4; k++) {
      const p1 = new THREE.Group(); p1.position.set(-side * (0.039 - 0.026 * k), -0.115, 0); wrist.add(p1);
      const len = [0.055, 0.062, 0.058, 0.047][k], r = 0.011;
      p1.add(mesh(new THREE.CapsuleGeometry(r, len - 2 * r, 3, 8), skin, 0, -len / 2, 0));
      const p2 = new THREE.Group(); p2.position.y = -len; p1.add(p2);
      const l2 = len * 0.85;
      p2.add(mesh(new THREE.CapsuleGeometry(r * 0.92, l2 - 2 * r * 0.92, 3, 8), skin, 0, -l2 / 2, 0));
      fingers.push({ pivots: [p1, p2] });
    }
    root.add(shoulder);
    arms[key] = { side, shoulder, elbow, wrist, fingers };
  }

  function apply(p) {
    for (const key of ["r", "l"]) {
      const a = arms[key], s = p[key];
      a.shoulder.rotation.set(-s.sx, 0, a.side * s.sz);
      a.elbow.rotation.set(-s.el, -a.side * s.ro, 0);
      a.wrist.rotation.set(-s.wx, 0, a.side * s.wz);
      // sp[i]: abertura lateral do dedo (rad, + = em direção ao polegar); tc: polegar cruzando à frente da mão (0..1)
      a.fingers.forEach((fg, i) => {
        const c = s.f[i], sp = s.sp?.[i] ?? 0;
        if (fg.thumb) fg.pivots[0].rotation.set(-(s.tc ?? 0) * 1.1, 0, a.side * (-0.5 + c * 1.1 - sp)); // fecha em direção à palma
        else {
          fg.pivots[0].rotation.set(-c * 1.4, 0, -a.side * sp);
          fg.pivots[1].rotation.x = -c * 1.2;
        }
      });
    }
    head.rotation.set(p.head.rx, p.head.ry, 0);
  }

  /* piscar a cada ~3,6 s, por ~130 ms */
  function idle(now) {
    const ph = now % 3600;
    const k = ph < 130 ? Math.sin((ph / 130) * Math.PI) : 0;
    for (const e of eyes) e.scale.y = 1 - 0.92 * k;
  }

  return { root, arms, head, torso, apply, idle };
}
