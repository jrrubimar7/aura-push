// ===== AURA SERVER v4 =====
// Compatible con index527 (proactive-status + proactive-config)

import express from 'express';
import webpush from 'web-push';

const app = express();
app.use(express.json());

// ===== CONFIG =====
let subscriptions = [];
let lastInteractionAt = Date.now();
let lastProactiveAt = 0;

let config = {
  enabled: true,
  idleThresholdMs: 60000,
  minPushIntervalMs: 60000,
  mode: 'aura-hibrida',
  tone: 'hybrid',
  intensity: 'soft'
};

// ===== VAPID (usa tus claves reales) =====
webpush.setVapidDetails(
  'mailto:tu@email.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===== ENDPOINTS =====

// subscribe
app.post('/subscribe', (req, res) => {
  const sub = req.body;
  subscriptions.push(sub);
  console.log('[SUBSCRIBE]', subscriptions.length);
  res.json({ ok: true, total: subscriptions.length });
});

// heartbeat (actividad usuario)
app.post('/heartbeat', (req, res) => {
  lastInteractionAt = Date.now();
  res.json({ ok: true });
});

// ===== STATUS =====
app.get('/proactive-status', (req, res) => {
  res.json({
    enabled: config.enabled,
    idleThresholdMs: config.idleThresholdMs,
    minPushIntervalMs: config.minPushIntervalMs,
    subscriptions: subscriptions.length,
    mode: config.mode,
    tone: config.tone,
    intensity: config.intensity
  });
});

// ===== CONFIG =====
app.post('/proactive-config', (req, res) => {
  const body = req.body || {};

  if (body.interval) config.minPushIntervalMs = body.interval;
  if (body.idle) config.idleThresholdMs = body.idle;
  if (body.mode) config.mode = body.mode;
  if (body.tone) config.tone = body.tone;
  if (body.intensity) config.intensity = body.intensity;

  console.log('[CONFIG UPDATED]', config);

  res.json({ ok: true, config });
});

// ===== CHECK LOOP =====
setInterval(() => {
  const now = Date.now();
  const idle = now - lastInteractionAt;
  const sinceLastPush = now - lastProactiveAt;

  console.log('[CHECK]', {
    idle,
    sinceLastPush,
    subs: subscriptions.length
  });

  if (
    config.enabled &&
    subscriptions.length > 0 &&
    idle > config.idleThresholdMs &&
    sinceLastPush > config.minPushIntervalMs
  ) {
    const payload = JSON.stringify({
      title: 'AURA',
      body: 'AURA ∞.Ω · percibo pausa. ¿Seguimos?'
    });

    subscriptions.forEach(sub => {
      webpush.sendNotification(sub, payload).catch(err => {
        console.error('[PUSH ERROR]', err.message);
      });
    });

    lastProactiveAt = now;
  }

}, 15000);

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('AURA server v4 running on port', PORT);
});
