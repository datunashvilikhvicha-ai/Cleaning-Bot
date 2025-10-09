import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getKnowledgeBase } from './loader';

type SourceType = 'kb' | 'doc';

interface KnowledgeChunk {
  key: string;
  text: string;
  lowercase: string;
  sourceType: SourceType;
}

export interface FaqAnswer {
  found: boolean;
  answer?: string;
  metadata?: {
    sourceType: SourceType;
    sourceKey: string;
  };
}

const DOCS_DIR = path.resolve(__dirname, '../../docs');

let kbChunksCache: KnowledgeChunk[] | undefined;
let docChunksCache: KnowledgeChunk[] | undefined;

function normaliseValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((item) => normaliseValue(item)).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}: ${normaliseValue(inner)}`)
      .join('; ');
  }
  return String(value);
}

function buildKnowledgeChunks(): KnowledgeChunk[] {
  const kb = getKnowledgeBase();
  const chunks: KnowledgeChunk[] = [];

  function walk(entry: unknown, prefix: string): void {
    if (entry === null || entry === undefined) {
      return;
    }

    if (typeof entry !== 'object' || entry instanceof Date) {
      const text = normaliseValue(entry);
      if (text.trim()) {
        chunks.push({
          key: prefix,
          text,
          lowercase: text.toLowerCase(),
          sourceType: 'kb',
        });
      }
      return;
    }

    if (Array.isArray(entry)) {
      const text = entry.map((item) => normaliseValue(item)).join(', ');
      chunks.push({
        key: prefix,
        text,
        lowercase: text.toLowerCase(),
        sourceType: 'kb',
      });
      return;
    }

    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      const pathKey = prefix ? `${prefix}.${key}` : key;
      walk(value, pathKey);
    }
  }

  walk(kb, '');
  return chunks;
}

function buildDocChunks(): KnowledgeChunk[] {
  if (!existsSync(DOCS_DIR)) {
    return [];
  }

  const files = readdirSync(DOCS_DIR).filter((file) => /\.md$/i.test(file));
  const chunks: KnowledgeChunk[] = [];

  for (const filename of files) {
    const content = readFileSync(path.join(DOCS_DIR, filename), 'utf8');
    const sections = content.split(/\n{2,}/).map((section) => section.trim()).filter(Boolean);
    if (!sections.length) {
      continue;
    }
    sections.forEach((section, index) => {
      const key = `${filename}${sections.length > 1 ? `#${index + 1}` : ''}`;
      chunks.push({
        key,
        text: section,
        lowercase: section.toLowerCase(),
        sourceType: 'doc',
      });
    });
  }

  return chunks;
}

function ensureCaches(): void {
  if (!kbChunksCache) {
    kbChunksCache = buildKnowledgeChunks();
  }
  if (!docChunksCache) {
    docChunksCache = buildDocChunks();
  }
}

function scoreChunk(chunk: KnowledgeChunk, tokens: string[]): number {
  return tokens.reduce((score, token) => (chunk.lowercase.includes(token) ? score + 1 : score), 0);
}

function sanitiseAnswer(answer: string): string {
  return answer.length > 600 ? `${answer.slice(0, 597)}...` : answer;
}

export function answerFaq(question: string): FaqAnswer {
  ensureCaches();

  const tokens = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

  if (!tokens.length) {
    return { found: false };
  }

  const chunks = [...(kbChunksCache ?? []), ...(docChunksCache ?? [])];

  let bestChunk: KnowledgeChunk | undefined;
  let bestScore = 0;

  for (const chunk of chunks) {
    const score = scoreChunk(chunk, tokens);
    if (score > bestScore) {
      bestScore = score;
      bestChunk = chunk;
    }
  }

  if (!bestChunk || bestScore === 0) {
    return { found: false };
  }

  return {
    found: true,
    answer: sanitiseAnswer(bestChunk.text),
    metadata: {
      sourceType: bestChunk.sourceType,
      sourceKey: bestChunk.key,
    },
  };
}

export function reloadFaqSources(): void {
  kbChunksCache = undefined;
  docChunksCache = undefined;
}
