import { describe, expect, it } from 'vitest';
import { generatePaymentLink } from '../payments';

describe('generatePaymentLink', () => {
  it('creates a payment link with metadata', () => {
    const result = generatePaymentLink({
      bookingId: 'booking-123',
      amount: 199.99,
      currency: 'usd',
      metadata: {
        customer: 'alex',
      },
    });

    expect(result.bookingId).toBe('booking-123');
    expect(result.currency).toBe('USD');
    expect(result.amount).toBeCloseTo(199.99, 2);
    expect(result.url).toContain('booking_id=booking-123');
    expect(result.url).toContain('meta_customer=alex');
  });

  it('requires a positive amount', () => {
    expect(() =>
      generatePaymentLink({
        bookingId: 'booking-123',
        amount: 0,
        currency: 'usd',
      }),
    ).toThrow(/amount/);
  });
});
