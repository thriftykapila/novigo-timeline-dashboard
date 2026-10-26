import { describe, expect, it } from "vitest";
import {
  buildChartPoints,
  buildHourlySummary,
  flattenAssets,
  normalizeSegments,
} from "../src/lib/data";
import { getShiftWindow } from "../src/lib/time";
import type { MachineIntervals } from "../src/lib/types";

const window = getShiftWindow("2026-09-01", {
  id: "shift",
  label: "",
  start: "08:30",
  end: "11:30",
});
const timestamp = (clock: string) => `2026-09-01T${clock}:00+05:30`;
const data = (patch: Partial<MachineIntervals> = {}): MachineIntervals => ({
  machine_ids: [1],
  runtimes: [],
  downtimes: [],
  stoppages: [],
  produce_counts: [],
  ...patch,
});

describe("shared timeline and hourly preparation", () => {
  it("clips valid segments to the window and now, drops invalid intervals, and keeps runtime kinds separate", () => {
    const source = data({
      runtimes: [
        {
          start_at: timestamp("08:00"),
          end_at: timestamp("10:12"),
          type: "planned",
        },
        {
          start_at: timestamp("10:12"),
          end_at: timestamp("11:45"),
          type: "unknown unplanned production",
        },
        { start_at: "invalid", end_at: timestamp("09:00") },
        { start_at: timestamp("10:00"), end_at: timestamp("09:00") },
        { start_at: timestamp("06:00"), end_at: timestamp("07:00") },
      ],
    });
    const now = Date.parse(timestamp("11:15"));
    const segments = normalizeSegments(source, window, now);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      start: window.from,
      end: Date.parse(timestamp("10:12")),
      kind: "runtime",
    });
    expect(segments[1].end).toBe(now);
    const hours = buildHourlySummary(source, [], segments, window, now);
    expect(hours.map((hour) => hour.label)).toEqual([
      "08:00",
      "09:00",
      "10:00",
      "11:00",
    ]);
    expect(hours.map((hour) => hour.runtime)).toEqual([30, 60, 12, 0]);
    expect(hours.map((hour) => hour.unplanned)).toEqual([0, 0, 48, 15]);
    expect(hours.map((hour) => hour.partial)).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
  it("keeps subsequent hours blank and caps an in-progress hour at now", () => {
    const source = data({
      downtimes: [
        {
          start_at: timestamp("08:00"),
          end_at: timestamp("12:00"),
          type: "unknown",
        },
      ],
    });
    const now = Date.parse(timestamp("09:10"));
    const hours = buildHourlySummary(
      source,
      [],
      normalizeSegments(source, window, now),
      window,
      now,
    );
    expect(hours.map((hour) => hour.unknown)).toEqual([30, 10, null, null]);
    expect(hours.map((hour) => hour.total)).toEqual([0, 0, null, null]);
  });
  it("assigns UTC bucket starts to IST clock hours, sums models and preserves a partial leading bucket", () => {
    const source = data({
      produce_counts: [
        {
          bucket_start: "2026-09-01T03:00:00Z",
          part_model_id: "a",
          ok_count: 2,
          ng_count: 1,
        }, // 08:30 IST
        {
          bucket_start: "2026-09-01T03:00:00Z",
          part_model_id: "b",
          ok_count: 3,
          ng_count: 2,
        },
        {
          bucket_start: "2026-09-01T04:00:00Z",
          part_model_id: "a",
          ok_count: 4,
          ng_count: 0,
        }, // 09:30 IST
      ],
    });
    const hours = buildHourlySummary(
      source,
      [
        {
          bucket_start: "2026-09-01T04:00:00Z",
          ideal_cycle_time_seconds: 2.5,
          actual_cycle_time_seconds: null,
        },
      ],
      [],
      window,
      window.to,
    );
    expect(hours[0]).toMatchObject({ total: 8, pass: 5, fail: 3 });
    expect(hours[1]).toMatchObject({ total: 4, ideal: 2.5, actual: null });
    const six = getShiftWindow("2026-09-01", {
      id: "",
      label: "",
      start: "06:00",
      end: "07:00",
    });
    const leading = data({
      produce_counts: [
        {
          bucket_start: "2026-09-01T00:00:00Z",
          part_model_id: "a",
          ok_count: 5,
          ng_count: 1,
        },
      ],
    });
    expect(buildHourlySummary(leading, [], [], six, six.to)[0].total).toBe(6);
    expect(
      buildChartPoints(leading, false, six, six.to).map((point) => point.count),
    ).toEqual([5, 1]);
  });
  it("splits UTC intervals across IST midnight and keeps the new day’s clock hours", () => {
    const night = getShiftWindow("2026-09-01", {
      id: "",
      label: "",
      start: "23:30",
      end: "01:30",
    });
    const source = data({
      runtimes: [
        {
          start_at: "2026-09-01T18:00:00Z",
          end_at: "2026-09-01T20:00:00Z",
          type: "planned",
        },
      ],
    });
    const hours = buildHourlySummary(
      source,
      [],
      normalizeSegments(source, night, night.to),
      night,
      night.to,
    );
    expect(hours.map((hour) => hour.label)).toEqual([
      "23:00",
      "00:00",
      "01:00",
    ]);
    expect(hours.map((hour) => hour.runtime)).toEqual([30, 60, 30]);
  });
  it("sorts individual rows across buckets and preserves every FAIL with per-model cumulative totals", () => {
    const source = data({
      produces: [
        {
          bucket_start: timestamp("08:00"),
          part_model_id: "a",
          produces: [
            {
              produce_id: "later-fail",
              first_seen_ts: timestamp("09:10"),
              result: "FAIL",
              part_model_id: "a",
            },
            {
              produce_id: "other-model",
              first_seen_ts: timestamp("08:45"),
              result: "PASS",
              part_model_id: "b",
            },
          ],
        },
        {
          bucket_start: timestamp("09:00"),
          part_model_id: "a",
          produces: [
            {
              produce_id: "earlier-pass",
              first_seen_ts: timestamp("08:40"),
              result: "PASS",
              part_model_id: "a",
            },
            {
              produce_id: "invalid",
              first_seen_ts: "invalid",
              result: "FAIL",
              part_model_id: "a",
            },
            {
              produce_id: "outside",
              first_seen_ts: timestamp("08:00"),
              result: "FAIL",
              part_model_id: "a",
            },
          ],
        },
      ],
    });
    const points = buildChartPoints(source, true, window, window.to);
    expect(points.map((point) => [point.id, point.cumulative])).toEqual([
      ["earlier-pass", 1],
      ["other-model", 1],
      ["later-fail", 2],
    ]);
    expect(points.filter((point) => point.result === "FAIL")).toHaveLength(1);
    expect(buildChartPoints(data(), true, window, window.to)).toEqual([]);
  });
  it("produces both coarse result types and independent model totals", () => {
    const source = data({
      produce_counts: [
        {
          bucket_start: timestamp("09:00"),
          part_model_id: "a",
          ok_count: 3,
          ng_count: 2,
        },
        {
          bucket_start: timestamp("09:00"),
          part_model_id: "b",
          ok_count: 8,
          ng_count: 1,
        },
      ],
    });
    const points = buildChartPoints(source, false, window, window.to);
    expect(points).toHaveLength(4);
    expect(
      points
        .filter((point) => point.result === "FAIL")
        .map((point) => point.count),
    ).toEqual([2, 1]);
    expect(
      points
        .filter((point) => point.partModel === "a")
        .map((point) => point.cumulative),
    ).toEqual([3, 5]);
  });
  it("flattens an asset hierarchy with the correct entity level and breadcrumb", () => {
    const assets = flattenAssets([
      {
        id: "plant",
        name: "Plant",
        assetlevel_id: 40,
        children: [{ id: "machine", name: "SPI", assetlevel_id: 10 }],
      },
    ]);
    expect(assets[1]).toMatchObject({
      id: "machine",
      assetlevel_id: 10,
      depth: 1,
      path: "Plant / SPI",
    });
  });
  it("accounts for each elapsed minute exactly once when API segments are tiled", () => {
    const source = data({
      runtimes: [
        {
          start_at: timestamp("08:30"),
          end_at: timestamp("09:30"),
          type: "planned",
        },
      ],
      downtimes: [
        {
          start_at: timestamp("09:30"),
          end_at: timestamp("10:00"),
          type: "unknown",
        },
      ],
      stoppages: [{ start_at: timestamp("10:00"), end_at: timestamp("11:30") }],
    });
    const hours = buildHourlySummary(
      source,
      [],
      normalizeSegments(source, window, window.to),
      window,
      window.to,
    );
    expect(
      hours.map(
        (hour) =>
          (hour.runtime ?? 0) +
          (hour.unplanned ?? 0) +
          (hour.stoppage ?? 0) +
          (hour.unknown ?? 0),
      ),
    ).toEqual([30, 60, 60, 30]);
    for (const hour of hours) {
      const totalMinutes =
        (hour.runtime ?? 0) +
        (hour.unplanned ?? 0) +
        (hour.stoppage ?? 0) +
        (hour.unknown ?? 0);
      expect(totalMinutes).toBeLessThanOrEqual(
        (hour.end - hour.start) / 60_000,
      );
    }
  });
  it("preserves source overlaps so chart and table share the same facts", () => {
    const source = data({
      runtimes: [
        {
          start_at: timestamp("09:00"),
          end_at: timestamp("10:00"),
          type: "planned",
        },
      ],
      stoppages: [{ start_at: timestamp("09:30"), end_at: timestamp("09:45") }],
    });
    const segments = normalizeSegments(source, window, window.to);
    const hour = buildHourlySummary(source, [], segments, window, window.to)[1];
    expect(segments).toHaveLength(2);
    expect(hour.runtime).toBe(60);
    expect(hour.stoppage).toBe(15);
    expect((hour.runtime ?? 0) + (hour.stoppage ?? 0)).toBe(75);
  });
});
