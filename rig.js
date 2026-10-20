/* Esqueleto 3D simples e neutro (só primitivas, sem arquivos de modelo).
 * Recebe o THREE por parâmetro para poder ser testado fora do navegador. */
export function buildRig(THREE) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0b697, roughness: 0.7 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2f5fa8, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d2433, roughness: 0.6 });
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; };

  // tronco, pescoço e cabeça
  const torso = mesh(new THREE.CapsuleGeometry(0.19, 0.42, 6, 14), cloth, 0, 1.1, 0);
  torso.scale.z = 0.7;
  root.add(torso);
  root.add(mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 12), skin, 0, 1.46, 0));
  const head = new THREE.Group(); head.position.set(0, 1.58, 0); root.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.13, 24, 18), skin, 0, 0.08, 0));
  head.add(mesh(new THREE.SphereGeometry(0.014, 10, 8), dark, -0.05, 0.1, 0.12));
  head.add(mesh(new THREE.SphereGeometry(0.014, 10, 8), dark, 0.05, 0.1, 0.12));

  const arms = {};
  for (const [key, side] of [["r", -1], ["l", 1]]) { // r fica do lado -X (esquerda de quem vê)
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.27, 1.34, 0);
    shoulder.add(mesh(new THREE.SphereGeometry(0.06, 14, 10), cloth));
    shoulder.add(mesh(new THREE.CapsuleGeometry(0.05, 0.2, 4, 10), cloth, 0, -0.15, 0));
    const elbow = new THREE.Group(); elbow.position.y = -0.3; shoulder.add(elbow);
    elbow.add(mesh(new THREE.SphereGeometry(0.045, 12, 8), skin));
    elbow.add(mesh(new THREE.CapsuleGeometry(0.04, 0.19, 4, 10), skin, 0, -0.137, 0));
    const wrist = new THREE.Group(); wrist.position.y = -0.27; elbow.add(wrist);
    wrist.add(mesh(new THREE.BoxGeometry(0.085, 0.09, 0.03), skin, 0, -0.045, 0));

    const fingers = [];
    // polegar (lado de dentro), depois indicador..mínimo
    const thumb = new THREE.Group(); thumb.position.set(-side * 0.05, -0.03, 0); wrist.add(thumb);
    thumb.add(mesh(new THREE.BoxGeometry(0.017, 0.045, 0.017), skin, 0, -0.022, 0));
    fingers.push({ pivots: [thumb], thumb: true });
    for (let k = 0; k < 4; k++) {
      const p1 = new THREE.Group(); p1.position.set(-side * (0.03 - 0.02 * k), -0.09, 0); wrist.add(p1);
      const len = [0.042, 0.047, 0.044, 0.036][k];
      p1.add(mesh(new THREE.BoxGeometry(0.016, len, 0.016), skin, 0, -len / 2, 0));
      const p2 = new THREE.Group(); p2.position.y = -len; p1.add(p2);
      p2.add(mesh(new THREE.BoxGeometry(0.014, len * 0.8, 0.014), skin, 0, -len * 0.4, 0));
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
      a.fingers.forEach((fg, i) => {
        const c = s.f[i];
        if (fg.thumb) fg.pivots[0].rotation.set(0, 0, a.side * (-0.5 + c * 1.1)); // fecha em direção à palma
        else { fg.pivots[0].rotation.x = -c * 1.4; fg.pivots[1].rotation.x = -c * 1.2; }
      });
    }
    head.rotation.set(p.head.rx, p.head.ry, 0);
  }
  return { root, arms, head, torso, apply };
}
