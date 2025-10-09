import { env } from '../../config/env';
import type { CalendarAdapter } from './types';
import { localCalendarAdapter } from './local';

const adapters: Record<string, CalendarAdapter> = {
  local: localCalendarAdapter,
};

export function getCalendarAdapter(): CalendarAdapter {
  return adapters[env.CALENDAR_PROVIDER] ?? localCalendarAdapter;
}

export type { CalendarAdapter, AvailabilityOptions, AvailabilitySlot } from './types';
