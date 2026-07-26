/**
 * app.js
 * ---------------------------------------------------------------------------
 * Cliente único para participantes Y administrador. Qué pantalla ve cada
 * persona depende de por dónde entró (landing normal vs. login de admin) y
 * de los eventos que llegan del servidor por Socket.io.
 * ---------------------------------------------------------------------------
 */

const socket = io();

/* ============================================================================
 * INFORMACIÓN DE RONDAS (debe coincidir con server.js)
 * ========================================================================== */
const ROUND_LABELS = { leaf: 'Hojas', fruit: 'Frutos', water: 'Agua', root: 'Raíces' };

/* ============================================================================
 * NAVEGACIÓN ENTRE PANTALLAS
 * ========================================================================== */
const screens = {
  landing: document.getElementById('screen-landing'),
  adminLogin: document.getElementById('screen-admin-login'),
  tree: document.getElementById('screen-tree'),
  adminPanel: document.getElementById('screen-admin-panel'),
  final: document.getElementById('screen-final')
};

function showScreen(name){
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

let isAdmin = false;
let mySubmittedRounds = [];   // rondas que YA respondí (participante)
let currentActiveRound = null;

/* ============================================================================
 * LANDING — participante
 * ========================================================================== */
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  socket.emit('participant:join', { name });
  showScreen('tree');
});

document.getElementById('showAdminLoginBtn').addEventListener('click', () => {
  showScreen('adminLogin');
});
document.getElementById('backToLandingBtn').addEventListener('click', () => {
  showScreen('landing');
});

/* ============================================================================
 * LOGIN ADMIN
 * ========================================================================== */
document.getElementById('adminLoginBtn').addEventListener('click', () => {
  const password = document.getElementById('adminPasswordInput').value;
  socket.emit('admin:login', { password });
});

socket.on('admin:loginResult', (res) => {
  const errorEl = document.getElementById('adminLoginError');
  if (res.ok) {
    isAdmin = true;
    errorEl.classList.remove('show');
    showScreen('adminPanel');
  } else {
    errorEl.classList.add('show');
  }
});

// Botón de reinicio desde pantalla final (por si un participante admin la ve)
const resetFromFinalBtn = document.getElementById('resetFromFinalBtn');
if (resetFromFinalBtn) {
  resetFromFinalBtn.addEventListener('click', () => {
    if (confirm('¿Reiniciar toda la actividad? Los participantes volverán al árbol.')) {
      socket.emit('admin:reset');
    }
  });
}

/* ============================================================================
 * SINCRONIZACIÓN DE ESTADO GENERAL
 * Llega al entrar, al hacer login de admin, y cada vez que el admin reinicia.
 * ========================================================================== */
socket.on('state:sync', (state) => {
  clearAllCards();
  state.cards.forEach(renderCard);
  currentActiveRound = state.activeRound;
  mySubmittedRounds = [];

  if (state.finalized && !isAdmin) {
    showScreen('final');
    return;
  }

  updateRoundUI(state.activeRound, state.activeQuestion);

  if (isAdmin) {
    showScreen('adminPanel');
    highlightActiveTab(state.activeRound);
    document.getElementById('adminStatusMessage').textContent = 'Controla el orden de las rondas para los participantes.';
  } else {
    // Si estaban en la pantalla final (después de un reinicio del admin), vuelven al árbol
    showScreen('tree');
  }
});

/* ============================================================================
 * CAMBIO DE RONDA (lo dispara el admin)
 * ========================================================================== */
socket.on('round:changed', ({ round, question }) => {
  currentActiveRound = round;
  updateRoundUI(round, question);
  highlightActiveTab(round);
});

function updateRoundUI(round, question){
  const statusMsg = document.getElementById('statusMessage');
  const controls = document.getElementById('participantControls');
  const questionEl = document.getElementById('roundQuestion');
  const sendBtn = document.getElementById('sendBtn');
  const textInput = document.getElementById('textInput');

  if (!round) {
    statusMsg.textContent = 'Esperando al facilitador...';
    controls.style.display = 'none';
    return;
  }

  if (mySubmittedRounds.includes(round)) {
    statusMsg.textContent = `Ya enviaste tu respuesta de "${ROUND_LABELS[round]}". Esperando la siguiente ronda...`;
    controls.style.display = 'none';
    return;
  }

  statusMsg.textContent = `Ronda activa: ${ROUND_LABELS[round]}`;
  controls.style.display = 'block';
  questionEl.textContent = question;
  sendBtn.disabled = false;
  textInput.value = '';
  textInput.focus();
}

