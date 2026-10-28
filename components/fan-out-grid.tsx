"use client";

import { memo, useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/*
 * Fan-out Grid – one agent hands a big job to many workers, and every task is a cell on a grid, in a single
 * self-contained file. Like a contribution graph, but live: hundreds of cells fill in as the workers get through them.
 * A soft gray tray with what runs and how far it is, a white card with the grid, the counts on the tray below.
 *   · cells are tinted by state: queued a faint gray, running blue with a sweeping shine, retrying amber,
 *     done green (with a small pop when it lands), failed red
 *   · done, cost and the time left are counted on top; the counts under the card double as a filter – pick a
 *     state and every other cell steps back
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
      className="ui-fog__cell"
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
    <div className={["ui-fog", className].filter(Boolean).join(" ")}>
      <style href="ui-fan-out-grid" precedence="default">
        {css}
      </style>

      <header className="ui-fog__bar">
        <span className="ui-fog__mark">{icon ?? <FanMark />}</span>
        <span className="ui-fog__title" title={title}>
          {title}
        </span>
        {job && (
          <span className="ui-fog__job" dir="auto" title={job}>
            {job}
          </span>
        )}
        <span className="ui-fog__sum">
          <span>
            <b>{fmt(count.done)}</b> / {fmt(total)}
          </span>
          <span>
            <b>{formatCost(cost)}</b>
          </span>
          <span className="ui-fog__time" data-done={finished ? "" : undefined}>
            {finished ? `Finished in ${took(elapsed)}` : eta !== null ? `~${took(eta)} left` : `${took(elapsed)} so far`}
          </span>
        </span>
      </header>

      <div ref={panelRef} className="ui-fog__panel">
        <div
          ref={gridRef}
          className="ui-fog__grid"
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

        {task && (
          <div ref={tipRef} id={tipId} role="tooltip" className="ui-fog__tip" data-status={task.status} key={task.id}>
            <span className="ui-fog__tip-head">
              <span className="ui-fog__tip-label" dir="auto">
                {task.label}
              </span>
              <span className="ui-fog__pill" data-status={task.status}>
                {LABEL[task.status]}
              </span>
            </span>
            <span className="ui-fog__tip-meta">
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
              <span className="ui-fog__tip-error" dir="auto">
                {task.error}
              </span>
            )}
            {task.result && task.status === "done" && (
              <span className="ui-fog__tip-result" dir="auto">
                {task.result}
              </span>
            )}
          </div>
        )}
      </div>

      {/* On the tray under the card: the states – each one a filter – and, while some failed, Retry */}
      <div className="ui-fog__foot">
        <div className="ui-fog__legend" role="group" aria-label="Show only">
          {SHOWN.map((st) => (
            <button
              key={st}
              type="button"
              className="ui-fog__key"
              data-status={st}
              aria-pressed={filter === st}
              data-off={filter && filter !== st ? "" : undefined}
              data-zero={count[st] === 0 && st !== "done" ? "" : undefined}
              onClick={() => setFilter((f) => (f === st ? null : st))}
            >
              <span className="ui-fog__swatch" aria-hidden="true" />
              <span className="ui-fog__n">{fmt(count[st])}</span> {LABEL[st].toLowerCase()}
            </button>
          ))}
        </div>
        {onRetry && count.failed > 0 && (
          <button type="button" className="ui-fog__retry" onClick={() => onRetry(tasks.filter((t) => t.status === "failed").map((t) => t.id))}>
            <Retry />
            Retry failed
          </button>
        )}
      </div>


      <div className="ui-fog__sr" aria-live="polite" aria-atomic="true" data-step={step}>
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-fog */
.ui-fog {
  --ui-fog-tray: #f0f0f0;
  --ui-fog-card: #ffffff;
  --ui-fog-panel: #ffffff;
  --ui-fog-strong: #171717;
  --ui-fog-ink: #171717;
  --ui-fog-text: #6b6b6b;
  --ui-fog-muted: #8a8a8a;
  --ui-fog-faint: #b8b8b8;
  --ui-fog-line: #ececec;
  --ui-fog-fill: rgba(0, 0, 0, 0.05);
  --ui-fog-accent: #2f6bff;
  --ui-fog-focus: rgba(23, 23, 23, 0.22);
  /* Cells by state: a tint and its edge */
  --ui-fog-queued-bg: #f3f3f3;
  --ui-fog-queued-edge: #e6e6e6;
  --ui-fog-running-bg: #e3ecff;
  --ui-fog-running-edge: #a9c2ff;
  --ui-fog-running-ink: #2456d6;
  --ui-fog-retrying-bg: #ffefd6;
  --ui-fog-retrying-edge: #f7c27a;
  --ui-fog-retrying-ink: #b85c00;
  --ui-fog-done-bg: #dcf3e4;
  --ui-fog-done-edge: #9fd9b4;
  --ui-fog-done-ink: #1a7f45;
  --ui-fog-failed-bg: #fde3df;
  --ui-fog-failed-edge: #f1a397;
  --ui-fog-failed-ink: #c2331f;
  --ui-fog-shine: rgba(255, 255, 255, 0.9);
  --ui-fog-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-fog-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-fog-cell: 12px;
  --ui-fog-gap: 4px;
  --ui-fog-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-fog-tray);
  container: ui-fog / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-fog-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-fog *, .ui-fog *::before, .ui-fog *::after { box-sizing: border-box; }
