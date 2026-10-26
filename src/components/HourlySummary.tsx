import type { HourBucket } from "../lib/types";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import AccessTimeRounded from "@mui/icons-material/AccessTimeRounded";

type RowKey =
  | "total"
  | "pass"
  | "fail"
  | "runtime"
  | "unplanned"
  | "stoppage"
  | "unknown"
  | "ideal"
  | "actual"
  | "plannedDowntime"
  | "unplannedDowntime";
const rows: {
  key: RowKey;
  label: string;
  unit?: string;
  className?: string;
}[] = [
  { key: "total", label: "Total production", className: "total-row" },
  { key: "pass", label: "Pass", className: "pass-row" },
  { key: "fail", label: "Fail", className: "fail-row" },
  { key: "runtime", label: "Runtime", unit: "min" },
  { key: "unplanned", label: "Unplanned Production", unit: "min" },
  { key: "stoppage", label: "Stoppage", unit: "min" },
  { key: "unknown", label: "Unknown Downtime", unit: "min" },
  { key: "plannedDowntime", label: "Planned Downtime", unit: "min" },
  { key: "unplannedDowntime", label: "Unplanned Downtime", unit: "min" },
  { key: "ideal", label: "Ideal Cycle Time", unit: "s" },
  { key: "actual", label: "Actual Cycle Time", unit: "s" },
];

function formatValue(value: number | null, unit?: string) {
  if (value === null) return "";
  const formatted = value.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return unit ? `${formatted} ${unit}` : formatted;
}

export default function HourlySummary({
  hours,
  sourceHourOffsets = false,
}: {
  hours: HourBucket[];
  sourceHourOffsets?: boolean;
}) {
  const hasOverlappingDurations = hours.some((hour) => {
    const totalMinutes =
      (hour.runtime ?? 0) +
      (hour.unplanned ?? 0) +
      (hour.stoppage ?? 0) +
      (hour.unknown ?? 0) +
      (hour.plannedDowntime ?? 0) +
      (hour.unplannedDowntime ?? 0);
    const hourMinutes = (hour.end - hour.start) / 60_000;
    return totalMinutes > hourMinutes + 0.05;
  });
  const visibleRows = rows.filter((row) => {
    if (row.key === "plannedDowntime" || row.key === "unplannedDowntime") {
      return hours.some((hour) => (hour[row.key] ?? 0) > 0);
    }
    return true;
  });

  return (
    <section className="surface summary-card" aria-labelledby="summary-title">
      <div className="section-heading">
        <div>
          <div className="title-with-icon">
            <AccessTimeRounded />
            <h2 id="summary-title">Hourly Production &amp; Downtime Summary</h2>
          </div>
          <p>Production counts, machine time, and cycle performance by hour.</p>
        </div>
        <span className="quiet-badge">All times in IST</span>
      </div>
      <div
        className="table-scroll"
        role="region"
        aria-label="Hourly production data, scroll horizontally for more hours"
        tabIndex={0}
      >
        <table className="hourly-table">
          <caption className="sr-only">
            Production counts and machine durations for each IST clock hour.
            Blank cells indicate future hours or unavailable cycle metrics.
            Partial shift hours are clipped to the selected window.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                Parameter <span>per hour</span>
              </th>
              {hours.map((hour) => (
                <th key={hour.start} scope="col">
                  {hour.label}
                  <span>{hour.partial ? "Partial hour" : "IST"}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr key={row.key} className={row.className}>
                <th scope="row">
                  {row.key === "pass" || row.key === "fail" ? (
                    <span className={`table-status ${row.key}`} />
                  ) : null}
                  {row.label}
                </th>
                {hours.map((hour) => (
                  <td
                    key={hour.start}
                    className={!hour.elapsed ? "future-cell" : undefined}
                  >
                    {formatValue(hour[row.key], row.unit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(hasOverlappingDurations || sourceHourOffsets) && (
        <div className="source-data-note">
          <InfoOutlined />
          <div>
            {sourceHourOffsets && (
              <p>
                Counts and cycle metrics follow source hourly buckets, assigned
                by their start time in IST.
              </p>
            )}
            {hasOverlappingDurations && (
              <p>
                Some source intervals overlap; summed durations may exceed
                elapsed minutes. Source categories are preserved.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="table-footnote">
        <span>
          Durations are clipped to each clock hour and the shift window.
        </span>
        <span>Cycle times in seconds · Blank = no data</span>
      </div>
    </section>
  );
}
