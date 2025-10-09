import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

loadEnv();

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_MODEL: z.string().min(1, 'OPENAI_MODEL is required'),
  STRIPE_KEY: z.string().min(1, 'STRIPE_KEY is required'),
  CURRENCY: z.string().min(1, 'CURRENCY is required'),
  COMPANY_NAME: z.string().min(1, 'COMPANY_NAME is required'),
  PAYMENT_PROVIDER: z.string().optional().default('local'),
  CALENDAR_PROVIDER: z.string().optional().default('local'),
  CRM_PROVIDER: z.string().optional().default('local'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = Object.freeze(parsed.data);

export type EnvConfig = typeof env;
