import type {
  Asset,
  AssetOption,
  ChartPoint,
  CycleBucket,
  HourBucket,
  MachineIntervals,
  RawSegment,
  Segment,
  SegmentKind,
  TimeWindow,
} from "./types";
import { floorISTHour, formatTime, HOUR_MS } from "./time";

export function flattenAssets(tree: Asset[]): AssetOption[] {
  const result: AssetOption[] = [];
  const visit = (nodes: Asset[], ancestors: string[]) => {
    for (const node of nodes) {
      const names = [...ancestors, node.name];
      result.push({
        ...node,
        path: names.join(" / "),
        depth: ancestors.length,
      });
      visit(node.children || [], names);
    }
  };
  visit(tree, []);
  return result;
}

export function normalizeSegments(
  data: MachineIntervals,
  window: TimeWindow,
  now = Date.now(),
): Segment[] {
  const result: Segment[] = [];
  const endLimit = Math.min(window.to, now);
  const append = (
    rows: RawSegment[],
    classify: (row: RawSegment) => [SegmentKind, string],
  ) => {
    for (const row of rows || []) {
      const rawStart = Date.parse(row.start_at),
        rawEnd = Date.parse(row.end_at);
      if (
        !Number.isFinite(rawStart) ||
        !Number.isFinite(rawEnd) ||
        rawEnd <= rawStart
      )
        continue;
      const start = Math.max(window.from, rawStart),
        end = Math.min(endLimit, rawEnd);
      if (end <= start) continue;
      const [kind, label] = classify(row);
      result.push({ start, end, kind, label });
    }
  };
  append(data.runtimes, (row) =>
    (row.type || "").toLowerCase().includes("unplanned")
      ? ["unplanned", row.runtime_name || "Unplanned production"]
      : ["runtime", row.runtime_name || "Runtime"],
  );
  append(data.downtimes, (row) => {
    const type = (row.type || "unknown").toLowerCase();
    if (type === "unknown")
      return [
        "unknown",
        row.downtime_name && row.downtime_name !== "unknown"
          ? row.downtime_name
          : "Unknown downtime",
      ];
    if (type.includes("unplanned"))
      return ["unplannedDowntime", row.downtime_name || "Unplanned downtime"];
    if (type.includes("planned"))
      return ["plannedDowntime", row.downtime_name || "Planned downtime"];
    return ["unknown", row.downtime_name || "Unknown downtime"];
  });
  append(data.stoppages, (row) => [
    "stoppage",
    row.stoppage_name || "Stoppage",
  ]);
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Parse and sort once; the canvas consumes numeric geometry without parsing dates. */
export function buildChartPoints(
  data: MachineIntervals,
  individual: boolean,
  window: TimeWindow,
  now = Date.now(),
): ChartPoint[] {
  const until = Math.min(window.to, now);
  const points: Omit<ChartPoint, "cumulative">[] = [];
  if (individual) {
    for (const bucket of data.produces || [])
      for (const row of bucket.produces || []) {
        const time = Date.parse(row.first_seen_ts);
        if (!Number.isFinite(time) || time < window.from || time >= until)
          continue;
        const result = row.result.toUpperCase();
        if (result !== "PASS" && result !== "FAIL") continue;
        points.push({
          time,
          result,
          count: 1,
          id: row.produce_id,
          partModel: String(row.part_model_id || bucket.part_model_id),
        });
      }
  } else {
    for (const [index, row] of (data.produce_counts || []).entries()) {
      const rawTime = Date.parse(row.bucket_start);
      // The first hourly bucket may begin before a partial shift's start.
      if (
        !Number.isFinite(rawTime) ||
        rawTime + HOUR_MS <= window.from ||
        rawTime >= until
      )
        continue;
      const time = Math.max(window.from, rawTime);
      for (const [result, rawCount] of [
        ["PASS", row.ok_count],
        ["FAIL", row.ng_count],
      ] as const) {
        const count = Number(rawCount);
        if (Number.isFinite(count) && count > 0)
          points.push({
            time,
            result,
            count,
            id: `${row.bucket_start}:${row.part_model_id}:${result}:${index}`,
            partModel: String(row.part_model_id),
          });
      }
    }
  }
  points.sort(
    (a, b) =>
      a.time - b.time ||
      (a.result === b.result ? 0 : a.result === "PASS" ? -1 : 1),
  );
  const totals = new Map<string, number>();
  return points.map((point) => {
    const cumulative = (totals.get(point.partModel) || 0) + point.count;
    totals.set(point.partModel, cumulative);
    return { ...point, cumulative };
  });
}

export function buildHourlySummary(
  data: MachineIntervals,
  cycles: CycleBucket[],
  segments: Segment[],
  window: TimeWindow,
  now = Date.now(),
): HourBucket[] {
  const buckets: HourBucket[] = [];
  const byHour = new Map<number, HourBucket>();
  for (
    let clockStart = floorISTHour(window.from);
    clockStart < window.to;
    clockStart += HOUR_MS
  ) {
    const start = Math.max(clockStart, window.from),
      end = Math.min(clockStart + HOUR_MS, window.to);
    const elapsed = start < now;
    const initial = elapsed ? 0 : null;
    const bucket: HourBucket = {
      start,
      end,
      label: formatTime(clockStart),
      elapsed,
      partial:
        start !== clockStart ||
        end !== clockStart + HOUR_MS ||
        (now > start && now < end),
      total: initial,
      pass: initial,
      fail: initial,
      runtime: initial,
      unplanned: initial,
      stoppage: initial,
      unknown: initial,
      plannedDowntime: initial,
      unplannedDowntime: initial,
      ideal: null,
      actual: null,
    };
    buckets.push(bucket);
    byHour.set(clockStart, bucket);
  }
  for (const row of data.produce_counts || []) {
    const timestamp = Date.parse(row.bucket_start);
    if (
      !Number.isFinite(timestamp) ||
      timestamp + HOUR_MS <= window.from ||
      timestamp >= Math.min(window.to, now)
    )
      continue;
    const bucket = byHour.get(floorISTHour(Math.max(timestamp, window.from)));
    if (!bucket?.elapsed) continue;
    const pass = Math.max(0, Number(row.ok_count) || 0),
      fail = Math.max(0, Number(row.ng_count) || 0);
    bucket.pass! += pass;
    bucket.fail! += fail;
    bucket.total! += pass + fail;
  }
  for (const segment of segments) {
    const start = Math.max(segment.start, window.from),
      end = Math.min(segment.end, window.to, now);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      continue;
    for (let hour = floorISTHour(start); hour < end; hour += HOUR_MS) {
      const bucket = byHour.get(hour);
      if (!bucket?.elapsed) continue;
      const minutes =
        (Math.min(end, bucket.end) - Math.max(start, bucket.start)) / 60_000;
      if (minutes > 0) bucket[segment.kind]! += minutes;
    }
  }
  for (const row of cycles || []) {
    const timestamp = Date.parse(row.bucket_start);
    if (
      !Number.isFinite(timestamp) ||
      timestamp + HOUR_MS <= window.from ||
      timestamp >= Math.min(window.to, now)
    )
      continue;
    const bucket = byHour.get(floorISTHour(Math.max(timestamp, window.from)));
    if (!bucket?.elapsed) continue;
    bucket.ideal = Number.isFinite(row.ideal_cycle_time_seconds)
      ? row.ideal_cycle_time_seconds
      : null;
    bucket.actual = Number.isFinite(row.actual_cycle_time_seconds)
      ? row.actual_cycle_time_seconds
      : null;
  }
  return buckets;
}
