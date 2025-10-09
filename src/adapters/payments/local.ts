import { PaymentAdapter, PaymentLinkInput, PaymentLinkResult } from './types';

const PAYMENT_LINK_EXPIRY_MINUTES = 60;

function assertPositiveNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

export const localPaymentAdapter: PaymentAdapter = {
  generatePaymentLink(input: PaymentLinkInput): PaymentLinkResult {
    assertNonEmpty(input.bookingId, 'bookingId');
    assertPositiveNumber(input.amount, 'amount');
    assertNonEmpty(input.currency, 'currency');

    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + PAYMENT_LINK_EXPIRY_MINUTES * 60 * 1000);

    const url = new URL('https://pay.cleaning.local/checkout');
    url.searchParams.set('booking_id', input.bookingId);
    url.searchParams.set('amount', input.amount.toFixed(2));
    url.searchParams.set('currency', input.currency.toUpperCase());

    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        url.searchParams.set(`meta_${key}`, String(value));
      }
    }

    return {
      url: url.toString(),
      bookingId: input.bookingId,
      amount: Math.round(input.amount * 100) / 100,
      currency: input.currency.toUpperCase(),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  },
};
