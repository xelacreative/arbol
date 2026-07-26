/**
 * app.js — Nuestro Árbol Familiar
 * Arquitectura: una sola página, múltiples pantallas.
 * El rol (participante / admin) se guarda en sessionStorage para sobrevivir
 * recargas accidentales del navegador.
 */

const socket = io();

/* ==========================================================================
 * SESSIONstorage — persistir rol de admin entre recargas
 * ======================================================================== */
let isAdmin = sessionStorage.getItem('isAdmin') === 'true';

/* ==========================================================================
 * PANTALLAS
 * ======================================================================== */
const screens = {
  landing:    document.getElementById('screen-landing'),
  adminLogin: document.getElementById('screen-admin-login'),
  tree:       document.getElementById('screen-tree'),
  adminPanel: document.getElementById('screen-admin-panel'),
  final:      document.getElementById('screen-final')
};

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

/* ==========================================================================
 * ESTADO DEL JUEGO (local)
 * ======================================================================== */
const ROUND_LABELS = { leaf: 'Hojas', fruit: 'Frutos', water: 'Agua', root: 'Raíces' };
let currentActiveRound = null;
let mySubmittedRounds = [];

/* ==========================================================================
 * LANDING — participante entra con nombre
 * ======================================================================== */
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  socket.emit('participant:join', { name });
  showScreen('tree');
});

document.getElementById('nameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('joinBtn').click();
});

document.getElementById('showAdminLoginBtn').addEventListener('click', () => {
  showScreen('adminLogin');
});

document.getElementById('backToLandingBtn').addEventListener('click', () => {
  showScreen('landing');
});

/* ==========================================================================
 * LOGIN ADMIN
 * ======================================================================== */
document.getElementById('adminLoginBtn').addEventListener('click', () => {
  const password = document.getElementById('adminPasswordInput').value;
  socket.emit('admin:login', { password });
});

document.getElementById('adminPasswordInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('adminLoginBtn').click();
});

socket.on('admin:loginResult', (res) => {
  if (res.ok) {
    isAdmin = true;
    sessionStorage.setItem('isAdmin', 'true');
    document.getElementById('adminLoginError').classList.remove('show');
    // Re-emit join con nombre opcional del admin
    const name = document.getElementById('adminNameInput').value.trim() || 'Facilitador';
    socket.emit('participant:join', { name });
    showAdminPanel();
  } else {
    document.getElementById('adminLoginError').classList.add('show');
  }
});

/* Si tenía sesión de admin guardada y se reconecta, pide el estado actualizado */
socket.on('connect', () => {
  if (isAdmin) {
    socket.emit('admin:login', { password: sessionStorage.getItem('adminPwd') || '' });
  }
});

/* ==========================================================================
 * MOSTRAR PANEL ADMIN
 * ======================================================================== */
function showAdminPanel() {
  document.getElementById('finalAdminBar').style.display = 'flex';
  showScreen('adminPanel');
}

/* ==========================================================================
 * SINCRONIZACIÓN DE ESTADO COMPLETO
 * Llega al conectar, al hacer login y al reiniciar.
 * ======================================================================== */
socket.on('state:sync', (state) => {
  clearAllCards();
  state.cards.forEach(renderCard);
  currentActiveRound = state.activeRound;
  mySubmittedRounds = [];

  if (state.finalized) {
    enterFinalScreen();
    return;
  }

  // No está finalizado — cada quien va a su pantalla
  if (isAdmin) {
    document.getElementById('adminStatusMessage').textContent =
      'Controla el orden de las rondas para los participantes.';
    highlightActiveTab(state.activeRound);
    showAdminPanel();
  } else {
    updateRoundUI(state.activeRound, state.activeQuestion);
    showScreen('tree');
  }
});

/* ==========================================================================
 * CAMBIO DE RONDA — lo dispara el admin, llega a todos
 * ======================================================================== */
socket.on('round:changed', ({ round, question }) => {
  currentActiveRound = round;
  updateRoundUI(round, question);
  highlightActiveTab(round);
});

