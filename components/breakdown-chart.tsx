"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

/*
 * Breakdown Chart – a stacked bar chart with a linked table, in a single self-contained file.
 * Pick what to measure, how to slice the bars and how to segment them; hover a bar or a row to see its breakdown,
 * click legend entries to hide segments. The styles are injected below, so no extra files are needed.
 */

export type Dimension = {
  key: string;
  label: string;
  /** Values in display order */
  values: string[];
  /** Colors per value, used when this dimension segments the bars */
  colors?: Record<string, string>;
  /** Small icon per value, shown under the bars and in the table */
  icons?: Record<string, ReactNode>;
};

export type Measure = {
  key: string;
  label: string;
  /** Unit after the total, e.g. "tasks" or "points" */
  unit: string;
  /** Field to sum – leave empty to count records */
  field?: string;
};

export type BreakdownRecord = Record<string, string | number>;

export type BreakdownChartProps = {
  records: BreakdownRecord[];
  dimensions: Dimension[];
  measures: Measure[];
  title?: string;
  defaultMeasure?: string;
  defaultSlice?: string;
  /** Dimension key, or "none" for single-color bars */
  defaultSegment?: string;
  className?: string;
};

const palette = ["#2f6bff", "#8b5cf6", "#ec4899", "#7aa2ff", "#c4b5fd", "#a3a3a3", "#f9a8d4"];

