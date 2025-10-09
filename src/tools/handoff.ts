import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface ConversationSnapshot {
  role: string;
  content: string | null;
  name?: string;
}

export interface HandoffContact {
  name?: string;
  email?: string;
  phone?: string;
  preferredContactMethod?: string;
}

export interface HumanHandoffInput {
  reason?: string;
  notes?: string;
  contact?: HandoffContact;
  conversation: ConversationSnapshot[];
  metadata?: Record<string, unknown>;
}

export interface HumanHandoffRecord extends HumanHandoffInput {
  id: string;
  createdAt: string;
}

const INBOX_DIR = path.resolve(__dirname, '../../inbox');
const INBOX_FILE = path.join(INBOX_DIR, 'handoff.json');

function ensureInboxFile(): void {
  if (!existsSync(INBOX_DIR)) {
    mkdirSync(INBOX_DIR, { recursive: true });
  }
  if (!existsSync(INBOX_FILE)) {
    writeFileSync(INBOX_FILE, '[]', 'utf8');
  }
}

export function writeHumanHandoff(input: HumanHandoffInput): HumanHandoffRecord {
  ensureInboxFile();

  const record: HumanHandoffRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
  };

  try {
    const raw = readFileSync(INBOX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.push(record);
      writeFileSync(INBOX_FILE, JSON.stringify(parsed, null, 2), 'utf8');
    } else {
      writeFileSync(INBOX_FILE, JSON.stringify([record], null, 2), 'utf8');
    }
  } catch (error) {
    writeFileSync(INBOX_FILE, JSON.stringify([record], null, 2), 'utf8');
  }

  return record;
}
