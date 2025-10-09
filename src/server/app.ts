import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env';
import { handleChatRequest } from '../ai/router';
import { reloadKnowledgeBase } from '../kb/loader';
import { reloadFaqSources } from '../kb/rag';
import { calculateCleaningQuote } from '../tools/quote';
import { getAvailabilitySlots } from '../tools/availability';
import { generatePaymentLink } from '../tools/payments';
import { getMetricsSnapshot, recordEvent as recordAnalyticsEvent } from '../analytics/store';

const app = express();

const rateLimitWindowMs = 60_000;
const rateLimitMaxRequests = 60;
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

const bannedTerms = ['fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt'];

function containsBannedContent(input: unknown): boolean {
  if (typeof input === 'string') {
    const lower = input.toLowerCase();
    return bannedTerms.some((term) => lower.includes(term));
  }
  if (Array.isArray(input)) {
    return input.some((item) => containsBannedContent(item));
  }
  if (typeof input === 'object' && input !== null) {
    return Object.values(input).some((value) => containsBannedContent(value));
  }
  return false;
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + rateLimitWindowMs });
    next();
    return;
  }

  if (entry.count >= rateLimitMaxRequests) {
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return;
  }

  entry.count += 1;
  next();
}

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
);
app.use(rateLimitMiddleware);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

function maskSensitiveValue(value: string): string {
  let redacted = value;
  redacted = redacted.replace(
    /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    (_match, user, domain) => `${user.slice(0, 1)}***@${domain}`,
  );
  redacted = redacted.replace(
    /\b(?:\+?\d[\d\s-]{6,}\d)\b/g,
    '[redacted-phone]',
  );
  redacted = redacted.replace(
    /\b\d{1,4}\s+[A-Za-z0-9\s]{3,}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl)\b/gi,
    '[redacted-address]',
  );
  redacted = redacted.replace(/(sk|pk|rk|api|secret)[-_][a-z0-9]{8,}/gi, '[redacted-secret]');
  return redacted;
}

function redactForLog(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (typeof payload === 'string') {
    return maskSensitiveValue(payload);
  }
  if (Array.isArray(payload)) {
    return payload.map(redactForLog);
  }
  if (typeof payload === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const keyLower = key.toLowerCase();
      const isSensitiveKey = ['email', 'phone', 'address', 'token', 'secret', 'key'].some((term) =>
        keyLower.includes(term),
      );
      if (typeof value === 'string' && isSensitiveKey) {
        result[key] = `[redacted-${key}]`;
      } else {
        result[key] = redactForLog(value);
      }
    }
    return result;
  }
  return payload;
}

function logRequest(event: string, payload: unknown): void {
  console.log(`[${new Date().toISOString()}] ${event}`, JSON.stringify(redactForLog(payload)));
}

function logResponse(event: string, payload: unknown): void {
  console.log(`[${new Date().toISOString()}] ${event}`, JSON.stringify(redactForLog(payload)));
}

const quoteRequestSchema = z.object({
  rooms: z.number().int().min(0).max(20),
  baths: z.number().int().min(0).max(10),
  squareMeters: z.number().positive().max(1000),
  serviceType: z.enum(['standard', 'deep']),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']),
  extras: z
    .object({
      insideOven: z.boolean().optional(),
      insideFridge: z.boolean().optional(),
      windows: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
});

const availabilityRequestSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  durationHours: z.number().positive().optional(),
});

const paymentLinkRequestSchema = z.object({
  bookingId: z.string().min(1, 'bookingId is required'),
  amount: z.number().positive('amount must be positive'),
  currency: z.string().min(1, 'currency is required'),
});

const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: env.COMPANY_NAME, timestamp: new Date().toISOString() });
});

