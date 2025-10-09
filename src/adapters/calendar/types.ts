export interface AvailabilityOptions {
  date: string;
  durationHours?: number;
  slotIntervalMinutes?: number;
}

export interface AvailabilitySlot {
  start: string;
  end: string;
  label: string;
}

export interface CalendarAdapter {
  getAvailability(options: AvailabilityOptions): AvailabilitySlot[];
}
