import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ANALYTICS_DIR = path.resolve(__dirname, '../../analytics');
const ANALYTICS_FILE = path.join(ANALYTICS_DIR, 'events.json');

export type AnalyticsEventType =
  | 'quote_issued'
  | 'booking_created'
  | 'payment_link_generated'
  | 'human_handoff'
  | 'deflection_success'
  | 'response_time';

export interface AnalyticsEvent<T = Record<string, unknown>> {
  id: string;
  type: AnalyticsEventType;
  timestamp: string;
  data?: T;
}

interface MetricsCounts {
  quotesIssued: number;
  bookingsCreated: number;
  paymentLinksGenerated: number;
  humanHandoffs: number;
  deflectionSuccesses: number;
  responsesRecorded: number;
  totalResponseTimeMs: number;
}

export interface MetricsSummary {
  days: number;
  from: string;
  to: string;
  quotesIssued: number;
  bookingsCreated: number;
  paymentLinksGenerated: number;
  humanHandoffs: number;
  deflectionRate: number;
  responsesRecorded: number;
  averageResponseTimeMs: number;
}

export interface MetricsSnapshot {
  last7: MetricsSummary;
  last30: MetricsSummary;
}

function ensureStore(): void {
  if (!existsSync(ANALYTICS_DIR)) {
    mkdirSync(ANALYTICS_DIR, { recursive: true });
  }
  if (!existsSync(ANALYTICS_FILE)) {
    writeFileSync(ANALYTICS_FILE, '[]', 'utf8');
  }
}

function readAllEvents(): AnalyticsEvent[] {
  ensureStore();
  try {
    const raw = readFileSync(ANALYTICS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as AnalyticsEvent[];
    }
  } catch (error) {
    // fall through to reset file
  }
  writeFileSync(ANALYTICS_FILE, '[]', 'utf8');
  return [];
}

function writeEvents(events: AnalyticsEvent[]): void {
  ensureStore();
  writeFileSync(ANALYTICS_FILE, JSON.stringify(events, null, 2), 'utf8');
}

export function recordEvent(type: AnalyticsEventType, data?: Record<string, unknown>): AnalyticsEvent {
  ensureStore();
  const events = readAllEvents();
  const event: AnalyticsEvent = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    data,
  };
  events.push(event);
  writeEvents(events);
  return event;
}

function computeCounts(events: AnalyticsEvent[]): MetricsCounts {
  return events.reduce<MetricsCounts>(
    (acc, event) => {
      switch (event.type) {
        case 'quote_issued':
          acc.quotesIssued += 1;
          break;
        case 'booking_created':
          acc.bookingsCreated += 1;
          break;
        case 'payment_link_generated':
          acc.paymentLinksGenerated += 1;
          break;
        case 'human_handoff':
          acc.humanHandoffs += 1;
          break;
        case 'deflection_success':
          acc.deflectionSuccesses += 1;
          break;
        case 'response_time': {
          acc.responsesRecorded += 1;
          const msValue = Number((event.data ?? {}).ms);
          if (Number.isFinite(msValue)) {
            acc.totalResponseTimeMs += msValue;
          }
          break;
        }
        default:
          break;
      }
      return acc;
    },
    {
      quotesIssued: 0,
      bookingsCreated: 0,
      paymentLinksGenerated: 0,
      humanHandoffs: 0,
      deflectionSuccesses: 0,
      responsesRecorded: 0,
      totalResponseTimeMs: 0,
    },
  );
}

function summarise(events: AnalyticsEvent[], days: number): MetricsSummary {
  const now = Date.now();
  const fromTime = now - days * 24 * 60 * 60 * 1000;
  const filtered = events.filter((event) => {
    const ts = new Date(event.timestamp).getTime();
    return Number.isFinite(ts) && ts >= fromTime;
  });

  const counts = computeCounts(filtered);
  const avgResponse =
    counts.responsesRecorded > 0 ? counts.totalResponseTimeMs / counts.responsesRecorded : 0;

  const deflectionDenominator = counts.deflectionSuccesses + counts.humanHandoffs;
  const deflectionRate =
    deflectionDenominator > 0 ? (counts.deflectionSuccesses / deflectionDenominator) * 100 : 0;

  return {
    days,
    from: new Date(fromTime).toISOString(),
    to: new Date(now).toISOString(),
    quotesIssued: counts.quotesIssued,
    bookingsCreated: counts.bookingsCreated,
    paymentLinksGenerated: counts.paymentLinksGenerated,
    humanHandoffs: counts.humanHandoffs,
    deflectionRate,
    responsesRecorded: counts.responsesRecorded,
    averageResponseTimeMs: avgResponse,
  };
}

export function getMetricsSnapshot(): MetricsSnapshot {
  const events = readAllEvents();
  return {
    last7: summarise(events, 7),
    last30: summarise(events, 30),
  };
}

export function clearAnalytics(): void {
  writeEvents([]);
}
