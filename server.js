import "dotenv/config";
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { franc } from 'franc';
import { streamBotResponse, askBot, loadTenantPrompts } from './openai.js';
import { createLeadsStore } from './lib/leadsStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIRST_TOKEN_TIMEOUT_MS = 4000;
const OVERALL_TIMEOUT_MS = 45000;
const HEARTBEAT_MS = 10000;

const MAX_MARKERS = 10;
const markers = [];
const lastEvent = { rid: null, reason: null };

function recordMarker(event, data = {}) {
  markers.push({ ts: Date.now(), event, ...data });
  while (markers.length > MAX_MARKERS) {
    markers.shift();
  }
  if (event === 'fallback-used' || event === 'openai-abort') {
    if (data?.rid) lastEvent.rid = data.rid;
    if (data?.reason) lastEvent.reason = data.reason;
  }
}

const isProduction = process.env.NODE_ENV === 'production';
const FALLBACK_TENANT_ID_RAW = (process.env.DEFAULT_TENANT_ID || 'neurox').trim() || 'default';
const FALLBACK_TENANT_ID =
  FALLBACK_TENANT_ID_RAW.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'default';

const loadedTenants = await loadTenantPrompts(true);
if (!loadedTenants.length) {
  console.warn('⚠️ No tenant prompts detected. Falling back to default prompt.');
} else {
  console.log(`✅ Tenant prompts initialized (${loadedTenants.length})`);
}

function normalizeTenantId(rawTenantId) {
  const tenantId = (rawTenantId || '').toString().trim();
  if (!tenantId) return FALLBACK_TENANT_ID;
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || FALLBACK_TENANT_ID;
}

const defaultAllowedOrigins = [
  'https://neurox.one',
  'https://cleaning-bot-production-0d1b.up.railway.app',
];

