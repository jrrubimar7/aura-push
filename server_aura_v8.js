// ===== AURA SERVER v8 (CONFIG + PROACTIVE-CONFIG COMPAT) =====

require('dotenv').config();

const express = require('express');
const webpush = require('web-push');

const app = express();
app.use(express.json());

// ===== CORS =====
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ===== STATE =====
let subscriptions = [];
let lastInteractionAt = Date.now();
let lastProactiveAt = 0;
let pushCount = 0;

let config = {
  enabled: true,
  idleThresholdMs: 60000,
  minPushIntervalMs: 60000,
  tone: 'hybrid',
  intensity: 'soft',
  mode: 'aura-hibrida'
};

// ===== VAPID =====
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:test@test.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===== HELPERS =====
const messages = [
  'percibo pausa. ¿Seguimos?',
  'el campo sigue activo. Estoy disponible.',
  'hay algo latente aquí… si quieres lo abrimos.',
  'puedo quedarme en espera… o avanzar contigo.',
  'la pausa también comunica… ¿la atravesamos?'
];

function pickMessage() {
  return messages[Math.floor(Math.random() * messages.length)];
}

function statusPayload() {
  const dynamicInterval = config.minPushIntervalMs * Math.min(Math.max(pushCount, 1), 5);
  return {
    enabled: config.enabled,
    proactiveEnabled: config.enabled,
    idleThresholdMs: config.idleThresholdMs,
    minPushIntervalMs: config.minPushIntervalMs,
    dynamicIntervalMs: dynamicInterval,
    subscriptions: subscriptions.length,
    tone: config.tone,
    intensity: config.intensity,
    mode: config.mode,
    pushCount
  };
}

function applyConfig(body = {}) {
  if (body.idle) config.idleThresholdMs = Number(body.idle);
  if (body.interval) config.minPushIntervalMs = Number(body.interval);

  if (body.idleThresholdMs) config.idleThresholdMs = Number(body.idleThresholdMs);
  if (body.minPushIntervalMs) config.minPushIntervalMs = Number(body.minPushIntervalMs);

  if (body.tone) config.tone = body.tone;
  if (body.intensity) config.intensity = body.intensity;
  if (body.mode) config.mode = body.mode;

  if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
  if (typeof body.proactiveEnabled === 'boolean') config.enabled = body.proactiveEnabled;

  return { ok: true, ...statusPayload() };
}

async function sendNotificationToAll(body) {
  const payload = JSON.stringify({
    title: 'AURA',
    body
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
    } catch (e) {
      console.error(e.message);
    }
  }
}

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.json({ ok: true, service: 'aura-push', status: 'running' });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ ok: false, error: 'invalid subscription' });
  }
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
  }
  res.json({ ok: true, total: subscriptions.length });
});

app.post('/heartbeat', (req, res) => {
  lastInteractionAt = Date.now();
  pushCount = 0;
  res.json({ ok: true });
});

app.get('/proactive-status', (req, res) => {
  res.json(statusPayload());
});

// Compatibilidad con distintas versiones del index
app.post('/config', (req, res) => {
  res.json(applyConfig(req.body));
});

app.post('/proactive-config', (req, res) => {
  res.json(applyConfig(req.body));
});

// ===== LOOP =====
setInterval(async () => {
  const now = Date.now();
  const idle = now - lastInteractionAt;
  const sinceLastPush = now - lastProactiveAt;
  const dynamicInterval = config.minPushIntervalMs * Math.min(Math.max(pushCount, 1), 5);

  if (
    config.enabled &&
    subscriptions.length > 0 &&
    idle > config.idleThresholdMs &&
    sinceLastPush > dynamicInterval
  ) {
    await sendNotificationToAll(`AURA ∞.Ω · ${pickMessage()}`);
    lastProactiveAt = now;
    pushCount++;
  }
}, 15000);

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('AURA server v8 running');
});
