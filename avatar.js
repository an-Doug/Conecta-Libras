/* Avatar 3D de Libras: cena Three.js + sequenciador de quadros-chave. */
import { buildRig } from "./rig.js";
import { REST, textToFrames } from "./signs.js";

const clonePose = (p) => JSON.parse(JSON.stringify(p));
const ease = (k) => k * k * (3 - 2 * k);
const mix = (a, b, k) => a + (b - a) * k;
function blend(a, b, k) {
  const out = { head: { rx: mix(a.head.rx, b.head.rx, k), ry: mix(a.head.ry, b.head.ry, k) } };
  for (const key of ["r", "l"]) {
    const o = {};
    for (const n of ["sx", "sz", "el", "ro", "wx", "wz"]) o[n] = mix(a[key][n], b[key][n], k);
    o.f = a[key].f.map((v, i) => mix(v, b[key].f[i], k));
    out[key] = o;
  }
  return out;
}

export function createAvatar(THREE, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); // lança erro se não houver WebGL
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  renderer.domElement.setAttribute("aria-hidden", "true");
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8fa3c4, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.5, 3, 3); scene.add(key);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(0, 1.35, 2.8);
  camera.lookAt(0, 1.3, 0);

  const rig = buildRig(THREE);
  scene.add(rig.root);

  let cur = clonePose(REST);
  rig.apply(cur);

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container);

  // sequenciador: lista de segmentos {from, to, dur, onStart}
  let track = null, raf = 0;
  function startSegment(now) {
    const seg = track.segs[track.i];
    seg.t0 = now; seg.from = clonePose(cur);
    seg.onStart?.();
  }
  function finish() { const r = track?.resolve; track = null; r?.(); }
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (document.hidden || !container.isConnected) return;
    if (track) {
      if (track.i < 0) { track.i = 0; startSegment(now); }
      let seg = track.segs[track.i];
      while (seg && now - seg.t0 >= seg.dur * 1000) {
        cur = seg.to;
        track.i++;
        if (track.i >= track.segs.length) { finish(); seg = null; break; }
        seg = track.segs[track.i]; startSegment(now);
      }
      if (track && seg) cur = blend(seg.from, seg.to, ease(Math.min(1, (now - seg.t0) / (seg.dur * 1000))));
      rig.apply(cur);
    }
    rig.torso.scale.y = 1 + Math.sin(now / 900) * 0.008; // respiração sutil
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(tick);

  function play(segs) {
    stop();
    return new Promise((resolve) => { track = { segs, i: -1, resolve }; });
  }
  function stop() {
    if (!track) return;
    const r = track.resolve; track = null; r();
  }

  return {
    /** Sinaliza o texto inteiro; resolve ao terminar (ou ao ser interrompido). */
    speak(text, { onWord } = {}) {
      const frames = textToFrames(text);
      if (!frames.length) return Promise.resolve();
      const segs = [];
      let lastWord = "";
      for (const fr of frames) {
        if (fr.word) lastWord = fr.word;
        const label = fr.spelled ? `${lastWord} · ${fr.spelled}` : fr.word;
        segs.push({
          to: fr.pose, dur: fr.t,
          onStart: label ? () => onWord?.(label, fr) : undefined,
        });
        if (fr.h > 0) segs.push({ to: fr.pose, dur: fr.h });
      }
      segs.push({ to: REST, dur: 0.6, onStart: () => onWord?.("") });
      return play(segs);
    },
    stop() { stop(); cur = clonePose(REST); rig.apply(cur); },
    destroy() { stop(); cancelAnimationFrame(raf); ro?.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