function updateRoundUI(round, question) {
  const statusMsg  = document.getElementById('statusMessage');
  const controls   = document.getElementById('participantControls');
  const questionEl = document.getElementById('roundQuestion');
  const sendBtn    = document.getElementById('sendBtn');
  const textInput  = document.getElementById('textInput');

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

/* ==========================================================================
 * ENVÍO DE RESPUESTA
 * ======================================================================== */
document.getElementById('sendBtn').addEventListener('click', submitAnswer);
document.getElementById('textInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAnswer();
});

function submitAnswer() {
  const input = document.getElementById('textInput');
  const text  = input.value.trim();
  if (!text || !currentActiveRound) return;
  socket.emit('card:submit', { type: currentActiveRound, text });
  mySubmittedRounds.push(currentActiveRound);
  updateRoundUI(currentActiveRound, null);
}

/* ==========================================================================
 * TARJETAS — renderizar en árbol del participante Y del admin
 * ======================================================================== */
socket.on('card:new', renderCard);

function renderCard(card) {
  ['overlay', 'overlayAdmin'].forEach((id) => {
    const overlay = document.getElementById(id);
    if (!overlay) return;
    const el = document.createElement('div');
    el.className = 'card ' + card.type + '-card';
    el.textContent = card.text;
    el.style.left = card.x + '%';
    el.style.top  = card.y + '%';
    if (card.type !== 'fruit') el.style.width = card.w + '%';
    overlay.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
  });
}

function clearAllCards() {
  ['overlay', 'overlayAdmin'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

/* ==========================================================================
 * PANTALLA FINAL
 * Todos van aquí al finalizar — participantes solo ven texto + mariposas.
 * El admin ve además la barra de control fija arriba.
 * ======================================================================== */
function enterFinalScreen() {
  // Mostrar barra de admin si corresponde
  document.getElementById('finalAdminBar').style.display = isAdmin ? 'flex' : 'none';
  showScreen('final');
  // Iniciar mariposas en la pantalla final
  startFinalAmbient();
}

socket.on('state:finalized', () => {
  enterFinalScreen();
});

/* Botones de la barra de admin en pantalla final */
document.getElementById('resetFromFinalBtn').addEventListener('click', () => {
  if (confirm('¿Reiniciar toda la actividad? Los participantes volverán al árbol.')) {
    socket.emit('admin:reset');
  }
});

document.getElementById('butterflyBtnFinal').addEventListener('click', () => {
  socket.emit('butterfly:spawn');
});

document.getElementById('butterflyBtnFinalParticipant').addEventListener('click', () => {
  socket.emit('butterfly:spawn');
});

/* ==========================================================================
 * PANEL ADMIN — botones de control
 * ======================================================================== */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const round    = tab.dataset.type;
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

function highlightActiveTab(round) {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.type === round);
  });
}

/* Estadísticas en vivo */
socket.on('admin:stats', (stats) => {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('statParticipants', stats.participantCount);
  set('statLeaf',  stats.counts.leaf);
  set('statFruit', stats.counts.fruit);
  set('statWater', stats.counts.water);
  set('statRoot',  stats.counts.root);
});

/* ==========================================================================
 * MARIPOSAS — evento colectivo en tiempo real
 * ======================================================================== */
document.getElementById('butterflyBtn').addEventListener('click', () => {
  socket.emit('butterfly:spawn');
});

document.getElementById('butterflyBtnAdmin').addEventListener('click', () => {
  socket.emit('butterfly:spawn');
});

socket.on('butterfly:spawn', () => {
  // Lanza en el escenario que esté activo ahora mismo
  spawnButterfly('stage',      'ambientLayer');
  spawnButterfly('stageAdmin', 'ambientLayerAdmin');
  spawnButterflyFinal();          // También en la pantalla final si está activa
});

/* ==========================================================================
 * CAPA AMBIENTAL — hojas cayendo y mariposas
 * ======================================================================== */
