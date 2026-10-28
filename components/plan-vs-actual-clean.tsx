"use client";

import { memo, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Plan vs Actual – an agent's plan as a live Gantt chart, the plan as a dashed ghost under every step, in a single
 * self-contained file.
 *   · every step's real bar grows over its ghost; the part that runs past the plan turns amber
 *   · steps that haven't started show where they will now run – they slide right when a step before them runs
 *     over, and stay put when they have room to spare
 *   · the planned finish is a dashed line, the expected finish (ETA) a solid one that moves; the gap between them is
 *     how late the run is, also counted live in the bar on top
 *   · time and cost so far sit in the bar on top, each against the plan
 *   · point at a step to see what it waits for, what waits for it, and what it cost
 * The styles are injected below, so no extra files are needed.
 */

export type PlanStep = {
  id: string;
  /** What the step does, in a few words – e.g. "Build the layout" */
  title: string;
  /** How long it was planned to take, in ms */
  plan: number;
  /** Steps that have to finish first */
  deps?: string[];
  /** When it really started, in ms from the start of the run – leave out while it waits */
  start?: number;
  /** When it really finished – leave out while it runs */
  end?: number;
  /** A small mark before the title – e.g. the tool's logo */
  icon?: ReactNode;
  /** What it has cost so far – shown when you point at the step, and added up in the bar on top */
  cost?: number;
  /** What it was planned to cost – the plan's total shows next to the spend */
  planCost?: number;
};

export type PlanVsActualProps = {
  steps: PlanStep[];
  /** Where the run is now, in ms from its start */
  now: number;
  /** What the run is for – e.g. "Ship the pricing page" */
  task?: string;
  /** Formats a time – defaults to 0:42 / 1:05 */
  formatTime?: (ms: number) => string;
  /** Formats a cost – defaults to dollars */
  formatCost?: (amount: number) => string;
  title?: string;
  className?: string;
};

type Status = "waiting" | "running" | "done";
type Placed = {
  step: PlanStep;
  index: number;
  status: Status;
  /** The plan */
  ps: number;
  pe: number;
  /** Real or expected start and end */
  as: number;
  ae: number;
};

/* ---------- Helpers ---------- */

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Seconds as 0:42 / 1:05 – an hour and more as 1:04:05, a day and more as 3d 4h */
const span = (s: number) => {
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
};
const clock = (ms: number) => span(Math.max(0, Math.round(ms / 1000)));
/** A difference: "+12s", "−1:05" */
const delta = (ms: number) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${ms < 0 ? "−" : "+"}${s < 60 ? `${s}s` : span(s)}`;
};
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** $1,234.50 – and <$0.01 for a cost that's there but rounds to nothing */
const dollars = (n: number) => (n !== 0 && Math.abs(n) < 0.005 ? `${n < 0 ? "-" : ""}<$0.01` : usd.format(n));
/** Less than this counts as on plan */
const SLACK = 1500;
/** Grid steps for the axis – the first that keeps it to about ten lines */
const TICKS = [30e3, 60e3, 120e3, 300e3, 600e3, 900e3, 1800e3, 3600e3, 7200e3, 10800e3, 21600e3, 43200e3, 86400e3, 172800e3, 604800e3];
/** A number from the outside: NaN and Infinity count as not given */
const num = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);

/** Plan and real or expected times for every step – each step starts once all it waits for has finished */
function place(steps: PlanStep[], now: number): Placed[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const indexOf = new Map(steps.map((s, i) => [s, i]));
  const memo = new Map<string, Placed>();
  // A step that (through others) waits for itself: that wait is left out instead of looping forever
  const visiting = new Set<string>();
  const visit = (s: PlanStep, index: number): Placed => {
    const hit = memo.get(s.id);
    if (hit) return hit;
    visiting.add(s.id);
    const deps = (s.deps ?? []).map((id) => byId.get(id)).filter((d): d is PlanStep => !!d && !visiting.has(d.id));
    const before = deps.map((d) => visit(d, indexOf.get(d)!));
    visiting.delete(s.id);
    const ps = Math.max(0, ...before.map((b) => b.pe));
    const pe = ps + s.plan;
    const status: Status = s.end !== undefined ? "done" : s.start !== undefined ? "running" : "waiting";
    let as: number;
    let ae: number;
    if (status === "done") {
      as = s.start ?? s.end! - s.plan;
      ae = s.end!;
    } else if (status === "running") {
      as = s.start!;
      ae = Math.max(now, as + s.plan);
    } else {
      // Can't start in the past – nor before everything it waits for is expected to be done
      as = Math.max(now, ...before.map((b) => b.ae));
      ae = as + s.plan;
    }
    const placed = { step: s, index, status, ps, pe, as, ae };
    memo.set(s.id, placed);
    return placed;
  };
  return steps.map((s, i) => visit(s, i));
}

/* ---------- Icons ---------- */

/* The chart mark and the step states: drawn for affectUI */
const ChartMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="7" height="3" rx="1.5" fill="currentColor" />
    <rect x="5" y="6.5" width="8" height="3" rx="1.5" fill="currentColor" opacity="0.6" />
    <rect x="8.5" y="10.5" width="6" height="3" rx="1.5" fill="currentColor" opacity="0.32" />
  </svg>
);
const StateIcon = ({ status }: { status: Status }) =>
  status === "done" ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7.4 5.7 10 11 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : status === "running" ? (
    <svg className="ui-pvac__spin" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
      <path d="M7 2a5 5 0 0 1 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2" />
    </svg>
  );

/** Position and width on the time axis as CSS variables */
const at = (start: number, end: number) => ({ "--s": start, "--d": Math.max(0, end - start) }) as CSSProperties;

/**
 * Times on the axis as they're shown. Small moves (the run ticking on) are followed exactly; a jump – a step that
 * finishes early, so everything after it moves up – glides there. Bars, numbers and links all read the same values,
 * so they always move together.
 */
function useGlide(target: Record<string, number>, snap: number) {
  const shown = useRef<Record<string, number>>({});
  const gliding = useRef(new Set<string>());
  const last = useRef(0);
  const [, redraw] = useState(0);
  const t = typeof performance === "undefined" ? 0 : performance.now();
  const dt = last.current ? Math.min(64, t - last.current) : 0;
  last.current = t;
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const out: Record<string, number> = {};
  for (const key in target) {
    const to = target[key];
    const from = shown.current[key];
    const gap = from === undefined ? 0 : Math.abs(to - from);
    // A jump starts a glide; a glide runs until it's practically there
    if (gap > snap) gliding.current.add(key);
    if (reduced || from === undefined || !gliding.current.has(key) || gap < snap * 0.04) {
      gliding.current.delete(key);
      out[key] = to;
    } else out[key] = from + (to - from) * (1 - Math.exp(-dt / 110));
  }
  shown.current = out;
  const moving = gliding.current.size > 0;
  useEffect(() => {
    if (!moving) return;
    const frame = requestAnimationFrame(() => redraw((n) => n + 1));
    return () => cancelAnimationFrame(frame);
  });
  return out;
}

type RowProps = {
  p: Placed;
  /** Only for a running step – the others don't change while the run ticks on */
  now: number;
  /** A waiting step: about how many seconds until it starts */
  wait: number;
  range: number;
  /** The width of a bar's track in px – 0 until measured */
  track: number;
  focused: boolean;
  lit: boolean;
  formatTime: (ms: number) => string;
  formatCost: (amount: number) => string;
  setFocus: (fn: (f: string | null) => string | null) => void;
};

/** One row: the step on the left, its bars on the right – re-rendered only when its own values change */
const Row = memo(function Row({ p, now, wait, range, track, focused, lit, formatTime, formatCost, setFocus }: RowProps) {
  const { step, status } = p;
  const planned = step.plan;
  const took = status === "done" ? p.ae - p.as : status === "running" ? now - p.as : 0;
  const over = status !== "waiting" && took - planned >= SLACK;
  const diff = status === "done" ? took - planned : over ? took - planned : 0;
  const end = status === "running" ? now : p.ae;
  const showDiff = (status === "done" || over) && Math.abs(diff) >= SLACK;
  const showCost = step.cost !== undefined && focused;
  const tagText = status === "waiting" ? formatTime(planned) : formatTime(took) + (showDiff ? delta(diff) : "") + (showCost ? formatCost(step.cost!) : "");
  // About how wide the numbers are – 7px a character, plus padding and pills
  const tw = tagText.length * 7 + 8 + (showDiff ? 13 : 0) + (showCost ? 10 : 0);
  // Near the right edge the numbers sit before the bar instead of after it – and when they don't fit where they'd go, on the side with more room
  const from = Math.min(p.as, p.ps);
  const to = Math.max(p.ae, p.pe);
  let side = to / range > 0.8 ? "before" : "after";
  if (track > 0) {
    const after = track - (to / range) * track - 3;
    const before = (from / range) * track - 3;
    if (side === "after" && tw > after && before > after) side = "before";
    else if (side === "before" && tw > before && after > before) side = "after";
  }
  const id = step.id;
  return (
    <div
      className="ui-pvac__row"
      role="listitem"
      tabIndex={0}
      data-status={status}
      data-lit={lit ? "" : undefined}
      data-focus={focused ? "" : undefined}
      onPointerEnter={() => setFocus(() => id)}
      onPointerLeave={() => setFocus((f) => (f === id ? null : f))}
      onFocus={() => setFocus(() => id)}
      onBlur={() => setFocus((f) => (f === id ? null : f))}
      aria-label={`${step.title}: ${status === "done" ? `took ${formatTime(took)}, planned ${formatTime(planned)}` : status === "running" ? `running for ${formatTime(took)} of ${formatTime(planned)} planned` : `starts in about ${formatTime(wait * 1000)}`}${step.cost !== undefined ? `, ${formatCost(step.cost)}` : ""}`}
    >
      <span className="ui-pvac__name">
        <span className="ui-pvac__state" data-status={status}>
          <StateIcon status={status} />
        </span>
        {step.icon && <span className="ui-pvac__icon">{step.icon}</span>}
        <span className="ui-pvac__label" dir="auto" title={step.title}>
          {step.title}
        </span>
      </span>

      <span className="ui-pvac__track">
        {status === "waiting" ? (
          // Where it will run now – it moves when the steps before it run over
          <span className="ui-pvac__bar" data-kind="forecast" style={at(p.as, p.ae)} />
        ) : (
          <>
            {/* Running within plan: what's left of it, so its expected end is visible */}
            {status === "running" && !over && <span className="ui-pvac__bar" data-kind="forecast" data-rest="" style={at(now, p.ae)} />}
            <span className="ui-pvac__bar" data-kind="actual" data-status={status} data-over={over ? "" : undefined} style={at(p.as, end)} />
            {over && <span className="ui-pvac__bar" data-kind="over" data-status={status} style={at(p.as + planned, end)} />}
          </>
        )}
        {/* The plan: a dashed ghost on top, so it shows through the real bar */}
        <span className="ui-pvac__ghost" style={at(p.ps, p.pe)} />
        <span className="ui-pvac__tag" data-side={side} data-status={status} style={{ "--s": side === "after" ? to : from, "--tw": tw } as CSSProperties}>
          {status === "waiting" ? (
            formatTime(planned)
          ) : (
            <>
              <span className="ui-pvac__took">{formatTime(took)}</span>
              {showDiff && (
                <span className="ui-pvac__diff" data-late={diff > 0 ? "" : undefined}>
                  {delta(diff)}
                </span>
              )}
            </>
          )}
          {/* What the step cost – shown for the step under the pointer */}
          {showCost && <span className="ui-pvac__cost">{formatCost(step.cost!)}</span>}
        </span>
      </span>
    </div>
  );
}, sameRow);

/** Rows are rebuilt on every render – compare what they show, not the objects */
function sameRow(a: RowProps, b: RowProps) {
  const x = a.p;
  const y = b.p;
  return (
    a.now === b.now && a.wait === b.wait && a.range === b.range && a.track === b.track && a.focused === b.focused && a.lit === b.lit &&
    a.formatTime === b.formatTime && a.formatCost === b.formatCost &&
    x.status === y.status && x.as === y.as && x.ae === y.ae && x.ps === y.ps && x.pe === y.pe &&
    x.step.id === y.step.id && x.step.title === y.step.title && x.step.icon === y.step.icon && x.step.cost === y.step.cost && x.step.plan === y.step.plan
  );
}

export function PlanVsActual({ steps: given, now: givenNow, task, formatTime = clock, formatCost = dollars, title = "Plan vs actual", className }: PlanVsActualProps) {
  const label = useId();
  const [focus, setFocus] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // NaN, Infinity and negative plans count as not given
  const now = num(givenNow) ?? 0;
  const steps = given.map((s) => ({ ...s, plan: Math.max(0, num(s.plan) ?? 0), start: num(s.start), end: num(s.end), cost: num(s.cost), planCost: num(s.planCost) }));

  const raw = place(steps, now);
  const planEnd = Math.max(0, ...raw.map((p) => p.pe));
  const rawEta = Math.max(0, ...raw.map((p) => p.ae));
  const done = raw.filter((p) => p.status === "done").length;
  const finished = done === raw.length;

  // The axis: room after the later finish, in whole steps, so it only grows now and then – and glides when it does
  const later = Math.max(planEnd, rawEta, now) * 1.22;
  let tickStep = Math.max(planEnd, rawEta) > 240000 ? 60000 : 30000;
  for (const t of TICKS) if (t > tickStep && later / tickStep > 10) tickStep = t;
  const range = Math.ceil(later / tickStep) * tickStep || tickStep;
  const ticks = Array.from({ length: Math.floor(range / tickStep) }, (_, i) => (i + 1) * tickStep).filter((v) => v < range);

  // How wide a bar's track is, so the numbers can stay inside it
  const [track, setTrack] = useState(0);
  useLayoutEffect(() => {
    const el = bodyRef.current?.querySelector<HTMLElement>(".ui-pvac__track");
    if (!el) return;
    const measure = () => setTrack(el.getBoundingClientRect().width);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [steps.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real or expected starts and ends, and the expected finish – as shown
  const target: Record<string, number> = { eta: rawEta };
  for (const p of raw) {
    target[`${p.step.id}:s`] = p.as;
    target[`${p.step.id}:e`] = p.ae;
  }
  const g = useGlide(target, range * 0.012);
  const placed = raw.map((p) => (p.status === "waiting" ? { ...p, as: g[`${p.step.id}:s`], ae: g[`${p.step.id}:e`] } : p));
  const byId = new Map(placed.map((p) => [p.step.id, p]));
  const eta = g.eta;
  const late = rawEta - planEnd;

  // Time and money: where the run is against its plan
  const hasCost = steps.some((s) => s.cost !== undefined || s.planCost !== undefined);
  const spent = steps.reduce((n, s) => n + (s.cost ?? 0), 0);
  const budget = steps.reduce((n, s) => n + (s.planCost ?? 0), 0);

  // The step under the pointer: what it waits for and what waits for it
  const focused = focus ? byId.get(focus) : undefined;
  const links = focused
    ? [
        ...(focused.step.deps ?? []).flatMap((id) => (byId.get(id) ? [[byId.get(id)!, focused] as const] : [])),
        ...placed.filter((p) => p.step.deps?.includes(focused.step.id)).map((p) => [focused, p] as const),
      ]
    : [];
  const linked = new Set(links.flatMap(([a, b]) => [a.step.id, b.step.id]));

  const state = Math.abs(late) < SLACK ? "on" : late > 0 ? "late" : "early";
  // Once it's through: how late or early it finished
  const verdict = Math.abs(late) < SLACK ? "On plan" : late > 0 ? `${delta(late)} ${finished ? "late" : "behind"}` : `${delta(late).slice(1)} ${finished ? "early" : "ahead"}`;

  return (
    <div className={["ui-pvac", className].filter(Boolean).join(" ")} style={{ "--ui-pvac-range": range, "--ui-pvac-rows": placed.length } as CSSProperties}>
      <style href="ui-plan-vs-actual-clean" precedence="default">
        {css}
      </style>

      <header className="ui-pvac__head">
        <span className="ui-pvac__mark">
          <ChartMark />
        </span>
        <span className="ui-pvac__title" id={label} dir="auto" title={title}>
          {title}
        </span>
        {task && (
          <span className="ui-pvac__task" dir="auto" title={task}>
            {task}
          </span>
        )}
        {/* Time and cost so far, each against the plan */}
        <dl className="ui-pvac__stats">
          <div className="ui-pvac__stat" data-over={!finished && now > planEnd ? "" : undefined}>
            <dt>Time</dt>
            <dd>
              <b className="ui-pvac__live" data-live={finished ? undefined : ""}>
                {formatTime(finished ? rawEta : now)}
              </b>
              <span> / {formatTime(planEnd)}</span>
            </dd>
          </div>
          {hasCost && (
            <div className="ui-pvac__stat" data-over={budget > 0 && spent > budget ? "" : undefined}>
              <dt>Cost</dt>
              <dd>
                <b className="ui-pvac__live" data-live={finished ? undefined : ""}>
                  {formatCost(spent)}
                </b>
                {budget > 0 && <span> / {formatCost(budget)}</span>}
              </dd>
            </div>
          )}
        </dl>
        <span className="ui-pvac__verdict" data-state={state}>
          {verdict}
        </span>
      </header>

      <div ref={bodyRef} className="ui-pvac__body" role="list" aria-labelledby={label} data-focus={focus ? "" : undefined}>
        {/* Behind the rows: grid lines, the planned finish, the expected one and "now" */}
        <div className="ui-pvac__layer" aria-hidden="true">
          {ticks.map((v) => (
            // A label that would run past the end sits before its line instead
            <span key={v} className="ui-pvac__tick" data-flip={track > 0 && (v / range) * track + 6 + formatTime(v).length * 7 > track ? "" : undefined} style={{ "--v": v } as CSSProperties}>
              <span>{formatTime(v)}</span>
            </span>
          ))}
          {Math.abs(late) >= SLACK && <span className="ui-pvac__gap" data-state={late > 0 ? "late" : "early"} style={at(Math.min(planEnd, eta), Math.max(planEnd, eta))} />}
          {/* The earlier line's label reaches left, the later one's right – so they never overlap */}
          <span className="ui-pvac__finish" data-kind="plan" data-side={late < 0 ? "right" : "left"} style={{ "--v": planEnd } as CSSProperties}>
            <span>Plan {formatTime(planEnd)}</span>
          </span>
          <span className="ui-pvac__finish" data-kind="eta" data-side={late < 0 ? "left" : "right"} data-state={state} data-hidden={Math.abs(late) < SLACK ? "" : undefined} style={{ "--v": eta } as CSSProperties}>
            <span>
              {finished ? "Done" : "ETA"} {formatTime(rawEta)}
            </span>
          </span>
          {!finished && <span className="ui-pvac__now" style={{ "--v": now } as CSSProperties} />}
        </div>

        <div className="ui-pvac__axis" aria-hidden="true">
          Step
        </div>

        {placed.map((p) => (
          <Row
            key={p.step.id}
            p={p}
            now={p.status === "running" ? now : 0}
            wait={p.status === "waiting" ? Math.max(0, Math.round((p.as - now) / 1000)) : 0}
            range={range}
            track={track}
            focused={focus === p.step.id}
            lit={focus === p.step.id || linked.has(p.step.id)}
            formatTime={formatTime}
            formatCost={formatCost}
            setFocus={setFocus}
          />
        ))}

        {/* What the focused step waits for and what waits for it – drawn over the rows, from one bar's end to the other's start */}
        <div className="ui-pvac__links" aria-hidden="true">
          {links.map(([a, b]) => (
            <span
              key={`${a.step.id}-${b.step.id}`}
              className="ui-pvac__link"
              style={{ "--a0": a.as, "--a1": a.ae, "--b0": Math.max(a.ae, b.as), "--from": a.index, "--to": b.index } as CSSProperties}
            />
          ))}
        </div>

        <div className="ui-pvac__foot" aria-hidden="true">
          <span className="ui-pvac__key" data-kind="plan">
            Plan
          </span>
          <span className="ui-pvac__key" data-kind="actual">
            Actual
          </span>
          <span className="ui-pvac__key" data-kind="over">
            Over plan
          </span>
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
/* The axis glides when it grows */
@property --ui-pvac-range { syntax: "<number>"; inherits: true; initial-value: 60000; }

/* Colors, sizes and motion as variables – override them on .ui-pvac */
.ui-pvac {
  --ui-pvac-card: #ffffff;
  --ui-pvac-strong: #000000;
  --ui-pvac-ink: rgba(0, 0, 0, 0.88);
  --ui-pvac-text: rgba(0, 0, 0, 0.61);
  --ui-pvac-muted: rgba(0, 0, 0, 0.45);
  --ui-pvac-faint: rgba(0, 0, 0, 0.27);
  --ui-pvac-line: rgba(0, 0, 0, 0.06);
  --ui-pvac-grid: rgba(0, 0, 0, 0.04);
  --ui-pvac-hover: rgba(0, 0, 0, 0.018);
  --ui-pvac-accent: rgba(0, 96, 226, 0.765);
  --ui-pvac-now: rgba(0, 96, 226, 0.4);
  --ui-pvac-ghost: rgba(0, 0, 0, 0.26);
  --ui-pvac-link: rgba(0, 0, 0, 0.5);
  /* The real bar */
  --ui-pvac-actual-bg: rgba(91, 91, 214, 0.1);
  --ui-pvac-actual-edge: rgba(91, 91, 214, 0.3);
  --ui-pvac-actual-mark: rgba(91, 91, 214, 0.72);
  /* Past the plan */
  --ui-pvac-over-bg: rgba(255, 140, 0, 0.15);
  --ui-pvac-over-edge: rgba(214, 102, 0, 0.42);
  --ui-pvac-over-ink: #c24a00;
  /* Where a waiting step will run */
  --ui-pvac-forecast-bg: rgba(0, 0, 0, 0.035);
  --ui-pvac-forecast-edge: rgba(0, 0, 0, 0.07);
  --ui-pvac-early-ink: #007d2ee0;
  --ui-pvac-early-fill: rgba(0, 164, 51, 0.1);
  --ui-pvac-shine: rgba(0, 0, 0, 0.1);
  --ui-pvac-late-bg: rgba(255, 140, 0, 0.07);
  --ui-pvac-early-bg: rgba(0, 164, 51, 0.06);
  --ui-pvac-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-pvac-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-pvac-row: 32px;
  --ui-pvac-bar: 14px;
  --ui-pvac-axis: 30px;
  --ui-pvac-foot: 40px;
  --ui-pvac-name: 188px;
  --ui-pvac-pad: 16px;
  --ui-pvac-gap: 14px;
  --ui-pvac-end: 16px;
  --ui-pvac-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  border-radius: 12px;
  background: var(--ui-pvac-card);
  box-shadow: var(--ui-pvac-shadow);
  container: ui-pvac / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-pvac-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
  transition: --ui-pvac-range 700ms var(--ui-pvac-ease);
}
.ui-pvac *, .ui-pvac *::before, .ui-pvac *::after { box-sizing: border-box; }
.ui-pvac svg { display: block; flex: none; }

/* ----- The bar on top: what the run is for, how far it is, and how late ----- */
.ui-pvac__head { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 12px 14px 12px 16px; border-bottom: 0.5px solid var(--ui-pvac-line); }
.ui-pvac__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-pvac-accent); }
/* A long title shortens after the task has given way – the numbers next to it never do */
.ui-pvac__title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-pvac-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-pvac__task { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-pvac-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Time and cost so far against the plan – the numbers turn amber once they pass it */
.ui-pvac__stats { display: flex; flex: none; align-items: center; gap: 14px; margin: 0 4px 0 0; font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-pvac__stat { display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.ui-pvac__stat dt { color: var(--ui-pvac-muted); }
.ui-pvac__stat dd { margin: 0; font-weight: 500; color: var(--ui-pvac-ink); transition: color 300ms ease; }
.ui-pvac__stat dd > span { font-weight: 400; color: var(--ui-pvac-muted); }
.ui-pvac__stat[data-over] dd { color: var(--ui-pvac-over-ink); }
.ui-pvac__live { font-weight: inherit; }
/* Numbers that still climb: a quick shine keeps running over them */
.ui-pvac__live[data-live] {
  background: linear-gradient(90deg, currentColor 0%, currentColor 38%, var(--ui-pvac-shine) 50%, currentColor 62%, currentColor 100%) 0 0 / 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: ui-pvac-shine 900ms linear infinite;
}
.ui-pvac__verdict { flex: none; min-width: 92px; height: 22px; padding: 0 8px; border-radius: 6px; background: rgba(0, 0, 0, 0.045); font-size: 12px; font-weight: 500; line-height: 22px; color: var(--ui-pvac-text); text-align: center; font-variant-numeric: tabular-nums; white-space: nowrap; transition: background-color 300ms ease, color 300ms ease; }
.ui-pvac__verdict[data-state="late"] { background: var(--ui-pvac-over-bg); color: var(--ui-pvac-over-ink); }
.ui-pvac__verdict[data-state="early"] { background: var(--ui-pvac-early-fill); color: var(--ui-pvac-early-ink); }

/* ----- The chart ----- */
.ui-pvac__body { position: relative; padding-bottom: 0; }
/* Everything on the time axis is placed in calc() against the gliding range */
.ui-pvac__layer { position: absolute; top: 0; bottom: 0; left: calc(var(--ui-pvac-pad) + var(--ui-pvac-name) + var(--ui-pvac-gap)); right: var(--ui-pvac-end); pointer-events: none; }
.ui-pvac__tick { position: absolute; top: 0; bottom: var(--ui-pvac-foot); left: calc(var(--v) * 100% / var(--ui-pvac-range)); width: 0.5px; background: var(--ui-pvac-grid); animation: ui-pvac-fade 420ms ease both; }
.ui-pvac__tick[data-flip] > span { left: auto; right: 6px; }
.ui-pvac__tick > span { position: absolute; top: 7px; left: 6px; font-size: 12px; line-height: 16px; color: var(--ui-pvac-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-pvac__now { position: absolute; top: var(--ui-pvac-axis); bottom: var(--ui-pvac-foot); left: calc(var(--v) * 100% / var(--ui-pvac-range)); width: 1px; background: var(--ui-pvac-now); }
.ui-pvac__now::before { content: ""; position: absolute; top: -2.5px; left: -2px; width: 5px; height: 5px; border-radius: 50%; background: var(--ui-pvac-accent); box-shadow: 0 0 0 3px var(--ui-pvac-card); }

/* The planned finish (dashed) and the expected one (solid, it moves), with the gap between them tinted */
.ui-pvac__gap { position: absolute; top: var(--ui-pvac-axis); bottom: calc(var(--ui-pvac-foot) - 1px); left: calc(var(--s) * 100% / var(--ui-pvac-range)); width: calc(var(--d) * 100% / var(--ui-pvac-range)); background: var(--ui-pvac-late-bg); animation: ui-pvac-fade 300ms ease both; }
.ui-pvac__gap[data-state="early"] { background: var(--ui-pvac-early-bg); }
.ui-pvac__finish { position: absolute; top: var(--ui-pvac-axis); bottom: calc(var(--ui-pvac-foot) - 6px); left: calc(var(--v) * 100% / var(--ui-pvac-range)); width: 0; border-left: 1px dashed var(--ui-pvac-ghost); }
.ui-pvac__finish[data-kind="eta"] { border-left: 1px solid var(--ui-pvac-over-edge); }
.ui-pvac__finish[data-kind="eta"][data-state="early"] { border-left-color: rgba(0, 140, 50, 0.45); }
.ui-pvac__finish[data-kind="eta"][data-hidden] { opacity: 0; }
.ui-pvac__finish > span { position: absolute; top: calc(100% + 2px); height: 20px; padding: 0 6px; border-radius: 5px; font-size: 12px; font-weight: 500; line-height: 20px; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* The earlier line's label ends at it, the later one's starts at it – they never overlap */
.ui-pvac__finish[data-side="left"] > span { right: -1px; border-top-right-radius: 0; }
.ui-pvac__finish[data-side="right"] > span { left: -1px; border-top-left-radius: 0; }
.ui-pvac__finish[data-kind="plan"] > span { background: rgba(0, 0, 0, 0.045); color: var(--ui-pvac-text); }
.ui-pvac__finish[data-kind="eta"] > span { background: var(--ui-pvac-over-bg); color: var(--ui-pvac-over-ink); }
.ui-pvac__finish[data-kind="eta"][data-state="early"] > span { background: var(--ui-pvac-early-fill); color: var(--ui-pvac-early-ink); }
.ui-pvac__finish[data-kind="plan"]:has(~ .ui-pvac__finish[data-hidden]) > span { right: auto; left: 50%; transform: translateX(-50%); border-radius: 5px; }

/* What a step waits for: an elbow down from the end of one bar to the start of the other – over the rows, so no number hides it */
.ui-pvac__links { position: absolute; top: 0; bottom: 0; z-index: 1; left: calc(var(--ui-pvac-pad) + var(--ui-pvac-name) + var(--ui-pvac-gap)); right: var(--ui-pvac-end); pointer-events: none; }
.ui-pvac__link {
  position: absolute;
  top: calc(var(--ui-pvac-axis) + var(--from) * var(--ui-pvac-row) + var(--ui-pvac-row) / 2 + var(--ui-pvac-bar) / 2);
  /* It leaves at the end of the bar above – or, when the step below starts right there, a little further left along
     its bottom edge, so there's always a turn – and ends exactly at the start of the step's bar */
  --x0: max(calc(var(--a0) * 100% / var(--ui-pvac-range) + 3px), min(calc(var(--a1) * 100% / var(--ui-pvac-range)), calc(var(--b0) * 100% / var(--ui-pvac-range) - 12px)));
  left: calc(var(--x0) - 0.5px);
  width: calc(var(--b0) * 100% / var(--ui-pvac-range) - var(--x0) + 0.5px);
  height: calc((var(--to) - var(--from)) * var(--ui-pvac-row) - var(--ui-pvac-bar) / 2);
  border-bottom-left-radius: 5px;
  border-left: 1px solid var(--ui-pvac-link);
  border-bottom: 1px solid var(--ui-pvac-link);
  animation: ui-pvac-draw 260ms var(--ui-pvac-ease) both;
}
/* Where it leaves: a small open square; where it arrives: the same square, filled – both centred on the line */
.ui-pvac__link::before, .ui-pvac__link::after { content: ""; position: absolute; width: 5px; height: 5px; border: 1px solid var(--ui-pvac-link); border-radius: 1px; background: var(--ui-pvac-card); }
.ui-pvac__link::before { top: -2.5px; left: -3px; }
.ui-pvac__link::after { right: -2.5px; bottom: -3px; background: var(--ui-pvac-link); }

.ui-pvac__axis { display: flex; align-items: center; height: var(--ui-pvac-axis); padding-left: var(--ui-pvac-pad); border-bottom: 0.5px solid var(--ui-pvac-line); font-size: 10px; font-weight: 500; line-height: 16px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ui-pvac-muted); }

/* ----- One row: the step on the left, its bars on the right ----- */
.ui-pvac__row {
  position: relative;
  display: grid;
  grid-template-columns: var(--ui-pvac-name) minmax(0, 1fr);
  column-gap: var(--ui-pvac-gap);
  height: var(--ui-pvac-row);
  padding: 0 var(--ui-pvac-end) 0 var(--ui-pvac-pad);
  outline: none;
  transition: background-color 140ms ease, opacity 200ms ease;
}
.ui-pvac__row:hover, .ui-pvac__row[data-focus] { background: var(--ui-pvac-hover); }
.ui-pvac__row:focus-visible { box-shadow: inset 0 0 0 2px var(--ui-pvac-focus); }
/* Pointing at a step dims every row it isn't linked to */
.ui-pvac__body[data-focus] .ui-pvac__row:not([data-lit]) { opacity: 0.45; }
.ui-pvac__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-pvac__state { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-pvac-faint); transition: color 240ms ease; }
.ui-pvac__state[data-status="running"] { color: var(--ui-pvac-accent); }
.ui-pvac__state[data-status="done"] { color: var(--ui-pvac-muted); }
.ui-pvac__state > svg { animation: ui-pvac-pop 240ms var(--ui-pvac-ease) both; }
.ui-pvac__spin { animation: ui-pvac-spin 900ms linear infinite !important; }
.ui-pvac__icon { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--ui-pvac-card); box-shadow: var(--ui-pvac-shadow); }
.ui-pvac__icon > :is(svg, img) { width: 12px; height: 12px; object-fit: contain; }
.ui-pvac__label { min-width: 0; overflow: hidden; color: var(--ui-pvac-ink); text-align: start; white-space: nowrap; text-overflow: ellipsis; transition: color 240ms ease; }
.ui-pvac__row[data-status="waiting"] .ui-pvac__label { color: var(--ui-pvac-text); }

.ui-pvac__track { position: relative; min-width: 0; height: var(--ui-pvac-row); }
.ui-pvac__bar, .ui-pvac__ghost {
  position: absolute;
  top: calc(50% - var(--ui-pvac-bar) / 2);
  left: calc(var(--s) * 100% / var(--ui-pvac-range));
  width: max(2px, calc(var(--d) * 100% / var(--ui-pvac-range)));
  height: var(--ui-pvac-bar);
  border-radius: 4px;
}
/* The real bar: a light tint with a hairline edge */
.ui-pvac__bar { overflow: hidden; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); }
.ui-pvac__bar[data-kind="actual"] { --k-bg: var(--ui-pvac-actual-bg); --k-edge: var(--ui-pvac-actual-edge); }
.ui-pvac__row:is(:hover, [data-focus]) .ui-pvac__bar[data-kind="actual"] { box-shadow: inset 0 0 0 1px var(--ui-pvac-actual-mark); }
/* The part past the plan, on top of the real bar */
.ui-pvac__bar[data-kind="over"] { --k-bg: var(--ui-pvac-over-bg); --k-edge: var(--ui-pvac-over-edge); border-top-left-radius: 0; border-bottom-left-radius: 0; background: linear-gradient(var(--k-bg), var(--k-bg)), var(--ui-pvac-card); animation: ui-pvac-fade 200ms ease both; }
/* Where a waiting step will run – it slides when the steps before it run over */
.ui-pvac__bar[data-kind="forecast"] { --k-bg: var(--ui-pvac-forecast-bg); --k-edge: var(--ui-pvac-forecast-edge); animation: ui-pvac-fade 320ms ease both; }
/* What's left of a running step, right after its real bar */
.ui-pvac__bar[data-rest] { border-top-left-radius: 0; border-bottom-left-radius: 0; animation: none; }
/* Running: a sheen sweeps along and the leading edge glows – on the amber part once it runs over */
.ui-pvac__bar[data-status="running"]:not([data-over])::before,
.ui-pvac__bar[data-kind="over"][data-status="running"]::before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--ui-pvac-card), transparent) -60px 0 / 60px 100% no-repeat; opacity: 0.7; animation: ui-pvac-sweep 1500ms linear infinite; }
.ui-pvac__bar[data-status="running"]:not([data-over])::after,
.ui-pvac__bar[data-kind="over"][data-status="running"]::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: min(28px, 100%); background: linear-gradient(90deg, transparent, var(--k-edge)); animation: ui-pvac-glow 1100ms ease-in-out infinite alternate; }
/* The plan: a dashed ghost on top of everything */
.ui-pvac__ghost { border: 1px dashed var(--ui-pvac-ghost); pointer-events: none; }

/* The numbers: how long it took and how far off the plan – on the card's color, so lines pass behind them */
.ui-pvac__tag { position: absolute; top: calc(50% - 9px); display: flex; align-items: center; gap: 5px; height: 18px; padding: 0 4px; border-radius: 4px; background: var(--ui-pvac-card); font-size: 12px; line-height: 16px; color: var(--ui-pvac-text); white-space: nowrap; font-variant-numeric: tabular-nums; pointer-events: none; }
/* Kept inside the track: when the numbers would run past its edge they sit over the bar instead (--tw is about their width) */
.ui-pvac__tag[data-side="after"] { left: max(0px, min(calc(var(--s) * 100% / var(--ui-pvac-range) + 3px), calc(100% - var(--tw) * 1px))); }
.ui-pvac__tag[data-side="before"] { right: max(0px, min(calc(100% - var(--s) * 100% / var(--ui-pvac-range) + 3px), calc(100% - var(--tw) * 1px))); }
.ui-pvac__tag[data-status="waiting"] { color: var(--ui-pvac-faint); }
.ui-pvac__cost { color: var(--ui-pvac-text); animation: ui-pvac-pop 180ms var(--ui-pvac-ease) both; }
.ui-pvac__cost::before { content: "·"; margin-right: 5px; color: var(--ui-pvac-faint); }
.ui-pvac__row:is(:hover, [data-focus]) .ui-pvac__tag { background: none; }
.ui-pvac__took { color: var(--ui-pvac-ink); }
/* Off the plan: a small pill tinted in its color – green when quicker, amber when slower */
.ui-pvac__diff { height: 16px; padding: 0 4px; border-radius: 4px; background: var(--ui-pvac-early-fill); font-weight: 500; line-height: 16px; color: var(--ui-pvac-early-ink); animation: ui-pvac-pop 220ms var(--ui-pvac-ease) both; }
.ui-pvac__diff[data-late] { background: var(--ui-pvac-over-bg); color: var(--ui-pvac-over-ink); }

/* ----- The key ----- */
.ui-pvac__foot { display: flex; align-items: center; gap: 14px; height: var(--ui-pvac-foot); margin-top: 4px; padding-left: var(--ui-pvac-pad); border-top: 0.5px solid var(--ui-pvac-line); font-size: 12px; line-height: 16px; color: var(--ui-pvac-muted); }
.ui-pvac__key { display: flex; align-items: center; gap: 6px; }
.ui-pvac__key::before { content: ""; width: 14px; height: 8px; border-radius: 2.5px; }
.ui-pvac__key[data-kind="plan"]::before { border: 1px dashed var(--ui-pvac-ghost); }
.ui-pvac__key[data-kind="actual"]::before { background: var(--ui-pvac-actual-bg); box-shadow: inset 0 0 0 0.5px var(--ui-pvac-actual-edge); }
.ui-pvac__key[data-kind="over"]::before { background: var(--ui-pvac-over-bg); box-shadow: inset 0 0 0 0.5px var(--ui-pvac-over-edge); }

/* ----- Narrow: a shorter name column; the task, the key and the finish labels make room (the bar on top says how late) ----- */
@container ui-pvac (max-width: 560px) {
  .ui-pvac__body { --ui-pvac-name: 120px; --ui-pvac-pad: 12px; --ui-pvac-gap: 10px; --ui-pvac-end: 12px; --ui-pvac-foot: 14px; }
  .ui-pvac__finish > span, .ui-pvac__foot { visibility: hidden; }
  .ui-pvac__head { padding: 10px 12px; }
  .ui-pvac__task { display: none; }
  .ui-pvac__head { flex-wrap: wrap; row-gap: 6px; }
  .ui-pvac__verdict { margin-left: auto; }
  .ui-pvac__stats { order: 3; flex-basis: 100%; flex-wrap: wrap; gap: 4px 16px; margin: 0; }
  .ui-pvac__icon { display: none; }
  .ui-pvac__foot .ui-pvac__key { display: none; }
  .ui-pvac__tick:nth-child(even) > span { display: none; }
}

@keyframes ui-pvac-fade { from { opacity: 0; } }
@keyframes ui-pvac-pop { from { opacity: 0; transform: scale(0.85); } }
@keyframes ui-pvac-draw { from { opacity: 0; clip-path: inset(0 100% 0 0); } to { opacity: 1; clip-path: inset(-4px -4px -4px -4px); } }
@keyframes ui-pvac-sweep { to { background-position: calc(100% + 60px) 0; } }
@keyframes ui-pvac-glow { from { opacity: 0.45; } to { opacity: 1; } }
@keyframes ui-pvac-spin { to { transform: rotate(360deg); } }
@keyframes ui-pvac-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-pvac { transition: none; }
  .ui-pvac *, .ui-pvac *::before, .ui-pvac *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pvac {
  --ui-pvac-card: #1c1c1f;
  --ui-pvac-strong: #ffffff;
  --ui-pvac-ink: rgba(255, 255, 255, 0.9);
  --ui-pvac-text: rgba(255, 255, 255, 0.62);
  --ui-pvac-muted: rgba(255, 255, 255, 0.45);
  --ui-pvac-faint: rgba(255, 255, 255, 0.28);
  --ui-pvac-line: rgba(255, 255, 255, 0.08);
  --ui-pvac-grid: rgba(255, 255, 255, 0.05);
  --ui-pvac-hover: rgba(255, 255, 255, 0.025);
  --ui-pvac-accent: #5b9aff;
  --ui-pvac-now: rgba(91, 154, 255, 0.55);
  --ui-pvac-ghost: rgba(255, 255, 255, 0.3);
  --ui-pvac-link: rgba(255, 255, 255, 0.55);
  --ui-pvac-actual-bg: rgba(130, 130, 255, 0.16);
  --ui-pvac-actual-edge: rgba(130, 130, 255, 0.38);
  --ui-pvac-actual-mark: rgba(140, 140, 255, 0.8);
  --ui-pvac-over-bg: rgba(255, 140, 30, 0.18);
  --ui-pvac-over-edge: rgba(255, 150, 60, 0.45);
  --ui-pvac-over-ink: #ffa057;
  --ui-pvac-forecast-bg: rgba(255, 255, 255, 0.05);
  --ui-pvac-forecast-edge: rgba(255, 255, 255, 0.09);
  --ui-pvac-early-ink: #3dd68c;
  --ui-pvac-early-fill: rgba(40, 200, 110, 0.14);
  --ui-pvac-shine: rgba(255, 255, 255, 0.4);
  --ui-pvac-late-bg: rgba(255, 140, 30, 0.07);
  --ui-pvac-early-bg: rgba(40, 200, 110, 0.06);
  --ui-pvac-focus: rgba(91, 154, 255, 0.45);
  --ui-pvac-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
:where(.dark, [data-theme="dark"]) .ui-pvac :is(.ui-pvac__verdict, .ui-pvac__finish[data-kind="plan"] > span) { background: rgba(255, 255, 255, 0.07); }
`;
