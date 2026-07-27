/**
 * server.js
 * ---------------------------------------------------------------------------
 * Servidor de la experiencia "Nuestro Árbol Familiar".
 *
 * Responsabilidades:
 *  - Servir los archivos estáticos del cliente (carpeta /public).
 *  - Mantener el estado del juego en memoria (participantes, ronda activa,
 *    tarjetas de respuestas ya colocadas, si la experiencia ya finalizó).
 *  - Sincronizar ese estado en tiempo real entre todos los clientes
 *    conectados (participantes y administrador) usando Socket.io.
 *
 * El estado vive únicamente en memoria: si el servidor se reinicia, la
 * actividad vuelve a cero. Para una sesión en vivo de 10-15 minutos esto es
 * suficiente y evita depender de una base de datos.
 * ---------------------------------------------------------------------------
 */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Contraseña de acceso al panel de administrador.
// Se puede sobreescribir con la variable de entorno ADMIN_PASSWORD al desplegar.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'msol';

app.use(express.static(path.join(__dirname, 'public')));

/* ============================================================================
 * DEFINICIÓN DE LAS RONDAS DEL JUEGO
 * Cada ronda define: etiqueta visible, pregunta, y la "zona" del árbol
 * (en porcentaje del contenedor) donde deben aparecer sus tarjetas, más el
 * tamaño aproximado de la tarjeta para poder calcular colisiones.
 * ========================================================================== */
const ROUND_INFO = {
  leaf: {
    label: 'Hojas',
    question: 'Escribe un sueño para las familias que acompañas.',
    zone: { x: [8, 92], y: [20, 58] },
    height: 5,
    fixedWidth: null // el ancho se estima según el largo del texto
  },
  fruit: {
    label: 'Frutos',
    question: '¿Qué logro familiar merece ser reconocido?',
    zone: { x: [8, 92], y: [22, 60] },
    height: 11,
    fixedWidth: 11 // los frutos son círculos de tamaño fijo
  },
  water: {
    label: 'Agua',
    question: '¿Qué acción concreta permite que un sueño crezca?',
    zone: { x: [38, 62], y: [62, 76] },
    height: 6.5,
    fixedWidth: null // antes era fijo (9) y por eso el texto largo se desbordaba
  },
  root: {
    label: 'Raíces',
    question: '¿Qué sostiene a una familia cuando llegan las dificultades?',
    zone: { x: [10, 90], y: [80, 97] },
    height: 5,
    fixedWidth: null
  }
};

const ROUND_ORDER = ['leaf', 'fruit', 'water', 'root'];

/* ============================================================================
 * ESTADO EN MEMORIA
 * ========================================================================== */
let state = {
  activeRound: null,   // 'leaf' | 'fruit' | 'water' | 'root' | null (nadie respondiendo)
  finalized: false,    // true cuando el admin presionó "Finalizar"
  cards: [],           // { id, type, text, name, x, y, w, h }
  participants: {}      // socket.id -> { name, submittedRounds: [] }
};

/* ============================================================================
 * UTILIDADES DE POSICIONAMIENTO
 * Coloca cada tarjeta nueva dentro de la zona de su ronda, evitando que se
 * superponga con tarjetas ya existentes (hasta 40 intentos aleatorios).
 * Todo se calcula en PORCENTAJE del contenedor, así la posición es idéntica
 * en cualquier tamaño de pantalla (el contenedor del árbol mantiene un
 * aspect-ratio fijo en el CSS del cliente).
 * ========================================================================== */
function estimateCardWidthPercent(type, text) {
  const info = ROUND_INFO[type];
  if (info.fixedWidth) return info.fixedWidth;
  const base = 7;
  const perChar = 0.85;
  return Math.min(base + text.length * perChar, 24);
}

function rectsOverlap(a, b) {
  return !(
    a.x + a.w < b.x ||
    b.x + b.w < a.x ||
    a.y + a.h < b.y ||
    b.y + b.h < a.y
  );
}

function findPosition(type, text) {
  const info = ROUND_INFO[type];
  const w = estimateCardWidthPercent(type, text);
  const h = info.height;
  const minX = info.zone.x[0];
  const maxX = info.zone.x[1] - w;
  const minY = info.zone.y[0];
  const maxY = info.zone.y[1] - h;

  const existing = state.cards.map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h }));

  let best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = minX + Math.random() * Math.max(1, maxX - minX);
    const y = minY + Math.random() * Math.max(1, maxY - minY);
    const rect = { x, y, w, h };
    const overlaps = existing.some((r) => rectsOverlap(r, rect));
    if (!overlaps) return rect;
    best = rect; // si no encontramos hueco libre, usamos el último intento
  }
  return best;
}

