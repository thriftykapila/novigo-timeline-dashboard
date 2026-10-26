import type { Shift, ShiftOption, TimeWindow } from "./types";

export const IST_OFFSET_MS = 330 * 60_000;
export const HOUR_MS = 3_600_000;

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const secondsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export function formatTime(timestamp: number, seconds = false): string {
  if (!Number.isFinite(timestamp)) return "—";
  const formatter = seconds ? secondsFormatter : timeFormatter;
  return formatter.format(timestamp);
}

export function formatDate(timestamp: number): string {
  return Number.isFinite(timestamp) ? dateFormatter.format(timestamp) : "—";
}

export function floorISTHour(timestamp: number): number {
  const localHour = Math.floor((timestamp + IST_OFFSET_MS) / HOUR_MS);
  return localHour * HOUR_MS - IST_OFFSET_MS;
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function buildShiftOptions(shifts: Shift[]): ShiftOption[] {
  const options: ShiftOption[] = [];
  for (const shift of shifts) {
    if (!shift.is_active) continue;

    const startTimes = [
      ...new Set(shift.shift_timings.filter(isValidTime)),
    ].sort();
    for (const [index, start] of startTimes.entries()) {
      const end = startTimes[(index + 1) % startTimes.length];
      options.push({
        id: `${shift.id}:${start}`,
        label: `${shift.name} · ${start}–${end}`,
        start,
        end,
      });
    }
  }
  return options;
}

export function getShiftWindow(date: string, shift: ShiftOption): TimeWindow {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !isValidTime(shift.start) ||
    !isValidTime(shift.end)
  ) {
    throw new Error("Choose a valid date and shift.");
  }
  const from = Date.parse(`${date}T${shift.start}:00+05:30`);
  let to = Date.parse(`${date}T${shift.end}:00+05:30`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error("Choose a valid date and shift.");
  }
  // Comparing the clocks also makes a one-entry shift span a full day.
  if (shift.end <= shift.start) to += 24 * HOUR_MS;
  return {
    from,
    to,
    from_ts: new Date(from).toISOString(),
    to_ts: new Date(to).toISOString(),
  };
}
