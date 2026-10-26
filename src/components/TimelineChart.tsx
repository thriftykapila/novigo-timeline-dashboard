import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type {
  ChartPoint,
  Segment,
  SegmentKind,
  TimeWindow,
} from "../lib/types";
import "./timeline.css";

export interface TimelineChartProps {
  segments: Segment[];
  points: ChartPoint[];
  window: TimeWindow;
  individual: boolean;
  loading?: boolean;
}

const MINIMUM_SPAN = 60_000;
const SERIES_COLORS = [
  "#2463df",
  "#17459d",
  "#6c5add",
  "#007f98",
  "#3d72bd",
  "#7d53ae",
];
const BAND_COLORS: Record<SegmentKind, string> = {
  runtime: "#22a69a",
  unplanned: "#c2d944",
  unknown: "#ff8269",
  stoppage: "#7361c9",
  plannedDowntime: "#83aa22",
  unplannedDowntime: "#ff8269",
};
const BAND_LABELS: Record<SegmentKind, string> = {
  runtime: "Runtime",
  unplanned: "Unplanned production",
  unknown: "Unknown downtime",
  stoppage: "Stoppage",
  plannedDowntime: "Planned downtime",
  unplannedDowntime: "Unplanned downtime",
};
const BAND_TEXT: Record<SegmentKind, string> = {
  runtime: "#ffffff",
  unplanned: "#404b06",
  unknown: "#582a24",
  stoppage: "#ffffff",
  plannedDowntime: "#233100",
  unplannedDowntime: "#582a24",
};
const tickTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const preciseTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const tooltipTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

interface Range {
  from: number;
  to: number;
}
interface PreparedPoint {
  point: ChartPoint;
  series: number;
}
interface HitPoint extends PreparedPoint {
  x: number;
  y: number;
}
interface Series {
  id: string;
  color: string;
  points: ChartPoint[];
}
interface Plot extends Range {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
  maxY: number;
  hits: HitPoint[];
}
interface Brush {
  start: number;
  current: number;
  pointerId: number;
}

