"use client";

import { memo, useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/*
 * Fan-out Grid – one agent hands a big job to many workers, and every task is a cell on a grid, in a single
 * self-contained file. Like a contribution graph, but live: hundreds of cells fill in as the workers get through them.
 * The bar on top says what runs and how far it is, the white panel below holds the grid.
 *   · cells are tinted by state: queued a faint gray, running blue with a sweeping shine, retrying amber,
 *     done green (with a small pop when it lands), failed red
 *   · done, cost and the time left are counted on top; a quiet line under the grid counts the states and doubles
 *     as a filter – pick a state and every other cell steps back
 *   · point at a cell (or move with the arrow keys) for a small window: the task, its worker, how long it took,
 *     what it cost, how often it was tried, and its result or error – click or Enter keeps it open
 *   · failed tasks can be sent again with "Retry failed"
 * The styles are injected below, so no extra files are needed.
 */

export type FanoutStatus = "queued" | "running" | "retrying" | "done" | "failed";

export type FanoutTask = {
  id: string;
  /** What this task is about, in a few words – e.g. "northwind.io" */
  label: string;
  status: FanoutStatus;
  /** Who works on it, e.g. "Researcher 3" */
  worker?: string;
  /** When it started and ended, in ms from the start of the job */
  start?: number;
  end?: number;
  cost?: number;
  /** How often it was tried – 2 and more show as retries */
  attempts?: number;
  /** What came out, one line – shown in the window of a finished task */
  result?: string;
  /** What went wrong – shown in the window of a failed or retrying task */
  error?: string;
};

export type FanoutGridProps = {
  tasks: FanoutTask[];
  /** What the whole job does – e.g. "Enrich 240 leads" */
  job?: string;
  /** How many workers run at once – used for the time left (defaults to the tasks running now) */
  workers?: number;
  /** The clock, in ms from the start of the job */
  now?: number;
  /** "Retry failed" sends the ids of the failed tasks here – without it, the button doesn't show */
  onRetry?: (ids: string[]) => void;
  /** A task was picked (click or Enter) – null when it's let go */
  onSelect?: (task: FanoutTask | null) => void;
  /** Formats every cost – defaults to dollars, e.g. "$0.014" */
  formatCost?: (amount: number) => string;
  title?: string;
  /** A small mark before the title, e.g. the agent's logo */
  icon?: ReactNode;
  className?: string;
};

/* ---------- Helpers ---------- */

const ORDER: FanoutStatus[] = ["done", "running", "retrying", "failed", "queued"];
/** The states the line under the grid counts – queued is simply what's left */
const SHOWN: FanoutStatus[] = ["done", "running", "retrying", "failed"];
const LABEL: Record<FanoutStatus, string> = { queued: "Queued", running: "Running", retrying: "Retrying", done: "Done", failed: "Failed" };
const SEC = 1000;
/** A broken value (NaN, Infinity) counts as missing */
const num = (n: number | undefined) => (n !== undefined && Number.isFinite(n) ? n : undefined);
const dollars = (n: number) =>
  n === 0 ? "$0" : n < 0.001 ? "<$0.001" : n < 0.01 ? `$${n.toFixed(3)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`;
const took = (time: number) => {
  const ms = Number.isFinite(time) ? Math.max(0, time) : 0;
  if (ms < SEC) return `${Math.round(ms)}ms`;
  if (ms < 10 * SEC) return `${(ms / SEC).toFixed(1)}s`;
  const s = Math.round(ms / SEC);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const fmt = (n: number) => n.toLocaleString("en-US");

/** One cell – only the cells whose state changed render again, not all of them on every tick */
const Cell = memo(function Cell({
  i,
  status,
  dim,
  on,
  pinned,
  setRef,
  onEnter,
  onPick,
}: {
  i: number;
  status: FanoutStatus;
  dim: boolean;
  on: boolean;
  pinned: boolean;
  setRef: (i: number, el: HTMLSpanElement | null) => void;
  onEnter: (i: number) => void;
  onPick: (i: number) => void;
}) {
  return (
    <span
      ref={(el) => setRef(i, el)}
      className="ui-fogc__cell"
      data-status={status}
      data-dim={dim ? "" : undefined}
      data-on={on ? "" : undefined}
      data-pinned={pinned ? "" : undefined}
      // --i staggers the shine, --d the entry – capped, so a thousand cells don't take seconds to arrive
      style={{ "--i": i, "--d": Math.min(i, 240) } as CSSProperties}
      onMouseEnter={() => onEnter(i)}
      onClick={() => onPick(i)}
    />
  );
});

/* ---------- Icons ---------- */

/* A small fan-out mark for the title (drawn for affectUI) */
const FanMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3" cy="8" r="1.9" fill="currentColor" />
    <rect x="10.2" y="1.6" width="3.6" height="3.6" rx="1" fill="currentColor" opacity="0.9" />
    <rect x="10.2" y="6.2" width="3.6" height="3.6" rx="1" fill="currentColor" opacity="0.6" />
    <rect x="10.2" y="10.8" width="3.6" height="3.6" rx="1" fill="currentColor" opacity="0.3" />
    <path d="M4.9 8H7c.6 0 .9-.3 1-.9l.4-2.4c.1-.6.4-.9 1-.9h.6M4.9 8h5.1M4.9 8H7c.6 0 .9.3 1 .9l.4 2.4c.1.6.4.9 1 .9h.6" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);
/* Retry: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const Retry = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20.0092 2V5.13219C20.0092 5.42605 19.6418 5.55908 19.4537 5.33333C17.6226 3.2875 14.9617 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);

export function FanoutGrid({ tasks, job, workers, now = 0, onRetry, onSelect, formatCost = dollars, title = "Fan-out", icon, className }: FanoutGridProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const cellEls = useRef<(HTMLSpanElement | null)[]>([]);
  const tipId = `${useId()}-tip`;

  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [filter, setFilter] = useState<FanoutStatus | null>(null);

  /* ---------- The numbers ---------- */

  const count = Object.fromEntries(ORDER.map((s) => [s, 0])) as Record<FanoutStatus, number>;
  for (const t of tasks) count[t.status]++;
  const total = tasks.length;
  const settled = count.done + count.failed;
  const cost = tasks.reduce((sum, t) => sum + (num(t.cost) ?? 0), 0);
  const finished = total > 0 && settled === total;
  const durations = tasks.filter((t) => t.status === "done" && num(t.start) !== undefined && num(t.end) !== undefined).map((t) => t.end! - t.start!);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const busy = count.running + count.retrying;
  const left = total - settled;
  const lanes = Math.max(1, num(workers) ?? busy);
  const eta = durations.length >= 3 && left > 0 ? (avg * left) / lanes : null;
  const elapsed = finished ? tasks.reduce((max, t) => Math.max(max, num(t.end) ?? 0), 0) : (num(now) ?? 0);

  /* ---------- The window over a cell ---------- */

  const pinnedIndex = pinned ? tasks.findIndex((t) => t.id === pinned) : -1;
  const shown = pinnedIndex >= 0 ? pinnedIndex : (hover ?? active);
  const task = shown !== null && shown >= 0 ? tasks[shown] : undefined;
  const pick = (i: number | null) => {
    const t = i === null ? undefined : tasks[i];
    const next = t && t.id !== pinned ? t.id : null;
    setPinned(next);
    onSelect?.(next ? t! : null);
  };
  // Stable handlers for the cells, so a cell only renders again when its own state changes
  const pickRef = useRef(pick);
  pickRef.current = pick;
  const onPick = useCallback((i: number) => pickRef.current(i), []);
  const setCell = useCallback((i: number, el: HTMLSpanElement | null) => {
    cellEls.current[i] = el;
  }, []);
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const panel = panelRef.current;
    const cell = shown !== null ? cellEls.current[shown] : null;
    if (!tip || !panel || !cell) return;
    const p = panel.getBoundingClientRect();
    const scale = panel.offsetWidth ? p.width / panel.offsetWidth : 1;
    const c = cell.getBoundingClientRect();
    const cx = (c.left + c.width / 2 - p.left) / scale;
    const top = (c.top - p.top) / scale;
    const bottom = (c.bottom - p.top) / scale;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    // Above the cell; below it only when there's no room above
    const below = top - h - 10 < 4;
    const x = Math.max(8, Math.min(cx - w / 2, panel.offsetWidth - w - 8));
    tip.style.left = `${x}px`;
    tip.style.top = `${below ? bottom + 10 : top - h - 10}px`;
    tip.style.setProperty("--x", `${cx - x}px`);
    tip.dataset.side = below ? "below" : "above";
  });

  /* ---------- Keyboard: arrows walk the grid, Enter keeps the window, Escape lets go ---------- */

  const columns = () => {
    const first = cellEls.current[0];
    const grid = gridRef.current;
    if (!first || !grid) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const el of cellEls.current) {
      if (!el || el.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!total) return;
    const cols = columns();
    const at = active ?? 0;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols, Home: -at, End: total - 1 - at };
    if (e.key in moves) {
      e.preventDefault();
      setPinned(null);
      setActive(Math.max(0, Math.min(total - 1, (active === null ? 0 : at + moves[e.key]))));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(at);
    } else if (e.key === "Escape") {
      setPinned(null);
      setActive(null);
      onSelect?.(null);
    }
  };

  /* ---------- What a screen reader hears: the whole run, in steps of ten percent ---------- */

  const step = total ? Math.floor((settled / total) * 10) : 0;
  const said = finished
    ? `Finished: ${fmt(count.done)} done, ${fmt(count.failed)} failed, ${formatCost(cost)}.`
    : `${fmt(count.done)} of ${fmt(total)} done${count.failed ? `, ${fmt(count.failed)} failed` : ""}.`;

  return (
    <div className={["ui-fogc", className].filter(Boolean).join(" ")}>
      <style href="ui-fan-out-grid-clean" precedence="default">
        {css}
      </style>

      <header className="ui-fogc__bar">
        <span className="ui-fogc__mark">{icon ?? <FanMark />}</span>
        <span className="ui-fogc__title" title={title}>
          {title}
        </span>
        {job && (
          <span className="ui-fogc__job" dir="auto" title={job}>
            {job}
          </span>
        )}
        <span className="ui-fogc__sum">
          <span>
            <b>{fmt(count.done)}</b> / {fmt(total)}
          </span>
          <span>
            <b>{formatCost(cost)}</b>
          </span>
          <span className="ui-fogc__time" data-done={finished ? "" : undefined}>
            {finished ? `Finished in ${took(elapsed)}` : eta !== null ? `~${took(eta)} left` : `${took(elapsed)} so far`}
          </span>
        </span>
      </header>

      <div ref={panelRef} className="ui-fogc__panel">
        <div
          ref={gridRef}
          className="ui-fogc__grid"
          role="group"
          aria-label={`${fmt(total)} tasks – arrow keys move, Enter keeps the details`}
          aria-describedby={task ? tipId : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onMouseLeave={() => setHover(null)}
          onBlur={() => setActive(null)}
        >
          {tasks.map((t, i) => (
            <Cell
              key={t.id}
              i={i}
              status={t.status}
              dim={!!filter && filter !== t.status}
              on={shown === i}
              pinned={pinned === t.id}
              setRef={setCell}
              onEnter={setHover}
              onPick={onPick}
            />
          ))}
        </div>

        {/* The states in one quiet line – each one a filter – and, while some failed, Retry */}
        <div className="ui-fogc__foot">
          <div className="ui-fogc__legend" role="group" aria-label="Show only">
            {SHOWN.map((st) => (
              <button
                key={st}
                type="button"
                className="ui-fogc__key"
                data-status={st}
                aria-pressed={filter === st}
                data-off={filter && filter !== st ? "" : undefined}
                data-zero={count[st] === 0 && st !== "done" ? "" : undefined}
                onClick={() => setFilter((f) => (f === st ? null : st))}
              >
                <span className="ui-fogc__swatch" aria-hidden="true" />
                <span className="ui-fogc__n">{fmt(count[st])}</span> {LABEL[st].toLowerCase()}
              </button>
            ))}
          </div>
          {onRetry && count.failed > 0 && (
            <button type="button" className="ui-fogc__retry" onClick={() => onRetry(tasks.filter((t) => t.status === "failed").map((t) => t.id))}>
              <Retry />
              Retry failed
            </button>
          )}
        </div>

        {task && (
          <div ref={tipRef} id={tipId} role="tooltip" className="ui-fogc__tip" data-status={task.status} key={task.id}>
            <span className="ui-fogc__tip-head">
              <span className="ui-fogc__tip-label" dir="auto">
                {task.label}
              </span>
              <span className="ui-fogc__pill" data-status={task.status}>
                {LABEL[task.status]}
              </span>
            </span>
            <span className="ui-fogc__tip-meta">
              {[
                task.worker,
                num(task.start) !== undefined ? took((num(task.end) ?? Math.max(num(now) ?? 0, task.start!)) - task.start!) : undefined,
                num(task.cost) ? formatCost(task.cost!) : undefined,
                (num(task.attempts) ?? 1) > 1 ? `${fmt(task.attempts!)} attempts` : undefined,
              ]
                .filter(Boolean)
                .join(" · ") || "Waiting for a worker"}
            </span>
            {task.error && (task.status === "failed" || task.status === "retrying") && (
              <span className="ui-fogc__tip-error" dir="auto">
                {task.error}
              </span>
            )}
            {task.result && task.status === "done" && (
              <span className="ui-fogc__tip-result" dir="auto">
                {task.result}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="ui-fogc__sr" aria-live="polite" aria-atomic="true" data-step={step}>
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-fogc */
.ui-fogc {
  --ui-fogc-panel: #ffffff;
  --ui-fogc-card: #ffffff;
  --ui-fogc-strong: #000000;
  --ui-fogc-ink: rgba(0, 0, 0, 0.88);
  --ui-fogc-text: rgba(0, 0, 0, 0.61);
  --ui-fogc-muted: rgba(0, 0, 0, 0.45);
  --ui-fogc-faint: rgba(0, 0, 0, 0.27);
  --ui-fogc-line: rgba(0, 0, 0, 0.06);
  --ui-fogc-fill: rgba(0, 0, 0, 0.06);
  --ui-fogc-accent: rgba(0, 96, 226, 0.765);
  --ui-fogc-focus: rgba(0, 96, 226, 0.35);
  /* Cells by state: a tint and its hairline edge – the Trace Waterfall bar recipe */
  --ui-fogc-queued-bg: rgba(0, 0, 0, 0.035);
  --ui-fogc-queued-edge: rgba(0, 0, 0, 0.07);
  --ui-fogc-running-bg: rgba(0, 96, 226, 0.12);
  --ui-fogc-running-edge: rgba(0, 96, 226, 0.36);
  --ui-fogc-running-ink: #0058cf;
  --ui-fogc-retrying-bg: #ff9c0030;
  --ui-fogc-retrying-edge: rgba(214, 120, 0, 0.45);
  --ui-fogc-retrying-ink: #cc4e00;
  --ui-fogc-done-bg: rgba(0, 164, 51, 0.2);
  --ui-fogc-done-edge: rgba(0, 140, 50, 0.38);
  --ui-fogc-done-ink: #007d2ee0;
  --ui-fogc-failed-bg: #f52b002e;
  --ui-fogc-failed-edge: rgba(215, 36, 0, 0.48);
  --ui-fogc-failed-ink: #d72400da;
  --ui-fogc-shine: rgba(255, 255, 255, 0.85);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-fogc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-fogc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-fogc-cell: 12px;
  --ui-fogc-gap: 4px;
  --ui-fogc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container: ui-fogc / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-fogc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-fogc *, .ui-fogc *::before, .ui-fogc *::after { box-sizing: border-box; }
:where(.ui-fogc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-fogc button:focus-visible { outline: 2px solid var(--ui-fogc-focus); outline-offset: 1px; }
.ui-fogc svg { display: block; flex: none; }
.ui-fogc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ui-fogc__n { font-variant-numeric: tabular-nums; }

/* ----- The bar: what runs, and how far it is ----- */
.ui-fogc__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin-bottom: 16px; }
.ui-fogc__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-fogc-accent); }
.ui-fogc__mark > svg { width: 16px; height: 16px; }
.ui-fogc__title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-fogc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-fogc__job { min-width: 0; overflow: hidden; color: var(--ui-fogc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-fogc__sum { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-fogc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-fogc__sum b { font-weight: 500; color: var(--ui-fogc-ink); }
.ui-fogc__time[data-done] { color: var(--ui-fogc-done-ink); }

/* ----- The white panel ----- */
.ui-fogc__panel { position: relative; display: grid; gap: 14px; padding: 16px 16px 14px; border-radius: 10px; background: var(--ui-fogc-panel); box-shadow: var(--ui-fogc-shadow); }

/* The line under the grid: a swatch and a count per state – each one a filter – and Retry on the right */
.ui-fogc__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; }
.ui-fogc__legend { display: flex; flex-wrap: wrap; gap: 0 2px; margin: -3px -6px; }
.ui-fogc__key { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 6px; border-radius: 6px; font-size: 12px; line-height: 16px; color: var(--ui-fogc-muted); transition: background-color 160ms ease, color 160ms ease, opacity 200ms ease; }
.ui-fogc__key:hover, .ui-fogc__key[aria-pressed="true"] { background: var(--ui-fogc-fill); color: var(--ui-fogc-ink); }
/* States that don't occur yet stay out of the line – on narrow containers they hold their place */
.ui-fogc__key[data-zero] { display: none; }
.ui-fogc__key[data-off] { opacity: 0.45; }
.ui-fogc__key .ui-fogc__n { color: var(--ui-fogc-ink); }
.ui-fogc__swatch { width: 8px; height: 8px; border-radius: 2.5px; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); }
.ui-fogc__retry { display: inline-flex; align-items: center; gap: 5px; height: 24px; margin: -3px -6px -3px auto; padding: 0 6px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--ui-fogc-failed-ink); animation: ui-fogc-in 260ms var(--ui-fogc-ease) both; transition: background-color 160ms ease; }
.ui-fogc__retry:hover { background: var(--ui-fogc-failed-bg); }
.ui-fogc__retry > svg { width: 13px; height: 13px; }

/* Every state's colors in one place */
.ui-fogc [data-status="queued"] { --k-bg: var(--ui-fogc-queued-bg); --k-edge: var(--ui-fogc-queued-edge); --k-ink: var(--ui-fogc-muted); }
.ui-fogc [data-status="running"] { --k-bg: var(--ui-fogc-running-bg); --k-edge: var(--ui-fogc-running-edge); --k-ink: var(--ui-fogc-running-ink); }
.ui-fogc [data-status="retrying"] { --k-bg: var(--ui-fogc-retrying-bg); --k-edge: var(--ui-fogc-retrying-edge); --k-ink: var(--ui-fogc-retrying-ink); }
.ui-fogc [data-status="done"] { --k-bg: var(--ui-fogc-done-bg); --k-edge: var(--ui-fogc-done-edge); --k-ink: var(--ui-fogc-done-ink); }
.ui-fogc [data-status="failed"] { --k-bg: var(--ui-fogc-failed-bg); --k-edge: var(--ui-fogc-failed-edge); --k-ink: var(--ui-fogc-failed-ink); }

/* ----- The grid: one cell per task ----- */
.ui-fogc__grid { display: grid; grid-template-columns: repeat(auto-fill, var(--ui-fogc-cell)); gap: var(--ui-fogc-gap); justify-content: space-between; padding: 2px; margin: -2px; border-radius: 6px; outline: none; }
.ui-fogc__grid:focus-visible { box-shadow: 0 0 0 2px var(--ui-fogc-focus); }
.ui-fogc__cell { position: relative; width: var(--ui-fogc-cell); height: var(--ui-fogc-cell); border-radius: 3px; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); overflow: hidden; cursor: pointer; transition: background-color 360ms ease, box-shadow 200ms ease, opacity 220ms ease, transform 160ms ease; animation: ui-fogc-cell-in 420ms var(--ui-fogc-ease) calc(var(--d, 0) * 2ms) backwards; }
/* Running: a shine sweeps across, each cell a little out of step with the next */
.ui-fogc__cell[data-status="running"]::before { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 25%, var(--ui-fogc-shine) 50%, transparent 75%) 0 0 / 300% 100%; opacity: 0.75; animation: ui-fogc-cell-sweep 1300ms linear calc(var(--i, 0) * -97ms) infinite; }
.ui-fogc__cell[data-status="retrying"] { animation: ui-fogc-breathe 1100ms ease-in-out infinite alternate; }
/* Landing: done and failed cells pop once when they get there */
.ui-fogc__cell:is([data-status="done"], [data-status="failed"]) { animation: ui-fogc-pop 420ms var(--ui-fogc-ease); }
.ui-fogc__cell:hover, .ui-fogc__cell[data-on] { box-shadow: inset 0 0 0 1px var(--k-ink); transform: scale(1.3); z-index: 1; }
.ui-fogc__cell[data-pinned] { box-shadow: inset 0 0 0 1px var(--k-ink), 0 0 0 2px var(--ui-fogc-focus); }
.ui-fogc__cell[data-dim] { opacity: 0.18; }

/* ----- The window over a cell ----- */
.ui-fogc__tip { position: absolute; top: 0; left: 0; z-index: 5; display: grid; gap: 3px; width: max-content; max-width: min(280px, calc(100% - 16px)); padding: 9px 12px 10px; border-radius: 10px; background: var(--ui-fogc-card); box-shadow: var(--ui-fogc-pop); pointer-events: none; transform-origin: var(--x, 50%) bottom; animation: ui-fogc-tip 160ms var(--ui-fogc-ease) both; }
.ui-fogc__tip[data-side="below"] { transform-origin: var(--x, 50%) top; }
.ui-fogc__tip-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.ui-fogc__tip-label { display: -webkit-box; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-fogc-ink); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-fogc__pill { flex: none; margin-top: 1px; height: 18px; margin-left: auto; padding: 0 6px; border-radius: 4px; background: var(--k-bg); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--k-ink); }
.ui-fogc__tip-meta { font-size: 12px; line-height: 16px; color: var(--ui-fogc-muted); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ui-fogc__tip-result { display: -webkit-box; overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-fogc-text); text-align: start; white-space: pre-line; overflow-wrap: anywhere; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.ui-fogc__tip-error { display: -webkit-box; overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-fogc-failed-ink); text-align: start; white-space: pre-line; overflow-wrap: anywhere; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }

/* ----- Narrow: smaller cells, the numbers on a line of their own ----- */
@container ui-fogc (max-width: 520px) {
  /* Set on the panel – a container query can't style the container itself */
  .ui-fogc__panel { --ui-fogc-cell: 10px; --ui-fogc-gap: 3px; padding: 12px; }
  .ui-fogc__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  /* The counts in a fixed two-by-two grid, Retry beside it – nothing moves when a state shows up or Retry appears */
  .ui-fogc__foot { align-items: center; }
  .ui-fogc__legend { display: grid; grid-template-columns: repeat(2, max-content); }
  .ui-fogc__key[data-zero] { display: inline-flex; opacity: 0.45; }
  .ui-fogc__retry { flex: none; margin-left: auto; }
}

@keyframes ui-fogc-cell-in { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-fogc-pop { 0% { transform: scale(0.7); } 55% { transform: scale(1.18); } 100% { transform: scale(1); } }
@keyframes ui-fogc-cell-sweep { from { background-position: 100% 0; } to { background-position: -50% 0; } }
@keyframes ui-fogc-breathe { from { opacity: 0.55; } to { opacity: 1; } }
@keyframes ui-fogc-tip { from { opacity: 0; transform: translateY(3px) scale(0.97); } }
@keyframes ui-fogc-in { from { opacity: 0; transform: translateY(2px); } }

@media (prefers-reduced-motion: reduce) {
  .ui-fogc *, .ui-fogc *::before, .ui-fogc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-fogc {
  --ui-fogc-panel: #1c1c1f;
  --ui-fogc-card: #232326;
  --ui-fogc-strong: #ffffff;
  --ui-fogc-ink: rgba(255, 255, 255, 0.9);
  --ui-fogc-text: rgba(255, 255, 255, 0.62);
  --ui-fogc-muted: rgba(255, 255, 255, 0.45);
  --ui-fogc-faint: rgba(255, 255, 255, 0.28);
  --ui-fogc-line: rgba(255, 255, 255, 0.08);
  --ui-fogc-fill: rgba(255, 255, 255, 0.08);
  --ui-fogc-accent: #5b9aff;
  --ui-fogc-focus: rgba(91, 154, 255, 0.45);
  --ui-fogc-queued-bg: rgba(255, 255, 255, 0.05);
  --ui-fogc-queued-edge: rgba(255, 255, 255, 0.09);
  --ui-fogc-running-bg: rgba(60, 130, 255, 0.24);
  --ui-fogc-running-edge: rgba(112, 170, 255, 0.5);
  --ui-fogc-running-ink: #8ab8ff;
  --ui-fogc-retrying-bg: rgba(255, 160, 40, 0.24);
  --ui-fogc-retrying-edge: rgba(255, 180, 70, 0.5);
  --ui-fogc-retrying-ink: #ffb357;
  --ui-fogc-done-bg: rgba(40, 200, 110, 0.22);
  --ui-fogc-done-edge: rgba(60, 220, 130, 0.42);
  --ui-fogc-done-ink: #3dd68c;
  --ui-fogc-failed-bg: rgba(255, 70, 50, 0.24);
  --ui-fogc-failed-edge: rgba(255, 110, 90, 0.5);
  --ui-fogc-failed-ink: #ff977d;
  --ui-fogc-shine: rgba(255, 255, 255, 0.3);
  --ui-fogc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-fogc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
`;
