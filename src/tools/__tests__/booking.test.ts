import { beforeEach, describe, expect, it, vi } from 'vitest';

let createBooking: typeof import('../booking').createBooking;
let listBookings: typeof import('../booking').listBookings;
let calculateCleaningQuote: typeof import('../quote').calculateCleaningQuote;

beforeEach(async () => {
  vi.resetModules();
  ({ createBooking, listBookings } = await import('../booking'));
  ({ calculateCleaningQuote } = await import('../quote'));
});

describe('createBooking', () => {
  it('creates a booking with pending payment status', () => {
    const quote = calculateCleaningQuote({
      rooms: 2,
      baths: 1,
      squareMeters: 80,
      serviceType: 'standard',
      frequency: 'one_time',
    });

    const booking = createBooking({
      customer: {
        name: 'Alex Client',
        phone: '+1-555-123-4567',
        email: 'alex@example.com',
        address: '123 Main St, San Francisco, CA',
      },
      scheduledStart: new Date('2024-07-10T10:00:00').toISOString(),
      scheduledEnd: new Date('2024-07-10T12:00:00').toISOString(),
      quote,
    });

    expect(booking.status).toBe('pending_payment');
    expect(booking.id).toBeTruthy();
    expect(listBookings()).toHaveLength(1);
  });

  it('fails validation when email is missing', () => {
    const quote = calculateCleaningQuote({
      rooms: 1,
      baths: 1,
      squareMeters: 50,
      serviceType: 'standard',
      frequency: 'one_time',
    });

    expect(() =>
      createBooking({
        customer: {
          name: 'Missing Email',
          phone: '+1-555-0000',
          email: '',
          address: '1 Test Ave',
        },
        scheduledStart: new Date().toISOString(),
        scheduledEnd: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        quote,
      }),
    ).toThrow(/customer\.email/);
  });

  it('rejects bookings outside the service area', () => {
    const quote = calculateCleaningQuote({
      rooms: 2,
      baths: 1,
      squareMeters: 80,
      serviceType: 'standard',
      frequency: 'one_time',
    });

    expect(() =>
      createBooking({
        customer: {
          name: 'Out of Town',
          phone: '+1-555-1111',
          email: 'out@example.com',
          address: '123 Broadway, New York, NY',
        },
        scheduledStart: new Date('2024-07-10T10:00:00').toISOString(),
        scheduledEnd: new Date('2024-07-10T12:00:00').toISOString(),
        quote,
      }),
    ).toThrow(/outside the supported service areas/i);
  });
});
