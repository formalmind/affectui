"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

/*
 * Experiment Card – an A/B test in two lines that quietly unfolds into the full comparison, in one self-contained file.
 * Closed, it shows the test, its status and who is ahead, next to a tiny column chart with one column per variant.
 * Hovering (or tapping) unfolds the variants below – the head stays where it is. Inside the open card:
 *   · hover a variant and its column lights up in the head (and the other way round)
 *   · switch the metric and every number rolls, the bars and columns glide, the leader chip follows
 *   · click a variant to pick it as the winner – the action on the tray appears with its name
 *   · the line on the gray tray always says what you are pointing at: visitors and confidence
 * The styles are injected below, so no extra files are needed.
 */

export type ExperimentTone = "red" | "amber" | "green" | "blue" | "violet" | "gray";

export type ExperimentMetric = {
  id: string;
  label: string;
  /** Formats a value of this metric, e.g. (n) => `${n.toFixed(1)}%` */
  format?: (value: number) => string;
  /** Set when a smaller number wins, e.g. bounce rate or cost */
  lowerIsBetter?: boolean;
};

export type ExperimentVariant = {
  id: string;
  /** Short key shown in the badge and the chart, e.g. "A" */
  key: string;
  name: string;
  /** The baseline every lift is measured against – defaults to the first variant */
  control?: boolean;
  visitors?: number;
  /** One number per metric id */
  values: Record<string, number>;
  /** Confidence against the control in percent, per metric id */
  confidence?: Record<string, number>;
  /** Any CSS color – defaults to gray for the control, then blue, violet, amber */
  color?: string;
};

