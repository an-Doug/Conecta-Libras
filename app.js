import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- Navegação ---------- */
let previous = "home", screen = "home", mode = "speech";
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
}
function showScreen(next) {
  screen = next;
  for (const id of ["home", "conversation", "help"]) $(id).hidden = id !== next;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function setMode(next) {
  mode = next;
  $("speech-mode").hidden = next !== "speech";
  $("camera-mode").hidden = next !== "camera";
  for (const [id, v] of [["tab-speech", "speech"], ["tab-camera", "camera"]]) {
    $(id).classList.toggle("active", next === v);
    $(id).setAttribute("aria-pressed", String(next === v));
  }
  if (next === "camera") stopListening();
  else stopCamera();
  showScreen("conversation");
  if (next === "speech") ensureAvatar();
}
$("start-speech").onclick = () => setMode("speech");
$("start-camera").onclick = () => setMode("camera");
$("open-help").onclick = () => { previous = screen; showScreen("help"); };
$("back-help").onclick = () => showScreen(previous);
$("help-start").onclick = () => setMode("speech");
$("back-home").onclick = () => { stopListening(); stopCamera(); showScreen("home"); };
$("tab-speech").onclick = $("switch-speech").onclick = () => setMode("speech");
$("tab-camera").onclick = $("switch-camera").onclick = () => setMode("camera");

/* ---------- Histórico ---------- */
function addHistory(kind, text) {
  if (!text) return;
  $("history-empty").hidden = true;
  const card = document.createElement("article");
  card.className = "hist" + (kind === "camera" ? " camera" : "");
  const label = document.createElement("small");
  label.textContent = kind === "camera" ? "Libras → texto" : "Fala → Libras";
  const body = document.createElement("p"); body.textContent = text;
  card.append(label, body);
  $("history-list").prepend(card);
}
$("new-conversation").onclick = () => {
  stopListening(); stopCamera(); clearSpeech(); clearCamera();
  $("history-list").replaceChildren(); $("history-empty").hidden = false;
  toast("Nova conversa iniciada.");
};

/* =========================================================
   FALA → LIBRAS  (Web Speech API + avatar 3D VLibras)
   ========================================================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, lastSent = "";

function setSpeechStatus(text, live) {
  $("speech-status-text").textContent = text;
  $("speech-status").classList.toggle("live", !!live);
}
function showTranscript(text) {
  const el = $("speech-text");
  el.textContent = text || "Toque no microfone e fale. A transcrição aparece aqui.";
  el.classList.toggle("muted", !text); el.classList.toggle("has", !!text);
}
function startListening() {
  if (!SR) { toast("Reconhecimento de voz indisponível neste navegador. Use o campo de texto (ou Chrome/Edge/Safari)."); $("type-input").focus(); return; }
  ensureAvatar();
  rec = new SR();
  rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = true;
  rec.onresult = (e) => {
    let interim = "", final = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    showTranscript((final || interim).trim());
    if (final.trim()) sendToAvatar(final.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Permita o uso do microfone para falar."); stopListening(); }
    else if (e.error !== "no-speech" && e.error !== "aborted") toast("Erro no microfone: " + e.error);
  };
  rec.onend = () => { if (listening) { try { rec.start(); } catch {} } };
  try { rec.start(); } catch {}
  listening = true;
  $("mic-label").textContent = "⏹ Parar de ouvir";
  $("mic-button").classList.add("live"); $("mic-button").setAttribute("aria-pressed", "true");
  setSpeechStatus("Ouvindo…", true);
}
function stopListening() {
  listening = false;
  try { rec && rec.stop(); } catch {}
  $("mic-label").textContent = "🎤 Começar a falar";
  $("mic-button").classList.remove("live"); $("mic-button").setAttribute("aria-pressed", "false");
  setSpeechStatus("Pronto para ouvir", false);
}
$("mic-button").onclick = () => (listening ? stopListening() : startListening());

$("type-form").onsubmit = (e) => {
  e.preventDefault();
  const v = $("type-input").value.trim();
  if (!v) return;
  $("type-input").value = ""; showTranscript(v); ensureAvatar(); sendToAvatar(v);
};
$("speech-repeat").onclick = () => (lastSent ? (ensureAvatar(), translate(lastSent)) : toast("Nada para repetir ainda."));
function clearSpeech() { showTranscript(""); lastSent = ""; try { window.plugin?.player?.stop?.(); } catch {} }
$("speech-clear").onclick = () => { clearSpeech(); toast("Limpo."); };

/* --- Avatar 3D: widget oficial VLibras (https://vlibras.gov.br) --- */
let avatarState = "idle"; // idle | loading | ready | error
let avatarPromise = null;
function setAvatarMsg(msg, loading) {
  $("avatar-msg").textContent = msg;
  $("avatar-placeholder").classList.toggle("loading", !!loading);
}
function ensureAvatar() {
  if (avatarPromise) return avatarPromise;
  avatarState = "loading"; setAvatarMsg("Carregando o avatar de Libras…", true);
  avatarPromise = new Promise((resolve) => {
    $("vw-host").innerHTML =
      '<div vw class="enabled"><div vw-access-button class="active"></div>' +
      '<div vw-plugin-wrapper><div class="vw-plugin-top-wrapper"></div></div></div>';
    const s = document.createElement("script");
    s.src = "https://vlibras.gov.br/app/vlibras-plugin.js";
    s.onload = () => {
      try { new window.VLibras.Widget("https://vlibras.gov.br/app"); } catch {}
      // abre o painel do avatar e espera o player ficar disponível
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        const btn = document.querySelector("[vw-access-button]");
        if (btn && !document.querySelector("[vw-plugin-wrapper].active")) btn.click();
        if (window.plugin?.player) {
          clearInterval(iv); avatarState = "ready";
          setAvatarMsg("Avatar pronto. Fale ou digite uma mensagem.", false);
          $("avatar-placeholder").hidden = true; resolve(true);
        } else if (tries > 60) {
          clearInterval(iv); avatarState = "error"; avatarPromise = null;
          setAvatarMsg("Não foi possível carregar o avatar. Verifique a internet e tente de novo.", false);
          resolve(false);
        }
      }, 500);
    };
    s.onerror = () => { avatarState = "error"; avatarPromise = null; setAvatarMsg("Sem conexão com o serviço VLibras.", false); resolve(false); };
    document.body.appendChild(s);
  });
  return avatarPromise;
}
async function sendToAvatar(text) {
  lastSent = text; addHistory("speech", text);
  await translate(text);
}
async function translate(text) {
  const ok = await ensureAvatar();
  if (!ok) { toast("Avatar indisponível no momento."); return; }
  try { window.plugin.player.translate(text); setSpeechStatus("Avatar sinalizando…", listening); }
  catch { toast("Não foi possível enviar o texto ao avatar."); }
}

