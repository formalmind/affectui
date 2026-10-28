"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/*
 * KPI Board – the top of a dashboard in one self-contained file: one date range for everything, three small trend cards, one large overview chart
 * that compares this period with the last, and a focus card for one product or plan.
 * All charts share one look: thin angular lines, a quiet fill, dates under the plot.
 *   · hover a small card and the day under the pointer gets a dot, its value in a small tag and its date on the axis
 *   · hover the overview and a dark tooltip compares this period with the last at that day
 *   · switch the range and every number rolls while the lines draw themselves in again; the filter inside the
 *     overview does the same for that one card only
 *   · on first view the cards rise in and the lines are drawn from the left
 * No chart library – plain SVG. The styles are injected below, so no extra files are needed.
 */

export type KpiStat = {
  id: string;
  label: string;
  /** "money" runs the value through formatMoney, "count" shows a whole number */
  kind?: "money" | "count";
  /** One label per point, e.g. "17 Aug" */
  labels: string[];
  values: number[];
  /** Total of the period before – shown as the change on the right */
  previous?: number;
  /** Set when a smaller number is the good news, e.g. refunds */
  lowerIsBetter?: boolean;
};

export type KpiBoardData = {
  /** The small cards in the first row – three fit best */
  stats: KpiStat[];
  overview: {
    title: string;
    labels: string[];
    current: number[];
    previous: number[];
    /** The same two lines per segment id – picked with the filter inside this card, which changes nothing else */
    segments?: Record<string, { current: number[]; previous: number[] }>;
  };
  focus: {
    title: string;
    note?: string;
    /** What is counted, e.g. "Product sales rate" */
    metric: string;
    /** Word after the number, e.g. "items" */
    unit?: string;
    labels: string[];
    values: number[];
    /** Total of the period before */
    previous: number;
  };
};

export type KpiBoardProps = {
  /** One data set per range id */
  data: Record<string, KpiBoardData>;
  ranges: { id: string; label: string }[];
  /** Controlled range id */
  range?: string;
  defaultRange?: string;
  onRangeChange?: (id: string) => void;
  /** A filter inside the overview card, e.g. All items / Pro / Team – it only switches the overview's lines (see overview.segments) */
  segments?: { id: string; label: string }[];
  segment?: string;
  defaultSegment?: string;
  onSegmentChange?: (id: string) => void;
  /** Words after every change, e.g. "vs. last month" */
  compareLabel?: string;
  /** Names of the two lines in the overview tooltip */
  currentLabel?: string;
  previousLabel?: string;
  formatMoney?: (value: number) => string;
  /** Icon in the focus card */
  icon?: ReactNode;
  /** Heading on the left of the bar above the cards */
  title?: string;
  /** The small button at the top right of the focus card, e.g. Set up */
  setup?: { label: string; onClick: () => void };
  /** The button at the bottom of the focus card */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/* ---------- Helpers ---------- */

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const whole = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n));
const money = (n: number) => `$${new Intl.NumberFormat("en-US", { minimumFractionDigits: Math.abs(n) < 10000 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 10000 ? 2 : 0 }).format(n)}`;
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A series stretched or squeezed to a fixed number of points, so lines of different lengths can glide into each other */
function resample(values: number[] | undefined, n: number): number[] {
  if (!values || values.length === 0) return new Array(n).fill(0);
  if (values.length === 1) return new Array(n).fill(values[0]);
  return Array.from({ length: n }, (_, i) => {
    const at = (i / (n - 1)) * (values.length - 1);
    const lo = Math.floor(at);
    const hi = Math.min(values.length - 1, lo + 1);
    return mix(values[lo], values[hi], at - lo);
  });
}

/** Straight segments through evenly spaced points in a 0–100 box: the line, and the same shape closed to the floor */
function trace(values: number[], lo: number, hi: number, top = 6, bottom = 94) {
  const span = hi - lo || 1;
  const pts = values.map((v, i) => [(i / Math.max(1, values.length - 1)) * 100, bottom - ((v - lo) / span) * (bottom - top)] as const);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join("");
  return { pts, line, area: `${line}L100,100L0,100Z` };
}

/** Where a point of the real data sits on a traced (resampled) line, in percent */
const spot = (pts: readonly (readonly [number, number])[], index: number, length: number) => pts[Math.round((index / Math.max(1, length - 1)) * (pts.length - 1))];

