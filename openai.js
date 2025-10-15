import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tenantsRoot = path.join(__dirname, "tenants");

const fallbackTenantIdRaw = (process.env.DEFAULT_TENANT_ID || "neurox").trim() || "default";
const fallbackTenantId =
  fallbackTenantIdRaw.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || "default";

const tenantPromptCache = new Map();
let tenantIndexPromise = null;
let openaiClient = null;
let openaiInitPromise = null;

function resolveModel() {
  const preferredModel = (process.env.OPENAI_MODEL || "").trim();
  return preferredModel &&
    /^[a-z0-9:\-]+$/i.test(preferredModel) &&
    !preferredModel.toLowerCase().includes("gpt-gpt")
    ? preferredModel
    : "gpt-4o-mini";
}

function sanitizeHistory(history = []) {
  return history
    .filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        (entry.role === "user" || entry.role === "assistant") &&
        typeof entry.content === "string" &&
        entry.content.trim(),
    )
    .map(({ role, content }) => ({
      role,
      content: content.trim(),
    }));
}

function latestUserMessage(history, userText) {
  const combined = [...history, { role: "user", content: userText }];
  for (let i = combined.length - 1; i >= 0; i -= 1) {
    const entry = combined[i];
    if (entry?.role === "user" && typeof entry.content === "string") {
      const trimmed = entry.content.trim();
      if (trimmed) return trimmed;
    }
  }
  return userText;
}

const baseSystemPrompt = `
You are NEURO AI Assistant, a smart, friendly representative of NEURO Cleaning Company.
Always reply in the same language as the user.
Provide cleaning service details, scheduling info, and help customers professionally.
`.trim();

function sanitizeTenantId(rawTenantId) {
  const tenantId = (rawTenantId || "").toString().trim();
  if (!tenantId) return fallbackTenantId;
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase() || fallbackTenantId;
}

async function ensureTenantPrompt(tenantId) {
  const safeTenantId = sanitizeTenantId(tenantId);
  if (tenantPromptCache.has(safeTenantId)) {
    return tenantPromptCache.get(safeTenantId);
  }

  await loadTenantPrompts(true);
  if (tenantPromptCache.has(safeTenantId)) {
    return tenantPromptCache.get(safeTenantId);
  }

  const promptPath = path.join(tenantsRoot, safeTenantId, "prompt.md");
  try {
    const raw = await fs.readFile(promptPath, "utf8");
    const trimmed = raw.trim();
    tenantPromptCache.set(safeTenantId, trimmed || null);
    return trimmed || null;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error("tenant-prompt-load-error", { tenantId: safeTenantId, error });
    }
    tenantPromptCache.set(safeTenantId, null);
    return null;
  }
}

export async function loadTenantPrompts(force = false) {
  if (!force && tenantIndexPromise) {
    return tenantIndexPromise;
  }

  tenantIndexPromise = (async () => {
    tenantPromptCache.clear();
    const tenants = [];

    try {
      const entries = await fs.readdir(tenantsRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const sanitized = sanitizeTenantId(entry.name);
        tenants.push(sanitized);

        const promptPath = path.join(tenantsRoot, entry.name, "prompt.md");
        let prompt = null;
        try {
          const raw = await fs.readFile(promptPath, "utf8");
          prompt = raw.trim() || null;
        } catch (error) {
          if (error?.code !== "ENOENT") {
            console.error("tenant-prompt-load-error", { tenantId: sanitized, error });
          }
        }

        tenantPromptCache.set(sanitized, prompt);
        console.log(`✅ Loaded tenant: ${sanitized}`);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.error("tenant-index-error", error);
      }
    }

    return tenants;
  })();

  return tenantIndexPromise;
}

function resolveTenantCompanyName(tenantId) {
  const safeTenantId = sanitizeTenantId(tenantId);
  const envKey = `COMPANY_NAME__${safeTenantId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || process.env.COMPANY_NAME || safeTenantId.toUpperCase();
}

function resolveTenantCurrency(tenantId) {
  const safeTenantId = sanitizeTenantId(tenantId);
  const envKey = `CURRENCY__${safeTenantId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envKey] || process.env.CURRENCY || "USD";
}