/* =========================================================
   LIBRAS → TEXTO  (câmera + MediaPipe Hands + kNN de sinais)
   ========================================================= */
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d");
let stream = null, landmarker = null, running = false, lastTs = -1;
let words = [];
let samples = store.get("libras-samples", []); // [{label, v:[126]}]
const KNN_K = 3, MAX_DIST = 0.9, STABLE_FRAMES = 10, COOLDOWN_MS = 1500;
let candidate = null, candCount = 0, lastEmit = { label: null, t: 0 }, lastHandSeen = 0;
let recording = null; // {label, left, vecs}

function setCamStatus(text, live) {
  $("camera-status-text").textContent = text;
  $("camera-status").classList.toggle("live", !!live);
}
function showCamText() {
  const el = $("camera-text"), t = words.join(" ");
  el.textContent = t || "As palavras reconhecidas aparecem aqui.";
  el.classList.toggle("muted", !t); el.classList.toggle("has", !!t);
}
async function getLandmarker() {
  if (landmarker) return landmarker;
  const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate },
    runningMode: "VIDEO", numHands: 2,
  });
  try { landmarker = await HandLandmarker.createFromOptions(fileset, opts("GPU")); }
  catch { landmarker = await HandLandmarker.createFromOptions(fileset, opts("CPU")); }
  return landmarker;
}
async function startCamera() {
  if (running) return;
  if (!navigator.mediaDevices?.getUserMedia) { toast("Câmera indisponível. Abra o app por HTTPS."); return; }
  try {
    setCamStatus("Iniciando câmera…", false);
    $("camera-toggle").disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play();
    await getLandmarker();
    running = true; lastTs = -1;
    $("camera-hint").hidden = true;
    $("camera-toggle").textContent = "⏹ Parar câmera"; $("camera-toggle").classList.add("live");
    setCamStatus("Procurando mãos…", true);
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    toast(err.name === "NotAllowedError" ? "Permita o uso da câmera para continuar." : "Não foi possível iniciar a câmera.");
    stopCamera();
  } finally { $("camera-toggle").disabled = false; }
}
function stopCamera() {
  running = false; recording = null;
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("camera-toggle").textContent = "📷 Iniciar câmera"; $("camera-toggle").classList.remove("live");
  $("camera-hint").hidden = false;
  setCamStatus("Câmera desligada", false);
}
$("camera-toggle").onclick = () => (running ? stopCamera() : startCamera());