/** Shared binary search for time-sorted data; no timestamp parsing on interaction. */
export function lowerBoundByTime<T>(
  items: T[],
  timestamp: number,
  getTime: (item: T) => number,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getTime(items[middle]) < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
function shortModel(value: string) {
  return value.length > 16 ? `${value.slice(0, 8)}…` : value;
}
function niceMaximum(value: number) {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = magnitude / 2;
  return Math.ceil((value * 1.07) / step) * step;
}
function timeTicks(from: number, to: number, targetCount: number) {
  const choices = [
    10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
    1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000,
  ];
  const interval =
    choices.find((choice) => choice >= (to - from) / targetCount) ?? 86_400_000;
  const values = [from];
  for (let time = from + interval; time < to - interval * 0.2; time += interval)
    values.push(time);
  // Retain the exact requested bounds; omit a nearby interior label to prevent collisions.
  if (values.length > 1 && to - values[values.length - 1] < interval * 0.65)
    values.pop();
  values.push(to);
  return values;
}
function configureCanvas(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
) {
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  const physicalWidth = Math.round(width * ratio);
  const physicalHeight = Math.round(height * ratio);
  if (canvas.width !== physicalWidth || canvas.height !== physicalHeight) {
    canvas.width = physicalWidth;
    canvas.height = physicalHeight;
  }
  const context = canvas.getContext("2d");
  context?.setTransform(ratio, 0, 0, ratio, 0, 0);
  return context;
}

function TimelineChart({
  segments,
  points,
  window: timeWindow,
  individual,
  loading = false,
}: TimelineChartProps) {
  const instructionsId = useId();
  const summaryId = useId();
  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipResultRef = useRef<HTMLSpanElement>(null);
  const tooltipTimeRef = useRef<HTMLSpanElement>(null);
  const tooltipCountRef = useRef<HTMLSpanElement>(null);
  const tooltipModelRef = useRef<HTMLSpanElement>(null);
  const tooltipIdRef = useRef<HTMLSpanElement>(null);
  const announcementRef = useRef<HTMLSpanElement>(null);
  const plotRef = useRef<Plot | null>(null);
  const brushRef = useRef<Brush | null>(null);
  const hoverRef = useRef<HitPoint | null>(null);
  const frameRef = useRef<number | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const focusedPointRef = useRef(-1);
  const [size, setSize] = useState({ width: 0, height: 320 });
  const [zoom, setZoom] = useState<Range | null>(null);

  const prepared = useMemo(() => {
    const series: Series[] = [];
    const seriesIndex = new Map<string, number>();
    const resolved: PreparedPoint[] = [];
    let max = 0;
    let failures = 0;
    for (const point of points) {
      let index = seriesIndex.get(point.partModel);
      if (index === undefined) {
        index = series.length;
        seriesIndex.set(point.partModel, index);
        series.push({
          id: point.partModel,
          color: SERIES_COLORS[index % SERIES_COLORS.length],
          points: [],
        });
      }
      series[index].points.push(point);
      resolved.push({ point, series: index });
      max = Math.max(max, point.cumulative);
      if (point.result === "FAIL") failures++;
    }
    return { points: resolved, series, maxY: niceMaximum(max), failures };
  }, [points]);

  const bands = useMemo(
    () =>
      segments.map((segment) => ({
        ...segment,
        color: BAND_COLORS[segment.kind],
        textColor: BAND_TEXT[segment.kind],
        caption: (segment.label || BAND_LABELS[segment.kind]).toUpperCase(),
      })),
    [segments],
  );
  const kinds = useMemo(
    () => [...new Set(segments.map((segment) => segment.kind))],
    [segments],
  );
  const range =
    zoom && zoom.from >= timeWindow.from && zoom.to <= timeWindow.to
      ? zoom
      : timeWindow;
  const isZoomed = range.from > timeWindow.from || range.to < timeWindow.to;
  const minimumSpan = Math.min(MINIMUM_SPAN, timeWindow.to - timeWindow.from);

  useEffect(() => {
    setZoom(null);
    focusedPointRef.current = -1;
  }, [timeWindow.from, timeWindow.to]);

  useEffect(() => {
    const element = areaRef.current;
    if (!element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((previous) =>
        previous.width === next.width && previous.height === next.height
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const drawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const plot = plotRef.current;
    if (!canvas || !plot) return;
    const context = configureCanvas(canvas, plot.width, plot.height);
    if (!context) return;
    context.clearRect(0, 0, plot.width, plot.height);
    const brush = brushRef.current;
    if (brush) {
      const left = Math.min(brush.start, brush.current);
      const width = Math.abs(brush.current - brush.start);
      context.fillStyle = "rgba(28, 56, 145, 0.16)";
      context.fillRect(left, plot.top, width, plot.bottom - plot.top);
      context.strokeStyle = "#202b86";
      context.lineWidth = 1.5;
      context.strokeRect(
        left + 0.5,
        plot.top + 0.5,
        width,
        plot.bottom - plot.top - 1,
      );
      return;
    }
    const hovered = hoverRef.current;
    if (!hovered) return;
    context.strokeStyle = "rgba(25, 44, 91, 0.5)";
    context.lineWidth = 1;
    context.setLineDash([3, 4]);
    context.beginPath();
    context.moveTo(hovered.x, plot.top);
    context.lineTo(hovered.x, plot.bottom);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(hovered.x, hovered.y, 7, 0, Math.PI * 2);
    context.strokeStyle =
      hovered.point.result === "FAIL" ? "#b52432" : "#173fa6";
    context.lineWidth = 2;
    context.stroke();
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipRef.current) tooltipRef.current.hidden = true;
    hoverRef.current = null;
  }, []);

  const showTooltip = useCallback(
    (hit: HitPoint, announce = false) => {
      const tooltip = tooltipRef.current;
      const plot = plotRef.current;
      if (!tooltip || !plot) return;
      const point = hit.point;
      const formattedTime = `${tooltipTime.format(point.time)} IST`;
      const count = `${number.format(point.count)} ${point.count === 1 ? "part" : "parts"} · ${number.format(point.cumulative)} cumulative`;
      if (tooltipResultRef.current) {
        tooltipResultRef.current.textContent = `${point.result === "PASS" ? "●" : "×"} ${point.result} · ${individual ? "Individual produce" : "Hourly bucket"}`;
        tooltipResultRef.current.className =
          point.result === "FAIL"
            ? "timeline-tooltip-result is-fail"
            : "timeline-tooltip-result";
      }
      if (tooltipTimeRef.current)
        tooltipTimeRef.current.textContent = formattedTime;
      if (tooltipCountRef.current) tooltipCountRef.current.textContent = count;
      if (tooltipModelRef.current)
        tooltipModelRef.current.textContent = `Part model: ${point.partModel}`;
      if (tooltipIdRef.current)
        tooltipIdRef.current.textContent = `ID: ${point.id}`;
      tooltip.hidden = false;
      const tooltipWidth = Math.min(310, plot.width - 16);
      const x = clamp(
        hit.x + 14,
        8,
        Math.max(8, plot.width - tooltipWidth - 8),
      );
      const y = hit.y > 166 ? hit.y - 154 : hit.y + 15;
      tooltip.style.width = `${tooltipWidth}px`;
      tooltip.style.transform = `translate(${x}px, ${clamp(y, 8, plot.height - 148)}px)`;
      hoverRef.current = hit;
      if (announce && announcementRef.current)
        announcementRef.current.textContent = `${point.result}. ${formattedTime}. ${count}. Part model ${point.partModel}. ID ${point.id}.`;
    },
    [individual],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width < 1) return;
    const startedAt = performance.now();
    const context = configureCanvas(canvas, size.width, size.height);
    if (!context) return;
    hideTooltip();
    brushRef.current = null;
    const plot: Plot = {
      left: size.width < 540 ? 44 : 58,
      right: size.width - 17,
      top: 31,
      bottom: size.height - 49,
      width: size.width,
      height: size.height,
      from: range.from,
      to: range.to,
      maxY: prepared.maxY,
      hits: [],
    };
    plotRef.current = plot;
    const plotWidth = plot.right - plot.left;
    const plotHeight = plot.bottom - plot.top;
    const span = Math.max(1, plot.to - plot.from);
    const timeX = (time: number) =>
      plot.left + ((time - plot.from) / span) * plotWidth;
    const countY = (count: number) =>
      plot.bottom - (count / plot.maxY) * plotHeight;

    context.clearRect(0, 0, size.width, size.height);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.fillStyle = "#f5f7fa";
    context.fillRect(plot.left, plot.top, plotWidth, plotHeight);
    context.save();
    context.beginPath();
    context.rect(plot.left, plot.top, plotWidth, plotHeight);
    context.clip();
    for (const band of bands) {
      if (band.end <= plot.from || band.start >= plot.to) continue;
      const x = timeX(Math.max(plot.from, band.start));
      const width = timeX(Math.min(plot.to, band.end)) - x;
      context.fillStyle = band.color;
      context.fillRect(x, plot.top, width + 0.5, plotHeight);
      if (width >= 17) {
        context.save();
        context.fillStyle = band.textColor;
        context.globalAlpha = 0.92;
        context.font = "600 10px Roboto, Arial, sans-serif";
        context.textAlign = "left";
        context.textBaseline = "alphabetic";
        context.translate(x + width / 2 + 3, plot.top + 12);
        context.rotate(Math.PI / 2);
        if (context.measureText(band.caption).width <= plotHeight - 24)
          context.fillText(band.caption, 0, 0);
        context.restore();
      }
    }
    context.lineWidth = 1;
    context.strokeStyle = "rgba(255, 255, 255, 0.3)";
    for (let index = 0; index <= 4; index++) {
      const y = plot.bottom - (index / 4) * plotHeight;
      context.beginPath();
      context.moveTo(plot.left, y);
      context.lineTo(plot.right, y);
      context.stroke();
    }

    const seriesGeometry: HitPoint[][] = prepared.series.map(() => []);
    const first = lowerBoundByTime(
      prepared.points,
      plot.from,
      (item) => item.point.time,
    );
    for (let index = first; index < prepared.points.length; index++) {
      const item = prepared.points[index];
      if (item.point.time > plot.to) break;
      const hit = {
        ...item,
        x: timeX(item.point.time),
        y: countY(item.point.cumulative),
      };
      plot.hits.push(hit);
      seriesGeometry[item.series].push(hit);
    }

    // One polyline and one batched PASS path per model. Only same-pixel PASSes coalesce.
    let renderedPasses = 0;
    let renderedFailures = 0;
    for (
      let seriesIndex = 0;
      seriesIndex < prepared.series.length;
      seriesIndex++
    ) {
      const series = prepared.series[seriesIndex];
      const hits = seriesGeometry[seriesIndex];
      const before =
        lowerBoundByTime(series.points, plot.from, (point) => point.time) - 1;
      const after = lowerBoundByTime(
        series.points,
        plot.to + 1,
        (point) => point.time,
      );
      context.beginPath();
      let hasStart = false;
      if (before >= 0) {
        const point = series.points[before];
        context.moveTo(timeX(point.time), countY(point.cumulative));
        hasStart = true;
      }
      for (const hit of hits) {
        if (!hasStart) {
          context.moveTo(hit.x, hit.y);
          hasStart = true;
        } else context.lineTo(hit.x, hit.y);
      }
      if (after < series.points.length && hasStart) {
        const point = series.points[after];
        context.lineTo(timeX(point.time), countY(point.cumulative));
      }
      context.strokeStyle = series.color;
      context.lineWidth = 1.6;
      context.stroke();
      context.beginPath();
      let lastX = -1;
      let lastY = -1;
      const radius = individual ? 2.5 : 3.8;
      for (const hit of hits) {
        if (hit.point.result === "FAIL") continue;
        const pixelX = Math.round(hit.x);
        const pixelY = Math.round(hit.y);
        if (pixelX === lastX && pixelY === lastY) continue;
        lastX = pixelX;
        lastY = pixelY;
        context.moveTo(hit.x + radius, hit.y);
        context.arc(hit.x, hit.y, radius, 0, Math.PI * 2);
        renderedPasses++;
      }
      context.fillStyle = series.color;
      context.strokeStyle = "#ffffff";
      context.lineWidth = 1;
      context.fill();
      context.stroke();
    }

    // FAILs are all retained and painted last so a dense PASS series cannot obscure defects.
    context.beginPath();
    for (const hit of plot.hits) {
      if (hit.point.result !== "FAIL") continue;
      const radius = individual ? 4 : 4.5;
      context.moveTo(hit.x - radius, hit.y - radius);
      context.lineTo(hit.x + radius, hit.y + radius);
      context.moveTo(hit.x + radius, hit.y - radius);
      context.lineTo(hit.x - radius, hit.y + radius);
      renderedFailures++;
    }
    context.lineWidth = 4.3;
    context.strokeStyle = "#ffffff";
    context.stroke();
    context.lineWidth = 2.1;
    context.strokeStyle = "#cf243d";
    context.stroke();
    context.restore();

    context.font = "11px Roboto, Arial, sans-serif";
    context.fillStyle = "#687386";
    context.textAlign = "left";
    context.fillText("Cumulative production", 10, 16);
    context.textAlign = "right";
    for (let index = 0; index <= 4; index++) {
      const value = (plot.maxY * index) / 4;
      context.fillText(
        number.format(value),
        plot.left - 9,
        plot.bottom - (index / 4) * plotHeight + 4,
      );
    }
    context.strokeStyle = "#9ca8b9";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(plot.left, plot.bottom + 8);
    context.lineTo(plot.right, plot.bottom + 8);
    context.stroke();
    const ticks = timeTicks(
      plot.from,
      plot.to,
      Math.max(2, Math.min(8, Math.floor(plotWidth / 115))),
    );
    for (let index = 0; index < ticks.length; index++) {
      const time = ticks[index];
      const x = timeX(time);
      context.beginPath();
      context.moveTo(x, plot.bottom + 8);
      context.lineTo(x, plot.bottom + 14);
      context.stroke();
      context.textAlign =
        index === 0 ? "left" : index === ticks.length - 1 ? "right" : "center";
      context.fillText(
        span < 300_000 ? preciseTime.format(time) : tickTime.format(time),
        x,
        plot.bottom + 29,
      );
    }
    context.textAlign = "center";
    context.fillStyle = "#7c8798";
    context.fillText(
      "Shift time · IST",
      (plot.left + plot.right) / 2,
      size.height - 5,
    );
    canvas.dataset.renderMs = (performance.now() - startedAt).toFixed(2);
    canvas.dataset.markersRendered = String(renderedPasses + renderedFailures);
    canvas.dataset.failureMarkers = String(renderedFailures);
    canvas.dataset.visibleMarkers = String(plot.hits.length);
    canvas.dataset.viewFrom = String(plot.from);
    canvas.dataset.viewTo = String(plot.to);
    canvas.dataset.drawRevision = String(
      Number(canvas.dataset.drawRevision || "0") + 1,
    );
    focusedPointRef.current = -1;
    drawOverlay();
  }, [
    bands,
    prepared,
    range.from,
    range.to,
    size,
    individual,
    drawOverlay,
    hideTooltip,
  ]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const updatePointer = useCallback(() => {
    frameRef.current = null;
    const startedAt = performance.now();
    const pointer = pointerRef.current;
    const plot = plotRef.current;
    if (!pointer || !plot) return;
    const brush = brushRef.current;
    if (brush) {
      brush.current = clamp(pointer.x, plot.left, plot.right);
      hideTooltip();
      drawOverlay();
      return;
    }
    if (
      pointer.x < plot.left ||
      pointer.x > plot.right ||
      pointer.y < plot.top - 8 ||
      pointer.y > plot.bottom + 8
    ) {
      hideTooltip();
      drawOverlay();
      return;
    }
    const span = plot.to - plot.from;
    const timestamp =
      plot.from + ((pointer.x - plot.left) / (plot.right - plot.left)) * span;
    const radiusTime = (14 / (plot.right - plot.left)) * span;
    const first = lowerBoundByTime(
      plot.hits,
      timestamp - radiusTime,
      (hit) => hit.point.time,
    );
    let nearest: HitPoint | null = null;
    let distance = 15 * 15;
    for (let index = first; index < plot.hits.length; index++) {
      const hit = plot.hits[index];
      if (hit.point.time > timestamp + radiusTime) break;
      const candidateDistance =
        (hit.x - pointer.x) ** 2 + (hit.y - pointer.y) ** 2;
      if (
        candidateDistance < distance ||
        (candidateDistance === distance && hit.point.result === "FAIL")
      ) {
        nearest = hit;
        distance = candidateDistance;
      }
    }
    if (nearest) showTooltip(nearest);
    else hideTooltip();
    drawOverlay();
    if (overlayRef.current)
      overlayRef.current.dataset.hoverMs = (
        performance.now() - startedAt
      ).toFixed(3);
  }, [drawOverlay, hideTooltip, showTooltip]);

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    if (frameRef.current === null)
      frameRef.current = requestAnimationFrame(updatePointer);
  };
  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || loading) return;
    const plot = plotRef.current;
    if (!plot) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < plot.left || x > plot.right || y < plot.top || y > plot.bottom)
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    brushRef.current = { start: x, current: x, pointerId: event.pointerId };
    hideTooltip();
    drawOverlay();
  };
  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const plot = plotRef.current;
    const brush = brushRef.current;
    if (!plot || !brush || brush.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    brush.current = clamp(event.clientX - bounds.left, plot.left, plot.right);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    brushRef.current = null;
    if (Math.abs(brush.current - brush.start) >= 6) {
      const span = plot.to - plot.from;
      const a =
        plot.from +
        ((Math.min(brush.start, brush.current) - plot.left) /
          (plot.right - plot.left)) *
          span;
      const b =
        plot.from +
        ((Math.max(brush.start, brush.current) - plot.left) /
          (plot.right - plot.left)) *
          span;
      const nextSpan = Math.max(minimumSpan, b - a);
      const from = clamp(
        (a + b - nextSpan) / 2,
        timeWindow.from,
        timeWindow.to - nextSpan,
      );
      setZoom({ from, to: from + nextSpan });
    } else drawOverlay();
  };

  const changeZoom = (factor: number) => {
    const fullSpan = timeWindow.to - timeWindow.from;
    const nextSpan = clamp(
      (range.to - range.from) * factor,
      minimumSpan,
      fullSpan,
    );
    const from = clamp(
      (range.from + range.to - nextSpan) / 2,
      timeWindow.from,
      timeWindow.to - nextSpan,
    );
    setZoom(nextSpan >= fullSpan ? null : { from, to: from + nextSpan });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (loading) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(0.5);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(2);
    } else if (event.key.toLowerCase() === "r" || event.key === "Escape") {
      event.preventDefault();
      setZoom(null);
      hideTooltip();
      drawOverlay();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const hits = plotRef.current?.hits;
      if (!hits?.length) return;
      focusedPointRef.current = clamp(
        focusedPointRef.current + (event.key === "ArrowRight" ? 1 : -1),
        0,
        hits.length - 1,
      );
      showTooltip(hits[focusedPointRef.current], true);
      drawOverlay();
    }
  };
  const cancelPointer = () => {
    brushRef.current = null;
    hideTooltip();
    drawOverlay();
  };

  return (
    <div className="timeline-component" aria-busy={loading}>
      <div className="timeline-key-row">
        <div className="timeline-series-key">
          <span className="timeline-key-label">Part models</span>
          {prepared.series.slice(0, 5).map((series) => (
            <span className="timeline-model" key={series.id} title={series.id}>
              <i style={{ backgroundColor: series.color }} />
              {shortModel(series.id)}
            </span>
          ))}
          {prepared.series.length > 5 ? (
            <span className="timeline-key-label">
              +{prepared.series.length - 5} more
            </span>
          ) : null}
          <span className="timeline-result-key">
            <i className="timeline-pass-dot" />
            PASS
          </span>
          <span className="timeline-result-key">
            <i className="timeline-fail-cross">×</i>FAIL
          </span>
        </div>
        <div className="timeline-band-key" aria-label="Machine state legend">
          {kinds.map((kind) => (
            <span key={kind}>
              <i style={{ backgroundColor: BAND_COLORS[kind] }} />
              {BAND_LABELS[kind]}
            </span>
          ))}
        </div>
      </div>
      <div className="timeline-canvas-area" ref={areaRef}>
        <canvas
          ref={canvasRef}
          className="timeline-canvas"
          aria-hidden="true"
          data-testid="timeline-canvas"
        />
        <canvas
          ref={overlayRef}
          className="timeline-canvas timeline-interaction"
          tabIndex={0}
          role="group"
          aria-roledescription="interactive production chart"
          aria-label="Production timeline. Drag horizontally to zoom; use plus or minus to zoom, R to reset, and left or right arrows to inspect produces."
          aria-describedby={`${instructionsId} ${summaryId}`}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelPointer}
          onPointerLeave={() => {
            if (!brushRef.current) {
              hideTooltip();
              drawOverlay();
            }
          }}
          onDoubleClick={() => setZoom(null)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            hideTooltip();
            drawOverlay();
          }}
        />
        <div
          ref={tooltipRef}
          className="timeline-tooltip"
          role="tooltip"
          hidden
        >
          <span ref={tooltipResultRef} className="timeline-tooltip-result" />
          <span ref={tooltipTimeRef} className="timeline-tooltip-time" />
          <span ref={tooltipCountRef} />
          <span ref={tooltipModelRef} className="timeline-tooltip-detail" />
          <span ref={tooltipIdRef} className="timeline-tooltip-detail" />
        </div>
        {loading ? (
          <div className="timeline-loading" role="status">
            <span />
            Loading production history…
          </div>
        ) : null}
        {!loading && points.length === 0 && segments.length === 0 ? (
          <div className="timeline-empty">
            No production history in this shift
          </div>
        ) : null}
      </div>
      <div className="timeline-bottom-row">
        <p id={instructionsId} className="timeline-instructions">
          <svg viewBox="0 0 18 18" aria-hidden="true">
            <path d="M5.5 2.5h7v13h-7zM8 5h2M9 11.5v1" />
          </svg>
          Drag a range to zoom
          <span className="timeline-desktop-hint">
            {" "}
            · Double-click to reset
          </span>
        </p>
        <div
          className="timeline-zoom-controls"
          aria-label="Timeline zoom controls"
        >
          <button
            type="button"
            onClick={() => changeZoom(0.5)}
            disabled={loading || range.to - range.from <= minimumSpan}
            aria-label="Zoom in"
          >
            <span aria-hidden="true">+</span>Zoom in
          </button>
          <button
            type="button"
            onClick={() => changeZoom(2)}
            disabled={loading || !isZoomed}
            aria-label="Zoom out"
          >
            <span aria-hidden="true">−</span>Zoom out
          </button>
          <button
            type="button"
            className="timeline-reset"
            onClick={() => setZoom(null)}
            disabled={loading || !isZoomed}
          >
            Reset zoom
          </button>
        </div>
      </div>
      <p id={summaryId} className="timeline-sr-only">
        Production chart from {tooltipTime.format(range.from)} to{" "}
        {tooltipTime.format(range.to)} IST. {number.format(points.length)}{" "}
        {individual ? "individual produce" : "hourly bucket"} markers, including{" "}
        {number.format(prepared.failures)} failure markers. Circles indicate
        PASS and red crosses indicate FAIL. Colored bands show machine state.
        All failure markers are retained at every zoom level.
      </p>
      <span
        ref={announcementRef}
        className="timeline-sr-only"
        aria-live="polite"
        aria-atomic="true"
      />
    </div>
  );
}

export default memo(TimelineChart);