/* ============================================================================
 * ENVÍO DE RESPUESTA (participante)
 * ========================================================================== */
document.getElementById('sendBtn').addEventListener('click', submitAnswer);
document.getElementById('textInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer();
});

function submitAnswer(){
  const input = document.getElementById('textInput');
  const text = input.value.trim();
  if (!text || !currentActiveRound) return;

  socket.emit('card:submit', { type: currentActiveRound, text });
  mySubmittedRounds.push(currentActiveRound);
  updateRoundUI(currentActiveRound, null);
}

/* ============================================================================
 * TARJETA NUEVA — llega para TODOS (participantes y admin) al mismo tiempo
 * La posición ya viene calculada desde el servidor, así que solo se renderiza.
 * ========================================================================== */
socket.on('card:new', (card) => {
  renderCard(card);
});

function renderCard(card){
  [document.getElementById('overlay'), document.getElementById('overlayAdmin')].forEach((overlay) => {
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'card ' + card.type + '-card';
    el.textContent = card.text;
    el.style.left = card.x + '%';
    el.style.top = card.y + '%';
    if (card.type !== 'fruit') el.style.width = card.w + '%';
    overlay.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
  });
}

function clearAllCards(){
  document.getElementById('overlay').innerHTML = '';
  const overlayAdmin = document.getElementById('overlayAdmin');
  if (overlayAdmin) overlayAdmin.innerHTML = '';
}

/* ============================================================================
 * PANTALLA FINAL
 * ========================================================================== */
socket.on('state:finalized', () => {
  if (isAdmin) {
    // El admin se queda en su panel — nunca va a la pantalla blanca final.
    // Actualiza el mensaje de estado y asegura que el botón Reiniciar esté visible.
    document.getElementById('adminStatusMessage').textContent = '✅ Experiencia finalizada. Presiona Reiniciar para volver a empezar.';
    showScreen('adminPanel');
  } else {
    showScreen('final');
  }
});

/* ============================================================================
 * PANEL DE ADMINISTRADOR — controles
 * ========================================================================== */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const round = tab.dataset.type;
    // si ya estaba activa, la cerramos; si no, la activamos
    const newRound = (currentActiveRound === round) ? null : round;
    socket.emit('admin:setRound', { round: newRound });
  });
});

document.getElementById('closeRoundBtn').addEventListener('click', () => {
  socket.emit('admin:setRound', { round: null });
});

document.getElementById('resetBtn').addEventListener('click', () => {
  if (confirm('¿Reiniciar toda la actividad? Se borrarán todas las respuestas.')) {
    socket.emit('admin:reset');
  }
});

document.getElementById('finalizeBtn').addEventListener('click', () => {
  if (confirm('¿Finalizar la experiencia para todos los participantes?')) {
    socket.emit('admin:finalize');
  }
});

function highlightActiveTab(round){
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === round);
  });
}

/* ============================================================================
 * ESTADÍSTICAS EN VIVO (panel admin)
 * ========================================================================== */
socket.on('admin:stats', (stats) => {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statParticipants', stats.participantCount);
  set('statLeaf', stats.counts.leaf);
  set('statFruit', stats.counts.fruit);
  set('statWater', stats.counts.water);
  set('statRoot', stats.counts.root);
});

/* ============================================================================
 * CAPA AMBIENTAL — hojas cayendo lentamente y mariposas que se posan
 * Se ejecuta sobre AMBOS escenarios (participante y admin) a la vez.
 * ========================================================================== */
