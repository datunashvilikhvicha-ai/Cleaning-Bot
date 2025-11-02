import express from 'express';
import bodyParser from 'body-parser';
import axios from 'axios';
import twilio from 'twilio';

const app = express();

// Twilio sends application/x-www-form-urlencoded payloads for WhatsApp webhooks.
app.use(bodyParser.urlencoded({ extended: false }));

const { MessagingResponse } = twilio.twiml;

const FALLBACK_REPLY =
  'Sorry, I could not reach the assistant right now. Please try again in a moment.';

function normalizeBaseUrl(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function resolveNeuroxBaseUrl() {
  const {
    NEUROX_API_URL,
    API_BASE_URL,
    RAILWAY_PUBLIC_DOMAIN,
  } = process.env;

  if (NEUROX_API_URL) return normalizeBaseUrl(NEUROX_API_URL);
  if (API_BASE_URL) return normalizeBaseUrl(API_BASE_URL);
  if (RAILWAY_PUBLIC_DOMAIN) {
    return normalizeBaseUrl(`https://${RAILWAY_PUBLIC_DOMAIN}`);
  }
  return 'https://cleaning-bot-production-0d1b.up.railway.app';
}

function resolveBotToken() {
  const token = (process.env.BOT_PUBLIC_TOKEN || '').trim();
  if (!token) {
    throw new Error('Missing BOT_PUBLIC_TOKEN environment variable');
  }
  return token;
}

function resolveTenantId() {
  const tenant = (process.env.DEFAULT_TENANT_ID || 'neurox').trim();
  return tenant || 'neurox';
}

function resolveClientId(body = {}) {
  const waId = (body.WaId || '').toString().trim();
  if (waId) return `wa:${waId}`;
  const from = (body.From || '').toString().trim();
  if (from) return from.replace(/^whatsapp:/i, '');
  return 'twilio-whatsapp-client';
}

async function forwardMessageToNeurox(message, body) {
  const baseUrl = resolveNeuroxBaseUrl();
  const endpoint = `${baseUrl}/chat`;
  const token = resolveBotToken();
  const tenantId = resolveTenantId();
  const clientId = resolveClientId(body);

  const response = await axios.post(
    endpoint,
    { message },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Stream-Mode': 'json',
        'X-Client-ID': clientId,
        'X-Tenant-ID': tenantId,
        'X-Bot-Token': token,
        'X-Public-Token': token,
      },
      timeout: 25000,
    },
  );

  const reply = (response.data?.reply || response.data?.details || '').toString().trim();
  if (!reply) {
    throw new Error('Empty reply from NeuroX API');
  }
  return reply;
}

app.post('/webhook', async (req, res) => {
  const incomingMessage = (req.body?.Body || '').toString().trim();
  const messagingResponse = new MessagingResponse();

  if (!incomingMessage) {
    messagingResponse.message(
      'I did not catch that message. Please try again.'
    );
    res.type('text/xml').status(200).send(messagingResponse.toString());
    return;
  }

  let replyText = FALLBACK_REPLY;
  try {
    replyText = await forwardMessageToNeurox(incomingMessage, req.body);
  } catch (error) {
    const status = error.response?.status;
    const details =
      error.response?.data ||
      error.message ||
      'Unhandled error contacting NeuroX API';
    console.error('twilio-webhook-forward-error', { status, details });
  }

  messagingResponse.message(replyText);
  res.type('text/xml').status(200).send(messagingResponse.toString());
});

let serverInstance;

export function startWebhookServer(portInput) {
  const resolvedPort = Number(portInput ?? process.env.PORT ?? 3000) || 3000;
  if (serverInstance?.listening) {
    return serverInstance;
  }
  serverInstance = app.listen(resolvedPort, '0.0.0.0');
  return serverInstance;
}

export { app };
export default app;