/**
 * Glides from the data that was shown to the data that is asked for. Returns the old data (null on first view,
 * which reads as "everything at zero") and how far along the move is, 0–1 and already eased.
 */
function useBlend<T>(value: T, key: string, duration = 760) {
  const from = useRef<T | null>(null);
  const to = useRef(value);
  const shownKey = useRef<string | null>(null);
  const [state, setState] = useState<{ key: string | null; t: number }>({ key: null, t: 0 });
  if (shownKey.current !== key) {
    if (shownKey.current !== null) from.current = to.current;
    shownKey.current = key;
  }
  to.current = value;
  useEffect(() => {
    if (reduced()) return setState({ key, t: 1 });
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setState({ key, t: ease(p) });
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [key, duration]);
  return { from: from.current, t: state.key === key ? state.t : 0 };
}

/* ---------- Small parts ---------- */

const ChevronIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="m2.5 3.8 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.6 6.3 2.2 2.2 4.6-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const GearIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 4.2h5.2M10.2 4.2H12M2 9.8h1.8M6.8 9.8H12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8.7" cy="4.2" r="1.5" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="5.3" cy="9.8" r="1.5" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);
const BoxIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 1.9 13.3 4.8v6.4L8 14.1 2.7 11.2V4.8L8 1.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M2.9 4.9 8 7.7l5.1-2.8M8 7.7V14" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
);

/** "▲ 12%" in green or red; `good` decides the color, `up` the direction of the arrow */
function Change({ up, good, children }: { up: boolean; good: boolean; children: ReactNode }) {
  return (
    <span className="ui-kb__change" data-good={good ? "" : undefined}>
      <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={up ? undefined : { transform: "scaleY(-1)" }}>
        <path d="M4 1.2 7.2 6.4H.8L4 1.2Z" fill="currentColor" />
      </svg>
      {children}
    </span>
  );
}

