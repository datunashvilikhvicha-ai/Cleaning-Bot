import { describe, expect, it } from 'vitest';
import { getAvailabilitySlots } from '../availability';

function hoursBetween(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / (60 * 60 * 1000);
}

describe('getAvailabilitySlots', () => {
  it('returns hourly slots within weekday hours', () => {
    const slots = getAvailabilitySlots({ date: '2024-07-09' });

    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].start).not.toBe(slots[0].end);
    expect(hoursBetween(slots[0].start, slots[0].end)).toBeCloseTo(2, 5);

    for (let i = 1; i < slots.length; i += 1) {
      const previous = slots[i - 1];
      const current = slots[i];
      expect(new Date(current.start).getTime()).toBeGreaterThan(new Date(previous.start).getTime());
      expect(hoursBetween(previous.start, previous.end)).toBeCloseTo(2, 5);
    }
  });

  it('uses weekend hours on Saturdays', () => {
    const date = '2024-07-13';
    const slots = getAvailabilitySlots({ date });
    expect(slots.length).toBeGreaterThan(0);

    const firstStart = new Date(slots[0].start).getTime();
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const minutesFromStart = (firstStart - dayStart) / (1000 * 60);
    expect(minutesFromStart).toBe(9 * 60);
  });

  it('rejects invalid date format', () => {
    expect(() => getAvailabilitySlots({ date: '07-09-2024' })).toThrow(/YYYY-MM-DD/);
  });
});
