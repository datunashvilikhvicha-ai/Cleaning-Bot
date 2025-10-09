import { getKnowledgeBase } from '../kb/loader';

export type ServiceFrequency = 'one_time' | 'weekly' | 'biweekly' | 'monthly';
export type ServiceType = 'standard' | 'deep';

export interface QuoteExtrasInput {
  insideOven?: boolean;
  insideFridge?: boolean;
  windows?: number;
}

export interface QuoteInput {
  rooms: number;
  baths: number;
  squareMeters: number;
  serviceType: ServiceType;
  frequency: ServiceFrequency;
  extras?: QuoteExtrasInput;
}

export interface QuoteBreakdown {
  baseVisitFee: number;
  rooms: number;
  baths: number;
  squareMeters: number;
  serviceMultiplier: number;
  frequencyMultiplier: number;
  extras: {
    insideOven: number;
    insideFridge: number;
    windows: number;
  };
}

export interface QuoteResult {
  currency: string;
  total: number;
  subtotal: number;
  breakdown: QuoteBreakdown;
}

const MIN_ROOMS = 0;
const MIN_BATHS = 0;
const MIN_SQM = 0;

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function getFrequencyMultiplier(frequency: ServiceFrequency): number {
  const kb = getKnowledgeBase();
  const multiplier = kb.pricing.frequency_discounts[frequency];
  if (!multiplier) {
    throw new Error(`Unsupported frequency: ${frequency}`);
  }
  return multiplier;
}

function getServiceMultiplier(serviceType: ServiceType): number {
  const kb = getKnowledgeBase();
  if (serviceType === 'standard') {
    return 1;
  }
  if (serviceType === 'deep') {
    return kb.pricing.deep_clean_multiplier;
  }
  const exhaustiveCheck: never = serviceType;
  throw new Error(`Unsupported service type: ${exhaustiveCheck}`);
}

export function calculateCleaningQuote(input: QuoteInput): QuoteResult {
  assertNonNegative(input.rooms, 'rooms');
  assertNonNegative(input.baths, 'baths');
  assertNonNegative(input.squareMeters, 'squareMeters');

  if (input.rooms < MIN_ROOMS) {
    throw new Error('rooms cannot be negative');
  }
  if (input.baths < MIN_BATHS) {
    throw new Error('baths cannot be negative');
  }
  if (input.squareMeters <= MIN_SQM) {
    throw new Error('squareMeters must be greater than zero');
  }

  const kb = getKnowledgeBase();
  const { pricing, addons, company } = kb;

  const baseVisitFee = pricing.base_visit_fee;
  const roomsCost = input.rooms * pricing.per_room;
  const bathsCost = input.baths * pricing.per_bath;
  const squareMetersCost = input.squareMeters * pricing.per_sqm;

  const serviceMultiplier = getServiceMultiplier(input.serviceType);
  const frequencyMultiplier = getFrequencyMultiplier(input.frequency);

  const extrasConfig = input.extras ?? {};
  const windowsCount = Math.max(0, Math.floor(extrasConfig.windows ?? 0));
  const extras = {
    insideOven: extrasConfig.insideOven ? addons.inside_oven : 0,
    insideFridge: extrasConfig.insideFridge ? addons.inside_fridge : 0,
    windows: addons.windows_per_room * windowsCount,
  };

  const subtotal =
    baseVisitFee + roomsCost + bathsCost + squareMetersCost + extras.insideOven + extras.insideFridge + extras.windows;

  const total = Math.round(subtotal * serviceMultiplier * frequencyMultiplier * 100) / 100;

  return {
    currency: company.currency,
    total,
    subtotal: Math.round(subtotal * 100) / 100,
    breakdown: {
      baseVisitFee,
      rooms: roomsCost,
      baths: bathsCost,
      squareMeters: squareMetersCost,
      serviceMultiplier,
      frequencyMultiplier,
      extras,
    },
  };
}
