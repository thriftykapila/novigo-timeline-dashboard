export interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  roles: string[];
  customer_name?: string;
}
export interface Asset {
  id: string;
  name: string;
  codename?: string | null;
  assetlevel_id: number;
  children?: Asset[];
}
export interface AssetOption extends Asset {
  path: string;
  depth: number;
}
export interface Shift {
  id: string;
  code: string;
  name: string;
  shift_timings: string[];
  is_active: boolean;
}
export interface ShiftOption {
  id: string;
  label: string;
  start: string;
  end: string;
}
export interface TimeWindow {
  from: number;
  to: number;
  from_ts: string;
  to_ts: string;
}
export interface RawSegment {
  start_at: string;
  end_at: string;
  type?: string;
  runtime_name?: string | null;
  downtime_name?: string | null;
  stoppage_name?: string | null;
}
export type SegmentKind =
  | "runtime"
  | "unplanned"
  | "unknown"
  | "stoppage"
  | "plannedDowntime"
  | "unplannedDowntime";
export interface Segment {
  start: number;
  end: number;
  kind: SegmentKind;
  label: string;
}
export interface ProduceCount {
  bucket_start: string;
  part_model_id: string;
  ok_count: number;
  ng_count: number;
}
export interface Produce {
  produce_id: string;
  first_seen_ts: string;
  result: string;
  produce_type?: string;
  part_model_id: string;
}
export interface ProduceBucket {
  bucket_start: string;
  part_model_id: string;
  produces: Produce[];
}
export interface MachineIntervals {
  machine_ids: (number | string)[];
  runtimes: RawSegment[];
  downtimes: RawSegment[];
  stoppages: RawSegment[];
  produce_counts: ProduceCount[];
  produces?: ProduceBucket[];
}
export interface CycleBucket {
  bucket_start: string;
  ideal_cycle_time_seconds: number | null;
  actual_cycle_time_seconds: number | null;
  entity_id?: string;
}
export interface HourBucket {
  start: number;
  end: number;
  label: string;
  elapsed: boolean;
  partial: boolean;
  total: number | null;
  pass: number | null;
  fail: number | null;
  runtime: number | null;
  unplanned: number | null;
  stoppage: number | null;
  unknown: number | null;
  plannedDowntime: number | null;
  unplannedDowntime: number | null;
  ideal: number | null;
  actual: number | null;
}
export interface ChartPoint {
  time: number;
  cumulative: number;
  result: "PASS" | "FAIL";
  count: number;
  id: string;
  partModel: string;
}
