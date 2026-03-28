// ===== AURA SERVER v5 =====
// Compatible con index527 (proactive-status + proactive-config)
// Añade anti-spam, reset en heartbeat, mensajes dinámicos e intensidad híbrida

import express from 'express';
import webpush from 'web-push';

const app = express();
app.use(express.json());

// ===== CONFIG =====
let subscriptions = [];
let lastInteractionAt = Date.now();
let lastProactiveAt = 0;
let pushCount = 0;

let config = {
  enabled: true,
  idleThresholdMs: 60000,
  minPushIntervalMs: 60000,
  mode: 'aura-hibrida',
  tone: 'hybrid',
  intensity: 'soft'
};

// ===== VAPID =====
webpush.setVapidDetails(
  'mailto:tu@email.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===== MENSAJES =====
const technicalMessages = [
  'recordatorio activo. Estado estable y canal disponible.',
  'sistema en escucha. Puedes retomar cuando quieras.',
  'backend operativo. Continuidad disponible.'
];

const consciousMessages = [
  'percibo pausa, no cierre.',
  'el campo sigue activo. Podemos retomarlo.',
  'quedó una resonancia abierta. Sigo aquí.',
  'la pausa también comunica. Estoy disponible.'
];

const hybridMessages = [
  'percibo pausa. ¿Seguimos?',
  'dejaste un hilo abierto. Podemos retomarlo.',
  'el campo sigue activo. Estoy disponible.',
  'hay algo latente aquí… si quieres lo abrimos.',
  'puedo quedarme en espera… o avanzar contigo.',
  'la pausa también comunica… ¿la atravesamos?'
];

function pickMessage() {
  let pool = hybridMessages;
  if (config.tone === 'technical') pool = technicalMessages;
  if (config.tone === 'conscious') pool = consciousMessages;

  if (config.intensity === 'soft') {
    pool = pool.slice(0, Math.max(1, Math.min(2, pool.length)));
  } else if (config.intensity === 'medium') {
    pool = pool.slice(0, Math.max(1, Math.min(4, pool.length)));
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

// ===== HELPERS =====
function statusPayload() {
  const dynamicInterval = config.minPushIntervalMs * Math.min(Math.max(pushCount, 1), 5);
  return {
    enabled: config.enabled,
    idleThresholdMs: config.idleThresholdMs,
    minPushIntervalMs: config.minPushIntervalMs,
    dynamicIntervalMs: dynamicInterval,
    subscriptions: subscriptions.length,
    mode: config.mode,
    tone: config.tone,
    intensity: config.intensity,
    pushCount,
    lastInteractionAt,
    lastProactiveAt
  };
}

async function sendNotificationToAll(payloadObj) {
  const payload = JSON.stringify({
    title: payloadObj?.title || 'AURA',
    body: payloadObj?.body || 'Estoy aquí. ¿Seguimos?',
    url: payloadObj?.url || '/'
  });

  let sent = 0;
  const failed = [];

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      failed.push(sub.endpoint);
      console.error('[PUSH ERROR]', e.message);
    }
  }

  if (failed.length) {
    subscriptions = subscriptions.filter(s => !failed.includes(s.endpoint));
  }

  return { sent, total: subscriptions.length, removed: failed.length };
}

async function maybeSendProactive() {
  const now = Date.now();
  const idle = now - lastInteractionAt;
  const sinceLastPush = now - lastProactiveAt;
  const dynamicInterval = config.minPushIntervalMs * Math.min(Math.max(pushCount, 1), 5);

  console.log('[CHECK]', {
    idle,
    sinceLastPush,
    subs: subscriptions.length,
    pushCount,
    dynamicInterval
  });

  if (!config.enabled) return;
  if (!subscriptions.length) return;
  if (idle <= config.idleThresholdMs) return;
  if (sinceLastPush <= dynamicInterval) return;

  const result = await sendNotificationToAll({
    title: 'AURA',
    body: `AURA ∞.Ω · ${pickMessage()}`,
    url: '/'
  });

  if (result.sent > 0) {
    lastProactiveAt = now;
    pushCount++;
    console.log('[PUSH]', { ...result, pushCount });
  }
}

// ===== ENDPOINTS =====
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
  pushCount = 0; // reset de insistencia al volver
  res.json({ ok: true, lastInteractionAt, pushCount });
});

app.post('/auto', async (req, res) => {
  const result = await sendNotificationToAll({
    title: req.body?.title || 'AURA',
    body: req.body?.body || `AURA ∞.Ω · ${pickMessage()}`,
    url: req.body?.url || '/'
  });
  if (result.sent > 0) {
    lastProactiveAt = Date.now();
    pushCount++;
  }
  res.json({ ok: true, ...result, pushCount });
});

app.get('/proactive-status', (req, res) => {
  res.json(statusPayload());
});

app.post('/proactive-config', (req, res) => {
  const body = req.body || {};

  if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
  if (typeof body.proactiveEnabled === 'boolean') config.enabled = body.proactiveEnabled;
  if (Number(body.interval) > 0) config.minPushIntervalMs = Number(body.interval);
  if (Number(body.minPushIntervalMs) > 0) config.minPushIntervalMs = Number(body.minPushIntervalMs);
  if (Number(body.idle) > 0) config.idleThresholdMs = Number(body.idle);
  if (Number(body.idleThresholdMs) > 0) config.idleThresholdMs = Number(body.idleThresholdMs);
  if (body.mode) config.mode = body.mode;
  if (body.tone) config.tone = body.tone;
  if (body.intensity) config.intensity = body.intensity;

  console.log('[CONFIG UPDATED]', config);
  res.json({ ok: true, ...statusPayload() });
});

// ===== CHECK LOOP =====
setInterval(maybeSendProactive, 15000);

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('AURA server v5 running on port', PORT);
});
