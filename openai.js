import "dotenv/config";
import OpenAI from "openai";

console.log("🔑 Checking OPENAI_API_KEY:", !!process.env.OPENAI_API_KEY);

if (!process.env.OPENAI_API_KEY) {
  throw new Error("❌ Missing OPENAI_API_KEY environment variable");
}

export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

console.log("✅ OpenAI client initialized");

function ensureApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("❌ Missing OPENAI_API_KEY environment variable");
  }
}

function resolveModel() {
  const preferredModel = (process.env.OPENAI_MODEL || '').trim();
  return preferredModel &&
    /^[a-z0-9:\-]+$/i.test(preferredModel) &&
    !preferredModel.toLowerCase().includes('gpt-gpt')
    ? preferredModel
    : 'gpt-4o-mini';
}

function sanitizeHistory(history = []) {
  return history
    .filter(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry.role === 'user' || entry.role === 'assistant') &&
        typeof entry.content === 'string' &&
        entry.content.trim(),
    )
    .map(({ role, content }) => ({
      role,
      content: content.trim(),
    }));
}

function latestUserMessage(history, userText) {
  const combined = [...history, { role: 'user', content: userText }];
  for (let i = combined.length - 1; i >= 0; i -= 1) {
    const entry = combined[i];
    if (entry?.role === 'user' && typeof entry.content === 'string') {
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

function buildMessages(userText, history = []) {
  const system = `
You are "Cleaning Concierge", a friendly booking & pricing assistant for a residential cleaning company.
- Greet briefly, be concise, and ask one clear follow-up question when needed.
- You can:
  * Give price estimates (small studio, 1BR/1BA, 2BR/1BA, 2BR/2BA, 3BR+).
  * Offer to book a time (collect date, time window, address, email/phone).
  * Explain policies (cancellations, rescheduling, satisfaction guarantee).
  * Handoff to a human if user asks.
- Currency is ${process.env.CURRENCY || 'USD'} and company name is ${process.env.COMPANY_NAME || 'NEURO'}.
- Never reveal API keys or internal details. If asked for secrets, decline politely.
`.trim();

  const cleanedHistory = sanitizeHistory(history);
  const latestUserContent = latestUserMessage(cleanedHistory, userText);
  const companyName = process.env.COMPANY_NAME || 'NEURO';
  const languageDirective = `
When replying, detect the language used in the customer's latest message (sample: """${latestUserContent}""") and respond in that language.
Do not translate the business or brand name "${companyName}" or other proper nouns; leave them as-is.
If you cannot determine the language, default to concise English with a brief note acknowledging uncertainty.
`.trim();

  return [
    { role: 'system', content: baseSystemPrompt },
    { role: 'system', content: system },
    { role: 'system', content: languageDirective },
    ...cleanedHistory,
    { role: 'user', content: userText },
  ];
}

/**
 * Ask the bot for a complete reply (non-streaming).
 * @param {string} userText
 * @param {{ history?: Array<{ role: 'user' | 'assistant', content: string }> }} [options]
 * @returns {Promise<string>}
 */
export async function askBot(userText, { history = [] } = {}) {
  ensureApiKey();
  const model = resolveModel();

  try {
    const resp = await openai.chat.completions.create({
      model,
      temperature: 0.6,
      messages: buildMessages(userText, history),
    });

    const text = resp?.choices?.[0]?.message?.content?.trim() || '';
    return text;
  } catch (maybeError) {
    const error =
      maybeError instanceof Error
        ? maybeError
        : new Error('Failed to get response from OpenAI.');
    if (maybeError && typeof maybeError === 'object') {
      if (!('status' in error) && 'status' in maybeError) {
        error.status = maybeError.status;
      }
      if (!('code' in error) && 'code' in maybeError) {
        error.code = maybeError.code;
      }
      if (!('response' in error) && 'response' in maybeError) {
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
 * @param {{ signal?: AbortSignal, history?: Array<{ role: 'user' | 'assistant', content: string }> }} [options]
 * @returns {Promise<AsyncIterable<string>>}
 */
export async function streamBotResponse(userText, { signal, history = [] } = {}) {
  ensureApiKey();
  const model = resolveModel();
  const requestOptions = signal ? { signal } : {};

  try {
    const stream = await openai.chat.completions.create(
      {
        model,
        temperature: 0.6,
        messages: buildMessages(userText, history),
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
        : new Error('Failed to stream response from OpenAI.');
    if (maybeError && typeof maybeError === 'object') {
      if (!('status' in error) && 'status' in maybeError) {
        error.status = maybeError.status;
      }
      if (!('code' in error) && 'code' in maybeError) {
        error.code = maybeError.code;
      }
      if (!('response' in error) && 'response' in maybeError) {
        error.response = maybeError.response;
      }
    }
    error.isOpenAIError = true;
    throw error;
  }
}
