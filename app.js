const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* ---------- Estilos extras (histórico) ---------- */
const extraCss = document.createElement("style");
extraCss.textContent = `
.hist-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.hist-head h2{margin:0}
.hist-head .link{width:auto;margin:0;font-size:14px;min-height:32px}
.hist-top{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:2px}
.hist-top small{margin:0}
.hist-replay{min-height:32px;padding:0 12px;border-radius:99px;background:var(--soft);color:var(--blue);font-weight:700;font-size:13px}
.diag-bar{height:10px;background:#e1e7f0;border-radius:99px;overflow:hidden}
.diag-bar i{display:block;height:100%;width:0;background:var(--green)}
.diag-log{font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;background:#f1f4f9;border-radius:12px;padding:8px;max-height:200px;overflow:auto;margin:8px 0 0;color:var(--ink)}
`;
document.head.appendChild(extraCss);

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

/* ---------- Histórico (persistente neste aparelho) ---------- */
const HISTORY_KEY = "libras-history", HISTORY_MAX = 50;
let history = store.get(HISTORY_KEY, []); // [{kind, text, t}]
if (!Array.isArray(history)) history = [];

function timeLabel(t) {
  try { return new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}
function renderHistory() {
  const list = $("history-list");
  list.replaceChildren();
  $("history-empty").hidden = history.length > 0;
  $("history-clear").hidden = history.length === 0;
  for (const item of history) {
    const card = document.createElement("article");
    card.className = "hist" + (item.kind === "camera" ? " camera" : "");
    const top = document.createElement("div"); top.className = "hist-top";
    const label = document.createElement("small");
    label.textContent = (item.kind === "camera" ? "Libras → texto" : "Fala → Libras") + " · " + timeLabel(item.t);
    top.append(label);
    if (item.kind !== "camera") {
      const b = document.createElement("button");
      b.className = "hist-replay"; b.type = "button"; b.textContent = "▶ Ver de novo";
      b.setAttribute("aria-label", "Ver de novo em Libras: " + item.text);
      b.onclick = () => { setMode("speech"); showTranscript(item.text); translate(item.text); };
      top.append(b);
    }
    const body = document.createElement("p"); body.textContent = item.text;
    card.append(top, body);
    list.append(card);
  }
}
function addHistory(kind, text) {
  if (!text) return;
  history.unshift({ kind, text, t: Date.now() });
  if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  store.set(HISTORY_KEY, history);
  renderHistory();
}
function clearHistory() {
  history = []; store.set(HISTORY_KEY, history); renderHistory();
}
// botão "Limpar histórico" criado aqui para não depender de mudança no HTML
(function setupHistoryHeader() {
  const title = $("history-title");
  const head = document.createElement("div"); head.className = "hist-head";
  title.replaceWith(head); head.append(title);
  const btn = document.createElement("button");
  btn.id = "history-clear"; btn.type = "button"; btn.className = "link"; btn.textContent = "Limpar histórico";
  btn.onclick = () => { clearHistory(); toast("Histórico apagado."); };
  head.append(btn);
})();

$("new-conversation").onclick = () => {
  stopListening(); stopCamera(); clearSpeech(); clearCamera(); clearHistory();
  toast("Nova conversa iniciada.");
};

/* =========================================================
   FALA → LIBRAS  (Web Speech API + avatar 3D próprio com Three.js)
   ========================================================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false, lastSent = "", handled = 0;

function refreshSpeechStatus() {
  let text = "Pronto para ouvir", live = false;
  if (pending > 0) { text = "Avatar sinalizando…"; live = true; }
  else if (listening) { text = "Ouvindo…"; live = true; }
  $("speech-status-text").textContent = text;
  $("speech-status").classList.toggle("live", live);
}
function showTranscript(text) {
  const el = $("speech-text");
  el.textContent = text || "Toque no microfone e fale. A transcrição aparece aqui.";
  el.classList.toggle("muted", !text); el.classList.toggle("has", !!text);
}
let netRetried = false;
function startListening(continuous = true) {
  if (!SR) { toast("Reconhecimento de voz indisponível neste navegador. Use o campo de texto (ou Chrome/Edge/Safari)."); $("type-input").focus(); return; }
  if (continuous) netRetried = false;
  ensureAvatar();
  try { rec && (rec.onend = null, rec.onerror = null, rec.abort()); } catch {}
  rec = new SR();
  rec.lang = "pt-BR"; rec.interimResults = true; rec.continuous = continuous;
  rec.onstart = () => { handled = 0; };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i], t = r[0].transcript;
      if (r.isFinal) {
        // evita reenviar resultados finais repetidos (comportamento do Chrome/Android)
        if (i >= handled) { handled = i + 1; const phrase = t.trim(); if (phrase) { showTranscript(phrase); sendToAvatar(phrase); } }
      } else interim += t;
    }
    if (interim.trim()) showTranscript(interim.trim());
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") { toast("Permita o uso do microfone para falar."); stopListening(); }
    else if (e.error === "network") {
      // o reconhecimento de voz do navegador depende de um serviço online do fabricante
      if (!netRetried) { netRetried = true; setTimeout(() => startListening(false), 500); return; }
      stopListening();
      toast("O reconhecimento de voz não conseguiu se conectar. Tente o Chrome ou Edge (sem VPN/bloqueadores) ou use o campo de texto.");
      $("type-input").focus();
    }
    else if (e.error === "audio-capture") { toast("Nenhum microfone encontrado."); stopListening(); }
    else if (e.error !== "no-speech" && e.error !== "aborted") toast("Erro no microfone: " + e.error);
  };
  rec.onend = () => { if (listening) setTimeout(() => { if (listening) { try { rec.start(); } catch {} } }, 250); };
  listening = true;
  try { rec.start(); } catch {}
  $("mic-label").textContent = "⏹ Parar de ouvir";
  $("mic-button").classList.add("live"); $("mic-button").setAttribute("aria-pressed", "true");
  refreshSpeechStatus();
}
function stopListening() {
  listening = false;
  try { rec && rec.stop(); } catch {}
  $("mic-label").textContent = "🎤 Começar a falar";
  $("mic-button").classList.remove("live"); $("mic-button").setAttribute("aria-pressed", "false");
  refreshSpeechStatus();
}
$("mic-button").onclick = () => (listening ? stopListening() : startListening());

$("type-form").onsubmit = (e) => {
  e.preventDefault();
  const v = $("type-input").value.trim();
  if (!v) return;
  $("type-input").value = ""; showTranscript(v); sendToAvatar(v);
};
$("speech-repeat").onclick = () => (lastSent ? translate(lastSent) : toast("Nada para repetir ainda."));
function clearSpeech() {
  showTranscript(""); lastSent = "";
  gen++; chain = Promise.resolve(); pending = 0; playing = false;
  try { avatar?.stop(); } catch {}
  showCaption("");
  refreshSpeechStatus();
}
$("speech-clear").onclick = () => { clearSpeech(); toast("Limpo."); };

/* --- Avatar 3D próprio (Three.js, carregado sob demanda) --- */
const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
let avatarPromise = null, avatar = null, gen = 0, chain = Promise.resolve(), pending = 0, playing = false, captionEl = null;
function setAvatarMsg(msg, loading) {
  $("avatar-msg").textContent = msg;
  $("avatar-placeholder").classList.toggle("loading", !!loading);
}
function showCaption(text) {
  if (!captionEl) return;
  captionEl.textContent = text || "";
  captionEl.hidden = !text;
}
function ensureAvatar() {
  if (avatarPromise) return avatarPromise;
  setAvatarMsg("Carregando o avatar de Libras…", true);
  avatarPromise = (async () => {
    let host = null;
    try {
      const [THREE, mod] = await Promise.all([import(THREE_URL), import("./avatar.js")]);
      host = document.createElement("div");
      host.id = "avatar-3d"; host.style.cssText = "position:absolute;inset:0";
      $("avatar-stage").prepend(host);
      avatar = mod.createAvatar(THREE, host);
      captionEl = document.createElement("p");
      captionEl.className = "camera-hint"; captionEl.hidden = true; captionEl.setAttribute("aria-hidden", "true");
      $("avatar-stage").append(captionEl);
      $("avatar-placeholder").hidden = true;
      return true;
    } catch (err) {
      console.error(err);
      host?.remove(); avatar = null; avatarPromise = null;
      setAvatarMsg("Não foi possível iniciar o avatar 3D. Verifique a internet e se o navegador permite gráficos 3D (WebGL).", false);
      return false;
    }
  })();
  return avatarPromise;
}

/* Fila de frases: cada frase só começa quando a anterior termina */
function setPending(n) { pending = Math.max(0, n); playing = pending > 0; refreshSpeechStatus(); }
async function translate(text) {
  const ok = await ensureAvatar();
  if (!ok) { toast("Avatar indisponível no momento."); return; }
  lastSent = text;
  const g = gen;
  setPending(pending + 1);
  chain = chain.then(async () => {
    try { if (g === gen) await avatar.speak(text, { onWord: showCaption }); }
    catch (err) { console.error(err); }
    if (g === gen) setPending(pending - 1);
  });
}
function sendToAvatar(text) {
  addHistory("speech", text);
  return translate(text);
}

/* =========================================================
   LIBRAS → TEXTO  (câmera + MediaPipe Mãos/Pose + encoder TF.js + kNN de embeddings)
   Modelo treinado offline (ml/train_libras.py) e servido de models/libras-v1/.
   ========================================================= */
const video = $("video"), canvas = $("overlay"), ctx = canvas.getContext("2d");
const MP_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_BASE = "models/libras-v1/";
const USER_REFS_KEY = "libras-user-refs";   // [{label, e:[128]}] — sinais ensinados pelo usuário (só embeddings)
let stream = null, mp = null, handLm = null, poseLm = null, recognizer = null, segmenter = null, feat = null;
let running = false, lastTs = -1, frameNo = 0, lastPoseRes = null;
let words = [];
let teaching = null; // {label, n, want}
try { localStorage.removeItem("libras-samples"); } catch {}   // formato antigo (kNN de frames)

function setCamStatus(text, live) {
  $("camera-status-text").textContent = text;
  $("camera-status").classList.toggle("live", !!live);
}
function showCamText() {
  const el = $("camera-text"), t = words.join(" ");
  el.textContent = t || "As palavras reconhecidas aparecem aqui.";
  el.classList.toggle("muted", !t); el.classList.toggle("has", !!t);
}

/* MediaPipe e TF.js só são baixados quando a câmera é usada; se o CDN falhar, o resto do app segue funcionando */
async function loadVision() {
  if (handLm && poseLm) return;
  mp = mp || (await import(MP_URL));
  const fileset = await mp.FilesetResolver.forVisionTasks(MP_URL + "/wasm");
  const make = async (Task, url, extra) => {
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: url, delegate }, runningMode: "VIDEO", ...extra });
    try { return await Task.createFromOptions(fileset, opts("GPU")); }
    catch { return await Task.createFromOptions(fileset, opts("CPU")); }
  };
  const G = "https://storage.googleapis.com/mediapipe-models/";
  handLm = await make(mp.HandLandmarker, G + "hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", { numHands: 2 });
  poseLm = await make(mp.PoseLandmarker, G + "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task", { numPoses: 1 });
}
async function loadModel() {
  if (recognizer) return;
  const [rmod, fmod] = await Promise.all([import("./recognizer/recognizer.js"), import("./recognizer/features.js")]);
  feat = fmod;
  recognizer = await rmod.loadRecognizer({ baseUrl: MODEL_BASE });
  recognizer.setUserReferences(store.get(USER_REFS_KEY, []));
  segmenter = new fmod.SignSegmenter();
}

