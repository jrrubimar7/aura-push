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
  console.error('Faltan VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en variables de entorno');
  process.exit(1);
}

// CORS abierto para GitHub Pages / pruebas cross-origin
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-aura-token']
}));

app.use(express.json({ limit: '32kb' }));
app.options('*', cors());

webpush.setVapidDetails(
  VAPID_SUBJECT,
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

let subscriptions = [];
let lastAlerts = {};
let calls = {};

function rateLimit(ip, limit = 30, windowMs = 60000) {
  const now = Date.now();
  if (!calls[ip]) calls[ip] = [];
  calls[ip] = calls[ip].filter(ts => now - ts < windowMs);
  if (calls[ip].length >= limit) return false;
  calls[ip].push(now);
  return true;
}

function requireAuth(req, res, next) {
  const token = req.headers['x-aura-token'];
  if (token !== AUTH_TOKEN) {
    return res.status(403).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

function validateNotificationInput(req, res, next) {
  const title = req.body?.title;
  const body = req.body?.body;
  const url = req.body?.url;

  if (title !== undefined && typeof title !== 'string') {
    return res.status(400).json({ ok: false, error: 'invalid title' });
  }
  if (body !== undefined && typeof body !== 'string') {
    return res.status(400).json({ ok: false, error: 'invalid body' });
  }
  if (url !== undefined && typeof url !== 'string') {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }
  if (typeof title === 'string' && title.length > 120) {
    return res.status(400).json({ ok: false, error: 'title too long' });
  }
  if (typeof body === 'string' && body.length > 240) {
    return res.status(400).json({ ok: false, error: 'body too long' });
  }

  next();
}

app.use((req, res, next) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit(ip)) {
    return res.status(429).json({ ok: false, error: 'rate limit' });
  }
  next();
});

app.get('/', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'aura-push',
    subscriptions: subscriptions.length
  });
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    subscriptions: subscriptions.length,
    alertsTracked: Object.keys(lastAlerts).length
  });
});

app.get('/security-status', requireAuth, (_req, res) => {
  res.status(200).json({
    ok: true,
    subscriptions: subscriptions.length,
    alertsTracked: Object.keys(lastAlerts).length,
    authEnabled: true,
    rateLimitPerMinute: 30
  });
});

app.post('/subscribe', (req, res) => {
  try {
    const sub = req.body;

    if (!sub || typeof sub !== 'object' || !sub.endpoint) {
      return res.status(400).json({ ok: false, error: 'suscripción inválida' });
    }

    const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
    if (!exists) subscriptions.push(sub);

    console.log('Suscripción guardada:', sub.endpoint);
    return res.status(201).json({
      ok: true,
      stored: true,
      total: subscriptions.length
    });
  } catch (err) {
    console.error('Error en /subscribe:', err);
    return res.status(500).json({ ok: false, error: 'error guardando suscripción' });
  }
});

app.post('/notify', requireAuth, validateNotificationInput, async (req, res) => {
  try {
    const payload = JSON.stringify({
      title: req.body?.title || 'AURA',
      body: req.body?.body || 'Push real funcionando',
      icon: req.body?.icon || './icon-192.png',
      badge: req.body?.badge || './icon-192.png',
      url: req.body?.url || '/'
    });

    if (!subscriptions.length) {
      return res.status(200).json({ ok: true, sent: 0, note: 'no hay suscripciones' });
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
    return res.status(500).json({ ok: false, error: 'error enviando notificación' });
  }
});

app.post('/smart-notify', requireAuth, validateNotificationInput, async (req, res) => {
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
      url: req.body?.url || '/'
    });

    if (!subscriptions.length) {
      return res.status(200).json({ ok: true, sent: 0, note: 'no hay suscripciones' });
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
    return res.status(500).json({ ok: false, error: 'error enviando smart notification' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
