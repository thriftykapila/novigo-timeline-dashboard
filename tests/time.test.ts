import { describe, expect, it } from "vitest";
import {
  buildShiftOptions,
  floorISTHour,
  formatDate,
  formatTime,
  getShiftWindow,
} from "../src/lib/time";
import type { Shift } from "../src/lib/types";

describe("IST shift windows", () => {
  const shifts: Shift[] = [
    {
      id: "live",
      code: "main",
      name: "Production",
      is_active: true,
      shift_timings: ["00:30", "12:30"],
    },
  ];
  it("derives every shift from API start times, including midnight wrapping", () => {
    const options = buildShiftOptions(shifts);
    expect(options.map(({ start, end }) => [start, end])).toEqual([
      ["00:30", "12:30"],
      ["12:30", "00:30"],
    ]);
    expect(getShiftWindow("2026-09-01", options[0])).toMatchObject({
      from_ts: "2026-08-31T19:00:00.000Z",
      to_ts: "2026-09-01T07:00:00.000Z",
    });
    expect(getShiftWindow("2026-09-01", options[1])).toMatchObject({
      from_ts: "2026-09-01T07:00:00.000Z",
      to_ts: "2026-09-01T19:00:00.000Z",
    });
  });
  it("formats UTC timestamps on the IST day, independent of host timezone", () => {
    const timestamp = Date.parse("2026-08-31T19:00:15Z");
    expect(formatDate(timestamp)).toBe("01 Sept 2026");
    expect(formatTime(timestamp)).toBe("00:30");
    expect(formatTime(timestamp, true)).toBe("00:30:15");
    expect(new Date(floorISTHour(timestamp)).toISOString()).toBe(
      "2026-08-31T18:30:00.000Z",
    );
  });
  it("supports a single start time as a full day, filters inactive shifts and invalid clocks", () => {
    const options = buildShiftOptions([
      { ...shifts[0], shift_timings: ["06:00", "invalid", "06:00"] },
      { ...shifts[0], id: "off", is_active: false },
    ]);
    expect(options).toHaveLength(1);
    const window = getShiftWindow("2026-09-01", options[0]);
    expect(window.to - window.from).toBe(86_400_000);
    expect(() => getShiftWindow("invalid", options[0])).toThrow("valid date");
  });
});