async function startCamera() {
  if (running) return;
  if (!navigator.mediaDevices?.getUserMedia) { toast("Câmera indisponível. Abra o app por HTTPS."); return; }
  try {
    setCamStatus("Iniciando câmera…", false);
    $("camera-toggle").disabled = true;
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    video.srcObject = stream; await video.play();
    setCamStatus("Carregando modelos de Libras…", false);
    await Promise.all([loadVision(), loadModel()]);
    segmenter.reset();
    running = true; lastTs = -1; frameNo = 0; lastPoseRes = null;
    $("camera-hint").hidden = true;
    $("camera-toggle").textContent = "⏹ Parar câmera"; $("camera-toggle").classList.add("live");
    setCamStatus("Procurando mãos…", true);
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    toast(err.name === "NotAllowedError" ? "Permita o uso da câmera para continuar." : "Não foi possível iniciar a câmera ou carregar o modelo de Libras.");
    stopCamera();
  } finally { $("camera-toggle").disabled = false; }
}
function stopCamera() {
  running = false; teaching = null; segmenter?.reset();
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
    const ts = performance.now();
    const hands = handLm.detectForVideo(video, ts);
    if (frameNo++ % 2 === 0) lastPoseRes = poseLm.detectForVideo(video, ts + 0.001);   // ombros mudam devagar: pose à metade da taxa
    draw(hands); handle(hands, lastPoseRes, ts);
  }
  requestAnimationFrame(loop);
}
function draw(res) {
  if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 3; ctx.strokeStyle = "#69e7a9"; ctx.fillStyle = "#fff";
  for (const hand of res.landmarks || []) {
    for (const c of mp.HandLandmarker.HAND_CONNECTIONS) {
      const a = hand[c.start], b = hand[c.end];
      ctx.beginPath(); ctx.moveTo(a.x * canvas.width, a.y * canvas.height); ctx.lineTo(b.x * canvas.width, b.y * canvas.height); ctx.stroke();
    }
    for (const p of hand) { ctx.beginPath(); ctx.arc(p.x * canvas.width, p.y * canvas.height, 3, 0, 7); ctx.fill(); }
  }
}

