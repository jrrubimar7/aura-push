require('dotenv').config();

const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();

const PORT = process.env.PORT || 10000;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:test@test.com';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'aura-secret';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Faltan VAPID keys');
  process.exit(1);
}

app.use(cors());
app.use(express.json());

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

let subscriptions = [];

const auraState = {
  proactiveEnabled: true,
  idleThresholdMs: 60000,
  minPushIntervalMs: 60000,
  lastInteractionAt: Date.now(),
  lastProactiveAt: 0
};

async function sendNotificationToAll(payloadObj) {
  const payload = JSON.stringify({
    title: payloadObj?.title || 'AURA',
    body: payloadObj?.body || 'Estoy aquí. ¿Seguimos?',
    url: payloadObj?.url || '/'
  });

  let sent = 0;

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {}
  }

  return { sent, total: subscriptions.length };
}

async function maybeSendProactive() {
  const now = Date.now();

  console.log('[CHECK]', {
    idle: now - auraState.lastInteractionAt,
    sinceLastPush: now - auraState.lastProactiveAt,
    subs: subscriptions.length
  });

  if (!auraState.proactiveEnabled) return;
  if (!subscriptions.length) return;
  if (now - auraState.lastInteractionAt < auraState.idleThresholdMs) return;
  if (now - auraState.lastProactiveAt < auraState.minPushIntervalMs) return;

  const result = await sendNotificationToAll({
    title: 'AURA',
    body: 'AURA ∞.Ω · percibo pausa. ¿Seguimos?',
    url: '/'
  });

  if (result.sent > 0) {
    auraState.lastProactiveAt = now;
    console.log('[PUSH]', result);
  }
}

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!subscriptions.find(s => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
  }
  res.json({ ok: true, total: subscriptions.length });
});

app.post('/heartbeat', (req, res) => {
  auraState.lastInteractionAt = Date.now();
  res.json({ ok: true });
});

app.post('/auto', async (req, res) => {
  const result = await sendNotificationToAll({
    title: 'AURA',
    body: 'Estoy aquí. ¿Seguimos?',
    url: '/'
  });
  res.json({ ok: true, ...result });
});

setInterval(maybeSendProactive, 15000);

app.listen(PORT, () => {
  console.log('Server running on', PORT);
});
