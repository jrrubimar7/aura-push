const express = require('express');
const cors = require('cors');
const webpush = require('web-push');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const subscriptions = [];

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || 'mailto:tu@email.com';
const port = process.env.PORT || 3000;

if (!publicKey || !privateKey) {
  console.error('Faltan VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY en .env');
  process.exit(1);
}

webpush.setVapidDetails(subject, publicKey, privateKey);

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'AURA push backend', subscriptions: subscriptions.length });
});

app.post('/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) {
    return res.status(400).json({ ok: false, error: 'Suscripción inválida' });
  }

  const exists = subscriptions.some(s => s.endpoint === sub.endpoint);
  if (!exists) subscriptions.push(sub);

  return res.json({ ok: true, stored: subscriptions.length });
});

app.post('/notify', async (req, res) => {
  const title = req.body?.title || 'AURA';
  const body = req.body?.body || 'Push enviado';
  const url = req.body?.url || '/';

  let sent = 0;
  let failed = 0;

  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify({ title, body, url }));
      sent++;
    } catch (err) {
      failed++;
      console.error('Push fail:', err.statusCode || err.message);
    }
  }));

  res.json({ ok: true, sent, failed, total: subscriptions.length });
});

app.listen(port, () => {
  console.log('AURA push backend on port', port);
});