/* ============================================================================
 * HELPERS DE ESTADO PÚBLICO
 * ========================================================================== */
function countByType() {
  const counts = { leaf: 0, fruit: 0, water: 0, root: 0 };
  state.cards.forEach((card) => { counts[card.type]++; });
  return counts;
}

function participantCount() {
  return Object.keys(state.participants).length;
}

function publicState() {
  return {
    activeRound: state.activeRound,
    activeQuestion: state.activeRound ? ROUND_INFO[state.activeRound].question : null,
    finalized: state.finalized,
    cards: state.cards
  };
}

function adminStats() {
  return {
    participantCount: participantCount(),
    counts: countByType(),
    activeRound: state.activeRound,
    finalized: state.finalized
  };
}

function broadcastStats() {
  io.emit('admin:stats', adminStats());
}

/* ============================================================================
 * SOCKET.IO — EVENTOS
 * ========================================================================== */
io.on('connection', (socket) => {

  // ---- Un participante entra con su nombre ----
  socket.on('participant:join', (data) => {
    const name = ((data && data.name) || '').toString().trim().slice(0, 40) || 'Participante';
    state.participants[socket.id] = { name, submittedRounds: [] };
    socket.emit('state:sync', publicState());
    broadcastStats();
  });

  // ---- Un participante envía su respuesta para la ronda activa ----
  socket.on('card:submit', (data) => {
    const participant = state.participants[socket.id];
    if (!participant) return;

    const type = data && data.type;
    const text = ((data && data.text) || '').toString().trim().slice(0, 60);

    if (!ROUND_INFO[type] || !text) return;
    if (state.activeRound !== type) return;               // solo se responde la ronda activa
    if (participant.submittedRounds.includes(type)) return; // una respuesta por ronda por persona

    const pos = findPosition(type, text);
    const card = {
      id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
      type,
      text,
      name: participant.name,
      x: pos.x, y: pos.y, w: pos.w, h: pos.h
    };

    state.cards.push(card);
    participant.submittedRounds.push(type);

    io.emit('card:new', card);
    broadcastStats();
  });

  // ---- Autenticación del administrador ----
  socket.on('admin:login', (data) => {
    const password = data && data.password;
    if (password === ADMIN_PASSWORD) {
      socket.data.isAdmin = true;
      socket.emit('admin:loginResult', { ok: true });
      socket.emit('state:sync', publicState());
      socket.emit('admin:stats', adminStats());
    } else {
      socket.emit('admin:loginResult', { ok: false });
    }
  });

  // ---- El admin activa una ronda (o la cierra con round: null) ----
  socket.on('admin:setRound', (data) => {
    if (!socket.data.isAdmin) return;
    const round = data && data.round;
    if (round !== null && !ROUND_INFO[round]) return;
    state.activeRound = round;
    io.emit('round:changed', {
      round,
      question: round ? ROUND_INFO[round].question : null
    });
    broadcastStats();
  });

  // ---- El admin reinicia toda la actividad ----
  socket.on('admin:reset', () => {
    if (!socket.data.isAdmin) return;
    state.cards = [];
    state.activeRound = null;
    state.finalized = false;
    Object.values(state.participants).forEach((p) => { p.submittedRounds = []; });
    io.emit('state:sync', publicState());
    broadcastStats();
  });

  // ---- El admin finaliza la experiencia ----
  socket.on('admin:finalize', () => {
    if (!socket.data.isAdmin) return;
    state.finalized = true;
    io.emit('state:finalized');
    broadcastStats();
  });

  // ---- Cualquiera suelta una mariposa: se retransmite a todos por diversión ----
  socket.on('butterfly:spawn', () => {
    io.emit('butterfly:spawn');
  });

  // ---- Admin muestra/oculta el mensaje de despedida a todos ----
  socket.on('farewell:show', () => {
    if (!socket.data.isAdmin) return;
    io.emit('farewell:show');
  });

  socket.on('farewell:hide', () => {
    if (!socket.data.isAdmin) return;
    io.emit('farewell:hide');
  });

  // ---- Limpieza al desconectar ----
  socket.on('disconnect', () => {
    delete state.participants[socket.id];
    broadcastStats();
  });
});

server.listen(PORT, () => {
  console.log(`Árbol Familiar escuchando en el puerto ${PORT}`);
  console.log(`Contraseña de administrador: ${ADMIN_PASSWORD}`);
});