:where(.ui-fog) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-fog button:focus-visible { outline: 2px solid var(--ui-fog-focus); outline-offset: 1px; }
.ui-fog svg { display: block; flex: none; }
.ui-fog__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ui-fog__n { font-variant-numeric: tabular-nums; }

/* ----- On the tray: what runs, and how far it is ----- */
.ui-fog__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 8px 12px 12px; }
.ui-fog__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-fog-accent); }
.ui-fog__mark > svg { width: 16px; height: 16px; }
.ui-fog__title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-fog-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-fog__job { min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-fog-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-fog__sum { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ui-fog-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-fog__sum b { font-weight: 600; color: var(--ui-fog-ink); }
.ui-fog__time[data-done] { font-weight: 500; color: var(--ui-fog-done-ink); }

/* ----- The white card with the grid ----- */
.ui-fog__panel { position: relative; display: grid; padding: 18px; border-radius: 16px; background: var(--ui-fog-panel); box-shadow: var(--ui-fog-shadow); }

/* ----- On the tray under the card: a swatch and a count per state – each one a filter – and Retry ----- */
.ui-fog__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; padding: 8px 6px 4px 8px; }
.ui-fog__legend { display: flex; flex-wrap: wrap; gap: 0 2px; }
.ui-fog__key { display: inline-flex; align-items: center; gap: 7px; height: 28px; padding: 0 9px; border-radius: 999px; font-size: 13px; line-height: 18px; color: var(--ui-fog-muted); transition: background-color 160ms ease, color 160ms ease, opacity 200ms ease, box-shadow 160ms ease; }
.ui-fog__key:hover { background: var(--ui-fog-fill); color: var(--ui-fog-ink); }
.ui-fog__key[aria-pressed="true"] { background: var(--ui-fog-card); box-shadow: var(--ui-fog-shadow); color: var(--ui-fog-ink); }
/* States that don't occur yet stay out of the line – on narrow containers they hold their place */
.ui-fog__key[data-zero] { display: none; }
.ui-fog__key[data-off] { opacity: 0.5; }
.ui-fog__key .ui-fog__n { font-weight: 600; color: var(--ui-fog-ink); }
.ui-fog__swatch { width: 9px; height: 9px; border-radius: 3px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); }
.ui-fog__retry { display: inline-flex; align-items: center; gap: 6px; height: 30px; margin-left: auto; padding: 0 12px 0 10px; border-radius: 999px; background: var(--ui-fog-card); box-shadow: var(--ui-fog-shadow); font-size: 13px; font-weight: 500; color: var(--ui-fog-failed-ink); animation: ui-fog-in 260ms var(--ui-fog-ease) both; transition: box-shadow 160ms ease; }
.ui-fog__retry:hover { box-shadow: var(--ui-fog-pop); }

