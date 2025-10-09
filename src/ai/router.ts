import OpenAI from 'openai';
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { z } from 'zod';
import { env } from '../config/env';
import { calculateCleaningQuote, type QuoteResult } from '../tools/quote';
import { getAvailabilitySlots } from '../tools/availability';
import { createBooking } from '../tools/booking';
import { generatePaymentLink } from '../tools/payments';
import { saveLead } from '../tools/crm';
import { answerFaq } from '../kb/rag';
import { writeHumanHandoff } from '../tools/handoff';
import { recordEvent } from '../analytics/store';
import { executeWithRetry } from './retry';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
}

export interface ChatResponse {
  message: ChatMessage;
  toolsUsed: string[];
  toolResults: Record<string, unknown[]>;
  handoff?: { handoffId: string } | null;
}

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

const quoteInputSchema = z.object({
  rooms: z.number().int().min(0),
  baths: z.number().int().min(0),
  square_meters: z.number().positive(),
  service_type: z.enum(['standard', 'deep']),
  frequency: z.enum(['one_time', 'weekly', 'biweekly', 'monthly']),
  extras: z
    .object({
      inside_oven: z.boolean().optional(),
      inside_fridge: z.boolean().optional(),
      windows: z.number().int().min(0).optional(),
    })
    .optional(),
});

const availabilityInputSchema = z.object({
  date: z.string(),
  duration_hours: z.number().positive().optional(),
  slot_interval_minutes: z.number().positive().optional(),
});

const quoteBreakdownSchema = z.object({
  baseVisitFee: z.number(),
  rooms: z.number(),
  baths: z.number(),
  squareMeters: z.number(),
  serviceMultiplier: z.number(),
  frequencyMultiplier: z.number(),
  extras: z.object({
    insideOven: z.number(),
    insideFridge: z.number(),
    windows: z.number(),
  }),
});

const quoteResultSchema = z.object({
  currency: z.string(),
  total: z.number(),
  subtotal: z.number(),
  breakdown: quoteBreakdownSchema,
});

const bookingInputSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().min(1),
    address: z.string().min(1),
  }),
  scheduled_start: z.string().min(1),
  scheduled_end: z.string().min(1),
  quote: quoteResultSchema,
});

const paymentLinkSchema = z.object({
  booking_id: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const leadSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
  phone: z.string().optional(),
  message: z.string().optional(),
  preferred_contact_method: z.enum(['email', 'phone']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const faqInputSchema = z.object({
  question: z.string().min(1),
});

const handoffSchema = z.object({
  reason: z.string().optional(),
  notes: z.string().optional(),
  contact: z
    .object({
      name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
      preferred_contact_method: z.enum(['email', 'phone']).optional(),
    })
    .optional(),
});

interface ToolExecutionContext {
  conversation: ChatCompletionMessageParam[];
  request: ChatRequest;
}

type ToolExecutor = (args: unknown, context: ToolExecutionContext) => Promise<unknown>;

const toolExecutors: Record<string, ToolExecutor> = {
  quote_cleaning: async (args, _context) => {
    const parsed = quoteInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const result = calculateCleaningQuote({
      rooms: parsed.data.rooms,
      baths: parsed.data.baths,
      squareMeters: parsed.data.square_meters,
      serviceType: parsed.data.service_type,
      frequency: parsed.data.frequency,
      extras: parsed.data.extras
        ? {
            insideOven: parsed.data.extras.inside_oven ?? false,
            insideFridge: parsed.data.extras.inside_fridge ?? false,
            windows: parsed.data.extras.windows,
          }
        : undefined,
    });

    recordEvent('quote_issued', {
      source: 'ai_tool',
      total: result.total,
      currency: result.currency,
    });

    return { result };
  },
  check_availability: async (args, _context) => {
    const parsed = availabilityInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const slots = getAvailabilitySlots({
      date: parsed.data.date,
      durationHours: parsed.data.duration_hours,
      slotIntervalMinutes: parsed.data.slot_interval_minutes,
    });

    return { slots };
  },
  create_booking: async (args, _context) => {
    const parsed = bookingInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const booking = createBooking({
      customer: parsed.data.customer,
      scheduledStart: parsed.data.scheduled_start,
      scheduledEnd: parsed.data.scheduled_end,
      quote: parsed.data.quote as QuoteResult,
    });

    recordEvent('booking_created', {
      source: 'ai_tool',
      bookingId: booking.id,
      total: booking.quote.total,
    });

    return { booking };
  },
  generate_payment_link: async (args, _context) => {
    const parsed = paymentLinkSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const link = generatePaymentLink({
      bookingId: parsed.data.booking_id,
      amount: parsed.data.amount,
      currency: parsed.data.currency,
      metadata: parsed.data.metadata,
    });

    recordEvent('payment_link_generated', {
      source: 'ai_tool',
      bookingId: link.bookingId,
      amount: link.amount,
      currency: link.currency,
    });

    return { paymentLink: link };
  },
  save_lead: async (args, _context) => {
    const parsed = leadSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const lead = saveLead({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone,
      message: parsed.data.message,
      preferredContactMethod: parsed.data.preferred_contact_method,
      metadata: parsed.data.metadata,
    });

    return { lead };
  },
  faq_lookup: async (args, _context) => {
    const parsed = faqInputSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const result = answerFaq(parsed.data.question);
    if (result.found) {
      recordEvent('deflection_success', {
        source: result.metadata?.sourceType,
        key: result.metadata?.sourceKey,
      });
    }
    return result;
  },
  escalate_to_human: async (args, context) => {
    const parsed = handoffSchema.safeParse(args);
    if (!parsed.success) {
      throw new Error(parsed.error.message);
    }

    const conversationSnapshot = context.conversation
      .filter((message) => message.role !== 'system')
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content === null || message.content === undefined
            ? null
            : JSON.stringify(message.content),
        name: 'name' in message ? message.name : undefined,
      }));

    const record = writeHumanHandoff({
      reason: parsed.data.reason,
      notes: parsed.data.notes,
      contact: parsed.data.contact
        ? {
            name: parsed.data.contact.name,
            email: parsed.data.contact.email,
            phone: parsed.data.contact.phone,
            preferredContactMethod: parsed.data.contact.preferred_contact_method,
          }
        : undefined,
      conversation: conversationSnapshot,
      metadata: context.request.metadata,
    });

    recordEvent('human_handoff', {
      handoffId: record.id,
      reason: record.reason,
    });

    return { handoffId: record.id };
  },
};