const configuredOrigins = new Set([
  ...defaultAllowedOrigins,
  ...(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

if (!isProduction) {
  configuredOrigins.add('http://localhost:3000');
  configuredOrigins.add('http://localhost:5173');
  configuredOrigins.add('http://127.0.0.1:3000');
  configuredOrigins.add('http://127.0.0.1:5173');
}

const allowAllOrigins =
  process.env.CORS_ALLOW_ALL === 'true' || configuredOrigins.has('*');
if (configuredOrigins.has('*')) {
  configuredOrigins.delete('*');
}

const allowedOriginsList = Array.from(configuredOrigins);
console.log(
  `🌐 CORS enabled for: ${allowedOriginsList.length ? allowedOriginsList.join(', ') : 'none'}`,
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowAllOrigins || configuredOrigins.has(origin)) {
      return callback(null, true);
    }
    console.warn('Blocked CORS origin', origin);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'X-Client-ID',
    'X-Tenant-ID',
    'X-Bot-Token',
    'X-Public-Token',
    'X-Stream-Mode',
  ],
};

const app = express();
app.use(cors(corsOptions));
app.use(express.json());

const sessions = new Map();
const leadsStore = createLeadsStore(__dirname);
void leadsStore.ensureFile?.().catch((error) =>
  console.error('lead-store-init-error', error),
);

function parseCookies(str = '') {
  return str.split(';').reduce((acc, part) => {
    const [key, value] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function ensureSession(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  let sessionId = cookies.session_id;

  if (!sessionId || typeof sessionId !== 'string') {
    sessionId = crypto.randomUUID();
  }

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, new Map());
  }

  const sameSite = isProduction ? 'None' : 'Lax';
  const secureFlag = isProduction ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=${sameSite}${secureFlag}`,
  );

  req.sessionId = sessionId;
  next();
}

app.use(ensureSession);

// Static UI
app.use(express.static(path.join(__dirname, 'public')));

function getClientId(req) {
  const clientId = (req.headers['x-client-id'] || '').toString().trim();
  return clientId || null;
}

function getHistory(sessionId, tenantId, clientId) {
  const key = `${tenantId}::${clientId}`;
  let clients = sessions.get(sessionId);
  if (!clients) {
    clients = new Map();
    sessions.set(sessionId, clients);
  }
  let history = clients.get(key);
  if (!history) {
    history = [];
    clients.set(key, history);
  }
  return history;
}

function trimHistory(history, maxTurns = 20) {
  const maxMessages = maxTurns * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
}

function clearHistory(sessionId, tenantId, clientId) {
  const clients = sessions.get(sessionId);
  if (!clients) return;
  const key = `${tenantId}::${clientId}`;
  clients.set(key, []);
}

function normalizeError(err) {
  const statusFromResponse = err?.status || err?.response?.status;
  const code = err?.code || err?.cause?.code;
  const messageFromResponse = err?.response?.data?.error?.message;
  const defaultDetails = err?.message || 'Unexpected server error.';

  if (/Missing OPENAI_API_KEY/.test(defaultDetails)) {
    return {
      status: 500,
      error: 'MISSING_OPENAI_API_KEY',
      details: 'Add OPENAI_API_KEY to your environment and restart the server.',
    };
  }

  if (code && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code)) {
    return {
      status: 503,
      error: 'OPENAI_UNREACHABLE',
      details: 'Unable to reach OpenAI. Check your internet connection or firewall.',
    };
  }

  if (statusFromResponse) {
    return {
      status: statusFromResponse,
      error: err?.response?.data?.error?.code || 'OPENAI_ERROR',
      details: messageFromResponse || defaultDetails,
    };
  }

  if (err?.isOpenAIError) {
    return {
      status: 502,
      error: 'OPENAI_ERROR',
      details: defaultDetails,
    };
  }

  return { status: 500, error: 'SERVER_ERROR', details: defaultDetails };
}

function detectLanguage(text = '') {
  const sample = (text || '').trim();
  if (!sample) return 'eng';

  const lang = franc(sample, { minLength: 3 });
  if (!lang || lang === 'und') return 'eng';
  return lang;
}

async function getGptReply(message, history = [], tenantId) {
  const lang = detectLanguage(message);
  console.log(
    `[MODEL] Language detected: ${lang}. Using GPT (OpenAI). Message: ${message}`,
  );
  const reply = (await askBot(message, { history, tenantId }))?.trim?.() || '';
  return reply;
}

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasOpenAIApiKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    streamingEnabled: true,
    lastRid: lastEvent.rid,
    lastReason: lastEvent.reason,
  });
});

if (process.env.NODE_ENV !== 'production') {
  app.get('/diag/last', (_req, res) => {
    res.json({ markers });
  });
}

app.post('/leads', async (req, res) => {
  const {
    name = '',
    phone = '',
    email = '',
    address = '',
    date = '',
    timeWindow = '',
    notes = '',
    quoteTotal = '',
  } = req.body || {};

  if (!name.trim() && !phone.trim() && !email.trim()) {
    return res.status(400).json({
      error: 'INVALID_LEAD',
      details: 'Provide at least a name and phone or email.',
    });
  }

  const entry = {
    id: crypto.randomUUID(),
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim(),
    address: address.trim(),
    date: date.trim(),
    timeWindow: timeWindow.trim(),
    notes: notes.trim(),
    quoteTotal: typeof quoteTotal === 'number' ? quoteTotal : (quoteTotal || '').toString().trim(),
    session_id: req.sessionId,
  };

  try {
    await leadsStore.addLead(entry);
  } catch (error) {
    console.error('lead-store-write-error', error);
    return res.status(500).json({ error: 'STORE_WRITE_FAILED' });
  }

  res.status(201).json({ lead: entry });
});

app.get('/admin/leads', async (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD_NOT_CONFIGURED' });
  }

  const provided =
    (req.headers['x-admin-key'] || '').toString() ||
    (req.query.key ? req.query.key.toString() : '');

  if (provided !== adminPassword) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const leads = await leadsStore.getLeads();
    res.json({ leads });
  } catch (error) {
    console.error('lead-store-read-error', error);
    res.status(500).json({ error: 'STORE_READ_FAILED' });
  }
});

// Chat endpoint with SSE streaming + watchdog + fallback
app.post('/chat', async (req, res) => {
  const token = (req.headers['x-public-token'] || '').toString().trim();
  console.log('Frontend token:', token);
  console.log('Server BOT_PUBLIC_TOKEN:', process.env.BOT_PUBLIC_TOKEN);
  if (token !== process.env.BOT_PUBLIC_TOKEN) {
    const legacyToken = (req.headers['x-bot-token'] || '').toString().trim();
    if (legacyToken === process.env.BOT_PUBLIC_TOKEN) {
      console.warn('⚠️ Legacy x-bot-token header accepted');
    } else {
      console.error('❌ Unauthorized token mismatch');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const tenantId = normalizeTenantId(
    req.header('x-tenant-id') || req.query.tenant || FALLBACK_TENANT_ID,
  );
  console.log('Incoming chat payload:', req.body);
  const message = (req.body?.message || '').toString().trim();
  if (!message) {
    return res.status(400).json({ error: 'MISSING_MESSAGE' });
  }

  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: 'MISSING_CLIENT_ID' });
  }

  const sessionId = req.sessionId;
  const rid = crypto.randomBytes(4).toString('hex');
  const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const detectedLang = detectLanguage(message);
  console.log(
    `[MODEL] Language detected: ${detectedLang}. Using GPT (OpenAI). Message: ${message}`,
  );

  const history = getHistory(sessionId, tenantId, clientId);
  const wantsJson =
    req.headers['x-stream-mode'] === 'json' ||
    (req.headers.accept || '').includes('application/json');

  const updateHistory = (replyText) => {
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: replyText });
    trimHistory(history);
  };

  if (wantsJson) {
    try {
      const reply = await getGptReply(message, history, tenantId);
      if (!reply) {
        const normalized = {
          status: 502,
          error: 'NO_REPLY',
          details: 'Assistant returned an empty reply.',
        };
        console.error('sse-error', { rid, status: normalized.status, code: normalized.error });
        return res.status(normalized.status).json(normalized);
      }
      updateHistory(reply);
      console.log('sse-done', { rid, chars: reply.length, mode: 'json' });
      return res.json({ reply });
    } catch (err) {
      const normalized = normalizeError(err);
      console.error('sse-error', {
        rid,
        status: normalized.status,
        code: normalized.error,
      });
      return res.status(normalized.status).json(normalized);
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const abortController = new AbortController();
  let started = false;
  let receivedToken = false;
  let fallbackUsed = false;
  let clientClosed = false;
  let firstTokenTimer = null;
  let overallTimer = null;
  let heartbeatTimer = null;
  let fallbackPromise = null;
  let streamIterator;

  const clearTimers = () => {
    if (firstTokenTimer) {
      clearTimeout(firstTokenTimer);
      firstTokenTimer = null;
    }
    if (overallTimer) {
      clearTimeout(overallTimer);
      overallTimer = null;
    }
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const safeWrite = (eventName, payloadJSON) => {
    if (clientClosed) return;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${payloadJSON}\n\n`);
  };

  const cleanup = async () => {
    if (clientClosed) return;
    clientClosed = true;
    clearTimers();
    if (fallbackPromise) {
      try {
        await fallbackPromise;
      } catch {
        // ignore
      }
    }
    res.end();
  };

  req.on('close', cleanup);
  res.on('close', cleanup);

  const sendError = (payload) => {
    console.error('sse-error', { rid, status: payload.status, code: payload.error });
    recordMarker('sse-error', { rid, status: payload.status, code: payload.error });
    safeWrite('error', JSON.stringify(payload));
  };

  const sendStart = () => {
    if (started) return;
    started = true;
    console.log('SSE start', { rid, sid: sessionId, model: modelName });
    recordMarker('SSE start', { rid, sid: sessionId });
    safeWrite('start', '{}');
    firstTokenTimer = setTimeout(() => abortAndFallback('first_token_timeout'), FIRST_TOKEN_TIMEOUT_MS);
    overallTimer = setTimeout(() => abortAndFallback('overall_timeout'), OVERALL_TIMEOUT_MS);
    heartbeatTimer = setInterval(() => {
      safeWrite('heartbeat', '{}');
    }, HEARTBEAT_MS);
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const markFallback = (reason) => {
    console.log('fallback-used', { rid, reason });
    recordMarker('fallback-used', { rid, reason });
    lastEvent.rid = rid;
    lastEvent.reason = reason;
  };

  const fallbackReply = (reason) => {
    if (fallbackUsed || clientClosed) return fallbackPromise;
    fallbackUsed = true;
    markFallback(reason);
    sendStart();
    clearTimers();

    fallbackPromise = (async () => {
      let replyText = '';
      try {
        replyText = (await askBot(message, { history, tenantId }))?.trim?.() || '';
      } catch (err) {
        const normalized = normalizeError(err);
        normalized.reason = reason;
        sendError(normalized);
        return;
      }

      if (!replyText) {
        sendError({
          status: 502,
          error: 'NO_REPLY',
          details: 'Assistant returned an empty reply.',
          reason,
        });
        return;
      }

      updateHistory(replyText);

      const pieces = replyText.match(/\S+\s*/g) || [replyText];
      for (const piece of pieces) {
        if (clientClosed) break;
        receivedToken = true;
        safeWrite('token', JSON.stringify({ token: piece }));
        await delay(25 + Math.floor(Math.random() * 16));
      }

      safeWrite('done', JSON.stringify({ reply: replyText, reason }));
      console.log('sse-done', { rid, chars: replyText.length });
      recordMarker('sse-done', { rid, chars: replyText.length, reason });
    })();

    return fallbackPromise;
  };

  const seenAbortReasons = new Set();

  const logAbort = (reason) => {
    if (seenAbortReasons.has(reason)) return;
    seenAbortReasons.add(reason);
    console.log('openai-abort', { rid, reason });
    recordMarker('openai-abort', { rid, reason });
    lastEvent.rid = rid;
    lastEvent.reason = reason;
  };

  const abortAndFallback = (reason) => {
    if (fallbackUsed || clientClosed) return;
    try {
      if (!abortController.signal.aborted) {
        abortController.abort(reason);
      }
    } catch {
      /* noop */
    }
    logAbort(reason);
    fallbackReply(reason);
  };

  try {
    streamIterator = await streamBotResponse(message, {
      signal: abortController.signal,
      history,
      tenantId,
    });
  } catch (err) {
    await fallbackReply('stream_setup_failure');
    await cleanup();
    return;
  }

  sendStart();

  let aggregated = '';

  try {
    for await (const token of streamIterator) {
      if (!token) continue;
      if (!receivedToken) {
        receivedToken = true;
        clearTimeout(firstTokenTimer);
        firstTokenTimer = null;
        console.log('first-token', { rid });
        recordMarker('first-token', { rid });
      }
      aggregated += token;
      safeWrite('token', JSON.stringify({ token }));
    }

    clearTimers();

    const finalReply = aggregated.trim();
    if (finalReply) {
      updateHistory(finalReply);
      safeWrite('done', JSON.stringify({ reply: finalReply }));
      console.log('sse-done', { rid, chars: finalReply.length });
      recordMarker('sse-done', { rid, chars: finalReply.length });
    } else {
      await fallbackReply('empty_stream_reply');
    }
  } catch (err) {
    const reason = abortController.signal.reason || err?.name || 'stream_error';
    if (abortController.signal.aborted) {
      logAbort(reason);
      if (reason === 'user_abort') {
        safeWrite('aborted', JSON.stringify({ reason }));
        lastEvent.rid = rid;
        lastEvent.reason = reason;
        recordMarker('aborted', { rid, reason });
      } else if (reason === 'client_watchdog') {
        safeWrite('aborted', JSON.stringify({ reason }));
        lastEvent.rid = rid;
        lastEvent.reason = reason;
        recordMarker('aborted', { rid, reason });
      } else {
        // handled via abortAndFallback already
      }
    } else if (!clientClosed) {
      await fallbackReply('stream_runtime_failure');
    }
  } finally {
    clearTimers();
    const finalAbortReason = abortController.signal.reason;
    if (
      !receivedToken &&
      !fallbackUsed &&
      !clientClosed &&
      finalAbortReason !== 'user_abort' &&
      finalAbortReason !== 'client_watchdog'
    ) {
      await fallbackReply('no_tokens_received');
    }
    await cleanup();
  }
});