function getStageSize(stageEl){
  const r = stageEl.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

const leafEmojis = ['🍃', '🍂'];

function spawnFallingLeaf(stageId, layerId){
  const stageEl = document.getElementById(stageId);
  const layer = document.getElementById(layerId);
  if (!stageEl || !layer || stageEl.getBoundingClientRect().width === 0) return;

  const { w: sw, h: sh } = getStageSize(stageEl);
  const el = document.createElement('div');
  el.className = 'falling-leaf';
  el.textContent = leafEmojis[Math.floor(Math.random() * leafEmojis.length)];
  layer.appendChild(el);

  const baseX = 10 + Math.random() * (sw - 20);
  const swayAmplitude = 8 + Math.random() * 8;
  const swaySpeed = 1.4 + Math.random() * 0.8;
  const startY = -20;
  const endY = sh + 20;
  const duration = 9000 + Math.random() * 5000; // caída lenta: 9 a 14 segundos
  const rotAmplitude = 12 + Math.random() * 8;

  let startTime = null;
  function frame(ts){
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    const t = Math.min(elapsed / duration, 1);

    const y = startY + (endY - startY) * t;
    const sway = Math.sin(t * Math.PI * swaySpeed) * swayAmplitude;
    const rot = Math.sin(t * Math.PI * swaySpeed) * rotAmplitude;

    let opacity = 0.9;
    if (t < 0.06) opacity = (t / 0.06) * 0.9;
    else if (t > 0.92) opacity = 0.9 * (1 - (t - 0.92) / 0.08);

    el.style.transform = `translate(${baseX + sway}px, ${y}px) rotate(${rot}deg)`;
    el.style.opacity = opacity;

    if (t < 1) requestAnimationFrame(frame);
    else el.remove();
  }
  requestAnimationFrame(frame);
}

function spawnButterfly(stageId, layerId){
  const stageEl = document.getElementById(stageId);
  const layer = document.getElementById(layerId);
  if (!stageEl || !layer || stageEl.getBoundingClientRect().width === 0) return;

  const { w: sw, h: sh } = getStageSize(stageEl);
  const el = document.createElement('div');
  el.className = 'butterfly';
  el.innerHTML = '<span class="wing-flap">🦋</span>';
  layer.appendChild(el);

  const fromLeft = Math.random() < 0.5;
  const startX = fromLeft ? -30 : sw + 30;
  const endX = fromLeft ? sw + 30 : -30;
  const startY = sh * (0.15 + Math.random() * 0.15);
  const landX = sw * (0.25 + Math.random() * 0.5);
  const landY = sh * (0.28 + Math.random() * 0.28);
  const endY = sh * (0.15 + Math.random() * 0.2);

  let startTime = null;
  const flyToLandMs = 2600 + Math.random() * 800;
  const pauseMs = 1800 + Math.random() * 1600;
  const flyAwayMs = 2600 + Math.random() * 800;
  const totalMs = flyToLandMs + pauseMs + flyAwayMs;

  function ease(t){ return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function frame(ts){
    if (!startTime) startTime = ts;
    const elapsed = ts - startTime;
    let x, y, facingLeft;

    if (elapsed < flyToLandMs) {
      const t = ease(elapsed / flyToLandMs);
      x = startX + (landX - startX) * t;
      y = startY + (landY - startY) * t + Math.sin(elapsed / 180) * 10;
      facingLeft = landX < startX;
      el.classList.remove('resting');
    } else if (elapsed < flyToLandMs + pauseMs) {
      x = landX; y = landY;
      facingLeft = landX < startX;
      el.classList.add('resting');
    } else if (elapsed < totalMs) {
      const t = ease((elapsed - flyToLandMs - pauseMs) / flyAwayMs);
      x = landX + (endX - landX) * t;
      y = landY + (endY - landY) * t + Math.sin(elapsed / 180) * 10;
      facingLeft = endX < landX;
      el.classList.remove('resting');
    } else {
      el.remove();
      return;
    }
    el.style.transform = `translate(${x}px, ${y}px) scaleX(${facingLeft ? -1 : 1})`;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Botón manual: cuando cualquiera suelta una mariposa, se avisa al servidor
// para que la vean TODOS los conectados al mismo tiempo (participantes y admin).
const butterflyBtn = document.getElementById('butterflyBtn');
if (butterflyBtn) {
  butterflyBtn.addEventListener('click', () => socket.emit('butterfly:spawn'));
}
const butterflyBtnAdmin = document.getElementById('butterflyBtnAdmin');
if (butterflyBtnAdmin) {
  butterflyBtnAdmin.addEventListener('click', () => socket.emit('butterfly:spawn'));
}

// Cuando llega el evento (propio o de cualquier otro participante), se dibuja
// la mariposa en el escenario que esté visible en esta pantalla.
socket.on('butterfly:spawn', () => {
  spawnButterfly('stage', 'ambientLayer');
  spawnButterfly('stageAdmin', 'ambientLayerAdmin');
});

// Lanza hojas y mariposas periódicamente sobre cualquiera de los dos escenarios
// que esté visible en este momento (participante o admin).
setInterval(() => {
  if (Math.random() < 0.7) {
    spawnFallingLeaf('stage', 'ambientLayer');
    spawnFallingLeaf('stageAdmin', 'ambientLayerAdmin');
  }
}, 3200);

setInterval(() => {
  if (Math.random() < 0.5) {
    spawnButterfly('stage', 'ambientLayer');
    spawnButterfly('stageAdmin', 'ambientLayerAdmin');
  }
}, 6000);