function loop() {
  if (!running) return;
  if (video.readyState >= 2 && video.currentTime !== lastTs) {
    lastTs = video.currentTime;
    const res = landmarker.detectForVideo(video, performance.now());
    draw(res); handle(res);
  }
  requestAnimationFrame(loop);
}
function draw(res) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3; ctx.strokeStyle = "#69e7a9"; ctx.fillStyle = "#fff";
  for (const hand of res.landmarks || []) {
    for (const c of HandLandmarker.HAND_CONNECTIONS) {
      const a = hand[c.start], b = hand[c.end];
      ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke();
    }
    for (const p of hand) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, 7); ctx.fill(); }
  }
}
// vetor de 126 números: 21 pontos x 3 coords x 2 mãos, normalizado pelo pulso e pelo tamanho da mão
function features(res) {
  const out = new Array(126).fill(0);
  (res.landmarks || []).forEach((hand, i) => {
    const side = res.handednesses?.[i]?.[0]?.categoryName === "Left" ? 0 : 1;
    const w = hand[0]; let max = 1e-6;
    const pts = hand.map((p) => [p.x - w.x, p.y - w.y, p.z - w.z]);
    for (const p of pts) max = Math.max(max, Math.hypot(...p));
    pts.forEach((p, j) => { const o = side * 63 + j * 3; out[o] = p[0] / max; out[o + 1] = p[1] / max; out[o + 2] = p[2] / max; });
  });
  return out;
}
function classify(v) {
  if (!samples.length) return null;
  const d = samples.map((s) => ({ label: s.label, d: Math.sqrt(s.v.reduce((a, x, i) => a + (x - v[i]) ** 2, 0)) })).sort((a, b) => a.d - b.d);
  if (d[0].d > MAX_DIST) return null;
  const top = d.slice(0, KNN_K), votes = {};
  for (const t of top) votes[t.label] = (votes[t.label] || 0) + 1;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function handle(res) {
  const now = performance.now();
  if (!res.landmarks?.length) {
    if (now - lastHandSeen > 1000) { candidate = null; candCount = 0; lastEmit.label = null; if (!recording) setCamStatus("Procurando mãos…", true); }
    return;
  }
  lastHandSeen = now;
  const v = features(res);
  if (recording) { // modo ensinar
    if (recording.left > 0) { recording.vecs.push(v); recording.left--; $("teach-msg").textContent = `Gravando… faltam ${recording.left}`; }
    if (recording.left === 0) finishRecording();
    return;
  }
  const label = classify(v);
  if (!label) { candidate = null; candCount = 0; setCamStatus(samples.length ? "Mãos detectadas" : "Mãos detectadas · ensine sinais abaixo", true); return; }
  if (label === candidate) candCount++; else { candidate = label; candCount = 1; }
  setCamStatus(`Reconhecendo: ${label}`, true);
  if (candCount >= STABLE_FRAMES && !(lastEmit.label === label && now - lastEmit.t < COOLDOWN_MS)) {
    words.push(label); lastEmit = { label, t: now }; candCount = 0; showCamText();
  }
}
$("camera-undo").onclick = () => { words.pop(); showCamText(); };
function clearCamera() { words = []; showCamText(); lastEmit = { label: null, t: 0 }; if ("speechSynthesis" in window) speechSynthesis.cancel(); }
$("camera-clear").onclick = () => { clearCamera(); };
$("camera-speak").onclick = () => {
  const text = words.join(" ");
  if (!text) return toast("Ainda não há texto para falar.");
  if (!("speechSynthesis" in window)) return toast("Voz indisponível neste navegador.");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text); u.lang = "pt-BR"; u.rate = 0.95;
  u.onerror = () => toast("Não foi possível reproduzir a voz.");
  speechSynthesis.speak(u);
  addHistory("camera", text); words = []; showCamText();
};

/* --- Ensinar sinais --- */
function renderSamples() {
  const labels = [...new Set(samples.map((s) => s.label))];
  const ul = $("teach-list"); ul.replaceChildren();
  for (const l of labels) {
    const li = document.createElement("li"); li.append(l + " ");
    const b = document.createElement("button"); b.textContent = "×"; b.setAttribute("aria-label", "Remover " + l);
    b.onclick = () => { samples = samples.filter((s) => s.label !== l); store.set("libras-samples", samples); renderSamples(); };
    li.append(b); ul.append(li);
  }
}
$("teach-record").onclick = async () => {
  const label = $("teach-label").value.trim();
  if (!label) return toast("Digite a palavra do sinal primeiro.");
  if (!running) { await startCamera(); if (!running) return; }
  $("teach-msg").textContent = "Faça o sinal diante da câmera…";
  recording = { label, left: 25, vecs: [] };
};
function finishRecording() {
  const r = recording; recording = null;
  for (const v of r.vecs) samples.push({ label: r.label, v });
  store.set("libras-samples", samples); renderSamples();
  $("teach-msg").textContent = `“${r.label}” gravado. Faça o sinal de novo para testar.`;
  $("teach-label").value = "";
}

/* ---------- PWA ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("install").hidden = false; });
$("install").onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $("install").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (document.hidden) { stopListening(); stopCamera(); } });
renderSamples();
