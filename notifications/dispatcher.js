import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendTelegramNotification } from './telegram.js';
import { sendWhatsappNotification } from './whatsapp.js';
import { sendEmailNotification } from './email.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TENANTS_ROOT = path.resolve(__dirname, '../tenants');
const LOG_DIR = path.resolve(__dirname, '../server/logs');
const LOG_PATH = path.join(LOG_DIR, 'notifications.log');

const configCache = new Map();

function normalizeString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeLeadPayload(payload = {}) {
  const tenant = normalizeString(payload.tenant) || 'default';
  return {
    tenant,
    lead_type: normalizeString(payload.lead_type) || 'general',
    name: normalizeString(payload.name),
    email: normalizeString(payload.email),
    phone: normalizeString(payload.phone),
    message: normalizeString(payload.message),
    raw: payload,
  };
}

function hasContactInformation(payload) {
  return Boolean(payload.email || payload.phone || payload.message);
}

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

async function appendLog(entry) {
  try {
    await ensureLogDir();
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      source: 'NotificationDispatcher',
      ...entry,
    });
    await fs.appendFile(LOG_PATH, `${line}\n`, 'utf8');
  } catch (error) {
    console.error('[NotificationDispatcher] Failed to write log entry', error);
  }
}

async function loadTenantConfig(tenantId) {
  if (!tenantId) return null;

  const cached = configCache.get(tenantId);
  const configPath = path.join(TENANTS_ROOT, tenantId, 'config.json');

  try {
    const stat = await fs.stat(configPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.config) {
      return cached.config;
    }

    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    configCache.set(tenantId, { config: parsed, mtimeMs: stat.mtimeMs });
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      if (!cached?.missing) {
        await appendLog({
          level: 'warn',
          event: 'tenant_config_missing',
          tenant: tenantId,
        });
      }
      configCache.set(tenantId, { config: null, mtimeMs: null, missing: true });
      return null;
    }

    await appendLog({
      level: 'error',
      event: 'tenant_config_error',
      tenant: tenantId,
      error: error.message,
    });
    configCache.set(tenantId, { config: null, mtimeMs: null, missing: true });
    return null;
  }
}

function buildLeadMessage(payload) {
  const lines = [
    `New ${payload.lead_type} lead received`,
    `Tenant: ${payload.tenant}`,
  ];

  if (payload.name) lines.push(`Name: ${payload.name}`);
  if (payload.email) lines.push(`Email: ${payload.email}`);
  if (payload.phone) lines.push(`Phone: ${payload.phone}`);
  if (payload.message) {
    lines.push('');
    lines.push('Message:');
    lines.push(payload.message);
  }

  return lines.join('\n');
}

function buildLeadSubject(payload) {
  const type = payload.lead_type ? payload.lead_type.toUpperCase() : 'LEAD';
  return `[${payload.tenant}] New ${type} lead`;
}

async function dispatchChannel(channel, handler) {
  try {
    const result = await handler();
    await appendLog({
      level: 'info',
      channel,
      event: 'notification_sent',
      details: typeof result === 'object' ? result : undefined,
    });
    return { channel, status: 'sent', result };
  } catch (error) {
    await appendLog({
      level: 'error',
      channel,
      event: 'notification_failed',
      error: error.message,
    });
    return { channel, status: 'failed', error };
  }
}

export async function sendNotification(tenantId, payload) {
  const normalized = normalizeLeadPayload({ ...payload, tenant: tenantId || payload?.tenant });

  if (!hasContactInformation(normalized)) {
    await appendLog({
      level: 'debug',
      event: 'notification_skipped_no_contact',
      tenant: normalized.tenant,
    });
    return { skipped: true, reason: 'missing_contact' };
  }

  const config = await loadTenantConfig(normalized.tenant);
  if (!config) {
    await appendLog({
      level: 'warn',
      event: 'notification_skipped_no_config',
      tenant: normalized.tenant,
    });
    return { skipped: true, reason: 'missing_config' };
  }

  const textMessage = buildLeadMessage(normalized);
  const subject = buildLeadSubject(normalized);
  const dispatches = [];

  if (config.telegram?.enabled) {
    dispatches.push(
      dispatchChannel('telegram', () =>
        sendTelegramNotification(config.telegram, {
          message: textMessage,
          payload: normalized,
        }),
      ),
    );
  }

  if (config.whatsapp?.enabled) {
    dispatches.push(
      dispatchChannel('whatsapp', () =>
        sendWhatsappNotification(config.whatsapp, {
          message: textMessage,
          payload: normalized,
        }),
      ),
    );
  }

  if (config.email?.enabled) {
    dispatches.push(
      dispatchChannel('email', () =>
        sendEmailNotification(config.email, {
          subject,
          text: textMessage,
          payload: normalized,
        }),
      ),
    );
  }

  if (!dispatches.length) {
    await appendLog({
      level: 'info',
      event: 'notification_skipped_no_channels',
      tenant: normalized.tenant,
    });
    return { skipped: true, reason: 'no_channels_enabled' };
  }

  const results = await Promise.all(dispatches);
  return { skipped: false, results };
}