app.post('/session/reset', (req, res) => {
  const clientId = getClientId(req);
  if (!clientId) {
    return res.status(400).json({ error: 'MISSING_CLIENT_ID' });
  }

  const tenantId = normalizeTenantId(
    req.header('x-tenant-id') || req.query.tenant || FALLBACK_TENANT_ID,
  );

  clearHistory(req.sessionId, tenantId, clientId);
  res.json({ ok: true });
});

app.get('/bot-config.js', (req, res) => {
  const tenantId = normalizeTenantId(req.query.tenant || FALLBACK_TENANT_ID);
  const payload = {
    token: (process.env.BOT_PUBLIC_TOKEN || '').toString().trim(),
    tenantId,
  };

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.send(`window.CLEANING_BOT_CONFIG=${JSON.stringify(payload)};`);
});

app.get('/widget.js', (req, res) => {
  const fallbackTenant = JSON.stringify(FALLBACK_TENANT_ID);
  const widgetJs = String.raw`(function () {
  var scriptEl = document.currentScript;
  if (!scriptEl) {
    console.error('[cleaning-bot] widget: unable to locate current script element.');
    return;
  }

  var dataset = scriptEl.dataset || {};
  var tenantId = (dataset.tenant || '').toLowerCase() || ${fallbackTenant};
  var token = dataset.token || '';
  var apiBase = dataset.base || (function () {
    try {
      return new URL(scriptEl.src, window.location.href).origin;
    } catch (error) {
      console.warn('[cleaning-bot] widget: failed to derive API base URL.', error);
      return '';
    }
  })();

  if (!token) {
    console.error('[cleaning-bot] widget: missing data-token attribute.');
    return;
  }

  if (!apiBase) {
    console.error('[cleaning-bot] widget: unable to resolve API base URL.');
    return;
  }

  var apiUrl = apiBase.replace(/\/$/, '') + '/chat';
  var clientStorageKey = 'cleaning-bot-client-' + tenantId;
  var clientId = null;
  try {
    clientId = localStorage.getItem(clientStorageKey);
  } catch (error) {
    console.warn('[cleaning-bot] widget: unable to access localStorage.', error);
  }
  if (!clientId) {
    var generated = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'cbw-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    clientId = generated;
    try {
      localStorage.setItem(clientStorageKey, clientId);
    } catch (error) {
      /* ignore write failures */
    }
  }

  var styleId = 'cleaning-bot-widget-style';
  if (!document.getElementById(styleId)) {
    var style = document.createElement('style');
    style.id = styleId;
    style.textContent =
      '.cbw-container{position:fixed;z-index:2147483000;font-family:"Inter",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#0f172a;}' +
      '.cbw-container[data-position="right"]{right:24px;bottom:24px;}' +
      '.cbw-container[data-position="left"]{left:24px;bottom:24px;}' +
      '.cbw-button{all:unset;display:flex;align-items:center;justify-content:center;gap:10px;background:#2563eb;color:#fff;padding:14px 18px;border-radius:999px;box-shadow:0 12px 32px rgba(37,99,235,0.4);cursor:pointer;font-weight:600;transition:transform 0.2s ease,box-shadow 0.2s ease;}' +
      '.cbw-button:hover{transform:translateY(-1px);box-shadow:0 16px 36px rgba(37,99,235,0.45);}' +
      '.cbw-button-icon{display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:999px;background:rgba(255,255,255,0.2);font-size:16px;}' +
      '.cbw-panel{display:none;flex-direction:column;width:360px;height:520px;background:#fff;border-radius:18px;box-shadow:0 24px 48px rgba(15,23,42,0.2);overflow:hidden;}' +
      '.cbw-open .cbw-panel{display:flex;}' +
      '.cbw-open .cbw-button{display:none;}' +
      '.cbw-header{padding:16px 18px;background:linear-gradient(135deg,#2563eb,#1e40af);color:#fff;display:flex;align-items:center;justify-content:space-between;}' +
      '.cbw-header-title{font-size:16px;font-weight:600;margin:0;}' +
      '.cbw-header-subtitle{margin:4px 0 0;font-size:13px;opacity:0.8;}' +
      '.cbw-close{all:unset;font-size:18px;cursor:pointer;color:rgba(255,255,255,0.85);padding:4px;}' +
      '.cbw-messages{flex:1;padding:18px;background:#f8fafc;overflow-y:auto;display:flex;flex-direction:column;gap:12px;}' +
      '.cbw-message{padding:10px 14px;border-radius:14px;line-height:1.4;max-width:85%;box-shadow:0 8px 20px rgba(15,23,42,0.08);white-space:pre-wrap;word-break:break-word;font-size:14px;}' +
      '.cbw-message.cbw-user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:6px;}' +
      '.cbw-message.cbw-bot{align-self:flex-start;background:#fff;color:#0f172a;border-bottom-left-radius:6px;}' +
      '.cbw-message.cbw-error{background:#fee2e2;color:#991b1b;}' +
      '.cbw-input{display:flex;gap:10px;padding:14px 16px;background:#fff;border-top:1px solid #e2e8f0;}' +
      '.cbw-input input{flex:1;padding:12px 14px;border-radius:999px;border:1px solid #cbd5f5;font-size:14px;outline:none;}' +
      '.cbw-input input:focus{border-color:#2563eb;}' +
      '.cbw-input button{all:unset;padding:12px 18px;border-radius:999px;background:#2563eb;color:#fff;font-weight:600;cursor:pointer;transition:background 0.2s ease;}' +
      '.cbw-input button:hover{background:#1e40af;}' +
      '.cbw-input button[disabled]{opacity:0.65;cursor:not-allowed;}' +
      '.cbw-typing{display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;}' +
      '.cbw-typing-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:cbw-bounce 1s infinite;}' +
      '.cbw-typing-dot:nth-child(2){animation-delay:0.15s;}' +
      '.cbw-typing-dot:nth-child(3){animation-delay:0.3s;}' +
      '@keyframes cbw-bounce{0%,80%,100%{transform:scale(0);}40%{transform:scale(1);}}';
    document.head.appendChild(style);
  }

  function appendMessage(list, role, text, extraClass) {
    var msg = document.createElement('div');
    var roleClass = role === 'user' ? 'cbw-user' : 'cbw-bot';
    msg.className = 'cbw-message ' + roleClass + (extraClass ? ' ' + extraClass : '');
    msg.textContent = text;
    list.appendChild(msg);
    list.scrollTop = list.scrollHeight;
    return msg;
  }

  function createTypingBubble(list) {
    var bubble = document.createElement('div');
    bubble.className = 'cbw-message cbw-bot cbw-typing';
    var dotsWrapper = document.createElement('div');
    dotsWrapper.style.display = 'inline-flex';
    dotsWrapper.style.gap = '4px';
    for (var i = 0; i < 3; i += 1) {
      var dot = document.createElement('span');
      dot.className = 'cbw-typing-dot';
      dotsWrapper.appendChild(dot);
    }
    bubble.appendChild(document.createTextNode('Thinking'));
    bubble.appendChild(dotsWrapper);
    list.appendChild(bubble);
    list.scrollTop = list.scrollHeight;
    return bubble;
  }

  function init() {
    var container = document.createElement('div');
    container.className = 'cbw-container cbw-collapsed';
    container.dataset.position = dataset.position === 'left' ? 'left' : 'right';

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cbw-button';
    button.innerHTML = '<span class="cbw-button-icon">💬</span><span class="cbw-button-label">Chat with us</span>';
    button.addEventListener('click', function () {
      container.classList.add('cbw-open');
      messages.scrollTop = messages.scrollHeight;
      input.focus();
    });

    var panel = document.createElement('div');
    panel.className = 'cbw-panel';

    var header = document.createElement('header');
    header.className = 'cbw-header';

    var headerText = document.createElement('div');
    headerText.innerHTML = '<p class="cbw-header-title">Need a hand?</p><p class="cbw-header-subtitle">We reply in seconds.</p>';

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'cbw-close';
    close.setAttribute('aria-label', 'Close chat');
    close.innerHTML = '×';
    close.addEventListener('click', function () {
      container.classList.remove('cbw-open');
    });

    header.appendChild(headerText);
    header.appendChild(close);

    var messages = document.createElement('div');
    messages.className = 'cbw-messages';
    appendMessage(messages, 'bot', 'Hi there! How can we help today?');

    var form = document.createElement('form');
    form.className = 'cbw-input';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = dataset.placeholder || 'Ask about services, pricing, booking…';

    var send = document.createElement('button');
    send.type = 'submit';
    send.textContent = 'Send';

    form.appendChild(input);
    form.appendChild(send);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (!input.value.trim()) {
        return;
      }
      if (send.disabled) {
        return;
      }
      var question = input.value.trim();
      input.value = '';
      appendMessage(messages, 'user', question);
      send.disabled = true;
      input.disabled = true;
      var typingBubble = createTypingBubble(messages);

      fetch(apiUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Stream-Mode': 'json',
          'X-Client-ID': clientId,
          'X-Tenant-ID': tenantId,
          'X-Bot-Token': token,
          'X-Public-Token': token
        },
        body: JSON.stringify({ message: question })
      })
        .then(function (response) {
          return response.json().then(function (payload) {
            return { ok: response.ok, payload: payload };
          });
        })
        .then(function (result) {
          var ok = result.ok;
          var payload = result.payload || {};
          var reply = (payload.reply || payload.details || '').trim();
          if (!ok) {
            throw new Error(reply || 'Unexpected error');
          }
          typingBubble.textContent = reply || 'We are here if you need anything else.';
          typingBubble.classList.remove('cbw-typing');
        })
        .catch(function (error) {
          typingBubble.textContent = 'Sorry, something went wrong. Please try again.';
          typingBubble.classList.remove('cbw-typing');
          typingBubble.classList.add('cbw-error');
          console.error('[cleaning-bot] widget request failed:', error);
        })
        .finally(function () {
          send.disabled = false;
          input.disabled = false;
          input.focus();
        });
    });

    panel.appendChild(header);
    panel.appendChild(messages);
    panel.appendChild(form);

    container.appendChild(button);
    container.appendChild(panel);
    document.body.appendChild(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();`;

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.send(widgetJs);
});

