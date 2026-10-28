"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

/*
 * Breakdown Chart (Clean) – a stacked bar chart with a linked table, in a single self-contained file.
 * Clean style: no tray – one white card with the title and total on top, quiet white pickers, hairline gridlines,
 * blue-family bars, small white popovers for the menus and the hover breakdown, and the legend as the card's last row.
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

/* The accent blue (rgba(0, 96, 226, .765) on white) and its lighter tints, then the status colors */
const palette = ["#3c85e9", "#5b5bd6", "#80b0f1", "#1a9a52", "#e8a20c", "#e5484d", "#b3cff6"];

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
  const color = (v: string, i: number) => segment?.colors?.[v] ?? (segment ? palette[i % palette.length] : palette[0]);

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

  // The breakdown sits beside its bar, but always inside the card – and so does the hovered bar's name
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const tip = tipRef.current;
    if (!plot || hoverIndex < 0) return;
    const card = plot.closest("section")!.getBoundingClientRect();
    const box = plot.getBoundingClientRect();
    const at = ((hoverIndex + 0.5) / table.length) * box.width;
    if (tip) {
      const w = tip.offsetWidth;
      const x = (hoverIndex + 0.5) / table.length > 0.5 ? at - 18 - w : at + 18;
      tip.style.left = `${Math.max(card.left - box.left + 4, Math.min(x, card.right - box.left - 4 - w))}px`;
    }
    const pill = plot.parentElement?.querySelector<HTMLElement>(".ui-bcc__xlabel[data-active] .ui-bcc__pill");
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
      <style href="ui-breakdown-chart-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-bcc", className].filter(Boolean).join(" ")} aria-label={title}>
        <header className="ui-bcc__head">
          <span className="ui-bcc__title" dir="auto" title={title}>
            {title}
          </span>
          <span className="ui-bcc__total">
            <strong>{fmt(grand)}</strong> {measure.unit}
          </span>
        </header>

        <div className="ui-bcc__controls">
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

        <div className="ui-bcc__chart" onPointerLeave={() => setHover(null)}>
          <div className="ui-bcc__plot" ref={plotRef}>
            {ticks.map((t) => (
              <span key={t} className="ui-bcc__grid" style={{ bottom: `${(t / max) * 100}%` }} data-zero={t === 0 || undefined}>
                <span className="ui-bcc__tick">{fmtTick(t)}</span>
              </span>
            ))}
            <div className="ui-bcc__bars" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
              {table.map((row, ri) => (
                <button
                  key={ri}
                  type="button"
                  className="ui-bcc__col"
                  data-dim={(hover && hover !== row.value) || undefined}
                  data-active={hover === row.value || undefined}
                  aria-label={`${row.value}: ${fmt(row.total)} ${measure.unit}`}
                  onPointerEnter={() => setHover(row.value)}
                  onFocus={() => setHover(row.value)}
                  onBlur={() => setHover(null)}
                >
                  {/* The empty part above the bar – only shown for the hovered bar */}
                  {/* A negative total draws no bar – the table still shows it */}
                  <span className="ui-bcc__rest" style={{ bottom: `${(Math.max(0, row.total) / max) * 100}%` }} />
                  <span className="ui-bcc__bar" style={{ height: `${(Math.max(0, row.total) / max) * 100}%` }}>
                    {segValues.map((seg, i) =>
                      hidden.has(seg) || !(row.cells[seg] > 0) ? null : (
                        <span key={i} className="ui-bcc__seg" style={{ flexGrow: row.cells[seg], background: color(seg, i) }} />
                      ),
                    )}
                  </span>
                </button>
              ))}
            </div>

            {hovered && (
              <div
                ref={tipRef}
                className="ui-bcc__tooltip"
                role="status"
                data-side={(hoverIndex + 0.5) / table.length > 0.5 ? "left" : "right"}
              >
                <p className="ui-bcc__tip-head">
                  <span className="ui-bcc__tip-label">
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
                          <span className="ui-bcc__swatch" style={{ background: color(x.seg, x.i) }} />
                          <span className="ui-bcc__tip-seg" dir="auto">
                            {x.seg}
                          </span>
                          <span className="ui-bcc__tip-num">{fmt(x.v)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}
          </div>
          <div className="ui-bcc__xaxis" style={{ gridTemplateColumns: `repeat(${table.length}, minmax(0, 1fr))` }}>
            {table.map((row, ri) => (
              <span key={ri} className="ui-bcc__xlabel" data-active={hover === row.value || undefined} title={row.value}>
                {hover === row.value ? (
                  <span className="ui-bcc__pill">
                    {slice.icons?.[row.value]}
                    <span dir="auto">{row.value}</span>
                  </span>
                ) : (
                  slice.icons?.[row.value] ?? (
                    <span className="ui-bcc__xtext" dir="auto">
                      {row.value}
                    </span>
                  )
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Only the table area glides to its new height – the legend row below never gets clipped */}
        <div className="ui-bcc__morph" ref={morphRef}>
          <div className="ui-bcc__table-wrap" ref={tableRef}>
            <table className="ui-bcc__table">
              <thead>
                <tr>
                  <th scope="col">{slice.label}</th>
                  <th scope="col" data-num>
                    {measure.label}
                  </th>
                  {segment &&
                    segValues.map((seg, i) => (
                      <th key={i} scope="col" data-num data-hidden={hidden.has(seg) || undefined}>
                        <span className="ui-bcc__th-seg" title={seg}>
                          <span className="ui-bcc__swatch" style={{ background: color(seg, i) }} />
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
                      <span className="ui-bcc__row-label" title={row.value}>
                        {slice.icons?.[row.value]}
                        <span dir="auto">{row.value}</span>
                      </span>
                    </th>
                    <td data-num data-total>
                      {fmt(row.total)}
                    </td>
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

        {/* The last row of the card: legend chips toggle segments */}
        <footer className="ui-bcc__foot">
          {segment ? (
            <div className="ui-bcc__legend" role="group" aria-label={`${segment.label} – click to show or hide`}>
              {segValues.map((seg, i) => (
                <button key={i} type="button" className="ui-bcc__chip" aria-pressed={!hidden.has(seg)} title={seg} onClick={() => toggle(seg)}>
                  <span className="ui-bcc__swatch" style={{ background: color(seg, i) }} />
                  <span dir="auto">{seg}</span>
                </button>
              ))}
            </div>
          ) : (
            <span className="ui-bcc__hint">Pick a segment to split the bars</span>
          )}
          {hidden.size > 0 && (
            <button type="button" className="ui-bcc__reset" onClick={() => setHidden(new Set())}>
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
    <div className="ui-bcc__select" ref={ref}>
      <span className="ui-bcc__select-label" id={id}>
        {label}
      </span>
      <button
        type="button"
        className="ui-bcc__select-btn"
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
        <div className="ui-bcc__menu" role="listbox" aria-labelledby={id}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className="ui-bcc__option"
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
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
    width="16"
    height="16"
    fill="none"
    stroke={color}
    strokeWidth="1.1"
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
        <path d="m5.5 8.2 1.8 1.8 3.3-3.6" stroke="#fff" strokeWidth="1.3" />
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
/* Colors and motion as variables – override them on .ui-bcc */
.ui-bcc {
  --ui-bcc-card: #ffffff;
  --ui-bcc-ink: rgba(0, 0, 0, 0.88);
  --ui-bcc-strong: #000000;
  --ui-bcc-text: rgba(0, 0, 0, 0.61);
  --ui-bcc-muted: rgba(0, 0, 0, 0.45);
  --ui-bcc-faint: rgba(0, 0, 0, 0.27);
  --ui-bcc-icon: rgba(0, 0, 0, 0.447);
  --ui-bcc-line: rgba(0, 0, 0, 0.06);
  --ui-bcc-grid: rgba(0, 0, 0, 0.06);
  --ui-bcc-zero: rgba(0, 0, 0, 0.12);
  --ui-bcc-fill: rgba(0, 0, 0, 0.06);
  --ui-bcc-wash: rgba(0, 0, 0, 0.03);
  --ui-bcc-rest: rgba(0, 0, 0, 0.035);
  --ui-bcc-accent: rgba(0, 96, 226, 0.765);
  --ui-bcc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-bcc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-bcc-shadow-hover: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-bcc-shadow-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-bcc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  width: 100%;
  max-width: 560px;
  /* One white card – the edge is a shadow, not a border */
  border-radius: 10px;
  background: var(--ui-bcc-card);
  box-shadow: var(--ui-bcc-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-bcc-ink);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
}
.ui-bcc *, .ui-bcc *::before, .ui-bcc *::after { box-sizing: border-box; }
:where(.ui-bcc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-bcc) svg { display: block; flex: none; }
.ui-bcc button:focus-visible { outline: 2px solid var(--ui-bcc-focus); outline-offset: 1px; }

/* Title and total */
.ui-bcc__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  /* A long total moves to its own line instead of leaving the card */
  flex-wrap: wrap;
  gap: 2px 12px;
  padding: 14px 16px 0;
}
.ui-bcc__title { flex: 1 1 0; min-width: min(120px, 100%); overflow: hidden; font-size: 15px; line-height: 24px; font-weight: 500; color: var(--ui-bcc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-bcc__total { flex: none; max-width: 100%; font-size: 12px; line-height: 16px; color: var(--ui-bcc-muted); }
.ui-bcc__total strong { white-space: nowrap; font-size: 15px; line-height: 24px; font-weight: 500; color: var(--ui-bcc-ink); }

/* Pickers: white secondary buttons with a label above */
.ui-bcc__controls {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 12px 16px 0;
}
.ui-bcc__select { position: relative; display: grid; grid-template-columns: minmax(0, 1fr); gap: 4px; min-width: 0; }
.ui-bcc__select-label { padding-left: 2px; font-size: 12px; line-height: 16px; color: var(--ui-bcc-muted); }
.ui-bcc__select-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 28px;
  padding: 0 6px 0 10px;
  border-radius: 6px;
  background: var(--ui-bcc-card);
  box-shadow: var(--ui-bcc-shadow);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--ui-bcc-strong);
  text-align: left;
  transition: box-shadow 160ms ease;
}
.ui-bcc__select-btn:hover { box-shadow: var(--ui-bcc-shadow-hover); }
.ui-bcc__select-btn span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-bcc__select-btn svg { color: var(--ui-bcc-icon); transition: transform 220ms var(--ui-bcc-ease); }
.ui-bcc__select-btn[aria-expanded="true"] svg { transform: rotate(180deg); }
.ui-bcc__menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 6;
  display: grid;
  gap: 0;
  min-width: 140px;
  padding: 4px;
  border-radius: 10px;
  background: var(--ui-bcc-card);
  box-shadow: var(--ui-bcc-shadow-pop);
  transform-origin: top center;
  animation: ui-bcc-drop 180ms var(--ui-bcc-ease);
}
.ui-bcc__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 28px;
  padding: 0 6px 0 8px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-bcc-ink);
  text-align: left;
  white-space: nowrap;
}
.ui-bcc__option span { overflow: hidden; text-overflow: ellipsis; }
.ui-bcc__option:hover, .ui-bcc__option:focus-visible { background: var(--ui-bcc-fill); outline: none; }
.ui-bcc__option svg { color: var(--ui-bcc-accent); }

/* Chart: hairline grid, the scale on the right, stacked bars */
.ui-bcc__chart { padding: 20px 16px 10px; }
.ui-bcc__plot {
  position: relative;
  height: 196px;
  margin-right: 28px;
}
.ui-bcc__grid {
  position: absolute;
  left: 0;
  right: 0;
  height: 0;
  border-top: 0.5px solid var(--ui-bcc-grid);
}
.ui-bcc__grid[data-zero] { border-color: var(--ui-bcc-zero); }
.ui-bcc__tick {
  position: absolute;
  right: -28px;
  top: -8px;
  width: 24px;
  font-size: 11px;
  line-height: 16px;
  text-align: right;
  color: var(--ui-bcc-muted);
}
.ui-bcc__bars {
  position: absolute;
  inset: 0;
  display: grid;
  gap: 4px;
}
.ui-bcc__col {
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  height: 100%;
  transition: opacity 200ms ease;
}
.ui-bcc__col:focus-visible { outline-offset: 4px; border-radius: 6px; }
/* Hover: the other bars fade back, the hovered one shows its empty rest up to the top */
.ui-bcc__col[data-dim] { opacity: 0.35; }
.ui-bcc__rest {
  position: absolute;
  top: 0;
  left: 50%;
  width: min(12px, 100%);
  transform: translateX(-50%);
  border-radius: 3px 3px 0 0;
  background: var(--ui-bcc-rest);
  opacity: 0;
  transition: opacity 180ms ease, bottom 520ms var(--ui-bcc-ease);
}
.ui-bcc__col[data-active] .ui-bcc__rest { opacity: 1; }
.ui-bcc__bar {
  position: relative;
  display: flex;
  flex-direction: column-reverse;
  gap: 1px;
  width: min(12px, 100%);
  min-height: 0;
  overflow: hidden;
  border-radius: 3px 3px 0 0;
  transition: height 520ms var(--ui-bcc-ease);
}
.ui-bcc__seg {
  flex-basis: 0;
  min-height: 2px;
  transition: flex-grow 520ms var(--ui-bcc-ease), background-color 300ms ease;
}

/* The hover breakdown: a small white popover beside the bar */
.ui-bcc__tooltip {
  position: absolute;
  z-index: 4;
  min-width: 152px;
  padding: 6px 10px 8px;
  border-radius: 10px;
  background: var(--ui-bcc-card);
  box-shadow: var(--ui-bcc-shadow-pop);
  /* Beside the bar at the top of the plot, so it never leaves the card – flips on the right half */
  top: 0;
  pointer-events: none;
  max-width: min(260px, 100%);
  transition: left 200ms var(--ui-bcc-ease);
  animation: ui-bcc-pop 160ms var(--ui-bcc-ease);
}
.ui-bcc__tip-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--ui-bcc-strong);
}
.ui-bcc__tip-head strong { flex: none; font-weight: 500; }
.ui-bcc__tip-label { display: inline-flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.ui-bcc__tip-label > span, .ui-bcc__tip-seg, .ui-bcc__pill > span, .ui-bcc__row-label > span, .ui-bcc__th-seg > span:last-child, .ui-bcc__chip > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-bcc__tooltip ul {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  margin: 4px 0 0;
  padding: 4px 0 0;
  border-top: 0.5px solid var(--ui-bcc-line);
  list-style: none;
}
.ui-bcc__tooltip li { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 20px; color: var(--ui-bcc-text); }
.ui-bcc__tip-seg { flex: 1; white-space: nowrap; }
.ui-bcc__tip-num { flex: none; color: var(--ui-bcc-ink); }
.ui-bcc__swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }

.ui-bcc__xaxis {
  display: grid;
  gap: 4px;
  margin: 8px 28px 0 0;
}
.ui-bcc__xlabel {
  position: relative;
  display: grid;
  place-items: center;
  height: 24px;
  min-width: 0;
  overflow: visible;
  color: var(--ui-bcc-icon);
}
/* The hovered bar's label grows into a small white chip with its name */
.ui-bcc__pill {
  position: absolute;
  top: 50%;
  left: 50%;
  z-index: 2;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px 0 6px;
  border-radius: 6px;
  background: var(--ui-bcc-card);
  box-shadow: var(--ui-bcc-shadow);
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  max-width: min(220px, 80cqw);
  white-space: nowrap;
  color: var(--ui-bcc-ink);
  transform: translate(-50%, -50%);
  animation: ui-bcc-pill 200ms var(--ui-bcc-ease);
}
.ui-bcc__xtext { overflow: hidden; max-width: 100%; font-size: 11px; line-height: 16px; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-bcc-muted); }

/* Table linked to the bars */
.ui-bcc__table-wrap { overflow-x: auto; border-top: 0.5px solid var(--ui-bcc-line); scrollbar-width: thin; }
.ui-bcc__table { width: 100%; border-collapse: collapse; font-size: 13px; line-height: 20px; }
.ui-bcc__table th,
.ui-bcc__table td {
  height: 36px;
  padding: 0 10px;
  border-top: 0.5px solid var(--ui-bcc-line);
  background: var(--ui-bcc-card);
  text-align: left;
  white-space: nowrap;
}
.ui-bcc__table th:first-child, .ui-bcc__table td:first-child { padding-left: 16px; }
.ui-bcc__table th:last-child, .ui-bcc__table td:last-child { padding-right: 16px; }
/* Column titles: tiny uppercase labels */
.ui-bcc__table thead th {
  height: 32px;
  border-top: 0;
  font-size: 10px;
  line-height: 16px;
  font-weight: 500;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--ui-bcc-muted);
}
.ui-bcc__table [data-num] { text-align: right; }
.ui-bcc__table tbody th { position: sticky; left: 0; z-index: 1; font-weight: 400; color: var(--ui-bcc-ink); }
/* The linked row: a subtle wash, laid over the white so the sticky first cell stays opaque */
.ui-bcc__table tbody tr[data-active] th,
.ui-bcc__table tbody tr[data-active] td { background: linear-gradient(var(--ui-bcc-wash), var(--ui-bcc-wash)) var(--ui-bcc-card); }
.ui-bcc__table td { color: var(--ui-bcc-text); }
.ui-bcc__table td[data-total] { color: var(--ui-bcc-ink); }
.ui-bcc__table [data-hidden] { opacity: 0.35; }
.ui-bcc__row-label, .ui-bcc__th-seg { display: inline-flex; align-items: center; gap: 8px; max-width: 220px; }
.ui-bcc__th-seg { max-width: 160px; }
.ui-bcc__row-label svg { color: var(--ui-bcc-icon); }
.ui-bcc__th-seg { gap: 6px; }

/* The last row of the card: legend chips toggle segments */
.ui-bcc__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  padding: 8px;
  border-top: 0.5px solid var(--ui-bcc-line);
}
.ui-bcc__legend { display: flex; flex-wrap: nowrap; gap: 2px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.ui-bcc__legend::-webkit-scrollbar { display: none; }
.ui-bcc__chip { flex: none; max-width: 220px; }
/* The legend scrolls sideways when it doesn't fit, so the focus ring sits inside the chip */
.ui-bcc .ui-bcc__chip:focus-visible { outline-offset: -2px; }
.ui-bcc__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--ui-bcc-text);
  white-space: nowrap;
  transition: background-color 140ms ease, color 140ms ease, opacity 160ms ease;
}
.ui-bcc__chip:hover { background: var(--ui-bcc-wash); color: var(--ui-bcc-ink); }
.ui-bcc__chip[aria-pressed="false"] { opacity: 0.45; text-decoration: line-through; text-decoration-color: var(--ui-bcc-faint); }
.ui-bcc__hint { padding-left: 8px; font-size: 12px; line-height: 16px; color: var(--ui-bcc-muted); }
.ui-bcc__reset {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--ui-bcc-ink);
  transition: background-color 140ms ease;
  animation: ui-bcc-pop 160ms var(--ui-bcc-ease);
}
.ui-bcc__reset:hover { background: var(--ui-bcc-wash); }