export type ExperimentCardProps = {
  title: string;
  variants: ExperimentVariant[];
  metrics: ExperimentMetric[];
  /** Controlled metric id */
  metric?: string;
  defaultMetric?: string;
  onMetricChange?: (id: string) => void;
  /** Controlled id of the variant picked as the winner */
  winner?: string | null;
  defaultWinner?: string | null;
  onWinnerChange?: (id: string | null) => void;
  /** The tag under the title, e.g. { label: "Running", tone: "green" } */
  status?: { label: string; tone?: ExperimentTone };
  /** Short text next to the status, e.g. "Day 9 of 14" */
  note?: string;
  /** The button that appears on the tray once a winner is picked. `label` gets the picked variant */
  action?: { label: string | ((variant: ExperimentVariant) => string); onClick: (variant: ExperimentVariant) => void };
  /** Replaces the line on the tray while nothing is hovered or picked */
  hint?: ReactNode;
  /** "hover" opens under the pointer (taps and the keyboard still toggle), "click" only on click */
  trigger?: "hover" | "click";
  /** Controlled open state */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/* ---------- Helpers ---------- */

const PALETTE = ["var(--ui-xc-c1)", "var(--ui-xc-c2)", "var(--ui-xc-c3)", "var(--ui-xc-c4)"];
const defaultFormat = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(n);
const whole = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const tenth = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** NaN and Infinity count as "no value" */
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rolls a set of named numbers from where they are to their targets, in one animation frame loop */
function useRolling(target: Record<string, number>, duration: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const signature = JSON.stringify(target);
  useEffect(() => {
    const to = JSON.parse(signature) as Record<string, number>;
    const from = { ...current.current };
    if (reduced() || Object.keys(to).every((k) => from[k] === to[k])) {
      current.current = to;
      setShown(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      const next: Record<string, number> = {};
      for (const k in to) next[k] = (from[k] ?? to[k]) + (to[k] - (from[k] ?? to[k])) * e;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [signature, duration]);
  return shown;
}

/* ---------- Icons ---------- */

const line = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="m2.2 5.2 1.9 1.9 3.7-4.1" {...line} strokeWidth={1.7} />
  </svg>
);
const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" {...line} strokeWidth={1.4} />
  </svg>
);
const TrendIcon = ({ down }: { down?: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" style={down ? { transform: "scaleY(-1)" } : undefined}>
    <path d="M1.5 7 4 4.5l1.6 1.6L8.5 3M6.2 3h2.3v2.3" {...line} strokeWidth={1.4} />
  </svg>
);
const PulseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <circle cx="6" cy="6" r="4.25" {...line} />
    <circle cx="6" cy="6" r="1.5" fill="currentColor" />
  </svg>
);

export function ExperimentCard({
  title,
  variants,
  metrics,
  metric,
  defaultMetric,
  onMetricChange,
  winner,
  defaultWinner = null,
  onWinnerChange,
  status,
  note,
  action,
  hint,
  trigger = "hover",
  open,
  defaultOpen = false,
  onOpenChange,
  className,
}: ExperimentCardProps) {
  const uid = useId();
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;
  const [innerMetric, setInnerMetric] = useState(defaultMetric ?? metrics[0]?.id);
  const metricNow = metrics.find((m) => m.id === (metric ?? innerMetric)) ?? metrics[0];
  const [innerWinner, setInnerWinner] = useState<string | null>(defaultWinner);
  const winnerId = winner !== undefined ? winner : innerWinner;
  /** The variant under the pointer (row or column) */
  const [hot, setHot] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const format = metricNow?.format ?? defaultFormat;
  const lower = Boolean(metricNow?.lowerIsBetter);
  const has = (v: ExperimentVariant) => finite(v.values[metricNow?.id ?? ""]);
  const valueOf = (v: ExperimentVariant) => (has(v) ? v.values[metricNow?.id ?? ""] : 0);
  const control = variants.find((v) => v.control) ?? variants[0];
  const base = control && has(control) ? valueOf(control) : 0;
  /** Change against the control in percent, as measured – null without a value or a baseline to compare with */
  const changeOf = (v: ExperimentVariant) => (has(v) && base ? ((valueOf(v) - base) / Math.abs(base)) * 100 : null);
  /** The same change counted as "how much better": flipped for metrics where less is better */
  const liftOf = (v: ExperimentVariant) => {
    const change = changeOf(v);
    return change === null ? null : change * (lower ? -1 : 1);
  };
  const signed = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return `${r >= 0 ? "+" : "−"}${tenth.format(Math.abs(r))}%`;
  };
  const leader = variants.reduce<ExperimentVariant | undefined>((best, v) => (!best || (liftOf(v) ?? -Infinity) > (liftOf(best) ?? -Infinity) ? v : best), undefined);
  const known = variants.filter(has).map(valueOf);
  const max = Math.max(...known, 0.0001);
  const min = known.length ? Math.min(...known) : 0;
  /** Column height in the head chart: stretched between the smallest and the largest value, so small gaps stay visible */
  const columnOf = (v: ExperimentVariant) => (!has(v) ? 0.1 : max > min ? 0.38 + 0.62 * ((valueOf(v) - min) / (max - min)) : 0.7);
  const colorOf = (v: ExperimentVariant) => v.color ?? (v === control ? "var(--ui-xc-c0)" : PALETTE[variants.filter((x) => x !== control).indexOf(v) % PALETTE.length]);

  // Numbers roll when the metric changes
  const shown = useRolling(Object.fromEntries(variants.map((v) => [v.id, valueOf(v)])), 620);

  /* ---------- Opening and closing ---------- */

  const timer = useRef(0);
  const change = (next: boolean) => {
    window.clearTimeout(timer.current);
    if (next === isOpen) return;
    if (!next) setHot(null);
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => change(next), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hover = trigger === "hover";
  const onEnter = (e: PointerEvent) => {
    if (hover && e.pointerType === "mouse") later(true, 90);
  };
  const onLeave = (e: PointerEvent) => {
    if (hover && e.pointerType === "mouse") later(false, 220);
  };

  // While open, a press outside closes it
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) change(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !isOpen) return;
    e.stopPropagation();
    change(false);
    rootRef.current?.querySelector<HTMLElement>(".ui-xc__toggle")?.focus({ preventScroll: true });
  };

  /* ---------- Metric switch ---------- */

  const switchRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = switchRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (!el) return;
    setPill({ left: el.offsetLeft, width: el.offsetWidth });
    // Many or long metrics scroll sideways – keep the chosen one in view
    const sw = switchRef.current!;
    if (el.offsetLeft < sw.scrollLeft) sw.scrollLeft = el.offsetLeft;
    else if (el.offsetLeft + el.offsetWidth > sw.scrollLeft + sw.clientWidth) sw.scrollLeft = el.offsetLeft + el.offsetWidth - sw.clientWidth;
  }, [metricNow?.id, metrics.length, isOpen]);

  const setMetric = (id: string) => {
    setInnerMetric(id);
    onMetricChange?.(id);
  };
  const onSwitchKey = (e: KeyboardEvent) => {
    const i = metrics.findIndex((m) => m.id === metricNow?.id);
    const to = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? metrics.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = metrics[(to + metrics.length) % metrics.length];
    setMetric(next.id);
    requestAnimationFrame(() => switchRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };

  const pick = (id: string) => {
    const next = winnerId === id ? null : id;
    setInnerWinner(next);
    onWinnerChange?.(next);
  };

  /* ---------- What the head and the tray say ---------- */

  const ahead = leader && leader !== control && (liftOf(leader) ?? 0) > 0 ? leader : null;
  const aheadChange = ahead ? (changeOf(ahead) ?? 0) : 0;
  const picked = variants.find((v) => v.id === winnerId) ?? null;
  const hotVariant = variants.find((v) => v.id === hot) ?? null;
  const about = hotVariant ?? null;
  let caption: ReactNode = hint ?? (picked ? null : "Pick a winner");
  let captionKey = "rest";
  if (about) {
    const conf = about.confidence?.[metricNow?.id ?? ""];
    caption = (
      <>
        <b>{about.key}</b>
        {finite(about.visitors) && (
          <>
            {" "}· {whole(about.visitors)} {about.visitors === 1 ? "visitor" : "visitors"}
          </>
        )}
        {about === control ? <> · baseline</> : finite(conf) && <> · {whole(conf)}% confidence</>}
      </>
    );
    captionKey = `hot-${about.id}-${metricNow?.id}`;
  } else if (picked) {
    caption = (
      <>
        <b>{picked.name}</b> picked
      </>
    );
    captionKey = `picked-${picked.id}`;
  }
  const actionLabel = picked && action ? (typeof action.label === "function" ? action.label(picked) : action.label) : null;

  return (
    <div
      ref={rootRef}
      className={["ui-xc", className].filter(Boolean).join(" ")}
      data-open={isOpen ? "" : undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={onKeyDown}
    >
      <style href="ui-experiment-card" precedence="default">
        {css}
      </style>

      <div className="ui-xc__card">
        <div className="ui-xc__head">
          {/* The whole head toggles; the chart on top of it only reacts once the card is open */}
          <button
            type="button"
            className="ui-xc__toggle"
            aria-expanded={isOpen}
            aria-controls={`${uid}-body`}
            aria-label={`${title}${status ? `, ${status.label}` : ""}${ahead ? `, ${ahead.name} is ahead by ${tenth.format(Math.abs(aheadChange))} percent` : ""}`}
            onClick={() => change(!isOpen)}
          />

          {/* One column per variant – the same numbers as the rows below, small */}
          <span className="ui-xc__chart" aria-hidden="true" data-many={variants.length > 5 ? "" : undefined} onPointerLeave={() => setHot(null)}>
            {variants.map((v) => (
              <span
                key={v.id}
                className="ui-xc__col"
                data-hot={hot === v.id ? "" : undefined}
                data-dim={hot && hot !== v.id ? "" : undefined}
                data-picked={winnerId === v.id ? "" : undefined}
                data-passed={winnerId && winnerId !== v.id ? "" : undefined}
                style={{ ["--ui-xc-color" as string]: colorOf(v), ["--ui-xc-size" as string]: columnOf(v) }}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHot(v.id)}
                onClick={() => pick(v.id)}
              />
            ))}
          </span>

          <span className="ui-xc__titles">
            <span className="ui-xc__name" dir="auto" title={title}>
              {title}
            </span>
            <span className="ui-xc__sub">
              {status && (
                <span className="ui-xc__tag" data-tone={status.tone ?? "gray"} title={status.label}>
                  <PulseIcon />
                  <span className="ui-xc__tag-text">{status.label}</span>
                </span>
              )}
              {note && (
                <span className="ui-xc__note" dir="auto" title={note}>
                  {note}
                </span>
              )}
            </span>
          </span>

          {ahead ? (
            <span className="ui-xc__lead" data-tone="green" key={`${ahead.id}-${metricNow?.id}`}>
              <b>{ahead.key}</b>
              <TrendIcon down={aheadChange < 0} />
              {signed(aheadChange)}
            </span>
          ) : (
            <span className="ui-xc__lead" data-tone="gray" key={`none-${metricNow?.id}`}>
              No lift yet
            </span>
          )}
        </div>

        <div id={`${uid}-body`} className="ui-xc__fold" inert={!isOpen}>
          <div className="ui-xc__clip">
            <div className="ui-xc__body">
              {metrics.length > 1 && (
                <div ref={switchRef} className="ui-xc__switch" role="radiogroup" aria-label="Metric" onKeyDown={onSwitchKey}>
                  {pill && <span className="ui-xc__thumb" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
                  {metrics.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={m.id === metricNow?.id}
                      tabIndex={m.id === metricNow?.id ? 0 : -1}
                      className="ui-xc__metric"
                      onClick={() => setMetric(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}

              <div className="ui-xc__rows" role="radiogroup" aria-label="Winner" onPointerLeave={() => setHot(null)}>
                {variants.map((v) => {
                  const lift = liftOf(v);
                  const change = changeOf(v);
                  const isControl = v === control;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={winnerId === v.id}
                      aria-label={`${v.name}: ${has(v) ? format(valueOf(v)) : "no value"}${isControl ? ", baseline" : change === null ? "" : `, ${change >= 0 ? "up" : "down"} ${tenth.format(Math.abs(change))} percent`}`}
                      className="ui-xc__row"
                      data-hot={hot === v.id ? "" : undefined}
                      data-dim={hot && hot !== v.id ? "" : undefined}
                      style={{ ["--ui-xc-color" as string]: colorOf(v) }}
                      onPointerEnter={(e) => e.pointerType === "mouse" && setHot(v.id)}
                      onFocus={() => setHot(v.id)}
                      onBlur={() => setHot(null)}
                      onClick={() => pick(v.id)}
                    >
                      <span className="ui-xc__badge">
                        <span title={v.key}>{v.key}</span>
                        <CheckIcon />
                      </span>
                      <span className="ui-xc__label" dir="auto" title={v.name}>
                        {v.name}
                      </span>
                      <span className="ui-xc__value">{has(v) ? format(shown[v.id] ?? valueOf(v)) : "—"}</span>
                      {isControl ? (
                        <span className="ui-xc__lift" data-tone="gray">
                          Base
                        </span>
                      ) : (
                        <span className="ui-xc__lift" data-tone={lift === null ? "gray" : lift > 0.05 ? "green" : lift < -0.05 ? "red" : "gray"}>
                          {change === null ? "—" : signed(change)}
                        </span>
                      )}
                      <span className="ui-xc__track">
                        <span className="ui-xc__bar" style={{ transform: `scaleX(${has(v) ? Math.max(0.02, valueOf(v) / max) : 0.02})` }} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The tray: it says what you are pointing at, and holds the action once a winner is picked */}
      <div className="ui-xc__fold" inert={!isOpen}>
        <div className="ui-xc__clip">
          <div className="ui-xc__foot">
            <span className="ui-xc__caption" aria-live="polite">
              <span key={captionKey}>{caption}</span>
            </span>
            {picked && action && (
              <button type="button" className="ui-xc__action" key={picked.id} title={actionLabel ?? undefined} onClick={() => action.onClick(picked)}>
                <span className="ui-xc__action-text">{actionLabel}</span>
                <ArrowIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-xc {
  --ui-xc-tray: #f0f0f0;
  --ui-xc-card: #ffffff;
  --ui-xc-line: #ececec;
  --ui-xc-ink: #171717;
  --ui-xc-text: #404040;
  --ui-xc-muted: #8f8f8f;
  --ui-xc-well: #f4f4f5;
  --ui-xc-track: #ededf0;
  --ui-xc-c0: #b4b4ba;
  --ui-xc-c1: #2f6bff;
  --ui-xc-c2: #7c5cff;
  --ui-xc-c3: #f0a020;
  --ui-xc-c4: #22a05a;
  --ui-xc-focus: rgba(23, 23, 23, 0.22);
  --ui-xc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  --ui-xc-time: 520ms;
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-xc-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-xc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-xc *, .ui-xc *::before, .ui-xc *::after { box-sizing: border-box; }
:where(.ui-xc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-xc button:focus-visible { outline: 2px solid var(--ui-xc-focus); outline-offset: 2px; }
.ui-xc svg { display: block; flex: none; }
.ui-xc b { font-weight: 600; color: var(--ui-xc-ink); }

/* Tags and lifts: colored text on a light fill of the same color */
.ui-xc [data-tone="red"] { --ui-xc-tag: #b42318; --ui-xc-tag-bg: rgba(229, 72, 77, 0.1); }
.ui-xc [data-tone="amber"] { --ui-xc-tag: #96590a; --ui-xc-tag-bg: rgba(240, 160, 32, 0.14); }
.ui-xc [data-tone="green"] { --ui-xc-tag: #18794e; --ui-xc-tag-bg: rgba(34, 160, 90, 0.11); }
.ui-xc [data-tone="blue"] { --ui-xc-tag: #1f55d6; --ui-xc-tag-bg: rgba(47, 107, 255, 0.09); }
.ui-xc [data-tone="violet"] { --ui-xc-tag: #6941c6; --ui-xc-tag-bg: rgba(124, 92, 255, 0.1); }
.ui-xc [data-tone="gray"] { --ui-xc-tag: #6b6b72; --ui-xc-tag-bg: rgba(110, 110, 120, 0.09); }

.ui-xc__card { border-radius: 16px; background: var(--ui-xc-card); box-shadow: 0 0 0 1px var(--ui-xc-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* Everything that opens does it the same quiet way: it unfolds and fades, nothing travels */
.ui-xc__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows var(--ui-xc-time) var(--ui-xc-ease), opacity 260ms ease; }
.ui-xc__clip { min-height: 0; overflow: hidden; }
.ui-xc[data-open] > .ui-xc__fold, .ui-xc[data-open] > .ui-xc__card > .ui-xc__fold { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows var(--ui-xc-time) var(--ui-xc-ease), opacity 380ms ease 120ms; }

/* ----- Head: the same in both states ----- */
.ui-xc__head { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.ui-xc__toggle { position: absolute; inset: 0; border-radius: 16px; }
.ui-xc__head > :not(.ui-xc__toggle) { position: relative; pointer-events: none; }
.ui-xc[data-open] .ui-xc__chart { pointer-events: auto; }
.ui-xc__chart { overflow: hidden; }
.ui-xc__chart[data-many] { gap: 1px; }

.ui-xc__chart { display: flex; flex: none; align-items: flex-end; justify-content: center; gap: 3px; width: 34px; height: 34px; padding: 6px 5px 5px; border-radius: 10px; background: var(--ui-xc-well); box-shadow: inset 0 0 0 1px var(--ui-xc-line); }
.ui-xc__col { flex: 1; max-width: 7px; height: calc(var(--ui-xc-size) * 100%); border-radius: 2.5px; background: var(--ui-xc-color); cursor: pointer; transition: height 620ms var(--ui-xc-ease), opacity 220ms ease, transform 260ms var(--ui-xc-ease); transform-origin: 50% 100%; }
.ui-xc__col[data-hot] { transform: scaleX(1.25); }
.ui-xc__col[data-dim] { opacity: 0.3; }
.ui-xc__col[data-passed]:not([data-hot]) { opacity: 0.35; }

.ui-xc__titles { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-width: 0; }
.ui-xc__name { overflow: hidden; text-align: start; font-size: 13.5px; font-weight: 600; color: var(--ui-xc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-xc__sub { display: flex; align-items: center; gap: 6px; min-width: 0; height: 20px; margin-top: 1px; overflow: hidden; font-size: 12px; line-height: 20px; color: var(--ui-xc-muted); white-space: nowrap; }
.ui-xc__tag { display: inline-flex; flex: none; max-width: 100%; min-width: 0; align-items: center; gap: 4px; height: 20px; padding: 0 7px 0 5px; border-radius: 5px; background: var(--ui-xc-tag-bg); font-weight: 500; color: var(--ui-xc-tag); }
.ui-xc__tag-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-xc__note { min-width: 0; overflow: hidden; text-align: start; text-overflow: ellipsis; }
.ui-xc__lead { display: inline-flex; flex: none; align-items: center; gap: 4px; height: 24px; padding: 0 8px; border-radius: 6px; background: var(--ui-xc-tag-bg); font-size: 12px; font-weight: 500; color: var(--ui-xc-tag); white-space: nowrap; font-variant-numeric: tabular-nums; animation: ui-xc-pop 360ms var(--ui-xc-ease) both; }
.ui-xc__lead b { color: inherit; }

/* ----- Body ----- */
.ui-xc__body { padding: 0 12px 10px; }
.ui-xc__switch { position: relative; display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; padding: 2px; border-radius: 10px; background: var(--ui-xc-well); box-shadow: inset 0 0 0 1px var(--ui-xc-line); }
/* Many or long metrics scroll sideways – the focus ring sits inside so it isn't cut off */
.ui-xc__switch { overflow-x: auto; scrollbar-width: none; }
.ui-xc__switch::-webkit-scrollbar { display: none; }
.ui-xc .ui-xc__metric:focus-visible { outline-offset: -2px; }
.ui-xc__thumb { position: absolute; top: 2px; left: 0; height: calc(100% - 4px); border-radius: 8px; background: var(--ui-xc-card); box-shadow: 0 0 0 1px var(--ui-xc-line), 0 1px 2px rgba(0, 0, 0, 0.06); transition: transform 420ms var(--ui-xc-ease), width 420ms var(--ui-xc-ease); }
.ui-xc__metric { position: relative; height: 26px; padding: 0 8px; border-radius: 8px; font-size: 12px; font-weight: 500; color: var(--ui-xc-muted); text-align: center; white-space: nowrap; transition: color 200ms ease; }
.ui-xc__metric:hover, .ui-xc__metric[aria-checked="true"] { color: var(--ui-xc-ink); }

.ui-xc__rows { display: grid; gap: 2px; margin-top: 8px; }
.ui-xc__row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; column-gap: 9px; row-gap: 6px; width: calc(100% + 12px); margin: 0 -6px; padding: 7px 6px 8px; border-radius: 10px; transition: background-color 160ms ease, opacity 220ms ease, box-shadow 200ms ease; }
.ui-xc__row[data-hot] { background: var(--ui-xc-well); }
.ui-xc__row[data-dim] { opacity: 0.5; }
.ui-xc__row[aria-checked="true"] { background: var(--ui-xc-well); box-shadow: inset 0 0 0 1px var(--ui-xc-line); }
.ui-xc__badge { display: grid; place-items: center; min-width: 20px; max-width: 56px; padding: 0 4px; height: 20px; border-radius: 6px; background: color-mix(in srgb, var(--ui-xc-color) 16%, transparent); font-size: 11px; font-weight: 600; line-height: 1; color: color-mix(in srgb, var(--ui-xc-color) 72%, var(--ui-xc-ink)); transition: background-color 220ms ease, color 220ms ease; }
.ui-xc__badge > * { grid-area: 1 / 1; transition: opacity 180ms ease, transform 260ms var(--ui-xc-ease); }
.ui-xc__badge span { max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-xc__badge svg { opacity: 0; transform: scale(0.5); }
.ui-xc__row[aria-checked="true"] .ui-xc__badge { background: var(--ui-xc-color); color: #fff; }
.ui-xc__row[aria-checked="true"] .ui-xc__badge span { opacity: 0; transform: scale(0.5); }
.ui-xc__row[aria-checked="true"] .ui-xc__badge svg { opacity: 1; transform: none; }
.ui-xc__label { overflow: hidden; text-align: start; color: var(--ui-xc-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-xc__value { font-weight: 500; color: var(--ui-xc-ink); font-variant-numeric: tabular-nums; }
.ui-xc__lift { min-width: 50px; height: 20px; padding: 0 6px; border-radius: 5px; background: var(--ui-xc-tag-bg); font-size: 11.5px; font-weight: 500; line-height: 20px; color: var(--ui-xc-tag); text-align: center; font-variant-numeric: tabular-nums; transition: background-color 240ms ease, color 240ms ease; }
.ui-xc__track { grid-column: 2 / -1; height: 4px; overflow: hidden; border-radius: 2px; background: var(--ui-xc-track); }
.ui-xc__bar { display: block; width: 100%; height: 100%; border-radius: 2px; background: var(--ui-xc-color); transform-origin: 0 50%; transition: transform 620ms var(--ui-xc-ease); }

/* ----- Tray ----- */
.ui-xc__foot { display: flex; align-items: center; gap: 8px; height: 38px; padding: 4px 4px 0 10px; }
.ui-xc__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-xc-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-xc__caption > span { display: inline-block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: top; animation: ui-xc-in 280ms var(--ui-xc-ease) both; }
.ui-xc__action { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 65%; height: 26px; padding: 0 7px 0 10px; border-radius: 10px; background: var(--ui-xc-ink); font-size: 12.5px; font-weight: 500; color: var(--ui-xc-card); white-space: nowrap; animation: ui-xc-pop 360ms var(--ui-xc-ease) both; transition: opacity 160ms ease; }
.ui-xc__action-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-xc__action:hover { opacity: 0.88; }
.ui-xc__action svg { transition: transform 220ms var(--ui-xc-ease); }
.ui-xc__action:hover svg { transform: translateX(2px); }

@keyframes ui-xc-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-xc-pop { from { opacity: 0; transform: scale(0.94); } }

/* Narrow cards: the note gives way first, then the lift chip loses its padding */
@container (max-width: 300px) {
  .ui-xc__head { gap: 8px; padding: 10px; }
  .ui-xc__chart { width: 30px; height: 30px; padding: 5px 4px 4px; gap: 2.5px; }
  .ui-xc__note { display: none; }
  .ui-xc__lead { gap: 3px; padding: 0 6px; }
  .ui-xc__lead svg { display: none; }
  .ui-xc__body { padding: 0 10px 10px; }
  .ui-xc__metric { padding: 0 4px; }
  .ui-xc__row { column-gap: 7px; }
  .ui-xc__lift { min-width: 44px; padding: 0 4px; }
}

@media (pointer: coarse) {
  .ui-xc__metric { height: 32px; }
  .ui-xc__row { padding: 10px 6px 11px; }
  .ui-xc__action { height: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-xc *, .ui-xc *::before, .ui-xc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-xc {
  --ui-xc-tray: #111113;
  --ui-xc-card: #19191b;
  --ui-xc-line: #2a2a2e;
  --ui-xc-ink: #ededed;
  --ui-xc-text: #c8c8cc;
  --ui-xc-muted: #8b8b92;
  --ui-xc-well: #222225;
  --ui-xc-track: #2c2c31;
  --ui-xc-c0: #6e6e76;
  --ui-xc-c1: #5b8cff;
  --ui-xc-c2: #9b83ff;
  --ui-xc-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="red"] { --ui-xc-tag: #ff9b93; }
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="amber"] { --ui-xc-tag: #f5c264; }
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="green"] { --ui-xc-tag: #6ee7a8; }
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="blue"] { --ui-xc-tag: #9bb8ff; }
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="violet"] { --ui-xc-tag: #c3b1ff; }
:where(.dark, [data-theme="dark"]) .ui-xc [data-tone="gray"] { --ui-xc-tag: #b4b4bb; }
:where(.dark, [data-theme="dark"]) .ui-xc__row[aria-checked="true"] .ui-xc__badge { color: #111113; }
`;
