import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { parse } from 'yaml';

const KB_FILENAME = 'cleaning.yml';
const KB_PATH = resolve(__dirname, KB_FILENAME);

const frequencyDiscountsSchema = z.object({
  one_time: z.number().positive(),
  weekly: z.number().positive(),
  biweekly: z.number().positive(),
  monthly: z.number().positive(),
});

const knowledgeBaseSchema = z.object({
  company: z.object({
    name: z.string().min(1),
    currency: z.string().min(1),
    serviceAreas: z.array(z.string().min(1)).min(1),
    hours: z.object({
      weekdays: z.string().min(1),
      weekends: z.string().min(1),
    }),
  }),
  pricing: z.object({
    base_visit_fee: z.number().nonnegative(),
    per_room: z.number().nonnegative(),
    per_bath: z.number().nonnegative(),
    per_sqm: z.number().nonnegative(),
    deep_clean_multiplier: z.number().positive(),
    frequency_discounts: frequencyDiscountsSchema,
  }),
  addons: z.object({
    inside_oven: z.number().nonnegative(),
    inside_fridge: z.number().nonnegative(),
    windows_per_room: z.number().nonnegative(),
  }),
  policies: z.object({
    cancellation: z.string().min(1),
    supplies: z.string().min(1),
  }),
});

export type KnowledgeBase = z.infer<typeof knowledgeBaseSchema>;

let knowledgeBaseCache: KnowledgeBase | undefined;

function loadKnowledgeBaseFromDisk(): KnowledgeBase {
  const fileContents = readFileSync(KB_PATH, 'utf8');
  const parsedYaml = parse(fileContents);
  const parsedResult = knowledgeBaseSchema.safeParse(parsedYaml);

  if (!parsedResult.success) {
    const messages = parsedResult.error.errors
      .map(
        (issue) =>
          `${issue.path.length ? issue.path.join('.') : 'root'}: ${issue.message}`,
      )
      .join('; ');
    throw new Error(`Failed to load knowledge base: ${messages}`);
  }

  return parsedResult.data;
}

/**
 * Access the cached KB, loading it from disk if necessary.
 */
export function getKnowledgeBase(): KnowledgeBase {
  if (!knowledgeBaseCache) {
    knowledgeBaseCache = loadKnowledgeBaseFromDisk();
  }
  return knowledgeBaseCache;
}

/**
 * Force-refresh the KB cache so updates on disk appear without restarting.
 */
export function reloadKnowledgeBase(): KnowledgeBase {
  knowledgeBaseCache = loadKnowledgeBaseFromDisk();
  return knowledgeBaseCache;
}

export const KNOWLEDGE_BASE_PATH = KB_PATH;
