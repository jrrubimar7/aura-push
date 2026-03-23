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

app.get('/', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'aura-push',
    subscriptions: subscriptions.length
  });
});

app.get('/health', (req, res) => {
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
      icon: req.body?.icon || '/icons/icon-192.png',
      badge: req.body?.badge || '/icons/icon-192.png',
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
      subscriptions = subscriptions.filter(
        s => !invalidEndpoints.includes(s.endpoint)
      );
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
