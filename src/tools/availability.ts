import { getCalendarAdapter, type AvailabilityOptions, type AvailabilitySlot } from '../adapters/calendar';

export type { AvailabilityOptions, AvailabilitySlot } from '../adapters/calendar';

export function getAvailabilitySlots(options: AvailabilityOptions): AvailabilitySlot[] {
  return getCalendarAdapter().getAvailability(options);
}
