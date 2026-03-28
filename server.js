// ===== AURA SERVER v10 (CONTEXT RESONANCE / JF+-) =====

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
  idleThresholdMs: 300000,
  minPushIntervalMs: 300000,
  tone: 'hybrid',
  intensity: 'soft',
  mode: 'aura-resonance',
  maxContexts: 5,
  resonanceDecayPerHour: 0.12,
  minStrengthToPush: 0.22
};

let contexts = [];

// ===== VAPID =====
webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:test@test.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ===== HELPERS =====
const fallbackMessages = [
  'percibo pausa. ¿Seguimos?',
  'el campo sigue activo. Estoy disponible.',
  'hay algo latente aquí… si quieres lo abrimos.',
  'puedo quedarme en espera… o avanzar contigo.',
  'la pausa también comunica… ¿la atravesamos?'
];

function nowMs() {
  return Date.now();
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeText(v) {
  return String(v || '').trim();
}

function buildResonanceKeys(topic, action, intent) {
  const raw = `${topic} ${action} ${intent}`
    .toLowerCase()
    .replace(/[|,.;:!?()[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const stop = new Set(['de','la','el','y','o','a','en','con','para','por','del','los','las','un','una']);
  return [...new Set(raw.filter(w => w.length > 2 && !stop.has(w)).slice(0, 12))];
}

function stateFromStrength(strength) {
  if (strength >= 0.7) return 'activo';
  if (strength >= 0.35) return 'latente';
  return 'huella';
}

function decayStrength(ctx) {
  const ageHours = Math.max(0, (nowMs() - (ctx.lastTouchedAt || ctx.updatedAt || nowMs())) / 3600000);
  const decayed = ctx.baseStrength - (ageHours * config.resonanceDecayPerHour);
  return clamp(decayed, 0.05, 1);
}

function materializeContext(ctx) {
  const strength = decayStrength(ctx);
  return {
    ...ctx,
    strength: Number(strength.toFixed(3)),
    state: stateFromStrength(strength)
  };
}

function sortContexts(list) {
  return list
    .map(materializeContext)
    .sort((a, b) => {
      if (b.strength !== a.strength) return b.strength - a.strength;
      return (b.lastTouchedAt || 0) - (a.lastTouchedAt || 0);
    });
}

function pruneContexts() {
  contexts = sortContexts(contexts).slice(0, config.maxContexts).map(c => ({
    id: c.id,
    topic: c.topic,
    action: c.action,
    intent: c.intent,
    resonanceKeys: c.resonanceKeys,
    baseStrength: c.strength,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastTouchedAt: c.lastTouchedAt
  }));
}

function upsertContext(body = {}) {
  const topic = normalizeText(body.topic);
  const action = normalizeText(body.action);
  const intent = normalizeText(body.intent);

  const resonanceKeys = buildResonanceKeys(topic, action, intent);
  const signature = `${topic}|${action}|${intent}`.toLowerCase();

  let existing = contexts.find(c =>
    `${c.topic}|${c.action}|${c.intent}`.toLowerCase() === signature
  );

  if (existing) {
    existing.topic = topic || existing.topic;
    existing.action = action || existing.action;
    existing.intent = intent || existing.intent;
    existing.resonanceKeys = resonanceKeys.length ? resonanceKeys : existing.resonanceKeys;
    existing.baseStrength = clamp((existing.baseStrength || 0.55) + 0.18, 0.05, 1);
    existing.updatedAt = nowMs();
    existing.lastTouchedAt = nowMs();
  } else {
    existing = {
      id: 'ctx_' + Math.random().toString(36).slice(2, 10),
      topic,
      action,
      intent,
      resonanceKeys,
      baseStrength: 0.78,
      createdAt: nowMs(),
      updatedAt: nowMs(),
      lastTouchedAt: nowMs()
    };
    contexts.push(existing);
  }

  pruneContexts();
  return sortContexts(contexts).find(c => c.id === existing.id) || materializeContext(existing);
}

function touchContextsFromHeartbeat(body = {}) {
  const text = `${normalizeText(body.topic)} ${normalizeText(body.action)} ${normalizeText(body.intent)} ${normalizeText(body.text)}`.toLowerCase();
  if (!text.trim()) return;

  contexts.forEach(ctx => {
    const score = (ctx.resonanceKeys || []).reduce((acc, key) => acc + (text.includes(key) ? 1 : 0), 0);
    if (score > 0) {
      ctx.baseStrength = clamp((ctx.baseStrength || 0.4) + (0.05 * score), 0.05, 1);
      ctx.lastTouchedAt = nowMs();
      ctx.updatedAt = nowMs();
    }
  });

  pruneContexts();
}

function pickFallbackMessage() {
  return fallbackMessages[Math.floor(Math.random() * fallbackMessages.length)];
}

function pickDominantContext() {
  const sorted = sortContexts(contexts);
  const best = sorted[0];
  if (!best || best.strength < config.minStrengthToPush) return null;
  return best;
}

function buildContextualMessage() {
  const best = pickDominantContext();
  if (!best) return pickFallbackMessage();

  if (best.action && best.topic) {
    return `te quedaste en ${best.action} sobre ${best.topic}… ¿seguimos?`;
  }
  if (best.action) {
    return `te quedaste en ${best.action}… ¿seguimos?`;
  }
  if (best.topic && best.intent) {
    return `seguía abierto ${best.topic} con intención de ${best.intent}… ¿lo retomamos?`;
  }
  if (best.topic) {
    return `seguía abierto ${best.topic}… ¿lo retomamos?`;
  }
  if (best.intent) {
    return `sigue latente la intención de ${best.intent}… ¿avanzamos?`;
  }
  return pickFallbackMessage();
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
    pushCount,
    contextCount: contexts.length,
    dominantContext: pickDominantContext(),
    contexts: sortContexts(contexts)
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

  if (Number(body.maxContexts) > 0) config.maxContexts = Number(body.maxContexts);
  if (Number(body.resonanceDecayPerHour) >= 0) config.resonanceDecayPerHour = Number(body.resonanceDecayPerHour);
  if (Number(body.minStrengthToPush) >= 0) config.minStrengthToPush = Number(body.minStrengthToPush);

  if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
  if (typeof body.proactiveEnabled === 'boolean') config.enabled = body.proactiveEnabled;

  pruneContexts();
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
  res.json({ ok: true, service: 'aura-push', status: 'running', version: 'v10' });
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
  lastInteractionAt = nowMs();
  pushCount = 0;
  touchContextsFromHeartbeat(req.body || {});
  res.json({ ok: true, pushCount, contextCount: contexts.length });
});

app.get('/proactive-status', (req, res) => {
  res.json(statusPayload());
});

app.post('/config', (req, res) => {
  res.json(applyConfig(req.body));
});

app.post('/proactive-config', (req, res) => {
  res.json(applyConfig(req.body));
});

app.post('/context', (req, res) => {
  const ctx = upsertContext(req.body || {});
  res.json({ ok: true, context: ctx, contexts: sortContexts(contexts) });
});

app.get('/context', (req, res) => {
  res.json({ ok: true, context: pickDominantContext(), contexts: sortContexts(contexts) });
});

// ===== LOOP =====
setInterval(async () => {
  const now = nowMs();
  const idle = now - lastInteractionAt;
  const sinceLastPush = now - lastProactiveAt;
  const dynamicInterval = config.minPushIntervalMs * Math.min(Math.max(pushCount, 1), 5);

  if (
    config.enabled &&
    subscriptions.length > 0 &&
    idle > config.idleThresholdMs &&
    sinceLastPush > dynamicInterval
  ) {
    const msg = buildContextualMessage();
    await sendNotificationToAll(`AURA ∞.Ω · ${msg}`);
    lastProactiveAt = now;
    pushCount++;
  }
}, 15000);

// ===== START =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('AURA server v10 running');
});