/* Cada imagem vira um "frame"; o segmentador junta os frames de UM sinal (mão sobe → mão desce) */
function handle(handRes, poseRes, now) {
  const hasPose = !!poseRes?.landmarks?.length;
  const frame = feat.makeFrame(handRes.landmarks, hasPose ? poseRes.landmarks[0] : null, video.videoWidth / video.videoHeight, now);
  const seg = segmenter.push(frame);
  if (seg) return onSegment(seg);
  if (!hasPose) setCamStatus("Mostre os ombros e as mãos para a câmera", true);
  else if (segmenter.recording) setCamStatus(teaching ? "Gravando o sinal…" : "Lendo o sinal…", true);
  else setCamStatus(handRes.landmarks?.length ? "Mãos detectadas · baixe-as ao terminar" : "Pronto · faça um sinal", true);
}
function onSegment(seg) {
  const res = recognizer.classify(seg);
  if (!res) return;
  if (teaching) return finishTeaching(res.embedding);
  if (!res.accepted) { setCamStatus("Não tenho certeza — escolha abaixo", true); return showSuggestions(res.top, false); }
  words.push(res.top[0].label); showCamText();
  setCamStatus(`Reconhecido: ${res.top[0].label}`, true);
  showSuggestions(res.top.slice(1), true);
}
/* hipóteses alternativas: o usuário confirma ou corrige (reconhecimento de sinais nunca é 100%) */
function showSuggestions(top, replaceLast) {
  let box = $("camera-suggest");
  if (!box) {
    box = document.createElement("div"); box.id = "camera-suggest"; box.setAttribute("aria-live", "polite");
    box.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0";
    $("camera-text").after(box);
  }
  box.replaceChildren();
  if (!top.length) return;
  const lead = document.createElement("small"); lead.textContent = replaceLast ? "Era outro sinal?" : "Você quis dizer:";
  box.append(lead);
  for (const t of top) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "hist-replay"; b.textContent = t.label;
    b.onclick = () => { if (replaceLast) words[words.length - 1] = t.label; else words.push(t.label); showCamText(); box.replaceChildren(); };
    box.append(b);
  }
}
$("camera-undo").onclick = () => { words.pop(); showCamText(); };
function clearCamera() { words = []; showCamText(); $("camera-suggest")?.replaceChildren(); if ("speechSynthesis" in window) speechSynthesis.cancel(); }
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

