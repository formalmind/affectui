"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

/*
 * Metrics Dashboard – a compact sales overview, in a single self-contained file.
 * A period switch and four KPI cards that pick the charted metric; one chart that switches between a
 * dotted line and bars, with an optional previous-period comparison and a hover / keyboard tooltip;
 * top products and sales channels below.
 * Figures count to their new values and the chart redraws when the range or metric changes.
 * The layout follows the block's own width. The styles are injected below, no extra files needed.
 */

export type MetricKey = "revenue" | "orders" | "aov" | "refunds";
export type RangeKey = "7d" | "30d" | "90d";

export type MetricsDashboardProps = {
  /** Title in the bar on top */
  title?: string;
  /** Site or workspace shown under the title */
  site?: string;
  /** Range to start on */
  defaultRange?: RangeKey;
  /** Metric to start on */
  defaultMetric?: MetricKey;
  /** Called when Export is pressed, with the current range and metric */
  onExport?: (range: RangeKey, metric: MetricKey) => void;
  className?: string;
};

const RANGES: { key: RangeKey; label: string; days: number }[] = [
  { key: "7d", label: "Week", days: 7 },
  { key: "30d", label: "Month", days: 30 },
  { key: "90d", label: "Quarter", days: 90 },
];

type MetricMeta = {
  key: MetricKey;
  label: string;
  /** "rate" changes are shown in points, the others in percent */
  kind: "count" | "money" | "rate";
  /** Averages and rates zoom the axis around their values instead of starting at zero */
  zoom: boolean;
  goodWhen: "up" | "down";
};

const METRICS: MetricMeta[] = [
  { key: "revenue", label: "Revenue", kind: "money", zoom: false, goodWhen: "up" },
  { key: "orders", label: "Orders", kind: "count", zoom: false, goodWhen: "up" },
  { key: "aov", label: "Avg. order", kind: "money", zoom: true, goodWhen: "up" },
  { key: "refunds", label: "Refund rate", kind: "rate", zoom: true, goodWhen: "down" },
];

const PRODUCTS: [string, number][] = [
  ["Linen overshirt", 0.22],
  ["Everyday tote", 0.16],
  ["Merino crew", 0.13],
  ["Canvas sneaker", 0.09],
  ["Wool beanie", 0.06],
];
const CHANNELS: [string, number][] = [
  ["Online store", 0.46],
  ["Instagram", 0.21],
  ["Marketplace", 0.14],
  ["Wholesale", 0.11],
  ["Pop-up", 0.05],
];

/* ---------- Sample data: 180 days, so every range has a previous period to compare with ---------- */

type Day = { date: Date; revenue: number; orders: number; refunded: number };

function sampleDays(): Day[] {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Array.from({ length: 180 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (179 - i));
    const trend = 92 + i * 0.32;
    // Shops sell most at the weekend
    const week = [1.22, 0.82, 0.86, 0.9, 0.96, 1.1, 1.3][date.getDay()];
    const orders = Math.round(trend * week * (0.88 + rand() * 0.24));
    const aov = 61 + i * 0.03 + (rand() - 0.5) * 8;
    const revenue = Math.round(orders * aov);
    const refunded = Math.round(orders * (0.026 - i * 0.00003 + (rand() - 0.5) * 0.012));
    return { date, revenue, orders, refunded };
  });
}

type Point = { label: string; value: number; previous: number };

function aggregate(days: Day[], key: MetricKey) {
  const revenue = days.reduce((s, d) => s + d.revenue, 0);
  const orders = days.reduce((a, d) => a + d.orders, 0);
  const refunded = days.reduce((a, d) => a + d.refunded, 0);
  if (key === "revenue") return revenue;
  if (key === "orders") return orders;
  if (key === "aov") return orders ? revenue / orders : 0;
  return orders ? (refunded / orders) * 100 : 0;
}

const dayLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Points for the chart: daily for 7 / 30 days, weekly buckets for 90 */
function seriesFor(all: Day[], days: number, key: MetricKey): Point[] {
  const current = all.slice(-days);
  const previous = all.slice(-days * 2, -days);
  const bucket = days > 31 ? 7 : 1;
  const out: Point[] = [];
  for (let i = 0; i < current.length; i += bucket) {
    const cur = current.slice(i, i + bucket);
    const prev = previous.slice(i, i + bucket);
    out.push({ label: dayLabel(cur[0].date), value: aggregate(cur, key), previous: aggregate(prev, key) });
  }
  return out;
}