/** A bordered button with its own small menu – arrow keys move, Enter picks, Escape or a press outside closes */
function Pick({ label, value, options, onChange }: { label: string; value: string; options: { id: string; label: string }[]; onChange: (id: string) => void }) {
  const uid = useId();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = Math.max(0, options.findIndex((o) => o.id === value));

  useEffect(() => {
    if (!open) return;
    const down = (e: globalThis.PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const show = () => {
    setActive(selected);
    setOpen(true);
  };
  const choose = (index: number) => {
    setOpen(false);
    if (options[index] && options[index].id !== value) onChange(options[index].id);
    ref.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={ref} className="ui-kb__pick" data-open={open ? "" : undefined} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="ui-kb__pick-button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        aria-activedescendant={open ? `${uid}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span>{options[selected]?.label}</span>
        <ChevronIcon />
      </button>
      {open && (
        <ul id={`${uid}-list`} className="ui-kb__menu" role="listbox" aria-label={label}>
          {options.map((o, i) => (
            <li
              key={o.id}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={i === selected}
              className="ui-kb__option"
              data-active={i === active ? "" : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              <span>{o.label}</span>
              {i === selected && <CheckIcon />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KpiBoard({
  data,
  ranges,
  range,
  defaultRange,
  onRangeChange,
  segments,
  segment,
  defaultSegment,
  onSegmentChange,
  compareLabel = "vs. last period",
  currentLabel = "This period",
  previousLabel = "Last period",
  formatMoney = money,
  icon,
  title,
  setup,
  action,
  className,
}: KpiBoardProps) {
  const uid = useId().replace(/:/g, "");
  const [innerRange, setInnerRange] = useState(defaultRange ?? ranges[0]?.id);
  const rangeId = range ?? innerRange ?? ranges[0]?.id;
  const [innerSegment, setInnerSegment] = useState(defaultSegment ?? segments?.[0]?.id);
  const segmentId = segment ?? innerSegment;
  const d = data[rangeId] ?? Object.values(data)[0];

  const { from, t } = useBlend(d, rangeId);
  // The overview follows the range and its own filter; nothing else reacts to that filter
  const ov = (segmentId && d.overview.segments?.[segmentId]) || d.overview;
  const ovKey = `${rangeId}/${segmentId ?? ""}`;
  const ovBlend = useBlend(sum(ov.current), ovKey);
  /** A number on its way from the old data to the new */
  const roll = (pick: (data: KpiBoardData) => number) => mix(from ? pick(from) : 0, pick(d), t);
  /** The line of the shown data. Lines don't glide between ranges – they are drawn in again from the left */
  const glide = (pick: (data: KpiBoardData) => number[] | undefined, n: number) => {
    const values = pick(d) ?? [];
    // Every point keeps its kink; only very long series are thinned out
    return values.length >= 2 && values.length <= n ? values : resample(values, n);
  };
  /** Changes with every new data set, so the drawing-in starts over */
  const drawn = rangeId;
  const show = (kind: KpiStat["kind"], n: number) => (kind === "count" ? whole(n) : formatMoney(n));

  /** The day under the pointer as a position 0–1 – for one small card at a time, for the overview, and for the focus card */
  const [day, setDay] = useState<{ id: string; at: number } | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [focusAt, setFocusAt] = useState<number | null>(null);
  /** Mouse: follow the pointer. Touch: press or drag sideways on a chart, let go and the mark leaves */
  const scrub = (set: (v: number | null) => void) => {
    const move = (e: PointerEvent<HTMLElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      set(Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)));
    };
    const end = (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType !== "mouse") set(null);
    };
    return { onPointerDown: move, onPointerMove: move, onPointerUp: end, onPointerCancel: end, onPointerLeave: () => set(null) };
  };

  const setRange = (id: string) => {
    setInnerRange(id);
    setDay(null);
    setAt(null);
    setFocusAt(null);
    onRangeChange?.(id);
  };
  const setSegment = (id: string) => {
    setInnerSegment(id);
    setAt(null);
    onSegmentChange?.(id);
  };

  /* ---------- Overview ---------- */

  const now = glide(() => ov.current, 72);
  const before = glide(() => ov.previous, 72);
  const ovHi = Math.max(...now, ...before, 1) * 1.06;
  const ovLo = Math.min(...now, ...before) * 0.82;
  const ovNow = trace(now, ovLo, ovHi);
  const ovBefore = trace(before, ovLo, ovHi);
  const ovTotal = mix(ovBlend.from ?? 0, sum(ov.current), ovBlend.t);
  const ovChange = sum(ov.previous) ? ((sum(ov.current) - sum(ov.previous)) / sum(ov.previous)) * 100 : 0;
  const ovIndex = at === null ? null : Math.round(at * (ov.current.length - 1));
  const ovDot = ovIndex === null ? null : spot(ovNow.pts, ovIndex, ov.current.length);
  const ovDotBefore = ovIndex === null ? null : spot(ovBefore.pts, ovIndex, ov.current.length);

  /* ---------- Focus ---------- */

  const focusLine = glide((x) => x.focus.values, 48);
  const fHi = Math.max(...focusLine, 1) * 1.05;
  const fLo = Math.min(...focusLine) * 0.8;
  const fTrace = trace(focusLine, fLo, fHi, 8, 92);
  const fTotal = roll((x) => sum(x.focus.values));
  const fChange = d.focus.previous ? ((sum(d.focus.values) - d.focus.previous) / d.focus.previous) * 100 : 0;
  const fIndex = focusAt === null ? null : Math.round(focusAt * (d.focus.values.length - 1));
  const fDot = fIndex === null ? null : spot(fTrace.pts, fIndex, d.focus.values.length);

  return (
    <div className={["ui-kb", className].filter(Boolean).join(" ")}>
      <style href="ui-kpi-board" precedence="default">
        {css}
      </style>

      {/* The date range sits above everything, because it changes every card */}
      <div className="ui-kb__bar">
        {title && <h2 className="ui-kb__heading">{title}</h2>}
        <Pick label="Date range" value={rangeId} options={ranges} onChange={setRange} />
      </div>

      {/* Row 1 – small trend cards; each marks the day under the pointer on its own */}
      {d.stats.map((s, i) => {
        const line = glide((x) => x.stats[i]?.values, 48);
        const hi = Math.max(...line, 1) * 1.08;
        const lo = Math.min(...line) * 0.75;
        const tr = trace(line, lo, hi, 10, 92);
        const total = roll((x) => sum(x.stats[i]?.values ?? []));
        const diff = s.previous === undefined ? null : sum(s.values) - s.previous;
        const index = day?.id !== s.id ? null : Math.round(day.at * (s.values.length - 1));
        const dot = index === null ? null : spot(tr.pts, index, s.values.length);
        return (
          <section key={s.id} className="ui-kb__card ui-kb__stat" aria-label={s.label} style={{ ["--n" as string]: i }}>
            <header className="ui-kb__row">
              <span className="ui-kb__pair">
                <b>{show(s.kind, total)}</b>
                <span>{s.label}</span>
              </span>
              {diff !== null && (
                <span className="ui-kb__pair ui-kb__pair--end">
                  {diff === 0 ? (
                    <b>0</b>
                  ) : (
                    <Change up={diff > 0} good={s.lowerIsBetter ? diff < 0 : diff > 0}>
                      {show(s.kind, Math.abs(diff))}
                    </Change>
                  )}
                  <span>{compareLabel}</span>
                </span>
              )}
            </header>
            <div className="ui-kb__plot ui-kb__plot--small" {...scrub((at) => setDay(at === null ? null : { id: s.id, at }))}>
              <svg key={drawn} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path className="ui-kb__fill" d={tr.area} />
                <path className="ui-kb__line" d={tr.line} />
              </svg>
              {dot && index !== null && (
                <>
                  <span className="ui-kb__rule" style={{ left: `${dot[0]}%`, top: `${dot[1]}%` }} />
                  <span className="ui-kb__dot" style={{ left: `${dot[0]}%`, top: `${dot[1]}%` }} />
                  <span className="ui-kb__tag" data-side={dot[0] > 62 ? "left" : "right"} style={{ left: `${dot[0]}%`, top: `${dot[1]}%` }}>
                    <span>{s.labels[index]}</span>
                    <b>{show(s.kind, s.values[index])}</b>
                  </span>
                </>
              )}
            </div>
            <div className="ui-kb__axis" aria-hidden="true">
              <span>{s.labels[0]}</span>
              <span>{s.labels[s.labels.length - 1]}</span>
              {dot && index !== null && (
                <span className="ui-kb__axis-tag" style={{ left: `${Math.min(88, Math.max(12, dot[0]))}%` }}>
                  {s.labels[index]}
                </span>
              )}
            </div>
          </section>
        );
      })}

      {/* Row 2 – the overview: this period against the last */}
      <section className="ui-kb__card ui-kb__overview" aria-label={d.overview.title} style={{ ["--n" as string]: 3 }}>
        <header className="ui-kb__row ui-kb__row--top">
          <div>
            <div className="ui-kb__label">{d.overview.title}</div>
            <div className="ui-kb__figure">
              <b>{formatMoney(ovTotal)}</b>
              <span className="ui-kb__vs">
                <i data-good={ovChange >= 0 ? "" : undefined}>
                  {ovChange >= 0 ? "+" : "−"}
                  {Math.abs(ovChange).toFixed(1)}%
                </i>{" "}
                {compareLabel}
              </span>
            </div>
          </div>
          {segments && segmentId && <Pick label="Segment" value={segmentId} options={segments} onChange={setSegment} />}
        </header>
        <div className="ui-kb__plot ui-kb__plot--large" {...scrub(setAt)}>
          <svg key={ovKey} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={`${uid}-fade`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--ui-kb-accent)" stopOpacity="0.14" />
                <stop offset="1" stopColor="var(--ui-kb-accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {Array.from({ length: 19 }, (_, i) => (
              <path key={i} className="ui-kb__grid" d={`M${((i / 18) * 100).toFixed(2)},0V100`} />
            ))}
            <path d={ovNow.area} fill={`url(#${uid}-fade)`} />
            <path className="ui-kb__line ui-kb__line--soft" d={ovBefore.line} />
            <path className="ui-kb__line" d={ovNow.line} />
          </svg>
          {ovDot && ovDotBefore && ovIndex !== null && (
            <>
              <span className="ui-kb__rule" style={{ left: `${ovDot[0]}%`, top: 0 }} />
              <span className="ui-kb__dot ui-kb__dot--soft" style={{ left: `${ovDotBefore[0]}%`, top: `${ovDotBefore[1]}%` }} />
              <span className="ui-kb__dot" style={{ left: `${ovDot[0]}%`, top: `${ovDot[1]}%` }} />
              <div className="ui-kb__tip" data-side={ovDot[0] > 58 ? "left" : "right"} style={{ left: `${ovDot[0]}%`, top: `${Math.min(ovDot[1], ovDotBefore[1])}%` }}>
                <div className="ui-kb__tip-head">
                  <span>{d.overview.labels[ovIndex]}</span>
                  <b>{formatMoney(ov.current[ovIndex] + (ov.previous[ovIndex] ?? 0))}</b>
                </div>
                <div className="ui-kb__tip-row">
                  <i />
                  <span>{currentLabel}</span>
                  <b>{formatMoney(ov.current[ovIndex])}</b>
                </div>
                <div className="ui-kb__tip-row" data-soft="">
                  <i />
                  <span>{previousLabel}</span>
                  <b>{formatMoney(ov.previous[ovIndex] ?? 0)}</b>
                </div>
              </div>
            </>
          )}
        </div>
        <div className="ui-kb__axis" aria-hidden="true">
          <span>{d.overview.labels[0]}</span>
          <span>{d.overview.labels[d.overview.labels.length - 1]}</span>
        </div>
      </section>

      {/* Row 2 – the focus card: one product, plan or channel */}
      <section className="ui-kb__card ui-kb__focus" aria-label={d.focus.title} style={{ ["--n" as string]: 4 }}>
        <header className="ui-kb__row ui-kb__row--top">
          <div className="ui-kb__product">
            <span className="ui-kb__icon">{icon ?? <BoxIcon />}</span>
            <span className="ui-kb__pair">
              <b>{d.focus.title}</b>
              {d.focus.note && <span>{d.focus.note}</span>}
            </span>
          </div>
          {setup && (
            <button type="button" className="ui-kb__setup" onClick={setup.onClick}>
              <GearIcon />
              {setup.label}
            </button>
          )}
        </header>
        <div className="ui-kb__label">{d.focus.metric}</div>
        <div className="ui-kb__figure ui-kb__figure--small">
          <b>
            {whole(fIndex === null ? fTotal : d.focus.values[fIndex])}
            {d.focus.unit ? ` ${d.focus.unit}` : ""}
          </b>
          <span className="ui-kb__vs">
            {fIndex === null ? (
              <>
                <Change up={fChange >= 0} good={fChange >= 0}>
                  {Math.abs(fChange).toFixed(0)}%
                </Change>{" "}
                {compareLabel}
              </>
            ) : (
              d.focus.labels[fIndex]
            )}
          </span>
        </div>
        <div className="ui-kb__plot ui-kb__plot--small" {...scrub(setFocusAt)}>
          <svg key={drawn} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="ui-kb__fill" d={fTrace.area} />
            <path className="ui-kb__line" d={fTrace.line} />
          </svg>
          {fDot && (
            <>
              <span className="ui-kb__rule" style={{ left: `${fDot[0]}%`, top: `${fDot[1]}%` }} />
              <span className="ui-kb__dot" style={{ left: `${fDot[0]}%`, top: `${fDot[1]}%` }} />
            </>
          )}
        </div>
        <div className="ui-kb__legend">
          <span>{previousLabel}</span>
          <b data-soft="">{whole(roll((x) => x.focus.previous))}</b>
          <span>{currentLabel}</span>
          <b>{whole(fTotal)}</b>
        </div>
        {action && (
          <button type="button" className="ui-kb__action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </section>
    </div>
  );
}

const css = /* css */ `
.ui-kb {
  --ui-kb-card: #ffffff;
  --ui-kb-line: #e7e7ea;
  --ui-kb-ink: #26262b;
  --ui-kb-text: #55555c;
  --ui-kb-muted: #96969e;
  --ui-kb-well: #f6f6f8;
  --ui-kb-rule: #a4a4ac;
  --ui-kb-accent: #2f6bff;
  --ui-kb-soft: #a9c4ff;
  --ui-kb-good: #12a36b;
  --ui-kb-bad: #d6453d;
  --ui-kb-tip: #1c1c20;
  --ui-kb-focus: rgba(23, 23, 23, 0.22);
  --ui-kb-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
  line-height: 20px;
  color: var(--ui-kb-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-kb *, .ui-kb *::before, .ui-kb *::after { box-sizing: border-box; }
:where(.ui-kb) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-kb button:focus-visible { outline: 2px solid var(--ui-kb-focus); outline-offset: 2px; }
.ui-kb svg { display: block; }
.ui-kb b { font-weight: 600; color: var(--ui-kb-ink); }
.ui-kb i { font-style: normal; }

/* ----- The bar above the cards: a heading, and the date range for all of them ----- */
.ui-kb__bar { grid-column: 1 / -1; display: flex; align-items: center; justify-content: flex-end; gap: 12px; min-height: 30px; }
.ui-kb__heading { flex: 1; min-width: 0; margin: 0; overflow: hidden; font-size: 17px; font-weight: 600; line-height: 24px; letter-spacing: -0.01em; color: var(--ui-kb-ink); white-space: nowrap; text-overflow: ellipsis; }

/* ----- Cards: white, a hairline, a whisper of shadow ----- */
.ui-kb__card { grid-column: span 2; display: flex; flex-direction: column; min-width: 0; padding: 16px 16px 14px; border: 1px solid var(--ui-kb-line); border-radius: 12px; background: var(--ui-kb-card); box-shadow: 0 1px 2px rgba(16, 16, 24, 0.04); animation: ui-kb-rise 620ms var(--ui-kb-ease) both; animation-delay: calc(var(--n) * 60ms); }
.ui-kb__overview { grid-column: span 4; }
.ui-kb__focus { padding-bottom: 16px; }
.ui-kb__row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-width: 0; }
.ui-kb__pair { display: grid; min-width: 0; font-variant-numeric: tabular-nums; }
.ui-kb__pair > * { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-kb__pair b { font-size: 14px; }
.ui-kb__pair span { color: var(--ui-kb-muted); }
.ui-kb__pair--end { justify-items: end; flex: none; text-align: right; }
.ui-kb__change { display: inline-flex; align-items: center; gap: 5px; font-size: 14px; font-weight: 600; color: var(--ui-kb-bad); font-variant-numeric: tabular-nums; }
.ui-kb__change[data-good] { color: var(--ui-kb-good); }

/* ----- One look for every chart: thin angular line, quiet fill, a floor line ----- */
.ui-kb__plot { position: relative; margin-top: 14px; border-bottom: 1px solid var(--ui-kb-line); cursor: crosshair; touch-action: pan-y; }
.ui-kb__plot--small { height: 64px; }
.ui-kb__plot--large { flex: 1; min-height: 190px; margin-top: 16px; border-bottom: 0; }
.ui-kb__plot svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; animation: ui-kb-draw 1100ms var(--ui-kb-ease) both; animation-delay: calc(120ms + var(--n) * 60ms); }
.ui-kb__line { fill: none; stroke: var(--ui-kb-accent); stroke-width: 1.5; stroke-linejoin: miter; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.ui-kb__line--soft { stroke: var(--ui-kb-soft); }
.ui-kb__fill { fill: var(--ui-kb-well); }
.ui-kb__grid { fill: none; stroke: var(--ui-kb-line); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; }
.ui-kb__axis { position: relative; display: flex; justify-content: space-between; height: 16px; margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--ui-kb-muted); white-space: nowrap; }

/* Pointing at a day */
.ui-kb__rule { position: absolute; bottom: 0; width: 0; margin-left: -0.5px; border-left: 1px dashed var(--ui-kb-rule); pointer-events: none; }
.ui-kb__dot { position: absolute; z-index: 1; width: 8px; height: 8px; margin: -4px 0 0 -4px; border: 1.5px solid var(--ui-kb-accent); border-radius: 50%; background: var(--ui-kb-card); pointer-events: none; }
.ui-kb__dot--soft { border-color: var(--ui-kb-soft); }
.ui-kb__tag { position: absolute; z-index: 2; display: inline-flex; gap: 12px; height: 24px; padding: 0 8px; border: 1px solid var(--ui-kb-line); border-radius: 6px; background: var(--ui-kb-card); box-shadow: 0 2px 6px rgba(16, 16, 24, 0.06); font-size: 12px; line-height: 22px; color: var(--ui-kb-text); white-space: nowrap; pointer-events: none; transform: translate(10px, -130%); font-variant-numeric: tabular-nums; animation: ui-kb-in 160ms ease both; }
.ui-kb__tag[data-side="left"] { transform: translate(calc(-100% - 10px), -130%); }
.ui-kb__tag b { font-weight: 500; color: var(--ui-kb-accent); }
.ui-kb__axis-tag { position: absolute; top: -4px; height: 22px; padding: 0 7px; border: 1px solid var(--ui-kb-line); border-radius: 6px; background: var(--ui-kb-card); line-height: 20px; color: var(--ui-kb-ink); transform: translateX(-50%); }

/* ----- Overview ----- */
.ui-kb__row--top { padding-bottom: 14px; border-bottom: 1px solid var(--ui-kb-line); }
.ui-kb__label { font-size: 13px; color: var(--ui-kb-text); }
.ui-kb__figure { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin-top: 4px; font-variant-numeric: tabular-nums; }
.ui-kb__figure b { font-size: 24px; line-height: 30px; letter-spacing: -0.02em; }
.ui-kb__figure--small b { font-size: 19px; line-height: 26px; }
.ui-kb__vs { display: inline-flex; align-items: baseline; gap: 5px; font-size: 13px; color: var(--ui-kb-muted); white-space: nowrap; }
.ui-kb__vs i { font-weight: 600; color: var(--ui-kb-bad); }
.ui-kb__vs i[data-good] { color: var(--ui-kb-good); }
.ui-kb__vs .ui-kb__change { font-size: 13px; }
.ui-kb__pick { position: relative; flex: none; }
.ui-kb__pick-button { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 9px 0 11px; border: 1px solid var(--ui-kb-line); border-radius: 8px; background: var(--ui-kb-card); box-shadow: 0 1px 1px rgba(16, 16, 24, 0.04); font-size: 12.5px; color: var(--ui-kb-ink); white-space: nowrap; transition: border-color 160ms ease, background-color 160ms ease; }
.ui-kb__pick-button:hover, .ui-kb__pick[data-open] .ui-kb__pick-button { border-color: #cfcfd6; }
.ui-kb__pick[data-open] .ui-kb__pick-button { background: var(--ui-kb-well); }
.ui-kb__pick-button svg { color: var(--ui-kb-muted); transition: transform 240ms var(--ui-kb-ease); }
.ui-kb__pick[data-open] .ui-kb__pick-button svg { transform: rotate(180deg); }
.ui-kb__menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 10; min-width: max(100%, 148px); margin: 0; padding: 4px; border: 1px solid var(--ui-kb-line); border-radius: 10px; background: var(--ui-kb-card); box-shadow: 0 10px 28px rgba(16, 16, 24, 0.1), 0 2px 6px rgba(16, 16, 24, 0.05); list-style: none; transform-origin: 100% 0; animation: ui-kb-menu 200ms var(--ui-kb-ease) both; }
.ui-kb__option { display: flex; align-items: center; justify-content: space-between; gap: 14px; height: 30px; padding: 0 8px 0 9px; border-radius: 7px; font-size: 12.5px; color: var(--ui-kb-text); white-space: nowrap; cursor: pointer; }
.ui-kb__option[data-active] { background: var(--ui-kb-well); color: var(--ui-kb-ink); }
.ui-kb__option[aria-selected="true"] { font-weight: 500; color: var(--ui-kb-ink); }
.ui-kb__option svg { color: var(--ui-kb-accent); }

.ui-kb__tip { position: absolute; z-index: 3; min-width: 168px; padding: 9px 11px 10px; border-radius: 8px; background: var(--ui-kb-tip); box-shadow: 0 8px 24px rgba(16, 16, 24, 0.18); font-size: 12.5px; line-height: 20px; color: rgba(255, 255, 255, 0.72); pointer-events: none; transform: translate(14px, calc(-100% - 12px)); font-variant-numeric: tabular-nums; animation: ui-kb-in 160ms ease both; }
.ui-kb__tip[data-side="left"] { transform: translate(calc(-100% - 14px), calc(-100% - 12px)); }
.ui-kb__tip b { font-weight: 500; color: #fff; }
.ui-kb__tip-head { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 6px; color: #fff; }
.ui-kb__tip-head b { color: #4ade9b; }
.ui-kb__tip-row { display: flex; align-items: center; gap: 7px; }
.ui-kb__tip-row span { flex: 1; }
.ui-kb__tip-row i { width: 7px; height: 7px; border: 1.5px solid #7ea2ff; border-radius: 50%; }
.ui-kb__tip-row[data-soft] i { border-color: #5a6a96; }

/* ----- Focus card ----- */
.ui-kb__focus .ui-kb__row--top { align-items: center; min-height: 69px; margin-bottom: 16px; }
.ui-kb__focus .ui-kb__plot--small { flex: 1; min-height: 64px; margin-top: 16px; }
.ui-kb__product { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ui-kb__product b { font-size: 14.5px; font-weight: 500; }
.ui-kb__icon { display: grid; flex: none; place-items: center; width: 36px; height: 36px; border: 1px solid var(--ui-kb-line); border-radius: 9px; box-shadow: 0 1px 1px rgba(16, 16, 24, 0.04); color: var(--ui-kb-text); }
.ui-kb__focus .ui-kb__label { font-size: 12.5px; color: var(--ui-kb-muted); }
.ui-kb__legend { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; margin-top: 12px; font-size: 12.5px; color: var(--ui-kb-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-kb__legend b { margin-right: 6px; font-weight: 500; color: var(--ui-kb-accent); }
.ui-kb__legend b[data-soft] { color: var(--ui-kb-soft); }
.ui-kb__setup { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 30px; padding: 0 11px 0 9px; border: 1px solid var(--ui-kb-line); border-radius: 8px; background: var(--ui-kb-card); box-shadow: 0 1px 1px rgba(16, 16, 24, 0.04); font-size: 12.5px; color: var(--ui-kb-ink); white-space: nowrap; transition: border-color 160ms ease, background-color 160ms ease; }
.ui-kb__setup:hover { border-color: #cfcfd6; background: var(--ui-kb-well); }
.ui-kb__setup svg { color: var(--ui-kb-muted); }
.ui-kb__action { height: 34px; margin-top: auto; border: 1px solid var(--ui-kb-line); border-radius: 8px; background: var(--ui-kb-card); box-shadow: 0 1px 2px rgba(16, 16, 24, 0.06); font-size: 13px; font-weight: 500; color: var(--ui-kb-ink); transition: background-color 160ms ease; }
.ui-kb__legend + .ui-kb__action { margin-top: 16px; }
.ui-kb__action:hover { background: var(--ui-kb-well); }

@keyframes ui-kb-rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes ui-kb-draw { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(-8px -8px -8px -8px); } }
@keyframes ui-kb-in { from { opacity: 0; } }
@keyframes ui-kb-menu { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }

/* Narrower containers: the overview and the focus card take a full row, then everything stacks */
@container (max-width: 820px) {
  .ui-kb__overview, .ui-kb__focus { grid-column: span 6; }
  /* Three small cards still share a row – the change moves under the label, and its words give way */
  .ui-kb__stat .ui-kb__row { flex-direction: column; gap: 2px; }
  .ui-kb__stat .ui-kb__pair--end { justify-items: start; text-align: left; }
  .ui-kb__stat .ui-kb__change { font-size: 12.5px; }
  .ui-kb__stat .ui-kb__pair--end > span:last-child { display: none; }
}
@container (max-width: 600px) {
  .ui-kb { gap: 8px; }
  .ui-kb__card { grid-column: span 6; }
  .ui-kb__stat .ui-kb__row { flex-direction: row; gap: 12px; }
  .ui-kb__stat .ui-kb__pair--end { justify-items: end; text-align: right; }
  .ui-kb__stat .ui-kb__change { font-size: 14px; }
  .ui-kb__stat .ui-kb__pair--end > span:last-child { display: block; }
  .ui-kb__row--top { flex-wrap: wrap; }
  .ui-kb__plot--large { min-height: 160px; }
}

@media (pointer: coarse) {
  .ui-kb__pick-button, .ui-kb__setup { height: 36px; }
  .ui-kb__option { height: 38px; }
  .ui-kb__action { height: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-kb *, .ui-kb *::before, .ui-kb *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-kb {
  --ui-kb-card: #19191b;
  --ui-kb-line: #2a2a2e;
  --ui-kb-ink: #ededed;
  --ui-kb-text: #b9b9bf;
  --ui-kb-muted: #84848c;
  --ui-kb-well: #202024;
  --ui-kb-rule: #6a6a72;
  --ui-kb-accent: #5b8cff;
  --ui-kb-soft: #37508f;
  --ui-kb-good: #4ade9b;
  --ui-kb-bad: #ff8f86;
  --ui-kb-tip: #2c2c32;
  --ui-kb-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-kb__pick-button:hover, :where(.dark, [data-theme="dark"]) .ui-kb__pick[data-open] .ui-kb__pick-button { border-color: #45454c; }
:where(.dark, [data-theme="dark"]) .ui-kb__menu { box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5); }
`;
