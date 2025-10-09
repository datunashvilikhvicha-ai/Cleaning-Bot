import { describe, expect, it } from 'vitest';
import { calculateCleaningQuote } from '../quote';

describe('calculateCleaningQuote', () => {
  it('computes a total with multipliers and extras applied', () => {
    const result = calculateCleaningQuote({
      rooms: 3,
      baths: 2,
      squareMeters: 100,
      serviceType: 'deep',
      frequency: 'weekly',
      extras: {
        insideOven: true,
        windows: 3,
      },
    });

    expect(result.currency).toBe('USD');
    expect(result.subtotal).toBeCloseTo(278, 2);
    expect(result.total).toBeCloseTo(330.82, 2);
    expect(result.breakdown.extras.insideOven).toBe(30);
    expect(result.breakdown.extras.windows).toBe(36);
  });

  it('throws when rooms are negative', () => {
    expect(() =>
      calculateCleaningQuote({
        rooms: -1,
        baths: 1,
        squareMeters: 50,
        serviceType: 'standard',
        frequency: 'one_time',
      }),
    ).toThrow(/rooms/);
  });

  it('throws when square meters are zero', () => {
    expect(() =>
      calculateCleaningQuote({
        rooms: 1,
        baths: 1,
        squareMeters: 0,
        serviceType: 'standard',
        frequency: 'one_time',
      }),
    ).toThrow(/squareMeters/);
  });
});
