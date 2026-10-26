import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Alert from "@mui/material/Alert";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import RefreshRounded from "@mui/icons-material/RefreshRounded";
import LogoutRounded from "@mui/icons-material/LogoutRounded";
import TimelineRounded from "@mui/icons-material/TimelineRounded";
import PrecisionManufacturingOutlined from "@mui/icons-material/PrecisionManufacturingOutlined";
import CalendarTodayOutlined from "@mui/icons-material/CalendarTodayOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import CheckCircleOutlineRounded from "@mui/icons-material/CheckCircleOutlineRounded";
import ErrorOutlineRounded from "@mui/icons-material/ErrorOutlineRounded";
import BarChartRounded from "@mui/icons-material/BarChartRounded";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import {
  buildShiftOptions,
  formatDate,
  formatTime,
  getShiftWindow,
} from "../lib/time";
import {
  buildChartPoints,
  buildHourlySummary,
  normalizeSegments,
  flattenAssets,
} from "../lib/data";
import Brand from "./Brand";
import HourlySummary from "./HourlySummary";
import TimelineChart from "./TimelineChart";

const number = (n: number) => n.toLocaleString("en-IN");
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "We could not load production data. Please try again.";
export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [assetId, setAssetId] = useState("");
  const [shiftId, setShiftId] = useState("");
  const [date, setDate] = useState("2026-09-01");
  const [individual, setIndividual] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const metadata = useQuery({
    queryKey: ["metadata"],
    queryFn: async ({ signal }) => {
      const [assets, shifts] = await Promise.all([
        api.assets(signal),
        api.shifts(signal),
      ]);
      return { assets, shifts };
    },
    staleTime: 300_000,
  });
  const assets = useMemo(
    () => flattenAssets(metadata.data?.assets ?? []),
    [metadata.data?.assets],
  );
  const shifts = useMemo(
    () => buildShiftOptions(metadata.data?.shifts ?? []),
    [metadata.data?.shifts],
  );
  const asset =
    assets.find((a) => a.id === assetId) ??
    assets.find((a) => /line\s*1\s*spi/i.test(a.name)) ??
    assets.find((a) => !a.children?.length) ??
    assets[0];
  const shift = shifts.find((s) => s.id === shiftId) ?? shifts[0];
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00+05:30`));
  const timeWindow = useMemo(
    () => (validDate && shift ? getShiftWindow(date, shift) : null),
    [date, shift, validDate],
  );
  const analytics = useQuery({
    queryKey: [
      "analytics",
      asset?.id,
      asset?.assetlevel_id,
      timeWindow?.from_ts,
      timeWindow?.to_ts,
      individual,
    ],
    enabled: !!asset && !!timeWindow,
    queryFn: async ({ signal }) => {
      const [intervals, cycles] = await Promise.all([
        api.intervals(asset!, timeWindow!, individual, signal),
        api.cycles(asset!, timeWindow!, signal),
      ]);
      return { intervals, cycles, observedAt: Date.now() };
    },
    staleTime: 60_000,
  });
  const now = analytics.data?.observedAt ?? Date.now();
  const segments = useMemo(
    () =>
      analytics.data && timeWindow
        ? normalizeSegments(analytics.data.intervals, timeWindow, now)
        : [],
    [analytics.data, timeWindow, now],
  );
  const points = useMemo(
    () =>
      analytics.data && timeWindow
        ? buildChartPoints(
            analytics.data.intervals,
            individual,
            timeWindow,
            now,
          )
        : [],
    [analytics.data, individual, timeWindow, now],
  );
  const hours = useMemo(
    () =>
      analytics.data && timeWindow
        ? buildHourlySummary(
            analytics.data.intervals,
            analytics.data.cycles,
            segments,
            timeWindow,
            now,
          )
        : [],
    [analytics.data, segments, timeWindow, now],
  );
  const counts = hours.reduce(
    (a, h) => ({
      total: a.total + (h.total ?? 0),
      pass: a.pass + (h.pass ?? 0),
      fail: a.fail + (h.fail ?? 0),
    }),
    { total: 0, pass: 0, fail: 0 },
  );
  const hasData = !!(segments.length || points.length || counts.total);
  const unknown = segments.filter((s) => s.kind === "unknown");
  const unknownMinutes = unknown.reduce(
    (a, s) => a + (s.end - s.start) / 60_000,
    0,
  );
  const yieldPercent = counts.total
    ? ((counts.pass / counts.total) * 100).toFixed(1)
    : "—";
  const inProgress =
    !!timeWindow && timeWindow.from <= now && timeWindow.to > now;
  const pending =
    metadata.isPending || (!!asset && !!timeWindow && analytics.isPending);
  async function logout() {
    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      setLogoutError("Your local session has been cleared.");
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">
        Skip to production dashboard
      </a>
      <header className="app-header">
        <div className="header-brand">
          <Brand />
          <span className="header-divider" />
          <span className="workspace-name">Analytics workspace</span>
        </div>
        <div className="header-user">
          <div className="user-details">
            <strong>{user?.name || user?.username}</strong>
            <span>{user?.customer_name || "Production analytics"}</span>
          </div>
          <Avatar
            sx={{
              width: 34,
              height: 34,
              bgcolor: "#ebebf8",
              color: "#353579",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {(user?.name || user?.username || "U")
              .split(" ")
              .map((s) => s[0])
              .slice(0, 2)
              .join("")}
          </Avatar>
          <Tooltip title="Sign out">
            <Button
              onClick={logout}
              disabled={loggingOut}
              aria-label="Sign out"
              className="logout-button"
              color="inherit"
            >
              {loggingOut ? (
                <CircularProgress size={18} />
              ) : (
                <LogoutRounded fontSize="small" />
              )}
            </Button>
          </Tooltip>
        </div>
      </header>
      <div className="workspace-body">
        <aside className="nav-rail" aria-label="Workspace navigation">
          <div className="rail-item active" aria-current="page">
            <TimelineRounded />
            <span>Timeline</span>
          </div>
          <div className="rail-footer">IST</div>
        </aside>
        <main id="main-content" className="dashboard-main">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">
                Workspace <span>/</span> Production analytics
              </div>
              <h1>
                Timeline dashboard<span className="heading-period">.</span>
              </h1>
              <p>Every part and every pause. Your shift, in one view.</p>
            </div>
            <div className="data-availability">
              <CalendarTodayOutlined />
              <div>
                <strong>Sample data available</strong>
                <span>1–7 September 2026</span>
              </div>
            </div>
          </div>
          {logoutError && <Alert severity="info">{logoutError}</Alert>}
          <section
            className="surface filter-card"
            aria-label="Production filters"
          >
            <div className="filter-grid">
              <FormControl
                size="small"
                fullWidth
                disabled={metadata.isPending || !assets.length}
              >
                <InputLabel id="asset-label">Machine / line</InputLabel>
                <Select
                  labelId="asset-label"
                  label="Machine / line"
                  value={asset?.id ?? ""}
                  onChange={(e) => setAssetId(e.target.value)}
                >
                  {assets.map((a) => (
                    <MenuItem value={a.id} key={a.id}>
                      <span className="asset-option" title={a.path}>
                        {a.name}
                        <small>{a.path}</small>
                      </span>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="Production date"
                type="date"
                size="small"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    "aria-label": "Production date",
                    min: "2020-01-01",
                    max: "2100-12-31",
                  },
                }}
                error={!validDate}
                fullWidth
              />
              <FormControl
                size="small"
                fullWidth
                disabled={metadata.isPending || !shifts.length}
              >
                <InputLabel id="shift-label">Shift</InputLabel>
                <Select
                  labelId="shift-label"
                  label="Shift"
                  value={shift?.id ?? ""}
                  onChange={(e) => setShiftId(e.target.value)}
                >
                  {shifts.map((s) => (
                    <MenuItem value={s.id} key={s.id}>
                      {s.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                className="refresh-button"
                startIcon={
                  analytics.isFetching ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshRounded />
                  )
                }
                onClick={() => void analytics.refetch()}
                disabled={!asset || !timeWindow || analytics.isFetching}
              >
                Refresh
              </Button>
            </div>
            <div className="filter-context">
              <div className="filter-tags">
                {asset && (
                  <Chip
                    size="small"
                    icon={<PrecisionManufacturingOutlined />}
                    label={asset.name}
                    className="asset-chip"
                  />
                )}
                {timeWindow && (
                  <span className="window-chip">
                    {formatDate(timeWindow.from)} ·{" "}
                    {formatTime(timeWindow.from)}–{formatTime(timeWindow.to)}{" "}
                    {formatDate(timeWindow.from) !== formatDate(timeWindow.to)
                      ? "(+1 day)"
                      : ""}
                  </span>
                )}
                <span className="timezone-chip">IST · UTC+05:30</span>
              </div>
              <span className="refresh-status">
                {analytics.isFetching
                  ? "Fetching production data…"
                  : analytics.data
                    ? `Updated at ${formatTime(analytics.data.observedAt, true)}`
                    : "Select your production window"}
              </span>
            </div>
          </section>
          {metadata.isError ? (
            <section className="surface state-panel">
              <ErrorOutlineRounded className="state-icon" />
              <h2>Could not load your workspace</h2>
              <p>{errorText(metadata.error)}</p>
              <Button
                variant="contained"
                onClick={() => void metadata.refetch()}
              >
                Try again
              </Button>
            </section>
          ) : !metadata.isPending && (!assets.length || !shifts.length) ? (
            <section className="surface state-panel">
              <InfoOutlined className="state-icon" />
              <h2>No {assets.length ? "active shifts" : "assets"} available</h2>
              <p>
                There are no selectable production windows for this account.
              </p>
              <Button
                variant="outlined"
                onClick={() => void metadata.refetch()}
              >
                Retry
              </Button>
            </section>
          ) : null}
          {pending && (
            <section
              className="surface loading-panel"
              aria-live="polite"
              aria-busy="true"
            >
              <LinearProgress />
              <div className="loading-content">
                <CircularProgress size={28} />
                <h2>Loading your shift</h2>
                <p>Bringing production history and hourly metrics together.</p>
              </div>
            </section>
          )}
          {analytics.isError && !pending && (
            <section className="surface state-panel" role="alert">
              <ErrorOutlineRounded className="state-icon" />
              <h2>Production data is unavailable</h2>
              <p>{errorText(analytics.error)}</p>
              <Button
                variant="contained"
                startIcon={<RefreshRounded />}
                onClick={() => void analytics.refetch()}
                disabled={analytics.isFetching}
              >
                Retry data request
              </Button>
            </section>
          )}
          {analytics.data && !analytics.isError && !pending && timeWindow && (
            <>
              <section
                className="surface production-card"
                aria-labelledby="production-title"
              >
                <div className="section-heading production-heading">
                  <div>
                    <div className="title-with-icon">
                      <TimelineRounded />
                      <h2 id="production-title">Production History</h2>
                      {inProgress && (
                        <Chip
                          size="small"
                          label="In progress"
                          color="success"
                          variant="outlined"
                        />
                      )}
                    </div>
                    <p>
                      {asset?.name} <span className="inline-divider">/</span>{" "}
                      {formatDate(timeWindow.from)}{" "}
                      <span className="inline-divider">/</span>{" "}
                      {formatTime(timeWindow.from)}–{formatTime(timeWindow.to)}{" "}
                      IST
                    </p>
                  </div>
                  <FormControlLabel
                    control={
                      <Switch
                        size="small"
                        checked={individual}
                        onChange={(e) => setIndividual(e.target.checked)}
                        inputProps={{
                          "aria-label": "Show individual produces",
                        }}
                      />
                    }
                    label="Show individual produces"
                    className="individual-toggle"
                  />
                </div>
                <div className="production-metrics">
                  <div>
                    <span className="metric-label">
                      <BarChartRounded />
                      Total production
                    </span>
                    <strong>
                      {number(counts.total)} <small>parts</small>
                    </strong>
                  </div>
                  <div>
                    <span className="metric-label">
                      <CheckCircleOutlineRounded />
                      Pass
                    </span>
                    <strong className="pass-value">
                      {number(counts.pass)} <small>parts</small>
                    </strong>
                  </div>
                  <div>
                    <span className="metric-label">
                      <ErrorOutlineRounded />
                      Fail
                    </span>
                    <strong className="fail-value">
                      {number(counts.fail)} <small>parts</small>
                    </strong>
                  </div>
                  <div>
                    <span className="metric-label">Pass rate</span>
                    <strong>
                      {yieldPercent}
                      <small>{counts.total ? "%" : ""}</small>
                    </strong>
                  </div>
                </div>
                {hasData ? (
                  <TimelineChart
                    key={`${asset?.id}:${timeWindow.from}:${individual}`}
                    segments={segments}
                    points={points}
                    window={timeWindow}
                    individual={individual}
                    loading={analytics.isFetching}
                  />
                ) : (
                  <div className="empty-chart">
                    <TimelineRounded />
                    <h3>No production data for this shift</h3>
                    <p>
                      Try Line1 SPI on a date between 1 and 7 September 2026.
                    </p>
                  </div>
                )}
                <div className="production-footnote">
                  <span
                    className={unknown.length ? "unknown-note" : "clear-note"}
                  >
                    <InfoOutlined />
                    {unknown.length
                      ? `${unknown.length} unknown segment${unknown.length === 1 ? "" : "s"} · ${unknownMinutes.toFixed(1)} min downtime`
                      : "No unknown downtime in this shift"}
                  </span>
                  <span>
                    {individual
                      ? `${number(points.length)} individual produces`
                      : "Hourly production counts"}
                    {points.length
                      ? ` · Last observed ${formatTime(points[points.length - 1].time, true)} IST`
                      : ""}
                  </span>
                </div>
              </section>
              <HourlySummary
                hours={hours}
                sourceHourOffsets={analytics.data.intervals.produce_counts.some(
                  (row) =>
                    (Date.parse(row.bucket_start) + 330 * 60_000) %
                      3_600_000 !==
                    0,
                )}
              />
            </>
          )}
          <footer className="dashboard-footer">
            <span>
              Novigo Analytics <span className="footer-dot">·</span> Production
              timeline
            </span>
            <span>Time zone: Asia/Kolkata (IST)</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
