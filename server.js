import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { askBot } from './openai.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Static UI
app.use(express.static(path.join(__dirname, 'public')));

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

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    hasOpenAIApiKey: Boolean(process.env.OPENAI_API_KEY),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  });
});

// Chat endpoint
app.post('/chat', async (req, res) => {
  try {
    const message = (req.body?.message || '').toString().trim();
    if (!message) return res.status(400).json({ error: 'MISSING_MESSAGE' });

    const reply = await askBot(message);
    if (!reply) return res.status(502).json({ error: 'NO_REPLY' });

    res.json({ reply });
  } catch (err) {
    const normalized = normalizeError(err);
    console.error('Chat error:', err);
    res.status(normalized.status).json(normalized);
  }
});

// Fallback to index.html
app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🚀 Server on http://localhost:${PORT}`)
);