const leafEmojis = ['🍃', '🍂'];

function getSize(el) {
  const r = el.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

/* --- Hoja cayendo lenta dentro de un contenedor --- */
function spawnFallingLeaf(stageId, layerId) {
  const stageEl = document.getElementById(stageId);
  const layer   = document.getElementById(layerId);
  if (!stageEl || !layer || stageEl.getBoundingClientRect().width === 0) return;

  const { w: sw, h: sh } = getSize(stageEl);
  const el = document.createElement('div');
  el.className  = 'falling-leaf';
  el.textContent = leafEmojis[Math.floor(Math.random() * leafEmojis.length)];
  layer.appendChild(el);

  const baseX         = 10 + Math.random() * (sw - 20);
  const swayAmplitude = 8  + Math.random() * 8;
  const swaySpeed     = 1.4 + Math.random() * 0.8;
  const rotAmplitude  = 12 + Math.random() * 8;
  const duration      = 9000 + Math.random() * 5000;
  const startY = -20;
  const endY   = sh + 20;

  let t0 = null;
  function frame(ts) {
    if (!t0) t0 = ts;
    const t = Math.min((ts - t0) / duration, 1);
    const y    = startY + (endY - startY) * t;
    const sway = Math.sin(t * Math.PI * swaySpeed) * swayAmplitude;
    const rot  = Math.sin(t * Math.PI * swaySpeed) * rotAmplitude;
    let opacity = 0.9;
    if (t < 0.06) opacity = (t / 0.06) * 0.9;
    else if (t > 0.92) opacity = 0.9 * (1 - (t - 0.92) / 0.08);
    el.style.transform = `translate(${baseX + sway}px, ${y}px) rotate(${rot}deg)`;
    el.style.opacity   = opacity;
    if (t < 1) requestAnimationFrame(frame);
    else el.remove();
  }
  requestAnimationFrame(frame);
}

/* --- Mariposa con vuelo, posada y salida --- */
function spawnButterfly(stageId, layerId) {
  const stageEl = document.getElementById(stageId);
  const layer   = document.getElementById(layerId);
  if (!stageEl || !layer || stageEl.getBoundingClientRect().width === 0) return;

  const { w: sw, h: sh } = getSize(stageEl);
  const el = document.createElement('div');
  el.className = 'butterfly';
  el.innerHTML = '<span class="wing-flap">🦋</span>';
  layer.appendChild(el);

  const fromLeft = Math.random() < 0.5;
  const startX = fromLeft ? -30 : sw + 30;
  const endX   = fromLeft ? sw + 30 : -30;
  const startY = sh * (0.15 + Math.random() * 0.15);
  const landX  = sw * (0.25 + Math.random() * 0.5);
  const landY  = sh * (0.28 + Math.random() * 0.28);
  const endY   = sh * (0.15 + Math.random() * 0.2);

  const flyToLandMs = 2600 + Math.random() * 800;
  const pauseMs     = 1800 + Math.random() * 1600;
  const flyAwayMs   = 2600 + Math.random() * 800;
  const totalMs     = flyToLandMs + pauseMs + flyAwayMs;

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  let t0 = null;
  function frame(ts) {
    if (!t0) t0 = ts;
    const elapsed = ts - t0;
    let x, y, facingLeft;

    if (elapsed < flyToLandMs) {
      const p = ease(elapsed / flyToLandMs);
      x = startX + (landX - startX) * p;
      y = startY + (landY - startY) * p + Math.sin(elapsed / 180) * 10;
      facingLeft = landX < startX;
      el.classList.remove('resting');
    } else if (elapsed < flyToLandMs + pauseMs) {
      x = landX; y = landY; facingLeft = landX < startX;
      el.classList.add('resting');
    } else if (elapsed < totalMs) {
      const p = ease((elapsed - flyToLandMs - pauseMs) / flyAwayMs);
      x = landX + (endX - landX) * p;
      y = landY + (endY - landY) * p + Math.sin(elapsed / 180) * 10;
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

/* --- Mariposa en la pantalla final (usa toda la ventana) --- */
function spawnButterflyFinal() {
  const layer = document.getElementById('finalAmbientLayer');
  if (!layer || !screens.final.classList.contains('active')) return;

  const sw = window.innerWidth;
  const sh = window.innerHeight;
  const el = document.createElement('div');
  el.className = 'butterfly butterfly-final';
  el.innerHTML = '<span class="wing-flap">🦋</span>';
  el.style.position = 'fixed';
  layer.appendChild(el);

  const fromLeft = Math.random() < 0.5;
  const startX = fromLeft ? -30 : sw + 30;
  const endX   = fromLeft ? sw + 30 : -30;
  const startY = sh * (0.1 + Math.random() * 0.3);
  const landX  = sw * (0.2 + Math.random() * 0.6);
  const landY  = sh * (0.2 + Math.random() * 0.5);
  const endY   = sh * (0.1 + Math.random() * 0.3);

  const flyToLandMs = 2800 + Math.random() * 1000;
  const pauseMs     = 2000 + Math.random() * 2000;
  const flyAwayMs   = 2800 + Math.random() * 1000;
  const totalMs     = flyToLandMs + pauseMs + flyAwayMs;

  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  let t0 = null;
  function frame(ts) {
    if (!t0) t0 = ts;
    const elapsed = ts - t0;
    let x, y, facingLeft;

    if (elapsed < flyToLandMs) {
      const p = ease(elapsed / flyToLandMs);
      x = startX + (landX - startX) * p;
      y = startY + (landY - startY) * p + Math.sin(elapsed / 160) * 14;
      facingLeft = landX < startX;
      el.classList.remove('resting');
    } else if (elapsed < flyToLandMs + pauseMs) {
      x = landX; y = landY; facingLeft = landX < startX;
      el.classList.add('resting');
    } else if (elapsed < totalMs) {
      const p = ease((elapsed - flyToLandMs - pauseMs) / flyAwayMs);
      x = landX + (endX - landX) * p;
      y = landY + (endY - landY) * p + Math.sin(elapsed / 160) * 14;
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

let finalAmbientInterval = null;
function startFinalAmbient() {
  if (finalAmbientInterval) return; // evitar duplicados
  spawnButterflyFinal();
  finalAmbientInterval = setInterval(() => {
    if (Math.random() < 0.6) spawnButterflyFinal();
  }, 5000);
}

/* --- Loops automáticos sobre las pantallas del árbol --- */
setInterval(() => {
  if (Math.random() < 0.7) {
    spawnFallingLeaf('stage',      'ambientLayer');
    spawnFallingLeaf('stageAdmin', 'ambientLayerAdmin');
  }
}, 3200);

setInterval(() => {
  if (Math.random() < 0.5) {
    spawnButterfly('stage',      'ambientLayer');
    spawnButterfly('stageAdmin', 'ambientLayerAdmin');
  }
}, 6000);

/* ==========================================================================
 * SI YA ERA ADMIN AL CARGAR LA PÁGINA (sessionStorage)
 * El servidor validará la clave guardada; si falla (server reiniciado),
 * simplemente envía al landing para que haga login de nuevo.
 * ======================================================================== */
if (isAdmin) {
  const savedPwd = sessionStorage.getItem('adminPwd');
  if (savedPwd) {
    socket.emit('admin:login', { password: savedPwd });
  } else {
    // Tenía isAdmin=true pero sin clave guardada — ir al login para reautenticar
    isAdmin = false;
    sessionStorage.removeItem('isAdmin');
    showScreen('adminLogin');
  }
}

/* Guardar la clave al hacer login exitoso */
const origAdminLoginBtn = document.getElementById('adminLoginBtn');
origAdminLoginBtn.addEventListener('click', () => {
  const pwd = document.getElementById('adminPasswordInput').value;
  sessionStorage.setItem('adminPwd', pwd);
}, true); // captura antes del handler principal