app.get('/embed', (req, res) => {
  const tenantId = normalizeTenantId(req.query.tenant || FALLBACK_TENANT_ID);
  const token =
    (req.query.token || '').toString().trim() ||
    (process.env.BOT_PUBLIC_TOKEN || '').toString().trim();
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const embedHtml = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chat Widget</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f8fafc;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .embed-shell {
        width: 360px;
        height: 520px;
        background: #ffffff;
        border-radius: 18px;
        box-shadow: 0 24px 48px rgba(15, 23, 42, 0.18);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .embed-header {
        padding: 18px;
        background: linear-gradient(135deg, #2563eb, #1e40af);
        color: #ffffff;
      }
      .embed-header h1 {
        margin: 0;
        font-size: 1.05rem;
      }
      .embed-header p {
        margin: 6px 0 0;
        font-size: 0.85rem;
        opacity: 0.85;
      }
      .embed-messages {
        flex: 1;
        padding: 18px;
        background: #f8fafc;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .embed-message {
        max-width: 80%;
        padding: 10px 14px;
        border-radius: 16px;
        line-height: 1.4;
        font-size: 0.95rem;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
      }
      .embed-message.user {
        align-self: flex-end;
        background: #2563eb;
        color: #ffffff;
        border-bottom-right-radius: 6px;
      }
      .embed-message.bot {
        align-self: flex-start;
        background: #ffffff;
        color: #0f172a;
        border-bottom-left-radius: 6px;
      }
      .embed-message.error {
        background: #fee2e2;
        color: #991b1b;
      }
      .embed-input {
        padding: 16px 18px;
        background: #ffffff;
        border-top: 1px solid #e2e8f0;
        display: flex;
        gap: 10px;
      }
      .embed-input input {
        flex: 1;
        border-radius: 999px;
        border: 1px solid #cbd5f5;
        padding: 12px 16px;
        outline: none;
        font-size: 0.95rem;
      }
      .embed-input input:focus {
        border-color: #2563eb;
      }
      .embed-input button {
        border: none;
        border-radius: 999px;
        background: #2563eb;
        color: #ffffff;
        font-weight: 600;
        padding: 12px 20px;
        cursor: pointer;
      }
      .embed-input button[disabled] {
        opacity: 0.65;
        cursor: not-allowed;
      }
      .typing {
        font-size: 0.85rem;
        color: #475569;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .typing span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #94a3b8;
        animation: typing-bounce 1s infinite;
      }
      .typing span:nth-child(2) { animation-delay: 0.15s; }
      .typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes typing-bounce {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
    </style>
  </head>
  <body>
    <main class="embed-shell">
      <header class="embed-header">
        <h1>Chat with us</h1>
        <p>Ask about pricing, availability, or support — we're here to help.</p>
      </header>
      <section class="embed-messages" id="embed-messages"></section>
      <form class="embed-input" id="embed-form">
        <input id="embed-input" type="text" placeholder="Type your question…" autocomplete="off" />
        <button id="embed-send" type="submit">Send</button>
      </form>
    </main>
    <script>
      (function () {
        var config = {
          tenantId: ${JSON.stringify(tenantId)},
          token: ${JSON.stringify(token)},
          apiUrl: ${JSON.stringify(`${baseUrl}/chat`)},
          clientKey: 'cleaning-bot-embed-' + ${JSON.stringify(tenantId)}
        };

        if (!config.token) {
          console.error('[cleaning-bot] embed: missing token. Provide ?token= in iframe src.');
        }

        var messagesEl = document.getElementById('embed-messages');
        var form = document.getElementById('embed-form');
        var input = document.getElementById('embed-input');
        var sendBtn = document.getElementById('embed-send');

        function ensureClientId() {
          try {
            var stored = sessionStorage.getItem(config.clientKey);
            if (stored) return stored;
          } catch (error) {}
          var generated = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'cb-embed-' + Date.now() + '-' + Math.random().toString(16).slice(2);
          try {
            sessionStorage.setItem(config.clientKey, generated);
          } catch (error) {}
          return generated;
        }

        var clientId = ensureClientId();

        function appendMessage(role, text, extra) {
          var bubble = document.createElement('div');
          bubble.className = 'embed-message ' + role + (extra ? ' ' + extra : '');
          bubble.textContent = text;
          messagesEl.appendChild(bubble);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return bubble;
        }

        function createTyping() {
          var wrapper = document.createElement('div');
          wrapper.className = 'embed-message bot typing';
          wrapper.textContent = 'Typing ';
          var dots = document.createElement('span');
          dots.className = 'typing';
          dots.innerHTML = '<span></span><span></span><span></span>';
          wrapper.appendChild(dots);
          messagesEl.appendChild(wrapper);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return wrapper;
        }

        appendMessage('bot', 'Hi there! How can we help today?');

        form.addEventListener('submit', function (event) {
          event.preventDefault();
          if (!input.value.trim()) {
            return;
          }
          if (!config.token) {
            appendMessage('bot', 'Bot token missing. Please configure the embed URL.', 'error');
            return;
          }

          var question = input.value.trim();
          input.value = '';
          appendMessage('user', question);

          sendBtn.disabled = true;
          input.disabled = true;

          var typing = createTyping();

          fetch(config.apiUrl, {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              'X-Stream-Mode': 'json',
              'X-Client-ID': clientId,
              'X-Tenant-ID': config.tenantId,
              'X-Bot-Token': config.token,
              'X-Public-Token': config.token
            },
            body: JSON.stringify({ message: question })
          })
            .then(function (response) {
              return response.json().then(function (payload) {
                return { ok: response.ok, payload: payload };
              });
            })
            .then(function (result) {
              var ok = result.ok;
              var payload = result.payload || {};
              var reply = (payload.reply || payload.details || '').trim();
              if (!ok) {
                throw new Error(reply || 'Unexpected error');
              }
              typing.textContent = reply || 'Happy to help!';
              typing.classList.remove('typing');
            })
            .catch(function (error) {
              typing.textContent = 'Sorry, something went wrong. Please try again.';
              typing.classList.remove('typing');
              typing.classList.add('error');
              console.error('[cleaning-bot] embed request failed:', error);
            })
            .finally(function () {
              sendBtn.disabled = false;
              input.disabled = false;
              input.focus();
            });
        });
      })();
    </script>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.send(embedHtml);
});

// Fallback to index.html
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