/* ---------- Formatting ---------- */

const fmt = (key: MetricKey, n: number) =>
  key === "refunds"
    ? `${n.toFixed(1)}%`
    : key === "aov"
      ? `$${n.toFixed(2)}`
      : key === "revenue"
        ? `$${Math.round(n).toLocaleString("en-US")}`
        : Math.round(n).toLocaleString("en-US");

/** Axis labels: "$12K", "140", "2.5%" */
const tickLabel = (key: MetricKey, n: number) => {
  const num = n >= 1000 ? `${+(n / 1000).toFixed(1)}K` : `${+n.toFixed(n < 10 ? 1 : 0)}`;
  return key === "refunds" ? `${num}%` : key === "revenue" || key === "aov" ? `$${num}` : num;
};

/** A round axis maximum with four equal steps */
function niceMax(n: number) {
  const step = Math.pow(10, Math.floor(Math.log10(n / 4)));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= n * 1.08) ?? step * 10;
  return nice * 4;
}

/** Smooth path through the points without overshooting (monotone cubic) */
function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return "";
  const n = pts.length;
  const d: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((pts[i + 1][1] - pts[i][1]) / (pts[i + 1][0] - pts[i][0]));
  m.push(d[0]);
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2);
  m.push(d[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    path += `C${x0 + dx},${y0 + m[i] * dx} ${x1 - dx},${y1 - m[i + 1] * dx} ${x1},${y1}`;
  }
  return path;
}