/* Every state's colors in one place */
.ui-fog [data-status="queued"] { --k-bg: var(--ui-fog-queued-bg); --k-edge: var(--ui-fog-queued-edge); --k-ink: var(--ui-fog-muted); }
.ui-fog [data-status="running"] { --k-bg: var(--ui-fog-running-bg); --k-edge: var(--ui-fog-running-edge); --k-ink: var(--ui-fog-running-ink); }
.ui-fog [data-status="retrying"] { --k-bg: var(--ui-fog-retrying-bg); --k-edge: var(--ui-fog-retrying-edge); --k-ink: var(--ui-fog-retrying-ink); }
.ui-fog [data-status="done"] { --k-bg: var(--ui-fog-done-bg); --k-edge: var(--ui-fog-done-edge); --k-ink: var(--ui-fog-done-ink); }
.ui-fog [data-status="failed"] { --k-bg: var(--ui-fog-failed-bg); --k-edge: var(--ui-fog-failed-edge); --k-ink: var(--ui-fog-failed-ink); }

/* ----- The grid: one cell per task ----- */
.ui-fog__grid { display: grid; grid-template-columns: repeat(auto-fill, var(--ui-fog-cell)); gap: var(--ui-fog-gap); justify-content: space-between; padding: 2px; margin: -2px; border-radius: 6px; outline: none; }
.ui-fog__grid:focus-visible { box-shadow: 0 0 0 2px var(--ui-fog-focus); }
.ui-fog__cell { position: relative; width: var(--ui-fog-cell); height: var(--ui-fog-cell); border-radius: 3.5px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); overflow: hidden; cursor: pointer; transition: background-color 360ms ease, box-shadow 200ms ease, opacity 220ms ease, transform 160ms ease; animation: ui-fog-cell-in 420ms var(--ui-fog-ease) calc(var(--d, 0) * 2ms) backwards; }
.ui-fog__cell[data-status="running"]::before { content: ""; position: absolute; inset: 0; background: linear-gradient(110deg, transparent 25%, var(--ui-fog-shine) 50%, transparent 75%) 0 0 / 300% 100%; opacity: 0.8; animation: ui-fog-cell-sweep 1300ms linear calc(var(--i, 0) * -97ms) infinite; }
.ui-fog__cell[data-status="retrying"] { animation: ui-fog-breathe 1100ms ease-in-out infinite alternate; }
.ui-fog__cell:is([data-status="done"], [data-status="failed"]) { animation: ui-fog-pop 420ms var(--ui-fog-ease); }
.ui-fog__cell:hover, .ui-fog__cell[data-on] { box-shadow: inset 0 0 0 1.5px var(--k-ink); transform: scale(1.3); z-index: 1; }
.ui-fog__cell[data-pinned] { box-shadow: inset 0 0 0 1.5px var(--k-ink), 0 0 0 2px var(--ui-fog-focus); }
.ui-fog__cell[data-dim] { opacity: 0.2; }