app.post('/admin/reload-kb', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const kb = reloadKnowledgeBase();
    reloadFaqSources();
    res.json({
      status: 'ok',
      reloadedAt: new Date().toISOString(),
      serviceAreas: kb.company.serviceAreas,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/chat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages)) {
      res.status(400).json({ error: 'messages must be an array' });
      return;
    }

    if (containsBannedContent(messages)) {
      res.status(400).json({ error: 'Message contains prohibited language.' });
      return;
    }

    const requestStarted = Date.now();
    logRequest('chat.request', messages);

    const result = await handleChatRequest({ messages });

    const durationMs = Date.now() - requestStarted;
    recordAnalyticsEvent('response_time', {
      ms: durationMs,
      handoff: Boolean(result.handoff),
    });

    logResponse('chat.response', result);

    res.json({
      message: result.message,
      toolsUsed: result.toolsUsed,
      toolResults: result.toolResults,
      handoff: result.handoff ?? null,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/tools/quote', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = quoteRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
      res.status(400).json({ error: 'Invalid quote request', details });
      return;
    }

    const payload = parsed.data;
    logRequest('tools.quote.request', payload);

    const extras = payload.extras
      ? {
          insideOven: payload.extras.insideOven ?? false,
          insideFridge: payload.extras.insideFridge ?? false,
          windows: payload.extras.windows,
        }
      : undefined;

    const result = calculateCleaningQuote({
      rooms: payload.rooms,
      baths: payload.baths,
      squareMeters: payload.squareMeters,
      serviceType: payload.serviceType,
      frequency: payload.frequency,
      extras,
    });

    recordAnalyticsEvent('quote_issued', {
      source: 'manual_form',
      total: result.total,
      currency: result.currency,
    });

    logResponse('tools.quote.response', result);

    res.json({ data: result });
  } catch (error) {
    next(error);
  }
});

app.post('/tools/availability', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = availabilityRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
      res.status(400).json({ error: 'Invalid availability request', details });
      return;
    }

    const payload = parsed.data;
    logRequest('tools.availability.request', payload);

    const durationHours = payload.durationHours ?? 2;

    const slots = getAvailabilitySlots({
      date: payload.date,
      durationHours,
    });

    logResponse('tools.availability.response', { slotCount: slots.length });

    res.json({ data: { slots, durationHours } });
  } catch (error) {
    next(error);
  }
});

app.post('/tools/payment-link', (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = paymentLinkRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
      res.status(400).json({ error: 'Invalid payment link request', details });
      return;
    }

    const payload = parsed.data;
    logRequest('tools.payment_link.request', payload);

    const paymentLink = generatePaymentLink({
      bookingId: payload.bookingId,
      amount: payload.amount,
      currency: payload.currency,
    });

    recordAnalyticsEvent('payment_link_generated', {
      source: 'manual_form',
      bookingId: paymentLink.bookingId,
      amount: paymentLink.amount,
      currency: paymentLink.currency,
    });

    logResponse('tools.payment_link.response', paymentLink);

    res.json({ data: paymentLink });
  } catch (error) {
    next(error);
  }
});

app.get('/admin/metrics', (_req: Request, res: Response) => {
  const snapshot = getMetricsSnapshot();

  const renderSummary = (label: string, summary: ReturnType<typeof getMetricsSnapshot>['last7']) => {
    const avgMs = summary.averageResponseTimeMs.toFixed(0);
    const deflection = summary.deflectionRate.toFixed(1);
    return `
      <section>
        <h2>${label}</h2>
        <p><small>${summary.from} → ${summary.to}</small></p>
        <ul>
          <li>Quotes issued: <strong>${summary.quotesIssued}</strong></li>
          <li>Bookings created: <strong>${summary.bookingsCreated}</strong></li>
          <li>Payment links: <strong>${summary.paymentLinksGenerated}</strong></li>
          <li>Human handoffs: <strong>${summary.humanHandoffs}</strong></li>
          <li>Deflection rate: <strong>${deflection}%</strong></li>
          <li>Avg. response time: <strong>${avgMs} ms</strong> across ${summary.responsesRecorded} responses</li>
        </ul>
      </section>
    `;
  };

  res.type('html').send(`
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Cleaning Concierge Metrics</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 2rem auto; max-width: 720px; color: #0f172a; }
          h1 { margin-bottom: 0.25rem; }
          section { border: 1px solid #e2e8f0; border-radius: 12px; padding: 1rem 1.5rem; margin-bottom: 1.5rem; background: #f8fafc; }
          ul { padding-left: 1.2rem; }
          li { margin: 0.35rem 0; }
        </style>
      </head>
      <body>
        <h1>Cleaning Concierge Metrics</h1>
        <p>Quote → Booking → Payment funnel with deflection performance.</p>
        ${renderSummary('Last 7 days', snapshot.last7)}
        ${renderSummary('Last 30 days', snapshot.last30)}
      </body>
    </html>
  `);
});

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  console.error('Server error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  console.log(`Cleaning concierge server listening on http://localhost:${PORT}`);
});

export default app;