/** A clean axis top: 10, 20, 50, 100 … split into five steps */
function niceMax(max: number) {
  if (max <= 0) return 5;
  const raw = max / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * pow >= raw)! * pow;
  return step * 5;
}

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
/** 12,345,678.9 – with separators, and a tiny value as <0.1 instead of 0 */
const fmt = (n: number) => (n > 0 && n < 0.05 ? "<0.1" : whole.format(n));
/** The scale on the right is narrow: 12.5M instead of 12,500,000 */
const fmtTick = (n: number) => compact.format(n);
/** Infinity, NaN and text count as 0, so one broken record can't break the whole chart */
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function BreakdownChart({
  records,
  dimensions,
  measures,
  title = "Workload",
  defaultMeasure,
  defaultSlice,
  defaultSegment,
  className,
}: BreakdownChartProps) {
  const [measureKey, setMeasure] = useState(defaultMeasure ?? measures[0]?.key ?? "");
  const [sliceKey, setSlice] = useState(defaultSlice ?? dimensions[0]?.key ?? "");
  const [segmentKey, setSegment] = useState(defaultSegment ?? dimensions[1]?.key ?? "none");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const morphRef = useSmoothHeight(tableRef);
  const plotRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  const measure = measures.find((m) => m.key === measureKey) ?? measures[0];
  const slice = dimensions.find((d) => d.key === sliceKey) ?? dimensions[0];
  // An unknown key, or the same dimension as the slice, means no segments
  const segment = segmentKey === "none" ? null : dimensions.find((d) => d.key === segmentKey && d.key !== slice?.key) ?? null;
  const segValues = segment ? segment.values : ["All"];
  const color = (v: string, i: number) => segment?.colors?.[v] ?? (segment ? palette[i % palette.length] : "#2f6bff");

  // Reset hidden segments when the segmentation changes
  useEffect(() => setHidden(new Set()), [segmentKey]);

  /** value per slice and segment */
  const table = useMemo(() => {
    if (!slice || !measure) return [];
    const rows = slice.values.map((sv) => {
      const cells: Record<string, number> = {};
      for (const seg of segValues) cells[seg] = 0;
      for (const r of records) {
        // Numbers match their label too: 2024 counts for "2024"
        if (String(r[slice.key]) !== sv) continue;
        const seg = segment ? String(r[segment.key]) : "All";
        if (!(seg in cells)) continue;
        cells[seg] += measure.field ? num(r[measure.field]) : 1;
      }
      const total = segValues.reduce((sum, seg) => sum + (hidden.has(seg) ? 0 : cells[seg]), 0);
      return { value: sv, cells, total };
    });
    return rows;
  }, [records, slice, segment, segValues, measure, hidden]);

  const grand = table.reduce((s, r) => s + r.total, 0);
  const max = niceMax(Math.max(0, ...table.map((r) => r.total)));
  const ticks = [5, 4, 3, 2, 1, 0].map((i) => (max / 5) * i);
  const hovered = table.find((r) => r.value === hover) ?? null;
  const hoverIndex = hovered ? table.indexOf(hovered) : -1;

  // The breakdown sits beside its bar, but always inside the white card – and so does the hovered bar's name
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const tip = tipRef.current;
    if (!plot || hoverIndex < 0) return;
    const card = (plot.closest(".ui-bc__card") ?? plot.closest("section")!).getBoundingClientRect();
    const box = plot.getBoundingClientRect();
    const at = ((hoverIndex + 0.5) / table.length) * box.width;
    if (tip) {
      const w = tip.offsetWidth;
      const x = (hoverIndex + 0.5) / table.length > 0.5 ? at - 22 - w : at + 22;
      tip.style.left = `${Math.max(card.left - box.left + 4, Math.min(x, card.right - box.left - 4 - w))}px`;
    }
    const pill = plot.parentElement?.querySelector<HTMLElement>(".ui-bc__xlabel[data-active] .ui-bc__pill");
    if (pill) {
      const half = pill.offsetWidth / 2;
      const center = box.left + at;
      const shift = Math.max(card.left + 4 + half - center, Math.min(0, card.right - 4 - half - center));
      pill.style.marginLeft = `${shift}px`;
    }
  });

  const toggle = (seg: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(seg)) next.delete(seg);
      else if (next.size < segValues.length - 1) next.add(seg);
      return next;
    });

  const dimensionOptions = dimensions.map((d) => ({ value: d.key, label: d.label }));

  // Without a measure or a dimension there is nothing to chart
  if (!measure || !slice) return null;

  return (
    <>
      <style href="ui-breakdown-chart" precedence="default">
        {css}
      </style>
      <section className={["ui-bc", className].filter(Boolean).join(" ")} aria-label={title}>
        <header className="ui-bc__head">
          <span className="ui-bc__title" dir="auto" title={title}>
            {title}
          </span>
          <span className="ui-bc__total">
            <strong>{fmt(grand)}</strong> {measure.unit}
          </span>
        </header>

        <div className="ui-bc__card">
          <div className="ui-bc__controls">
            <Select label="Measure" value={measure.key} onChange={setMeasure} options={measures.map((m) => ({ value: m.key, label: m.label }))} />
            <Select
              label="Slice"
              value={slice.key}
              onChange={(v) => {
                setSlice(v);
                if (v === segmentKey) setSegment("none");
              }}
              options={dimensionOptions}
            />
            <Select
              label="Segment"
              value={segment?.key ?? "none"}
              onChange={setSegment}
              options={[{ value: "none", label: "None" }, ...dimensionOptions.filter((o) => o.value !== sliceKey)]}
            />
          </div>

          <div className="ui-bc__chart" onPointerLeave={() => setHover(null)}>
            <div className="ui-bc__plot" ref={plotRef}>
              {ticks.map((t) => (
                <span key={t} className="ui-bc__grid" style={{ bottom: `${(t / max) * 100}%` }} data-zero={t === 0 || undefined}>
                  <span className="ui-bc__tick">{fmtTick(t)}</span>
                </span>
              ))}
              <div className="ui-bc__bars" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
                {table.map((row, ri) => (
                  <button
                    key={ri}
                    type="button"
                    className="ui-bc__col"
                    data-dim={(hover && hover !== row.value) || undefined}
                    data-active={hover === row.value || undefined}
                    aria-label={`${row.value}: ${fmt(row.total)} ${measure.unit}`}
                    onPointerEnter={() => setHover(row.value)}
                    onFocus={() => setHover(row.value)}
                    onBlur={() => setHover(null)}
                  >
                    {/* The empty part above the bar – only shown for the hovered bar */}
                    {/* A negative total draws no bar – the table still shows it */}
                    <span className="ui-bc__rest" style={{ bottom: `${(Math.max(0, row.total) / max) * 100}%` }} />
                    <span className="ui-bc__bar" style={{ height: `${(Math.max(0, row.total) / max) * 100}%` }}>
                      {segValues.map((seg, i) =>
                        hidden.has(seg) || !(row.cells[seg] > 0) ? null : (
                          <span
                            key={i}
                            className="ui-bc__seg"
                            style={{ flexGrow: row.cells[seg], background: color(seg, i) }}
                          />
                        ),
                      )}
                    </span>
                  </button>
                ))}
              </div>

              {hovered && (
                <div
                  ref={tipRef}
                  className="ui-bc__tooltip"
                  role="status"
                  data-side={(hoverIndex + 0.5) / table.length > 0.5 ? "left" : "right"}
                >
                  <p className="ui-bc__tip-head">
                    <span className="ui-bc__tip-label">
                      {slice.icons?.[hovered.value]}
                      <span dir="auto">{hovered.value}</span>
                    </span>
                    <strong>{fmt(hovered.total)}</strong>
                  </p>
                  {segment && (
                    <ul>
                      {segValues
                        .map((seg, i) => ({ seg, i, v: hovered.cells[seg] }))
                        .filter((x) => x.v && !hidden.has(x.seg))
                        .sort((a, b) => b.v - a.v)
                        .map((x) => (
                          <li key={x.i}>
                            <span className="ui-bc__swatch" style={{ background: color(x.seg, x.i) }} />
                            <span className="ui-bc__tip-seg" dir="auto">
                              {x.seg}
                            </span>
                            <span>{fmt(x.v)}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="ui-bc__xaxis" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
              {table.map((row, ri) => (
                <span key={ri} className="ui-bc__xlabel" data-active={hover === row.value || undefined} title={row.value}>
                  {hover === row.value ? (
                    <span className="ui-bc__pill">
                      {slice.icons?.[row.value]}
                      <span dir="auto">{row.value}</span>
                    </span>
                  ) : (
                    slice.icons?.[row.value] ?? (
                      <span className="ui-bc__xtext" dir="auto">
                        {row.value}
                      </span>
                    )
                  )}
                </span>
              ))}
            </div>
          </div>

          <div className="ui-bc__morph" ref={morphRef}>
          <div className="ui-bc__table-wrap" ref={tableRef}>
            <table className="ui-bc__table">
              <thead>
                <tr>
                  <th scope="col">{slice.label}</th>
                  <th scope="col" data-num>
                    {measure.label}
                  </th>
                  {segment &&
                    segValues.map((seg, i) => (
                      <th key={i} scope="col" data-num data-hidden={hidden.has(seg) || undefined}>
                        <span className="ui-bc__th-seg" title={seg}>
                          <span className="ui-bc__swatch" style={{ background: color(seg, i) }} />
                          <span dir="auto">{seg}</span>
                        </span>
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody>
                {table.map((row, ri) => (
                  <tr
                    key={ri}
                    data-active={hover === row.value || undefined}
                    onPointerEnter={() => setHover(row.value)}
                    onPointerLeave={() => setHover(null)}
                  >
                    <th scope="row">
                      <span className="ui-bc__row-label" title={row.value}>
                        {slice.icons?.[row.value]}
                        <span dir="auto">{row.value}</span>
                      </span>
                    </th>
                    <td data-num>{fmt(row.total)}</td>
                    {segment &&
                      segValues.map((seg, i) => (
                        <td key={i} data-num data-hidden={hidden.has(seg) || undefined}>
                          {fmt(row.cells[seg])}
                        </td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
        </div>

        <footer className="ui-bc__foot">
          {segment ? (
            <div className="ui-bc__legend" role="group" aria-label={`${segment.label} – click to show or hide`}>
              {segValues.map((seg, i) => (
                <button
                  key={i}
                  type="button"
                  className="ui-bc__chip"
                  aria-pressed={!hidden.has(seg)}
                  title={seg}
                  onClick={() => toggle(seg)}
                >
                  <span className="ui-bc__swatch" style={{ background: color(seg, i) }} />
                  <span dir="auto">{seg}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="ui-bc__hint">Pick a segment to split the bars</span>
          )}
          {hidden.size > 0 && (
            <button type="button" className="ui-bc__reset" onClick={() => setHidden(new Set())}>
              Show all
            </button>
          )}
        </footer>
      </section>
    </>
  );
}

/** Small dropdown with a label above it */
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <div className="ui-bc__select" ref={ref}>
      <span className="ui-bc__select-label" id={id}>
        {label}
      </span>
      <button
        type="button"
        className="ui-bc__select-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={id}
        title={current}
        onClick={() => setOpen((o) => !o)}
      >
        <span dir="auto">{current}</span>
        <ChevronIcon />
      </button>
      {open && (
        <div className="ui-bc__menu" role="listbox" aria-labelledby={id}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="ui-bc__option"
              autoFocus={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              onKeyDown={(e) => {
                const items = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
                const i = items.indexOf(e.currentTarget);
                if (e.key === "ArrowDown") items[Math.min(items.length - 1, i + 1)]?.focus();
                if (e.key === "ArrowUp") items[Math.max(0, i - 1)]?.focus();
                if (e.key.startsWith("Arrow")) e.preventDefault();
              }}
            >
              <span dir="auto" title={o.label}>
                {o.label}
              </span>
              {o.value === value && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ChevronIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

/** Small status icons – exported for your own status values */
export const StatusIcon = ({
  kind,
  color = "currentColor",
}: {
  kind: "backlog" | "todo" | "progress" | "review" | "done" | "canceled";
  color?: string;
}) => (
  <svg
    viewBox="0 0 16 16"
    width="15"
    height="15"
    fill="none"
    stroke={color}
    strokeWidth="1.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {kind === "backlog" && <path d="M2.5 9.5 4 3.5h8l1.5 6M2.5 9.5v3h11v-3M2.5 9.5H6l.8 1.5h2.4l.8-1.5h3.5" />}
    {kind === "todo" && <rect x="3" y="3" width="10" height="10" rx="2.5" />}
    {kind === "progress" && (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v3l2 1.5" />
      </>
    )}
    {kind === "review" && (
      <>
        <path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z" />
        <circle cx="8" cy="8" r="1.8" />
      </>
    )}
    {kind === "done" && (
      <>
        <rect x="2.5" y="2.5" width="11" height="11" rx="3" fill={color} stroke="none" />
        <path d="m5.5 8.2 1.8 1.8 3.3-3.6" stroke="#fff" strokeWidth="1.5" />
      </>
    )}
    {kind === "canceled" && (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="m4.2 11.8 7.6-7.6" />
      </>
    )}
  </svg>
);

/**
 * Lets a box glide to the height of its content instead of jumping: the outer box follows the inner one
 * with a height transition whenever the content grows or shrinks.
 */
function useSmoothHeight(inner: RefObject<HTMLElement | null>) {
  const outer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const sync = () => {
      o.style.height = `${i.offsetHeight}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(i);
    // Transitions switch on after the first measurement, so the first render doesn't animate
    const frame = requestAnimationFrame(() => o.setAttribute("data-smooth", ""));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [inner]);
  return outer;
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-bc {
  --ui-bc-tray: #f0f0f0;
  --ui-bc-card: #ffffff;
  --ui-bc-line: #ececec;
  --ui-bc-grid: #ebebeb;
  --ui-bc-ink: #171717;
  --ui-bc-text: #404040;
  --ui-bc-muted: #8f8f8f;
  --ui-bc-accent: #2f6bff;
  --ui-bc-accent-ink: #2f6bff;
  --ui-bc-border: #e5e5e5;
  --ui-bc-surface-hover: #f8f8f8;
  --ui-bc-option-hover: #f5f5f5;
  --ui-bc-zero: #dcdcdc;
  --ui-bc-rest: #f2f2f2;
  --ui-bc-head-bg: #fcfcfc;
  --ui-bc-row-active: #f6f6f6;
  --ui-bc-wash: rgba(0, 0, 0, 0.05);
  --ui-bc-accent-wash: rgba(47, 107, 255, 0.08);
  --ui-bc-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  --ui-bc-btn-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-bc-pop-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.18);
  --ui-bc-tip-shadow: 0 10px 26px -8px rgba(0, 0, 0, 0.18);
  --ui-bc-pill-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
  --ui-bc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  width: 100%;
  max-width: 560px;
  /* Like the Chat Composer: a gray tray with heading and legend, the white card sits on top of it */
  background: var(--ui-bc-tray);
  /* The gray tray frames the white card on every side */
  padding: 6px;
  border-radius: 22px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-bc-ink);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
.ui-bc *, .ui-bc *::before, .ui-bc *::after { box-sizing: border-box; }
.ui-bc button { margin: 0; font: inherit; color: inherit; cursor: pointer; }
.ui-bc button:focus-visible { outline: 2px solid var(--ui-bc-accent); outline-offset: 2px; }

.ui-bc__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  /* A long total moves to its own line instead of leaving the card */
  flex-wrap: wrap;
  gap: 2px 12px;
  padding: 11px 18px 10px;
  font-size: 14px;
  line-height: 20px;
}
.ui-bc__title { flex: 1 1 0; min-width: min(120px, 100%); overflow: hidden; font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-bc__total { flex: none; max-width: 100%; color: var(--ui-bc-muted); }
.ui-bc__total strong { white-space: nowrap; font-size: 15px; font-weight: 600; color: var(--ui-bc-ink); }

.ui-bc__card {
  overflow: hidden;
  background: var(--ui-bc-card);
  border: 1px solid var(--ui-bc-border);
  border-radius: 16px;
  box-shadow: var(--ui-bc-card-shadow);
}

.ui-bc__controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 16px 18px 4px;
}
.ui-bc__select { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; min-width: 0; }
.ui-bc__select-label { font-size: 12px; line-height: 16px; color: var(--ui-bc-muted); }
.ui-bc__select-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 34px;
  padding: 0 10px 0 12px;
  border: 0;
  border-radius: 10px;
  background: var(--ui-bc-card);
  box-shadow: 0 0 0 1px var(--ui-bc-border), var(--ui-bc-btn-shadow);
  font-size: 13px !important;
  font-weight: 500;
  text-align: left;
  transition: background-color 140ms ease;
}
.ui-bc__select-btn span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-bc__select-btn svg { flex: none; color: var(--ui-bc-muted); transition: transform 200ms var(--ui-bc-ease); }
.ui-bc__select-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
.ui-bc__select-btn:hover { background: var(--ui-bc-surface-hover); }
.ui-bc__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 6;
  display: grid;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ui-bc-card);
  box-shadow: 0 0 0 1px var(--ui-bc-border), var(--ui-bc-pop-shadow);
  animation: ui-bc-drop 180ms var(--ui-bc-ease);
}
.ui-bc__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 13px !important;
  text-align: left;
}
.ui-bc__option { gap: 8px; }
.ui-bc__option span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-bc__option svg { flex: none; }
.ui-bc__option:hover, .ui-bc__option:focus-visible { background: var(--ui-bc-option-hover); outline: none; }
.ui-bc__option[aria-selected="true"] { color: var(--ui-bc-accent-ink) !important; font-weight: 500; }

/* Chart: dashed grid, the scale on the right, stacked bars */
.ui-bc__chart { padding: 22px 18px 12px; }
.ui-bc__plot {
  position: relative;
  height: 200px;
  margin-right: 30px;
}
.ui-bc__grid {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 1px dashed var(--ui-bc-grid);
}
.ui-bc__grid[data-zero] { border-top-style: solid; border-color: var(--ui-bc-zero); }
.ui-bc__tick {
  position: absolute;
  right: -30px;
  top: -8px;
  width: 26px;
  font-size: 11px;
  line-height: 16px;
  text-align: right;
  color: var(--ui-bc-muted);
}
.ui-bc__bars {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 4px;
}
.ui-bc__col {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  transition: opacity 200ms ease;
}
.ui-bc__col:focus-visible { outline-offset: 4px; }
/* Hover: the other bars fade back, the hovered one shows its empty rest up to the top */
.ui-bc__col[data-dim] { opacity: 0.38; }
.ui-bc__rest {
  position: absolute;
  top: 0;
  left: 50%;
  width: min(10px, 100%);
  transform: translateX(-50%);
  background: var(--ui-bc-rest);
  opacity: 0;
  transition: opacity 180ms ease, bottom 520ms var(--ui-bc-ease);
}
.ui-bc__col[data-active] .ui-bc__rest { opacity: 1; }
.ui-bc__bar {
  position: relative;
  display: flex;
  flex-direction: column-reverse;
  gap: 1px;
  width: min(10px, 100%);
  min-height: 0;
  overflow: hidden;
  transition: height 520ms var(--ui-bc-ease);
}
.ui-bc__seg {
  flex-basis: 0;
  min-height: 2px;
  transition: flex-grow 520ms var(--ui-bc-ease), background-color 300ms ease;
}

.ui-bc__tooltip {
  position: absolute;
  z-index: 4;
  min-width: 150px;
  padding: 9px 11px 10px;
  border-radius: 12px;
  background: var(--ui-bc-card);
  box-shadow: 0 0 0 1px var(--ui-bc-border), var(--ui-bc-tip-shadow);
  /* Beside the bar at the top of the plot, so it never leaves the card – flips on the right half */
  top: 0;
  pointer-events: none;
  max-width: min(260px, 100%);
  transition: left 200ms var(--ui-bc-ease);
  animation: ui-bc-pop 160ms var(--ui-bc-ease);
}
.ui-bc__tip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}
.ui-bc__tip-head > strong { flex: none; }
.ui-bc__tip-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.ui-bc__tip-label > span, .ui-bc__tip-seg, .ui-bc__pill > span, .ui-bc__row-label > span, .ui-bc__th-seg > span:last-child, .ui-bc__chip > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-bc__tooltip ul {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2px;
  margin: 6px 0 0;
  padding: 6px 0 0;
  border-top: 1px solid var(--ui-bc-line);
  list-style: none;
}
.ui-bc__tooltip li { display: flex; align-items: center; gap: 7px; font-size: 12px; line-height: 18px; color: var(--ui-bc-text); }
.ui-bc__tip-seg { flex: 1; white-space: nowrap; }
.ui-bc__swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }

.ui-bc__xaxis {
  display: grid;
  gap: 4px;
  margin: 8px 30px 0 0;
}
.ui-bc__xlabel {
  display: grid;
  place-items: center;
  height: 24px;
  min-width: 0;
  color: var(--ui-bc-muted);
}
.ui-bc__xlabel { position: relative; overflow: visible; }
/* The hovered bar's label grows into a pill with its name */
.ui-bc__pill {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px 0 7px;
  border-radius: 999px;
  background: var(--ui-bc-card);
  box-shadow: 0 0 0 1px var(--ui-bc-border), var(--ui-bc-pill-shadow);
  font-size: 12px;
  font-weight: 500;
  max-width: min(220px, 80cqw);
  white-space: nowrap;
  color: var(--ui-bc-ink);
  transform: translate(-50%, -50%);
  animation: ui-bc-pill 200ms var(--ui-bc-ease);
}
.ui-bc__xtext { overflow: hidden; max-width: 100%; font-size: 11px; white-space: nowrap; text-overflow: ellipsis; }

/* Table linked to the bars */
.ui-bc__table-wrap { overflow-x: auto; border-top: 1px solid var(--ui-bc-line); scrollbar-width: thin; }
.ui-bc__table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 18px; }
.ui-bc__table th,
.ui-bc__table td {
  height: 38px;
  padding: 0 14px;
  border-top: 1px solid var(--ui-bc-line);
  text-align: left;
  white-space: nowrap;
}
.ui-bc__table thead th { border-top: 0; font-weight: 450; color: var(--ui-bc-muted); background: var(--ui-bc-head-bg); }
.ui-bc__table [data-num] { text-align: right; }
.ui-bc__table tbody th { position: sticky; left: 0; z-index: 1; background: var(--ui-bc-card); font-weight: 450; }
.ui-bc__table tbody tr { transition: background-color 140ms ease; }
.ui-bc__table tbody tr[data-active] th,
.ui-bc__table tbody tr[data-active] td { background: var(--ui-bc-row-active); }
.ui-bc__table td { color: var(--ui-bc-text); }
.ui-bc__table [data-hidden] { opacity: 0.35; }
.ui-bc__row-label, .ui-bc__th-seg { display: inline-flex; align-items: center; gap: 8px; max-width: 220px; }
.ui-bc__th-seg { max-width: 160px; }

/* Gray extension: legend chips toggle segments */
.ui-bc__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  padding: 6px 10px 7px 10px;
}
.ui-bc__legend { display: flex; flex-wrap: wrap; gap: 2px; min-width: 0; }
.ui-bc__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 28px;
  white-space: nowrap;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px !important;
  color: var(--ui-bc-text) !important;
  transition: background-color 140ms ease, opacity 160ms ease;
}
.ui-bc__chip:hover { background: var(--ui-bc-wash); }
.ui-bc__chip[aria-pressed="false"] { opacity: 0.45; text-decoration: line-through; }
.ui-bc__hint { padding-left: 8px; font-size: 12.5px; color: var(--ui-bc-muted); }
.ui-bc__reset {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px !important;
  font-weight: 500;
  color: var(--ui-bc-accent-ink) !important;
}
.ui-bc__reset:hover { background: var(--ui-bc-accent-wash); }

@keyframes ui-bc-drop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-bc-pop { from { opacity: 0; } }
@keyframes ui-bc-pill { from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); } }

@media (prefers-reduced-motion: reduce) {
  .ui-bc__bar, .ui-bc__seg, .ui-bc__tooltip, .ui-bc__col, .ui-bc__rest { transition: none; }
  .ui-bc__menu, .ui-bc__tooltip, .ui-bc__pill { animation: none; }
}

/* Height changes glide instead of jumping */
.ui-bc__morph { overflow: hidden; }
.ui-bc__morph[data-smooth] { transition: height 380ms cubic-bezier(0.22, 1, 0.36, 1); }
@media (prefers-reduced-motion: reduce) { .ui-bc__morph[data-smooth] { transition: none; } }

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-bc {
  --ui-bc-tray: #161618;
  --ui-bc-card: #232326;
  --ui-bc-line: rgba(255, 255, 255, 0.08);
  --ui-bc-grid: rgba(255, 255, 255, 0.09);
  --ui-bc-ink: #ededed;
  --ui-bc-text: #c4c4c4;
  --ui-bc-muted: #8f8f8f;
  --ui-bc-accent-ink: #6b95ff;
  --ui-bc-border: rgba(255, 255, 255, 0.08);
  --ui-bc-surface-hover: #2a2a2d;
  --ui-bc-option-hover: #313135;
  --ui-bc-zero: rgba(255, 255, 255, 0.16);
  --ui-bc-rest: rgba(255, 255, 255, 0.06);
  --ui-bc-head-bg: #262629;
  --ui-bc-row-active: #2a2a2d;
  --ui-bc-wash: rgba(255, 255, 255, 0.06);
  --ui-bc-accent-wash: rgba(47, 107, 255, 0.16);
  --ui-bc-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-bc-btn-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  --ui-bc-pop-shadow: 0 12px 30px -8px rgba(0, 0, 0, 0.5);
  --ui-bc-tip-shadow: 0 12px 28px -8px rgba(0, 0, 0, 0.5);
  --ui-bc-pill-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
/* Floating layers sit one step lighter than the card so they separate from it */
:where(.dark, [data-theme="dark"]) .ui-bc__menu,
:where(.dark, [data-theme="dark"]) .ui-bc__tooltip,
:where(.dark, [data-theme="dark"]) .ui-bc__pill {
  background: #2a2a2d;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), var(--ui-bc-pop-shadow);
}
:where(.dark, [data-theme="dark"]) .ui-bc__select-btn { background: #2a2a2d; }
:where(.dark, [data-theme="dark"]) .ui-bc__select-btn:hover { background: #313135; }
`;