/* ----- The window over a cell ----- */
.ui-fog__tip { position: absolute; top: 0; left: 0; z-index: 5; display: grid; gap: 3px; width: max-content; max-width: min(290px, calc(100% - 16px)); padding: 10px 14px 11px; border-radius: 14px; background: var(--ui-fog-card); box-shadow: var(--ui-fog-pop); pointer-events: none; transform-origin: var(--x, 50%) bottom; animation: ui-fog-tip 160ms var(--ui-fog-ease) both; }
.ui-fog__tip[data-side="below"] { transform-origin: var(--x, 50%) top; }
.ui-fog__tip-head { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.ui-fog__tip-label { display: -webkit-box; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-fog-ink); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-fog__pill { flex: none; height: 20px; margin-left: auto; padding: 0 8px; border-radius: 999px; background: var(--k-bg); font-size: 12px; font-weight: 500; line-height: 20px; color: var(--k-ink); }
.ui-fog__tip-meta { font-size: 12.5px; line-height: 18px; color: var(--ui-fog-muted); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ui-fog__tip-result { display: -webkit-box; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-fog-text); text-align: start; white-space: pre-line; overflow-wrap: anywhere; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.ui-fog__tip-error { display: -webkit-box; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-fog-failed-ink); text-align: start; white-space: pre-line; overflow-wrap: anywhere; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }

/* ----- Narrow: smaller cells, the numbers on a line of their own ----- */
@container ui-fog (max-width: 520px) {
  /* Set on the card – a container query can't style the container itself */
  .ui-fog__panel { --ui-fog-cell: 10px; --ui-fog-gap: 3px; padding: 14px; }
  .ui-fog__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  /* The counts in a fixed two-by-two grid, Retry beside it – nothing moves when a state shows up or Retry appears */
  .ui-fog__foot { align-items: center; }
  .ui-fog__legend { display: grid; grid-template-columns: repeat(2, max-content); }
  .ui-fog__key[data-zero] { display: inline-flex; opacity: 0.45; }
  .ui-fog__retry { flex: none; margin-left: auto; }
}

@keyframes ui-fog-cell-in { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-fog-pop { 0% { transform: scale(0.7); } 55% { transform: scale(1.18); } 100% { transform: scale(1); } }
@keyframes ui-fog-cell-sweep { from { background-position: 100% 0; } to { background-position: -50% 0; } }
@keyframes ui-fog-breathe { from { opacity: 0.55; } to { opacity: 1; } }
@keyframes ui-fog-tip { from { opacity: 0; transform: translateY(3px) scale(0.97); } }
@keyframes ui-fog-in { from { opacity: 0; transform: translateY(2px); } }

@media (prefers-reduced-motion: reduce) {
  .ui-fog *, .ui-fog *::before, .ui-fog *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-fog {
  --ui-fog-tray: #1a1a1c;
  --ui-fog-card: #232326;
  --ui-fog-panel: #232326;
  --ui-fog-strong: #f5f5f5;
  --ui-fog-ink: #f0f0f0;
  --ui-fog-text: #a1a1a1;
  --ui-fog-muted: #8a8a8a;
  --ui-fog-faint: #5c5c5c;
  --ui-fog-line: #2e2e31;
  --ui-fog-fill: rgba(255, 255, 255, 0.06);
  --ui-fog-accent: #6d93ff;
  --ui-fog-focus: rgba(255, 255, 255, 0.3);
  --ui-fog-queued-bg: #2b2b2f;
  --ui-fog-queued-edge: #36363b;
  --ui-fog-running-bg: #1d2b4d;
  --ui-fog-running-edge: #3c5fb3;
  --ui-fog-running-ink: #8aaeff;
  --ui-fog-retrying-bg: #3a2a12;
  --ui-fog-retrying-edge: #8a5a1c;
  --ui-fog-retrying-ink: #ffb357;
  --ui-fog-done-bg: #15321f;
  --ui-fog-done-edge: #2f7a4b;
  --ui-fog-done-ink: #55d68c;
  --ui-fog-failed-bg: #3d1a16;
  --ui-fog-failed-edge: #8f3a2e;
  --ui-fog-failed-ink: #ff8a76;
  --ui-fog-shine: rgba(255, 255, 255, 0.28);
  --ui-fog-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-fog-pop: 0 0 0 1px #34343a, 0 16px 36px -12px rgba(0, 0, 0, 0.7);
}
`;
