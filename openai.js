import 'dotenv/config';
import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Ask the bot for a reply.
 * @param {string} userText
 * @returns {Promise<string>}
 */
export async function askBot(userText) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY environment variable.');
  }

  const preferredModel = (process.env.OPENAI_MODEL || '').trim();
  const model =
    preferredModel &&
    /^[a-z0-9:\-]+$/i.test(preferredModel) &&
    !preferredModel.toLowerCase().includes('gpt-gpt')
      ? preferredModel
      : 'gpt-4o-mini';

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

  try {
    const resp = await client.chat.completions.create({
      model,
      temperature: 0.6,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText }
      ]
    });

    const text = resp?.choices?.[0]?.message?.content?.trim() || '';
    return text;
  } catch (error) {
    error.isOpenAIError = true;
    throw error;
  }
}
