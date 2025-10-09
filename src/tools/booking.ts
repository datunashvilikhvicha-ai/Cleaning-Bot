import { randomUUID } from 'node:crypto';
import type { QuoteResult } from './quote';
import { getKnowledgeBase } from '../kb/loader';

export type BookingStatus = 'pending_payment' | 'paid' | 'cancelled';

export interface BookingCustomer {
  name: string;
  phone: string;
  email: string;
  address: string;
}

export interface BookingInput {
  customer: BookingCustomer;
  scheduledStart: string; // ISO string
  scheduledEnd: string; // ISO string
  quote: QuoteResult;
}

export interface BookingRecord extends BookingInput {
  id: string;
  createdAt: string;
  status: BookingStatus;
}

const bookings: BookingRecord[] = [];

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

function assertIsoTimestamp(value: string, label: string): void {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
}

export function createBooking(input: BookingInput): BookingRecord {
  assertNonEmpty(input.customer.name, 'customer.name');
  assertNonEmpty(input.customer.phone, 'customer.phone');
  assertNonEmpty(input.customer.email, 'customer.email');
  assertNonEmpty(input.customer.address, 'customer.address');
  assertIsoTimestamp(input.scheduledStart, 'scheduledStart');
  assertIsoTimestamp(input.scheduledEnd, 'scheduledEnd');

  if (!input.quote || typeof input.quote.total !== 'number') {
    throw new Error('quote result is required for booking');
  }

  const kb = getKnowledgeBase();
  const addressLower = input.customer.address.toLowerCase();
  const serviceAreaMatch = kb.company.serviceAreas.some((area) =>
    addressLower.includes(area.toLowerCase()),
  );
  if (!serviceAreaMatch) {
    throw new Error('Address is outside the supported service areas.');
  }

  const booking: BookingRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    customer: input.customer,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
    quote: input.quote,
    status: 'pending_payment',
  };

  bookings.push(booking);
  return booking;
}

export function listBookings(): BookingRecord[] {
  return [...bookings];
}