/* --- Ensinar sinais: guarda só o embedding (128 números) de cada repetição --- */
function renderSamples() {
  const labels = [...new Set(store.get(USER_REFS_KEY, []).map((r) => r.label))];
  const ul = $("teach-list"); ul.replaceChildren();
  for (const l of labels) {
    const li = document.createElement("li"); li.append(l + " ");
    const b = document.createElement("button"); b.textContent = "×"; b.setAttribute("aria-label", "Remover " + l);
    b.onclick = () => {
      const rest = store.get(USER_REFS_KEY, []).filter((r) => r.label !== l);
      store.set(USER_REFS_KEY, rest); recognizer?.setUserReferences(rest); renderSamples();
    };
    li.append(b); ul.append(li);
  }
}
$("teach-record").onclick = async () => {
  const label = $("teach-label").value.trim();
  if (!label) return toast("Digite a palavra do sinal primeiro.");
  if (!running) { await startCamera(); if (!running) return; }
  teaching = { label, n: 0, want: 3 };
  $("teach-msg").textContent = `Faça o sinal “${label}” (1 de 3). Baixe as mãos entre uma repetição e outra.`;
};
function finishTeaching(emb) {
  const t = teaching; t.n++;
  const refs = store.get(USER_REFS_KEY, []);
  refs.push({ label: t.label, e: Array.from(emb, (v) => Math.round(v * 1e4) / 1e4) });
  store.set(USER_REFS_KEY, refs); recognizer.setUserReferences(refs);
  if (t.n < t.want) { $("teach-msg").textContent = `Boa! Repita o sinal (${t.n + 1} de ${t.want}).`; return; }
  teaching = null; renderSamples();
  $("teach-msg").textContent = `“${t.label}” gravado. Faça o sinal de novo para testar.`;
  $("teach-label").value = "";
}

