require('dotenv').config();

const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.options('*', cors());

const PORT = process.env.PORT || 10000;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:test@test.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('Faltan VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en .env');
  process.exit(1);
}

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

let subscriptions = [];
let lastAlerts = {};

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'aura-push',
    subscriptions: subscriptions.length
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/subscribe', (req, res) => {
  try {
    const sub = req.body;

    if (!sub || !sub.endpoint) {
      return res.status(400).json({ ok: false, error: 'Suscripción inválida' });
    }

    const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
    if (!exists) subscriptions.push(sub);

    console.log('Suscripción guardada:', sub.endpoint);
    return res.status(201).json({ ok: true, stored: true, total: subscriptions.length });
  } catch (err) {
    console.error('Error en /subscribe:', err);
    return res.status(500).json({ ok: false, error: 'Error guardando suscripción' });
  }
});

app.post('/notify', async (req, res) => {
  try {
    const payload = JSON.stringify({
      title: req.body?.title || 'AURA',
      body: req.body?.body || 'Push real funcionando',
      icon: req.body?.icon || './icon-192.png',
      badge: req.body?.badge || './icon-192.png',
      url: req.body?.url || '/'
    });

    if (!subscriptions.length) {
      return res.status(200).json({ ok: true, sent: 0, note: 'No hay suscripciones' });
    }

    let sent = 0;
    const invalidEndpoints = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        console.error('Error enviando push:', err.statusCode || '', err.body || err.message);

        if (err.statusCode === 404 || err.statusCode === 410) {
          invalidEndpoints.push(sub.endpoint);
        }
      }
    }

    if (invalidEndpoints.length) {
      subscriptions = subscriptions.filter(s => !invalidEndpoints.includes(s.endpoint));
    }

    return res.status(200).json({
      ok: true,
      sent,
      total: subscriptions.length,
      removed: invalidEndpoints.length
    });
  } catch (err) {
    console.error('Error en /notify:', err);
    return res.status(500).json({ ok: false, error: 'Error enviando notificación' });
  }
});

app.post('/smart-notify', async (req, res) => {
  try {
    const { type, title, body, key, cooldownMs } = req.body || {};
    const now = Date.now();
    const dedupeKey = key || `${type || 'generic'}:${title || 'AURA'}`;
    const cooldown = Number(cooldownMs) > 0 ? Number(cooldownMs) : 30 * 60 * 1000;

    if (lastAlerts[dedupeKey] && (now - lastAlerts[dedupeKey] < cooldown)) {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'cooldown',
        remainingMs: cooldown - (now - lastAlerts[dedupeKey])
      });
    }

    lastAlerts[dedupeKey] = now;

    const payload = JSON.stringify({
      title: title || 'AURA',
      body: body || 'Evento detectado',
      icon: './icon-192.png',
      badge: './icon-192.png',
      url: '/'
    });

    if (!subscriptions.length) {
      return res.status(200).json({ ok: true, sent: 0, note: 'No hay suscripciones' });
    }

    let sent = 0;
    const invalidEndpoints = [];

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (err) {
        console.error('Error enviando smart push:', err.statusCode || '', err.body || err.message);

        if (err.statusCode === 404 || err.statusCode === 410) {
          invalidEndpoints.push(sub.endpoint);
        }
      }
    }

    if (invalidEndpoints.length) {
      subscriptions = subscriptions.filter(s => !invalidEndpoints.includes(s.endpoint));
    }

    return res.status(200).json({
      ok: true,
      sent,
      total: subscriptions.length,
      removed: invalidEndpoints.length,
      dedupeKey
    });
  } catch (err) {
    console.error('Error en /smart-notify:', err);
    return res.status(500).json({ ok: false, error: 'Error enviando smart notification' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