async function buildMessages(userText, history = [], tenantId) {
  const safeTenantId = sanitizeTenantId(tenantId);
  const companyName = resolveTenantCompanyName(safeTenantId);
  const currency = resolveTenantCurrency(safeTenantId);
  const tenantPrompt = await ensureTenantPrompt(safeTenantId);

  const system = `
You are "Cleaning Concierge", a friendly booking & pricing assistant for a residential cleaning company.
- Greet briefly, be concise, and ask one clear follow-up question when needed.
- You can:
  * Give price estimates (small studio, 1BR/1BA, 2BR/1BA, 2BR/2BA, 3BR+).
  * Offer to book a time (collect date, time window, address, email/phone).
  * Explain policies (cancellations, rescheduling, satisfaction guarantee).
  * Handoff to a human if user asks.
- Currency is ${currency} and company name is ${companyName}.
  * When the customer requests specific details, incorporate the latest policies or offers from the tenant prompt if provided.
  * Always keep responses under 6 sentences unless listing steps.
- Never reveal API keys or internal details. If asked for secrets, decline politely.
`.trim();

  const cleanedHistory = sanitizeHistory(history);
  const latestUserContent = latestUserMessage(cleanedHistory, userText);
  const languageDirective = `
When replying, detect the language used in the customer's latest message (sample: """${latestUserContent}""") and respond in that language.
Do not translate the business or brand name "${companyName}" or other proper nouns; leave them as-is.
If you cannot determine the language, default to concise English with a brief note acknowledging uncertainty.
`.trim();

  const messages = [
    { role: "system", content: baseSystemPrompt },
    { role: "system", content: system },
    { role: "system", content: languageDirective },
    ...cleanedHistory,
    { role: "user", content: userText },
  ];

  if (tenantPrompt) {
    messages.splice(1, 0, { role: "system", content: tenantPrompt });
  }

  return messages;
}

async function ensureOpenAIClient() {
  if (openaiClient) return openaiClient;
  if (!openaiInitPromise) {
    openaiInitPromise = (async () => {
      const hasKey = Boolean(process.env.OPENAI_API_KEY);
      console.log("🔑 Checking OPENAI_API_KEY:", hasKey);
      if (!hasKey) {
        throw new Error("❌ Missing OPENAI_API_KEY environment variable");
      }

      await loadTenantPrompts(false);
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      console.log("✅ OpenAI client initialized");
      openaiClient = client;
      return client;
    })();
  }

  return openaiInitPromise;
}

/**
 * Ask the bot for a complete reply (non-streaming).
 * @param {string} userText
 * @param {{ history?: Array<{ role: 'user' | 'assistant', content: string }>, tenantId?: string }} [options]
 * @returns {Promise<string>}
 */
export async function askBot(userText, { history = [], tenantId } = {}) {
  const client = await ensureOpenAIClient();
  const model = resolveModel();
  const messages = await buildMessages(userText, history, tenantId);

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.6,
      messages,
    });

    const text = resp?.choices?.[0]?.message?.content?.trim() || "";
    return text;
  } catch (maybeError) {
    const error =
      maybeError instanceof Error
        ? maybeError
        : new Error("Failed to get response from OpenAI.");
    if (maybeError && typeof maybeError === "object") {
      if (!("status" in error) && "status" in maybeError) {
        error.status = maybeError.status;
      }
      if (!("code" in error) && "code" in maybeError) {
        error.code = maybeError.code;
      }
      if (!("response" in error) && "response" in maybeError) {
        error.response = maybeError.response;
      }
    }
    error.isOpenAIError = true;
    throw error;
  }
}

/**
 * Create a streaming chat completion for the assistant.
 * Yields only textual delta tokens; ignores tool / reasoning events.
 * @param {string} userText
 * @param {{
 *   signal?: AbortSignal,
 *   history?: Array<{ role: 'user' | 'assistant', content: string }>,
 *   tenantId?: string
 * }} [options]
 * @returns {Promise<AsyncIterable<string>>}
 */
export async function streamBotResponse(userText, { signal, history = [], tenantId } = {}) {
  const client = await ensureOpenAIClient();
  const model = resolveModel();
  const requestOptions = signal ? { signal } : {};
  const messages = await buildMessages(userText, history, tenantId);

  try {
    const stream = await client.chat.completions.create(
      {
        model,
        temperature: 0.6,
        messages,
        stream: true,
      },
      requestOptions,
    );

    async function* iterate() {
      for await (const chunk of stream) {
        const choices = Array.isArray(chunk?.choices) ? chunk.choices : [];
        for (const choice of choices) {
          const token = choice?.delta?.content;
          if (token) {
            yield token;
          }
        }
      }
    }

    return iterate();
  } catch (maybeError) {
    const error =
      maybeError instanceof Error
        ? maybeError
        : new Error("Failed to stream response from OpenAI.");
    if (maybeError && typeof maybeError === "object") {
      if (!("status" in error) && "status" in maybeError) {
        error.status = maybeError.status;
      }
      if (!("code" in error) && "code" in maybeError) {
        error.code = maybeError.code;
      }
      if (!("response" in error) && "response" in maybeError) {
        error.response = maybeError.response;
      }
    }
    error.isOpenAIError = true;
    throw error;
  }
}