/* ---------- PWA ---------- */
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e; $("install").hidden = false; });
$("install").onclick = async () => { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; $("install").hidden = true; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
document.addEventListener("visibilitychange", () => { if (document.hidden) { stopListening(); stopCamera(); } });
/* ---------- Diagnóstico de voz (ajuda a achar por que o reconhecimento falha) ---------- */
(function setupDiagnostics() {
  const d = document.createElement("details"); d.className = "panel mt"; d.id = "diag";
  d.innerHTML =
    '<summary>Diagnóstico do microfone</summary>' +
    '<p class="muted small">Use se a voz não funcionar. Fale normalmente durante os testes. Tudo roda só neste aparelho.</p>' +
    '<div class="grid2"><button id="diag-mic" class="btn outline" type="button">1. Testar microfone</button>' +
    '<button id="diag-sr" class="btn outline" type="button">2. Testar reconhecimento</button></div>' +
    '<div class="diag-bar mt" aria-hidden="true"><i id="diag-level"></i></div><pre id="diag-log" class="diag-log"></pre>';
  $("switch-camera").before(d);
  const logEl = $("diag-log");
  const log = (m) => { logEl.textContent += new Date().toLocaleTimeString("pt-BR") + "  " + m + "\n"; logEl.scrollTop = logEl.scrollHeight; };
  log("Navegador: " + navigator.userAgent);
  log("Endereço: " + location.origin + " | contexto seguro: " + window.isSecureContext + " | online: " + navigator.onLine);
  log("Reconhecimento de voz disponível: " + !!SR);

  $("diag-mic").onclick = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return log("getUserMedia indisponível.");
    stopListening();
    log("Teste do microfone: fale por 5 segundos…");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      log("Microfone em uso: " + (s.getAudioTracks()[0]?.label || "(sem nome)"));
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize); let peak = 0; const t0 = performance.now();
      await new Promise((res) => {
        (function tick() {
          an.getByteTimeDomainData(buf);
          let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
          peak = Math.max(peak, m); $("diag-level").style.width = Math.min(100, (m / 64) * 100) + "%";
          if (performance.now() - t0 < 5000) requestAnimationFrame(tick); else res();
        })();
      });
      s.getTracks().forEach((t) => t.stop()); ac.close(); $("diag-level").style.width = "0";
      log(peak > 6 ? `OK: o microfone captou som (pico ${peak}).` : `Quase nenhum som captado (pico ${peak}). Fale mais perto ou confira o microfone padrão do Windows/Chrome.`);
    } catch (e) { log("Falha ao abrir o microfone: " + e.name); }
  };

  $("diag-sr").onclick = () => {
    if (!SR) return log("SpeechRecognition indisponível neste navegador.");
    stopListening();
    const r = new SR(); r.lang = "pt-BR"; r.interimResults = true; r.continuous = false;
    for (const ev of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch", "end"]) r.addEventListener(ev, () => log("evento: " + ev));
    r.onresult = (e) => { const x = e.results[e.results.length - 1]; log("texto: " + x[0].transcript + (x.isFinal ? " (final)" : "")); };
    r.onerror = (e) => log("ERRO: " + e.error + (e.message ? " — " + e.message : ""));
    log("Teste do reconhecimento: fale uma frase curta agora…");
    try { r.start(); } catch (e) { log("start falhou: " + e.message); }
  };
})();

renderSamples();
renderHistory();