const toolDefinitions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'quote_cleaning',
      description: 'Calculate a cleaning quote using the official pricing table.',
      parameters: {
        type: 'object',
        required: ['rooms', 'baths', 'square_meters', 'service_type', 'frequency'],
        properties: {
          rooms: { type: 'integer', minimum: 0 },
          baths: { type: 'integer', minimum: 0 },
          square_meters: { type: 'number', minimum: 1 },
          service_type: { type: 'string', enum: ['standard', 'deep'] },
          frequency: { type: 'string', enum: ['one_time', 'weekly', 'biweekly', 'monthly'] },
          extras: {
            type: 'object',
            properties: {
              inside_oven: { type: 'boolean' },
              inside_fridge: { type: 'boolean' },
              windows: { type: 'integer', minimum: 0 },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Return available time slots for a given date.',
      parameters: {
        type: 'object',
        required: ['date'],
        properties: {
          date: { type: 'string', description: 'Target date in YYYY-MM-DD format' },
          duration_hours: { type: 'number', minimum: 0.5 },
          slot_interval_minutes: { type: 'number', minimum: 15 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_booking',
      description: 'Create a booking entry for the client with a pending payment status.',
      parameters: {
        type: 'object',
        required: ['customer', 'scheduled_start', 'scheduled_end', 'quote'],
        properties: {
          customer: {
            type: 'object',
            required: ['name', 'phone', 'email', 'address'],
            properties: {
              name: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
              address: { type: 'string' },
            },
          },
          scheduled_start: { type: 'string', description: 'ISO timestamp for visit start' },
          scheduled_end: { type: 'string', description: 'ISO timestamp for visit end' },
          quote: {
            type: 'object',
            required: ['currency', 'total', 'subtotal', 'breakdown'],
            properties: {
              currency: { type: 'string' },
              total: { type: 'number' },
              subtotal: { type: 'number' },
              breakdown: { type: 'object' },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_payment_link',
      description: 'Create a payment link for the specified booking and amount.',
      parameters: {
        type: 'object',
        required: ['booking_id', 'amount', 'currency'],
        properties: {
          booking_id: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          metadata: {
            type: 'object',
            additionalProperties: {
              anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_lead',
      description: 'Store a prospective customer lead for follow-up.',
      parameters: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          phone: { type: 'string' },
          message: { type: 'string' },
          preferred_contact_method: { type: 'string', enum: ['email', 'phone'] },
          metadata: { type: 'object' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'faq_lookup',
      description:
        'Answer policy or pricing questions using the cleaning knowledge base and approved docs. Respond with not_found when information is unavailable.',
      parameters: {
        type: 'object',
        required: ['question'],
        properties: {
          question: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'escalate_to_human',
      description: 'Escalate the conversation to a human specialist when the assistant cannot help or upon request.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
          notes: { type: 'string' },
          contact: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              preferred_contact_method: { type: 'string', enum: ['email', 'phone'] },
            },
          },
        },
      },
    },
  },
];

const MAX_TOOL_EXECUTIONS = 6;

const systemPromptMessage: ChatCompletionMessageParam = {
  role: 'system',
  content:
    'You are a cleaning concierge; never guess prices; use tools for quotes/availability/booking/payments; confirm address is inside service area; summarize next steps clearly; keep answers short and friendly.',
};

function toOpenAIMessage(message: ChatMessage): ChatCompletionMessageParam {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.tool_call_id ?? '',
      content: message.content ?? '',
    };
  }

  return {
    role: message.role,
    content: message.content ?? '',
    name: message.name,
  } as ChatCompletionMessageParam;
}

function toAssistantMessageParam(message: ChatCompletionMessage): ChatCompletionAssistantMessageParam {
  if (message.role !== 'assistant') {
    throw new Error(`Unexpected assistant message role: ${message.role}`);
  }
  return {
    role: 'assistant',
    content: message.content ?? '',
    tool_calls: message.tool_calls,
  };
}

function fromAssistantMessage(message: ChatCompletionAssistantMessageParam): ChatMessage {
  return {
    role: 'assistant',
    content: message.content ?? '',
  };
}

export async function handleChatRequest(request: ChatRequest): Promise<ChatResponse> {
  const conversation: ChatCompletionMessageParam[] = [systemPromptMessage, ...request.messages.map(toOpenAIMessage)];
  const toolsUsed = new Set<string>();
  let humanHandoffTriggered = false;
  let humanHandoffInfo: { handoffId: string } | null = null;
  const toolResults: Record<string, unknown[]> = {};

  for (let step = 0; step < MAX_TOOL_EXECUTIONS; step += 1) {
    const completion = await openai.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: conversation,
      tool_choice: 'auto',
      tools: toolDefinitions,
    });

    const choice = completion.choices[0];
    if (!choice?.message) {
      throw new Error('OpenAI response did not include a message');
    }

    const assistantMessage = toAssistantMessageParam(choice.message);
    conversation.push(assistantMessage);

    if (assistantMessage.tool_calls?.length) {
      for (const toolCall of assistantMessage.tool_calls) {
        const executor = toolExecutors[toolCall.function.name];

        let parsedArgs: unknown;
        try {
          parsedArgs = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to parse tool arguments as JSON';
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: message }),
          });
          continue;
        }

        if (!executor) {
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` }),
          });
          continue;
        }

        try {
          const result = await executeWithRetry(
            () => executor(parsedArgs, { conversation, request }),
            {
              onRetry: (attempt, error, nextDelayMs) => {
                console.warn(
                  `Tool ${toolCall.function.name} failed on attempt ${attempt}. Retrying in ${nextDelayMs}ms:`,
                  error,
                );
              },
            },
          );
          toolsUsed.add(toolCall.function.name);
          if (!toolResults[toolCall.function.name]) {
            toolResults[toolCall.function.name] = [];
          }
          toolResults[toolCall.function.name].push(result);
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: true, data: result }),
          });
          if (toolCall.function.name === 'escalate_to_human' && result && typeof result === 'object') {
            const typed = result as { handoffId?: string };
            if (typed.handoffId) {
              humanHandoffTriggered = true;
              humanHandoffInfo = { handoffId: typed.handoffId };
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Tool execution failed';
          conversation.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ ok: false, error: message }),
          });
        }
      }
      if (humanHandoffTriggered && humanHandoffInfo) {
        return {
          message: {
            role: 'assistant',
            content: "We’ll call you back shortly.",
          },
          toolsUsed: [...toolsUsed],
          toolResults,
          handoff: humanHandoffInfo,
        };
      }
      continue;
    }

    return {
      message: fromAssistantMessage(assistantMessage),
      toolsUsed: [...toolsUsed],
      toolResults,
      handoff: humanHandoffInfo,
    };
  }

  return {
    message: {
      role: 'assistant',
      content:
        "I'm having trouble completing that request right now. Let's try again or check in with a human teammate.",
    },
    toolsUsed: [...toolsUsed],
    toolResults,
    handoff: humanHandoffInfo,
  };
}