@keyframes ui-bcc-drop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-bcc-pop { from { opacity: 0; } }
@keyframes ui-bcc-pill { from { opacity: 0; transform: translate(-50%, -50%) scale(0.92); } }

/* Height changes glide instead of jumping */
.ui-bcc__morph { overflow: hidden; }
.ui-bcc__morph[data-smooth] { transition: height 380ms var(--ui-bcc-ease); }

/* Narrow (phones): tighter padding, smaller bars */
@container (max-width: 420px) {
  .ui-bcc__head { padding: 12px 12px 0; }
  .ui-bcc__controls { gap: 6px; padding: 10px 12px 0; }
  .ui-bcc__select-btn { padding: 0 4px 0 8px; }
  .ui-bcc__chart { padding: 18px 12px 8px; }
  .ui-bcc__plot { height: 168px; }
  .ui-bcc__bar, .ui-bcc__rest { width: min(10px, 100%); }
  .ui-bcc__table th:first-child, .ui-bcc__table td:first-child { padding-left: 12px; }
  .ui-bcc__table th:last-child, .ui-bcc__table td:last-child { padding-right: 12px; }
  .ui-bcc__foot { padding: 6px; }
  .ui-bcc__legend { gap: 0; }
  .ui-bcc__chip { gap: 5px; padding: 0 6px; }
}
/* Touch screens: taller pickers, menu rows and legend chips */
@media (hover: none) and (pointer: coarse) {
  .ui-bcc__select-btn { height: 36px; }
  .ui-bcc__option { height: 40px; }
  .ui-bcc__chip, .ui-bcc__reset { height: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-bcc__bar, .ui-bcc__seg, .ui-bcc__tooltip, .ui-bcc__col, .ui-bcc__rest, .ui-bcc__morph[data-smooth] { transition: none; }
  .ui-bcc__menu, .ui-bcc__tooltip, .ui-bcc__pill, .ui-bcc__reset { animation: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-bcc {
  --ui-bcc-card: #1c1c1e;
  --ui-bcc-ink: rgba(255, 255, 255, 0.9);
  --ui-bcc-strong: #ffffff;
  --ui-bcc-text: rgba(255, 255, 255, 0.62);
  --ui-bcc-muted: rgba(255, 255, 255, 0.46);
  --ui-bcc-faint: rgba(255, 255, 255, 0.3);
  --ui-bcc-icon: rgba(255, 255, 255, 0.5);
  --ui-bcc-line: rgba(255, 255, 255, 0.08);
  --ui-bcc-grid: rgba(255, 255, 255, 0.08);
  --ui-bcc-zero: rgba(255, 255, 255, 0.16);
  --ui-bcc-fill: rgba(255, 255, 255, 0.08);
  --ui-bcc-wash: rgba(255, 255, 255, 0.04);
  --ui-bcc-rest: rgba(255, 255, 255, 0.05);
  --ui-bcc-accent: #4d8dff;
  --ui-bcc-focus: rgba(77, 141, 255, 0.5);
  --ui-bcc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-bcc-shadow-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-bcc-shadow-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
/* Floating layers sit one step lighter than the card so they separate from it */
:where(.dark, [data-theme="dark"]) .ui-bcc__menu,
:where(.dark, [data-theme="dark"]) .ui-bcc__tooltip,
:where(.dark, [data-theme="dark"]) .ui-bcc__pill { background: #252527; }
:where(.dark, [data-theme="dark"]) .ui-bcc__select-btn { background: #232325; }
`;
