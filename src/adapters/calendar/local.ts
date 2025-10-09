import { getKnowledgeBase } from '../../kb/loader';
import type { CalendarAdapter, AvailabilityOptions, AvailabilitySlot } from './types';

const DEFAULT_DURATION_HOURS = 2;
const DEFAULT_INTERVAL_MINUTES = 60;

function assertValidDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must be in YYYY-MM-DD format');
  }
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('date is invalid');
  }
}

function getHourSpec(date: Date): string {
  const kb = getKnowledgeBase();
  const day = date.getDay();
  const isWeekend = day === 0 || day === 6;
  return isWeekend ? kb.company.hours.weekends : kb.company.hours.weekdays;
}

function parseHourSpec(hourSpec: string): [number, number] {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(hourSpec);
  if (!match) {
    throw new Error(`Invalid hour specification: ${hourSpec}`);
  }
  const [, startHour, startMinute, endHour, endMinute] = match;
  const startInMinutes = Number(startHour) * 60 + Number(startMinute);
  const endInMinutes = Number(endHour) * 60 + Number(endMinute);
  if (endInMinutes <= startInMinutes) {
    throw new Error(`End time must be after start time in spec: ${hourSpec}`);
  }
  return [startInMinutes, endInMinutes];
}

function formatLabel(date: Date): string {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const localCalendarAdapter: CalendarAdapter = {
  getAvailability(options: AvailabilityOptions): AvailabilitySlot[] {
    const {
      date,
      durationHours = DEFAULT_DURATION_HOURS,
      slotIntervalMinutes = DEFAULT_INTERVAL_MINUTES,
    } = options;

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      throw new Error('durationHours must be greater than zero');
    }
    if (!Number.isFinite(slotIntervalMinutes) || slotIntervalMinutes <= 0) {
      throw new Error('slotIntervalMinutes must be greater than zero');
    }

    assertValidDate(date);

    const dayStart = new Date(`${date}T00:00:00`);
    const hourSpec = getHourSpec(dayStart);
    const [startMinutes, endMinutes] = parseHourSpec(hourSpec);
    const durationMinutes = Math.round(durationHours * 60);

    const slots: AvailabilitySlot[] = [];

    for (let start = startMinutes; start + durationMinutes <= endMinutes; start += slotIntervalMinutes) {
      const startDate = new Date(dayStart);
      startDate.setMinutes(start);
      const endDate = new Date(dayStart);
      endDate.setMinutes(start + durationMinutes);
      slots.push({
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        label: `${formatLabel(startDate)} – ${formatLabel(endDate)}`,
      });
    }

    return slots;
  },
};
