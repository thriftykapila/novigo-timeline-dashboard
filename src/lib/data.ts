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
  const options: AssetOption[] = [];

  function visit(nodes: Asset[], ancestors: string[]): void {
    for (const node of nodes) {
      const names = [...ancestors, node.name];
      options.push({
        ...node,
        path: names.join(" / "),
        depth: ancestors.length,
      });
      visit(node.children || [], names);
    }
  }

  visit(tree, []);
  return options;
}

export function normalizeSegments(
  data: MachineIntervals,
  window: TimeWindow,
  now = Date.now(),
): Segment[] {
  const segments: Segment[] = [];
  const visibleEnd = Math.min(window.to, now);

  function appendSegments(
    rows: RawSegment[],
    classify: (row: RawSegment) => [SegmentKind, string],
  ): void {
    for (const row of rows || []) {
      const rawStart = Date.parse(row.start_at);
      const rawEnd = Date.parse(row.end_at);
      if (
        !Number.isFinite(rawStart) ||
        !Number.isFinite(rawEnd) ||
        rawEnd <= rawStart
      ) {
        continue;
      }
      const start = Math.max(window.from, rawStart);
      const end = Math.min(visibleEnd, rawEnd);
      if (end <= start) continue;

      const [kind, label] = classify(row);
      segments.push({ start, end, kind, label });
    }
  }

  appendSegments(data.runtimes, (row) => {
    if ((row.type || "").toLowerCase().includes("unplanned")) {
      return ["unplanned", row.runtime_name || "Unplanned production"];
    }
    return ["runtime", row.runtime_name || "Runtime"];
  });
  appendSegments(data.downtimes, (row) => {
    const type = (row.type || "unknown").toLowerCase();
    if (type === "unknown") {
      const label =
        row.downtime_name && row.downtime_name !== "unknown"
          ? row.downtime_name
          : "Unknown downtime";
      return ["unknown", label];
    }
    if (type.includes("unplanned")) {
      return ["unplannedDowntime", row.downtime_name || "Unplanned downtime"];
    }
    if (type.includes("planned")) {
      return ["plannedDowntime", row.downtime_name || "Planned downtime"];
    }
    return ["unknown", row.downtime_name || "Unknown downtime"];
  });
  appendSegments(data.stoppages, (row) => [
    "stoppage",
    row.stoppage_name || "Stoppage",
  ]);
  return segments.sort(
    (first, second) => first.start - second.start || first.end - second.end,
  );
}

export function buildChartPoints(
  data: MachineIntervals,
  individual: boolean,
  window: TimeWindow,
  now = Date.now(),
): ChartPoint[] {
  const visibleEnd = Math.min(window.to, now);
  const points: Omit<ChartPoint, "cumulative">[] = [];

  if (individual) {
    for (const bucket of data.produces || []) {
      for (const row of bucket.produces || []) {
        const time = Date.parse(row.first_seen_ts);
        if (
          !Number.isFinite(time) ||
          time < window.from ||
          time >= visibleEnd
        ) {
          continue;
        }
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
    }
  } else {
    for (const [index, row] of (data.produce_counts || []).entries()) {
      const rawTime = Date.parse(row.bucket_start);
      // The first hourly bucket may begin before a partial shift's start.
      if (
        !Number.isFinite(rawTime) ||
        rawTime + HOUR_MS <= window.from ||
        rawTime >= visibleEnd
      ) {
        continue;
      }
      const time = Math.max(window.from, rawTime);
      for (const [result, rawCount] of [
        ["PASS", row.ok_count],
        ["FAIL", row.ng_count],
      ] as const) {
        const count = Number(rawCount);
        if (!Number.isFinite(count) || count <= 0) continue;
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
  points.sort((first, second) => {
    if (first.time !== second.time) return first.time - second.time;
    if (first.result === second.result) return 0;
    return first.result === "PASS" ? -1 : 1;
  });

  const totalsByModel = new Map<string, number>();
  return points.map((point) => {
    const cumulative = (totalsByModel.get(point.partModel) || 0) + point.count;
    totalsByModel.set(point.partModel, cumulative);
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
  const bucketsByHour = new Map<number, HourBucket>();
  const visibleEnd = Math.min(window.to, now);

  for (
    let clockStart = floorISTHour(window.from);
    clockStart < window.to;
    clockStart += HOUR_MS
  ) {
    const start = Math.max(clockStart, window.from);
    const end = Math.min(clockStart + HOUR_MS, window.to);
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
    bucketsByHour.set(clockStart, bucket);
  }

  for (const row of data.produce_counts || []) {
    const timestamp = Date.parse(row.bucket_start);
    if (
      !Number.isFinite(timestamp) ||
      timestamp + HOUR_MS <= window.from ||
      timestamp >= visibleEnd
    ) {
      continue;
    }
    const hour = floorISTHour(Math.max(timestamp, window.from));
    const bucket = bucketsByHour.get(hour);
    if (!bucket?.elapsed) continue;

    const pass = Math.max(0, Number(row.ok_count) || 0);
    const fail = Math.max(0, Number(row.ng_count) || 0);
    bucket.pass = (bucket.pass ?? 0) + pass;
    bucket.fail = (bucket.fail ?? 0) + fail;
    bucket.total = (bucket.total ?? 0) + pass + fail;
  }

  for (const segment of segments) {
    const start = Math.max(segment.start, window.from);
    const end = Math.min(segment.end, visibleEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }

    for (let hour = floorISTHour(start); hour < end; hour += HOUR_MS) {
      const bucket = bucketsByHour.get(hour);
      if (!bucket?.elapsed) continue;
      const minutes =
        (Math.min(end, bucket.end) - Math.max(start, bucket.start)) / 60_000;
      if (minutes > 0) {
        bucket[segment.kind] = (bucket[segment.kind] ?? 0) + minutes;
      }
    }
  }

  for (const row of cycles || []) {
    const timestamp = Date.parse(row.bucket_start);
    if (
      !Number.isFinite(timestamp) ||
      timestamp + HOUR_MS <= window.from ||
      timestamp >= visibleEnd
    ) {
      continue;
    }
    const hour = floorISTHour(Math.max(timestamp, window.from));
    const bucket = bucketsByHour.get(hour);
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
