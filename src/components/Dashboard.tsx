import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
  floorISTHour,
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

const formatCount = (value: number) => value.toLocaleString("en-IN");

function getErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "We could not load production data. Please try again.";
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [date, setDate] = useState("2026-09-01");
  const [showIndividual, setShowIndividual] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const workspaceQuery = useQuery({
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
    () => flattenAssets(workspaceQuery.data?.assets ?? []),
    [workspaceQuery.data?.assets],
  );
  const shifts = useMemo(
    () => buildShiftOptions(workspaceQuery.data?.shifts ?? []),
    [workspaceQuery.data?.shifts],
  );
  const selectedAsset =
    assets.find((asset) => asset.id === selectedAssetId) ??
    assets.find((asset) => /line\s*1\s*spi/i.test(asset.name)) ??
    assets.find((asset) => !asset.children?.length) ??
    assets[0];
  const selectedShift =
    shifts.find((shift) => shift.id === selectedShiftId) ?? shifts[0];
  const isValidDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00+05:30`));
  const timeWindow = useMemo(
    () =>
      isValidDate && selectedShift ? getShiftWindow(date, selectedShift) : null,
    [date, selectedShift, isValidDate],
  );

  const productionQuery = useQuery({
    queryKey: [
      "analytics",
      selectedAsset?.id,
      selectedAsset?.assetlevel_id,
      timeWindow?.from_ts,
      timeWindow?.to_ts,
      showIndividual,
    ],
    enabled: Boolean(selectedAsset && timeWindow),
    queryFn: async ({ signal }) => {
      if (!selectedAsset || !timeWindow)
        throw new Error("Choose a machine, date and shift.");
      const [intervals, cycles] = await Promise.all([
        api.intervals(selectedAsset, timeWindow, showIndividual, signal),
        api.cycles(selectedAsset, timeWindow, signal),
      ]);
      return { intervals, cycles, observedAt: Date.now() };
    },
    staleTime: 60_000,
  });
  const production = productionQuery.data;
  const observedAt = production?.observedAt ?? Date.now();

  // Use the same clipped intervals and observation time for the chart and table.
  const { segments, points, hours } = useMemo(() => {
    if (!production || !timeWindow)
      return { segments: [], points: [], hours: [] };
    const segments = normalizeSegments(
      production.intervals,
      timeWindow,
      production.observedAt,
    );
    const points = buildChartPoints(
      production.intervals,
      showIndividual,
      timeWindow,
      production.observedAt,
    );
    const hours = buildHourlySummary(
      production.intervals,
      production.cycles,
      segments,
      timeWindow,
      production.observedAt,
    );
    return { segments, points, hours };
  }, [production, timeWindow, showIndividual]);

  const counts = hours.reduce(
    (totals, hour) => ({
      total: totals.total + (hour.total ?? 0),
      pass: totals.pass + (hour.pass ?? 0),
      fail: totals.fail + (hour.fail ?? 0),
    }),
    { total: 0, pass: 0, fail: 0 },
  );
  const hasData = segments.length > 0 || points.length > 0 || counts.total > 0;
  const unknownSegments = segments.filter(
    (segment) => segment.kind === "unknown",
  );
  const unknownMinutes = unknownSegments.reduce(
    (minutes, segment) => minutes + (segment.end - segment.start) / 60_000,
    0,
  );
  const passRate = counts.total
    ? ((counts.pass / counts.total) * 100).toFixed(1)
    : "—";
  const lastPoint = points.at(-1);
  const isInProgress = Boolean(
    timeWindow && timeWindow.from <= observedAt && timeWindow.to > observedAt,
  );
  const isLoading =
    workspaceQuery.isPending ||
    Boolean(selectedAsset && timeWindow && productionQuery.isPending);
  const noOptions =
    !workspaceQuery.isPending &&
    !workspaceQuery.isError &&
    (!assets.length || !shifts.length);
  const isOvernight =
    timeWindow && formatDate(timeWindow.from) !== formatDate(timeWindow.to);
  const userInitials = (user?.name || user?.username || "U")
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("");
  const sourceHourOffsets =
    production?.intervals.produce_counts.some((row) => {
      const bucketStart = Date.parse(row.bucket_start);
      return floorISTHour(bucketStart) !== bucketStart;
    }) ?? false;

  let refreshStatus = "Select your production window";
  if (productionQuery.isFetching) refreshStatus = "Fetching production data…";
  else if (production)
    refreshStatus = `Updated at ${formatTime(production.observedAt, true)}`;

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await signOut();
    } catch {
      // signOut clears the local session even when the server cannot be reached.
    } finally {
      setIsLoggingOut(false);
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
            {userInitials}
          </Avatar>
          <Tooltip title="Sign out">
            <Button
              onClick={handleLogout}
              disabled={isLoggingOut}
              aria-label="Sign out"
              className="logout-button"
              color="inherit"
            >
              {isLoggingOut ? (
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
          <section
            className="surface filter-card"
            aria-label="Production filters"
          >
            <div className="filter-grid">
              <FormControl
                size="small"
                fullWidth
                disabled={workspaceQuery.isPending || !assets.length}
              >
                <InputLabel id="asset-label">Machine / line</InputLabel>
                <Select
                  labelId="asset-label"
                  label="Machine / line"
                  value={selectedAsset?.id ?? ""}
                  onChange={(event) => setSelectedAssetId(event.target.value)}
                >
                  {assets.map((assetOption) => (
                    <MenuItem value={assetOption.id} key={assetOption.id}>
                      <span className="asset-option" title={assetOption.path}>
                        {assetOption.name}
                        <small>{assetOption.path}</small>
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
                onChange={(event) => setDate(event.target.value)}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    "aria-label": "Production date",
                    min: "2020-01-01",
                    max: "2100-12-31",
                  },
                }}
                error={!isValidDate}
                fullWidth
              />
              <FormControl
                size="small"
                fullWidth
                disabled={workspaceQuery.isPending || !shifts.length}
              >
                <InputLabel id="shift-label">Shift</InputLabel>
                <Select
                  labelId="shift-label"
                  label="Shift"
                  value={selectedShift?.id ?? ""}
                  onChange={(event) => setSelectedShiftId(event.target.value)}
                >
                  {shifts.map((shiftOption) => (
                    <MenuItem value={shiftOption.id} key={shiftOption.id}>
                      {shiftOption.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="outlined"
                className="refresh-button"
                startIcon={
                  productionQuery.isFetching ? (
                    <CircularProgress size={16} />
                  ) : (
                    <RefreshRounded />
                  )
                }
                onClick={() => void productionQuery.refetch()}
                disabled={
                  !selectedAsset || !timeWindow || productionQuery.isFetching
                }
              >
                Refresh
              </Button>
            </div>
            <div className="filter-context">
              <div className="filter-tags">
                {selectedAsset && (
                  <Chip
                    size="small"
                    icon={<PrecisionManufacturingOutlined />}
                    label={selectedAsset.name}
                    className="asset-chip"
                  />
                )}
                {timeWindow && (
                  <span className="window-chip">
                    {formatDate(timeWindow.from)} ·{" "}
                    {formatTime(timeWindow.from)}–{formatTime(timeWindow.to)}{" "}
                    {isOvernight ? "(+1 day)" : ""}
                  </span>
                )}
                <span className="timezone-chip">IST · UTC+05:30</span>
              </div>
              <span className="refresh-status">{refreshStatus}</span>
            </div>
          </section>
          {workspaceQuery.isError ? (
            <section className="surface state-panel">
              <ErrorOutlineRounded className="state-icon" />
              <h2>Could not load your workspace</h2>
              <p>{getErrorMessage(workspaceQuery.error)}</p>
              <Button
                variant="contained"
                onClick={() => void workspaceQuery.refetch()}
              >
                Try again
              </Button>
            </section>
          ) : null}
          {noOptions && (
            <section className="surface state-panel">
              <InfoOutlined className="state-icon" />
              <h2>No {assets.length ? "active shifts" : "assets"} available</h2>
              <p>
                There are no selectable production windows for this account.
              </p>
              <Button
                variant="outlined"
                onClick={() => void workspaceQuery.refetch()}
              >
                Retry
              </Button>
            </section>
          )}
          {isLoading && (
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
          {productionQuery.isError && !isLoading && (
            <section className="surface state-panel" role="alert">
              <ErrorOutlineRounded className="state-icon" />
              <h2>Production data is unavailable</h2>
              <p>{getErrorMessage(productionQuery.error)}</p>
              <Button
                variant="contained"
                startIcon={<RefreshRounded />}
                onClick={() => void productionQuery.refetch()}
                disabled={productionQuery.isFetching}
              >
                Retry data request
              </Button>
            </section>
          )}
          {productionQuery.data &&
            !productionQuery.isError &&
            !isLoading &&
            timeWindow && (
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
                        {isInProgress && (
                          <Chip
                            size="small"
                            label="In progress"
                            color="success"
                            variant="outlined"
                          />
                        )}
                      </div>
                      <p>
                        {selectedAsset?.name}{" "}
                        <span className="inline-divider">/</span>{" "}
                        {formatDate(timeWindow.from)}{" "}
                        <span className="inline-divider">/</span>{" "}
                        {formatTime(timeWindow.from)}–
                        {formatTime(timeWindow.to)} IST
                      </p>
                    </div>
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={showIndividual}
                          onChange={(event) =>
                            setShowIndividual(event.target.checked)
                          }
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
                        {formatCount(counts.total)} <small>parts</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">
                        <CheckCircleOutlineRounded />
                        Pass
                      </span>
                      <strong className="pass-value">
                        {formatCount(counts.pass)} <small>parts</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">
                        <ErrorOutlineRounded />
                        Fail
                      </span>
                      <strong className="fail-value">
                        {formatCount(counts.fail)} <small>parts</small>
                      </strong>
                    </div>
                    <div>
                      <span className="metric-label">Pass rate</span>
                      <strong>
                        {passRate}
                        <small>{counts.total ? "%" : ""}</small>
                      </strong>
                    </div>
                  </div>
                  {hasData ? (
                    <TimelineChart
                      key={`${selectedAsset?.id}:${timeWindow.from}:${showIndividual}`}
                      segments={segments}
                      points={points}
                      window={timeWindow}
                      individual={showIndividual}
                      loading={productionQuery.isFetching}
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
                      className={
                        unknownSegments.length ? "unknown-note" : "clear-note"
                      }
                    >
                      <InfoOutlined />
                      {unknownSegments.length
                        ? `${unknownSegments.length} unknown segment${unknownSegments.length === 1 ? "" : "s"} · ${unknownMinutes.toFixed(1)} min downtime`
                        : "No unknown downtime in this shift"}
                    </span>
                    <span>
                      {showIndividual
                        ? `${formatCount(points.length)} individual produces`
                        : "Hourly production counts"}
                      {lastPoint
                        ? ` · Last observed ${formatTime(lastPoint.time, true)} IST`
                        : ""}
                    </span>
                  </div>
                </section>
                <HourlySummary
                  hours={hours}
                  sourceHourOffsets={sourceHourOffsets}
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