/** Counts from the last shown value to the new one */
function useCountUp(target: number, ms = 600) {
  const [value, setValue] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = a + (target - a) * eased;
      from.current = v;
      setValue(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return value;
}

/* ---------- Block ---------- */

const W = 600;
const H = 200;

export function MetricsDashboard({
  title = "Sales",
  site = "Northwind Store",
  defaultRange = "30d",
  defaultMetric = "revenue",
  onExport,
  className,
}: MetricsDashboardProps) {
  const uid = "ui-md" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const all = useMemo(sampleDays, []);
  const [range, setRange] = useState<RangeKey>(defaultRange);
  const [metric, setMetric] = useState<MetricKey>(defaultMetric);
  const [compare, setCompare] = useState(false);
  const [chart, setChart] = useState<"line" | "bars">("line");
  const [hover, setHover] = useState<number | null>(null);
  const [exported, setExported] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);

  const days = RANGES.find((r) => r.key === range)!.days;
  const current = all.slice(-days);
  const previous = all.slice(-days * 2, -days);
  const points = useMemo(() => seriesFor(all, days, metric), [all, days, metric]);
  const meta = METRICS.find((m) => m.key === metric)!;

  // Totals start at zero; averages and rates zoom in around their values, so small changes stay visible.
  // Bars always start at zero – a bar that starts mid-air reads wrong.
  const shownValues = points.flatMap((p) => (compare ? [p.value, p.previous] : [p.value]));
  const [lo, max] = (() => {
    if (!meta.zoom || chart === "bars") return [0, niceMax(Math.max(...shownValues))];
    const minV = Math.min(...shownValues);
    const maxV = Math.max(...shownValues);
    const pad = Math.max((maxV - minV) * 0.8, maxV * 0.02);
    const raw = (maxV + pad - Math.max(0, minV - pad)) / 4;
    const step = raw >= 1 ? Math.ceil(raw) : Math.ceil(raw * 10) / 10;
    const a = Math.max(0, Math.floor((minV - pad) / step) * step);
    return [a, a + step * 4];
  })();
  const yOf = (v: number) => (v - lo) / (max - lo);
  const xy = (i: number, v: number): [number, number] => [(i / (points.length - 1)) * W, H - yOf(v) * H];
  const line = smoothPath(points.map((p, i) => xy(i, p.value)));
  const prevLine = smoothPath(points.map((p, i) => xy(i, p.previous)));
  const area = `${line}L${W},${H}L0,${H}Z`;
  const ticks = [0, 1, 2, 3, 4].map((t) => lo + ((max - lo) / 4) * t);
  const labelEvery = Math.ceil(points.length / 6);
  // Guards the render between a range change and the effect that clears the hover
  const active = hover !== null && hover < points.length ? hover : null;
  const revenueTotal = aggregate(current, "revenue");
  const pct = (i: number) => (i / (points.length - 1)) * 100;
  // Bars sit in equal slots; the line runs edge to edge
  const slot = 100 / points.length;
  const xPct = (i: number) => (chart === "bars" ? slot * (i + 0.5) : pct(i));

  useEffect(() => setHover(null), [range, metric, chart]);

  const pickFromPointer = (clientX: number) => {
    const el = plotRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left) / r.width;
    const i = chart === "bars" ? Math.floor(t * points.length) : Math.round(t * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, i)));
  };

  const onChartKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const cur = hover ?? last;
    const next =
      e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setHover(Math.max(0, Math.min(last, next)));
  };

  const rangeIndex = RANGES.findIndex((r) => r.key === range);

  return (
    <div className={["ui-md", className].filter(Boolean).join(" ")}>
      <style href="ui-metrics-dashboard" precedence="default">
        {css}
      </style>

      {/* Bar on the gray tray */}
      <div className="ui-md__bar">
        <div className="ui-md__heading">
          <span className="ui-md__title">{title}</span>
          <span className="ui-md__site">
            {site} · Last {days} days
          </span>
        </div>
        <div className="ui-md__actions">
          <div className="ui-md__range" role="group" aria-label="Period">
            <span className="ui-md__range-thumb" aria-hidden="true" style={{ transform: `translateX(${rangeIndex * 100}%)` }} />
            {RANGES.map((r) => (
              <button key={r.key} type="button" aria-pressed={range === r.key} onClick={() => setRange(r.key)}>
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ui-md__export"
            onClick={() => {
              onExport?.(range, metric);
              setExported(true);
              window.setTimeout(() => setExported(false), 1600);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {exported ? <path d="m5 12.5 4.5 4.5L19 7.5" /> : <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" />}
            </svg>
            <span aria-live="polite">{exported ? "Exported" : "Export"}</span>
          </button>
        </div>
      </div>

      {/* KPI cards on the tray pick the charted metric – the chosen one in full, the others dimmed */}
      <div className="ui-md__kpis" role="tablist" aria-label="Metric">
          {METRICS.map((m) => (
            <Kpi
              key={m.key}
              meta={m}
              selected={metric === m.key}
              value={aggregate(current, m.key)}
              before={aggregate(previous, m.key)}
              onSelect={() => setMetric(m.key)}
            />
          ))}
      </div>

      <div className="ui-md__card">
        <div className="ui-md__chart">
          <div className="ui-md__chart-head">
            <span className="ui-md__legend">
              <i aria-hidden="true" />
              {meta.label}
            </span>
            <div className="ui-md__chart-tools">
            <div className="ui-md__kind" role="group" aria-label="Chart type">
              <span className="ui-md__kind-thumb" aria-hidden="true" style={{ transform: chart === "bars" ? "translateX(100%)" : undefined }} />
              <button type="button" aria-pressed={chart === "line"} aria-label="Line chart" onClick={() => setChart("line")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3.5 16.5 9 11l4 3.5 7.5-8" />
                  <circle cx="9" cy="11" r="1.6" />
                  <circle cx="13" cy="14.5" r="1.6" />
                </svg>
              </button>
              <button type="button" aria-pressed={chart === "bars"} aria-label="Bar chart" onClick={() => setChart("bars")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5.5 19.5v-6M10 19.5V8M14.5 19.5v-9M19 19.5V5" />
                </svg>
              </button>
            </div>
            <label className="ui-md__compare">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
              <span className="ui-md__switch" aria-hidden="true" />
              Compare to previous period
            </label>
            </div>
          </div>

          <div className="ui-md__plot-wrap">
            <div className="ui-md__axis" aria-hidden="true">
              {[...ticks].reverse().map((t) => (
                <span key={t}>{tickLabel(metric, t)}</span>
              ))}
            </div>
            <div
              ref={plotRef}
              className="ui-md__plot"
              tabIndex={0}
              role="img"
              aria-label={`${meta.label} over the last ${days} days, from ${fmt(metric, points[0].value)} to ${fmt(metric, points[points.length - 1].value)}. Use the arrow keys to inspect points.`}
              onPointerMove={(e) => e.pointerType === "mouse" && pickFromPointer(e.clientX)}
              onPointerDown={(e) => pickFromPointer(e.clientX)}
              onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
              onKeyDown={onChartKey}
              onBlur={() => setHover(null)}
            >
              <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" className="ui-md__area-a" />
                    <stop offset="100%" className="ui-md__area-b" />
                  </linearGradient>
                </defs>
                {ticks.map((t) => (
                  <line key={t} className={t === lo ? "ui-md__base" : "ui-md__grid"} x1="0" x2={W} y1={H - yOf(t) * H} y2={H - yOf(t) * H} />
                ))}
                {/* Key restarts the draw-in when range, metric or chart type change */}
                {chart === "line" && (
                  <g key={`${range}-${metric}`} className="ui-md__series">
                    <path className="ui-md__area" d={area} fill={`url(#${uid}-area)`} />
                    {compare && <path className="ui-md__prev" d={prevLine} />}
                    <path className="ui-md__line" d={line} />
                  </g>
                )}
                {active !== null && chart === "line" && <line className="ui-md__guide" x1={xy(active, 0)[0]} x2={xy(active, 0)[0]} y1="0" y2={H} />}
              </svg>

              {/* Line: a dot on every point, lined up with the dates below */}
              {chart === "line" && (
                <div key={`dots-${range}-${metric}`} className="ui-md__dots" aria-hidden="true">
                  {points.map((p, i) => (
                    <span key={i} style={{ left: `${pct(i)}%`, top: `${(1 - yOf(p.value)) * 100}%`, animationDelay: `${(i / points.length) * 700}ms` }} />
                  ))}
                </div>
              )}

              {/* Bars: one per point, the previous period as a ghost bar beside it */}
              {chart === "bars" && (
                <div key={`bars-${range}-${metric}`} className="ui-md__bars" data-compare={compare ? "" : undefined} aria-hidden="true">
                  {points.map((p, i) => (
                    <div key={i} className="ui-md__bar-slot" data-active={active === i ? "" : undefined} style={{ ["--d" as string]: `${(i / points.length) * 400}ms` }}>
                      {compare && <span className="ui-md__col ui-md__col--prev" style={{ height: `${yOf(p.previous) * 100}%` }} />}
                      <span className="ui-md__col" style={{ height: `${yOf(p.value) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )}

              {active !== null && (
                <>
                  {chart === "line" && compare && (
                    <span
                      className="ui-md__dot ui-md__dot--prev"
                      style={{ left: `${pct(active)}%`, top: `${(1 - yOf(points[active].previous)) * 100}%` }}
                    />
                  )}
                  {chart === "line" && (
                    <span className="ui-md__dot" style={{ left: `${pct(active)}%`, top: `${(1 - yOf(points[active].value)) * 100}%` }} />
                  )}
                  <div
                    className="ui-md__tip"
                    role="status"
                    data-side={active > (points.length - 1) / 2 ? "left" : "right"}
                    style={{ left: `${xPct(active)}%` }}
                  >
                    <span className="ui-md__tip-date">
                      {days > 31 ? `Week of ${points[active].label}` : points[active].label}
                    </span>
                    <span className="ui-md__tip-row">
                      <i aria-hidden="true" />
                      {meta.label}
                      <b>{fmt(metric, points[active].value)}</b>
                    </span>
                    {compare && (
                      <span className="ui-md__tip-row ui-md__tip-row--prev">
                        <i aria-hidden="true" />
                        Previous
                        <b>{fmt(metric, points[active].previous)}</b>
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="ui-md__dates" aria-hidden="true">
              {points.map((p, i) =>
                i % labelEvery === 0 ? (
                  <span
                    key={i}
                    data-start={chart === "line" && i === 0 ? "" : undefined}
                    data-end={xPct(i) > 88 ? "" : undefined}
                    style={{ left: `${xPct(i)}%` }}
                  >
                    {p.label}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <div className="ui-md__lists">
          <List title="Top products" rows={PRODUCTS} total={revenueTotal} />
          <List title="Channels" rows={CHANNELS} total={revenueTotal} />
        </div>
      </div>
    </div>
  );
}

function Kpi({
  meta,
  selected,
  value,
  before,
  onSelect,
}: {
  meta: MetricMeta;
  selected: boolean;
  value: number;
  before: number;
  onSelect: () => void;
}) {
  const shown = useCountUp(value);
  const rate = meta.kind === "rate";
  const change = rate ? value - before : before ? ((value - before) / before) * 100 : 0;
  const up = change >= 0;
  const good = (up ? "up" : "down") === meta.goodWhen;
  const text = rate ? `${Math.abs(change).toFixed(1)} pts` : `${Math.abs(change).toFixed(1)}%`;
  return (
    <button type="button" role="tab" aria-selected={selected} className="ui-md__kpi" onClick={onSelect}>
      <span className="ui-md__kpi-label">{meta.label}</span>
      <span className="ui-md__kpi-value">{fmt(meta.key, shown)}</span>
      <span className="ui-md__delta" data-good={good ? "" : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: up ? undefined : "rotate(180deg)" }}>
          <path d="M7 14.5 12 9.5l5 5" />
        </svg>
        {text}
        <span className="ui-md__sr"> {up ? "up" : "down"} versus the previous period</span>
      </span>
    </button>
  );
}

function List({ title, rows, total }: { title: string; rows: [string, number][]; total: number }) {
  const top = rows[0][1];
  return (
    <div className="ui-md__list">
      <div className="ui-md__list-head">
        <span>{title}</span>
        <span>Revenue</span>
      </div>
      <ul>
        {rows.map(([name, share]) => (
          <ListRow key={name} name={name} value={total * share} width={(share / top) * 100} />
        ))}
      </ul>
    </div>
  );
}

function ListRow({ name, value, width }: { name: string; value: number; width: number }) {
  const shown = useCountUp(value);
  return (
    <li className="ui-md__row">
      <span className="ui-md__row-bar" style={{ width: `${width}%` }} aria-hidden="true" />
      <span className="ui-md__row-name">{name}</span>
      <span className="ui-md__row-value">${Math.round(shown).toLocaleString("en-US")}</span>
    </li>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-md {
  --ui-md-tray: #f0f0f0;
  --ui-md-card: #ffffff;
  --ui-md-card-line: #e5e5e5;
  --ui-md-line: #ececec;
  --ui-md-ink: #171717;
  --ui-md-text: #404040;
  --ui-md-muted: #8f8f8f;
  --ui-md-accent: #2f6bff;
  --ui-md-area: rgba(47, 107, 255, 0.16);
  --ui-md-prev: #b5b5b5;
  --ui-md-good: #1f8a4c;
  --ui-md-good-bg: #e9f6ee;
  --ui-md-bad: #d92d5c;
  --ui-md-bad-bg: #fdecf1;
  --ui-md-bar: #f3f6ff;
  --ui-md-chip: #ffffff;
  --ui-md-thumb: #ffffff;
  --ui-md-hover: rgba(0, 0, 0, 0.04);
  --ui-md-tip: #171717;
  --ui-md-tip-text: #ffffff;
  --ui-md-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  --ui-md-ease: cubic-bezier(0.65, 0, 0.25, 1);
  --ui-md-spring: cubic-bezier(0.34, 1.3, 0.64, 1);
  container-type: inline-size;
  padding: 0 6px 6px;
  border-radius: 24px;
  background: var(--ui-md-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-md-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-md *, .ui-md *::before, .ui-md *::after { box-sizing: border-box; }
.ui-md button { font: inherit; color: inherit; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-md :focus-visible { outline: 2px solid var(--ui-md-accent); outline-offset: 2px; }
.ui-md__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ---------- Bar ---------- */

.ui-md__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 8px 12px 14px;
}
.ui-md__heading { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ui-md__title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.ui-md__site { font-size: 12.5px; color: var(--ui-md-muted); white-space: nowrap; }
.ui-md__actions { display: flex; align-items: center; gap: 8px; }

.ui-md__range {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, 64px);
  padding: 3px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.05);
}
.ui-md__range-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 64px;
  height: calc(100% - 6px);
  border-radius: 7px;
  background: var(--ui-md-thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04);
  transition: transform 420ms var(--ui-md-spring);
}
.ui-md__range button {
  position: relative;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ui-md-muted);
  transition: color 200ms ease;
}
.ui-md__range button[aria-pressed="true"] { color: var(--ui-md-ink); }

.ui-md__export {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 12px 0 10px;
  border: 0;
  border-radius: 10px;
  background: var(--ui-md-chip);
  box-shadow: 0 0 0 1px var(--ui-md-card-line), var(--ui-md-shadow);
  font-size: 13px;
  font-weight: 500;
  transition: background-color 160ms ease;
}
.ui-md__export:hover { background: color-mix(in srgb, var(--ui-md-chip) 92%, var(--ui-md-ink)); }
.ui-md__export svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* ---------- Card ---------- */

.ui-md__card {
  overflow: hidden;
  border: 1px solid var(--ui-md-card-line);
  border-radius: 20px;
  background: var(--ui-md-card);
  box-shadow: var(--ui-md-shadow);
}

/* KPI cards: their own rounded fields on the tray; the chosen one in full, the others dimmed */
.ui-md__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 6px;
}
.ui-md__kpi {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
  padding: 14px 16px 13px;
  border: 1px solid var(--ui-md-card-line);
  border-radius: 16px;
  background: var(--ui-md-card);
  box-shadow: var(--ui-md-shadow);
  text-align: left;
  opacity: 0.5;
  filter: saturate(0.2);
  transition: opacity 260ms ease, filter 260ms ease, transform 260ms var(--ui-md-spring);
}
.ui-md__kpi:hover { opacity: 0.8; }
.ui-md__kpi[aria-selected="true"] { opacity: 1; filter: none; }
.ui-md__kpi:active { transform: scale(0.98); }
.ui-md__kpi-label { font-size: 12.5px; color: var(--ui-md-text); }
.ui-md__kpi-value {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}
.ui-md__delta {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
  padding: 0 7px 0 4px;
  border-radius: 999px;
  background: var(--ui-md-bad-bg);
  font-size: 11.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--ui-md-bad);
}
.ui-md__delta[data-good] { background: var(--ui-md-good-bg); color: var(--ui-md-good); }
.ui-md__delta svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* Chart */
.ui-md__chart { padding: 16px 18px 12px; border-bottom: 1px solid var(--ui-md-line); }
.ui-md__chart-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.ui-md__legend { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 500; color: var(--ui-md-text); }
.ui-md__legend i { width: 14px; height: 2.5px; border-radius: 2px; background: var(--ui-md-accent); }
.ui-md__chart-tools { display: flex; align-items: center; gap: 14px; }
.ui-md__kind {
  position: relative;
  display: grid;
  grid-template-columns: 30px 30px;
  padding: 2px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.05);
}
.ui-md__kind-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 30px;
  height: calc(100% - 4px);
  border-radius: 7px;
  background: var(--ui-md-thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04);
  transition: transform 380ms var(--ui-md-spring);
}
.ui-md__kind button {
  position: relative;
  display: grid;
  place-items: center;
  height: 24px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-md-muted);
  transition: color 200ms ease;
}
.ui-md__kind button[aria-pressed="true"] { color: var(--ui-md-ink); }
.ui-md__kind svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.ui-md__kind circle { fill: var(--ui-md-thumb); }
.ui-md__compare { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ui-md-muted); cursor: pointer; user-select: none; }
.ui-md__compare input { position: absolute; opacity: 0; pointer-events: none; }
.ui-md__switch {
  position: relative;
  width: 28px;
  height: 16px;
  border-radius: 999px;
  background: #d9d9d9;
  transition: background-color 200ms ease;
}
.ui-md__switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 300ms var(--ui-md-spring);
}
.ui-md__compare input:checked + .ui-md__switch { background: var(--ui-md-accent); }
.ui-md__compare input:checked + .ui-md__switch::after { transform: translateX(12px); }
.ui-md__compare input:focus-visible + .ui-md__switch { outline: 2px solid var(--ui-md-accent); outline-offset: 2px; }

.ui-md__plot-wrap {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: 200px auto;
  column-gap: 10px;
}
.ui-md__axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  margin: -7px 0;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ui-md-muted);
}
.ui-md__plot { position: relative; outline-offset: 4px; border-radius: 4px; touch-action: pan-y; }
.ui-md__plot svg { display: block; width: 100%; height: 100%; overflow: visible; }
.ui-md__grid { stroke: var(--ui-md-line); stroke-width: 1; stroke-dasharray: 3 4; vector-effect: non-scaling-stroke; }
.ui-md__base { stroke: var(--ui-md-line); stroke-width: 1; vector-effect: non-scaling-stroke; }
.ui-md__area-a { stop-color: var(--ui-md-area); }
.ui-md__area-b { stop-color: var(--ui-md-area); stop-opacity: 0; }
/* Line and area are revealed left to right when range or metric change */
.ui-md__series { animation: ui-md-reveal 900ms var(--ui-md-ease) both; }
.ui-md__line {
  fill: none;
  stroke: var(--ui-md-accent);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.ui-md__prev {
  fill: none;
  stroke: var(--ui-md-prev);
  stroke-width: 1.5;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
  animation: ui-md-fade 400ms ease both;
}
/* Dots on the line */
.ui-md__dots { position: absolute; inset: 0; pointer-events: none; }
.ui-md__dots span {
  position: absolute;
  width: 7px;
  height: 7px;
  margin: -3.5px 0 0 -3.5px;
  border: 1.5px solid var(--ui-md-accent);
  border-radius: 50%;
  background: var(--ui-md-card);
  animation: ui-md-pop 360ms var(--ui-md-spring) both;
}
/* Bars */
.ui-md__bars {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  pointer-events: none;
}
.ui-md__bar-slot {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  height: 100%;
}
.ui-md__col {
  width: 56%;
  max-width: 22px;
  border-radius: 5px 5px 2px 2px;
  background: linear-gradient(180deg, var(--ui-md-accent), color-mix(in srgb, var(--ui-md-accent) 55%, var(--ui-md-card)));
  transform-origin: bottom;
  animation: ui-md-grow 620ms var(--ui-md-ease) both;
  animation-delay: var(--d);
  transition: opacity 200ms ease;
}
.ui-md__bars[data-compare] .ui-md__col { width: 34%; max-width: 12px; }
.ui-md__col--prev { background: var(--ui-md-prev); opacity: 0.55; }
.ui-md__bars:has([data-active]) .ui-md__bar-slot:not([data-active]) .ui-md__col { opacity: 0.45; }
.ui-md__guide { stroke: var(--ui-md-muted); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; vector-effect: non-scaling-stroke; }
.ui-md__dot {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border: 2px solid var(--ui-md-card);
  border-radius: 50%;
  background: var(--ui-md-accent);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  pointer-events: none;
}
.ui-md__dot--prev { background: var(--ui-md-prev); }
.ui-md__tip {
  position: absolute;
  top: 6px;
  z-index: 2;
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 9px 11px;
  border-radius: 10px;
  background: var(--ui-md-tip);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  font-size: 12px;
  color: var(--ui-md-tip-text);
  pointer-events: none;
}
.ui-md__tip[data-side="right"] { transform: translateX(14px); }
.ui-md__tip[data-side="left"] { transform: translateX(calc(-100% - 14px)); }
.ui-md__tip-date { font-size: 11.5px; opacity: 0.6; }
.ui-md__tip-row { display: flex; align-items: center; gap: 7px; }
.ui-md__tip-row i { width: 8px; height: 8px; border-radius: 50%; background: var(--ui-md-accent); }
.ui-md__tip-row--prev i { background: var(--ui-md-prev); }
.ui-md__tip-row b { margin-left: auto; padding-left: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ui-md__dates { position: relative; grid-column: 2; height: 26px; font-size: 11px; color: var(--ui-md-muted); }
.ui-md__dates span { position: absolute; top: 9px; transform: translateX(-50%); white-space: nowrap; }
.ui-md__dates span[data-start] { transform: none; }
.ui-md__dates span[data-end] { transform: translateX(-100%); }

/* Lists */
.ui-md__lists { display: grid; grid-template-columns: 1fr 1fr; }
.ui-md__list { min-width: 0; padding: 14px 12px 12px; }
.ui-md__list + .ui-md__list { border-left: 1px solid var(--ui-md-line); }
.ui-md__list-head { display: flex; justify-content: space-between; padding: 0 8px 8px; font-size: 12.5px; font-weight: 500; }
.ui-md__list-head span + span { font-weight: 400; color: var(--ui-md-muted); }
.ui-md__list ul { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
.ui-md__row {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
}
.ui-md__row-bar {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 8px;
  background: var(--ui-md-bar);
  transition: width 600ms var(--ui-md-ease);
}
.ui-md__row-name { position: relative; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-md-text); }
.ui-md__row-value { position: relative; font-variant-numeric: tabular-nums; color: var(--ui-md-ink); }

@keyframes ui-md-reveal { from { clip-path: inset(-10% 100% -10% 0); } to { clip-path: inset(-10% -1% -10% 0); } }
@keyframes ui-md-fade { from { opacity: 0; } }
@keyframes ui-md-pop { from { transform: scale(0); } }
@keyframes ui-md-grow { from { transform: scaleY(0); } }

/* ---------- Follows the block's own width ---------- */

@container (max-width: 640px) {
  .ui-md__kpis { grid-template-columns: 1fr 1fr; }
  .ui-md__lists { grid-template-columns: 1fr; }
  .ui-md__list + .ui-md__list { border-left: 0; border-top: 1px solid var(--ui-md-line); }
  .ui-md__compare { font-size: 0; gap: 0; }
  .ui-md__compare::after { content: "Compare"; font-size: 12.5px; margin-left: 8px; }
}
@container (max-width: 460px) {
  .ui-md__bar { flex-wrap: wrap; padding: 12px 4px 12px 10px; }
  .ui-md__actions { width: 100%; }
  .ui-md__range { flex: 1; grid-template-columns: repeat(3, 1fr); }
  .ui-md__range-thumb { width: calc((100% - 6px) / 3); }
  .ui-md__kpi { padding: 12px 14px; }
  .ui-md__kpi-value { font-size: 20px; }
  .ui-md__chart { padding: 14px 12px 10px; }
  .ui-md__plot-wrap { grid-template-rows: 168px auto; }
  /* Fewer date labels so they don't run into each other */
  .ui-md__dates span:nth-child(even) { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-md__range-thumb, .ui-md__kind-thumb, .ui-md__kpi, .ui-md__row-bar, .ui-md__switch::after { transition: none; }
  .ui-md__series, .ui-md__prev, .ui-md__dots span, .ui-md__col { animation: none; }
}


/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-md input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-md textarea:focus-visible,
.ui-md [contenteditable]:focus-visible { outline: none; }
/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-md {
  --ui-md-tray: #161618;
  --ui-md-card: #232326;
  --ui-md-card-line: rgba(255, 255, 255, 0.08);
  --ui-md-line: rgba(255, 255, 255, 0.07);
  --ui-md-ink: #ededed;
  --ui-md-text: #c4c4c4;
  --ui-md-muted: #8f8f8f;
  --ui-md-accent: #4d82ff;
  --ui-md-area: rgba(77, 130, 255, 0.2);
  --ui-md-prev: #5c5c61;
  --ui-md-good: #3fbf74;
  --ui-md-good-bg: rgba(63, 191, 116, 0.14);
  --ui-md-bad: #f2777b;
  --ui-md-bad-bg: rgba(242, 119, 123, 0.14);
  --ui-md-bar: rgba(77, 130, 255, 0.12);
  --ui-md-chip: #2a2a2d;
  --ui-md-thumb: #313135;
  --ui-md-hover: rgba(255, 255, 255, 0.04);
  --ui-md-tip: #ededed;
  --ui-md-tip-text: #121213;
  --ui-md-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
:where(.dark, [data-theme="dark"]) .ui-md__range,
:where(.dark, [data-theme="dark"]) .ui-md__kind { background: rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) .ui-md__switch { background: #3a3a3e; }
`;
