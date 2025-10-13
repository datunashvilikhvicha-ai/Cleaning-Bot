import "dotenv/config";
import express from 'express';
import cors from 'cors';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { franc } from 'franc';
import { streamBotResponse, askBot } from './openai.js';
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

const app = express();
app.use(cors());
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

  res.setHeader(
    'Set-Cookie',
    `session_id=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
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

function getHistory(sessionId, clientId) {
  let clients = sessions.get(sessionId);
  if (!clients) {
    clients = new Map();
    sessions.set(sessionId, clients);
  }
  let history = clients.get(clientId);
  if (!history) {
    history = [];
    clients.set(clientId, history);
  }
  return history;
}

function trimHistory(history, maxTurns = 20) {
  const maxMessages = maxTurns * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
}

function clearHistory(sessionId, clientId) {
  const clients = sessions.get(sessionId);
  if (!clients) return;
  clients.set(clientId, []);
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

async function getGptReply(message, history = []) {
  const lang = detectLanguage(message);
  console.log(
    `[MODEL] Language detected: ${lang}. Using GPT (OpenAI). Message: ${message}`,
  );
  const reply = (await askBot(message, { history }))?.trim?.() || '';
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

  const history = getHistory(sessionId, clientId);
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
      const reply = await getGptReply(message, history);
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
        replyText = (await askBot(message, { history }))?.trim?.() || '';
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

  clearHistory(req.sessionId, clientId);
  res.json({ ok: true });
});

// Fallback to index.html
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
