"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Agent Lanes – where every agent is right now, as a live timeline, in a single self-contained file.
 * One white card: a lane per agent (avatar, name, model on the left), its tasks as blocks along the time it took,
 * and a "now" line on the right edge. The window slides with the clock, so the picture is always the last half hour.
 *   · done tasks are quiet gray blocks, the running one grows into "now" and shimmers; tool logos lead the title
 *   · a task that waits for a person pulses amber and ends in "Needs you" – click it to Approve or Reject in place
 *   · a failed task is red; a hand-off draws a thin curve from the end of one task to the next agent's task
 *   · click any other block for a small dark tooltip with what got done; blocks slide out of the window and fade
 * The tasks are yours: pass them with start and end times (no end while running) – the component draws and moves them.
 * The styles are injected below, so no extra files are needed.
 */

export type LaneAgent = {
  id: string;
  name: string;
  /** Model or role, shown under the name, e.g. "Opus 5.5" */
  model?: string;
  /** A small mark – defaults to the initials on a soft tile */
  avatar?: ReactNode;
};

export type LaneTaskStatus = "done" | "running" | "waiting" | "failed";

export type LaneTask = {
  id: string;
  agentId: string;
  title: string;
  status: LaneTaskStatus;
  start: number | Date;
  /** Leave it out while the task runs or waits – it then reaches "now" */
  end?: number | Date;
  /** Id of the task another agent picked up from this one – drawn as a hand-off curve */
  handoffTo?: string;
  /** What exactly needs a decision, shown above Approve / Reject */
  ask?: string;
  /** What got done so far, a few words each – shown in a small tooltip when the block is clicked */
  summary?: string[];
  /** Small logos of the tools it works in, shown before the title – up to three */
  tools?: ReactNode[];
};

export type AgentLanesProps = {
  agents: LaneAgent[];
  tasks: LaneTask[];
  /** How much time the lanes show, in ms (default 30 minutes) */
  span?: number;
  /** A clock you control – e.g. a faster one for a demo. Without it the lanes follow real time */
  now?: number;
  onApprove?: (task: LaneTask) => void;
  onReject?: (task: LaneTask) => void;
  /** Shows "Open" in a block's tooltip */
  onOpen?: (task: LaneTask) => void;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const ms = (d: number | Date) => (typeof d === "number" ? d : d.getTime());
const MIN = 60_000;
const mins = (t: number) => {
  const m = Math.max(0, Math.round(t / MIN));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${Math.floor(h / 24)}d`;
};
// The first letter or digit of the first two words – whole characters, so an emoji never splits in half
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => Array.from(w).find((c) => /[\p{L}\p{N}]/u.test(c)))
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
/** Tick steps in minutes – the axis gets at most six labels, so they never run into each other */
const STEPS = [1, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440];
const STATE: Record<LaneTaskStatus, string> = { done: "Done", running: "Running", waiting: "Needs you", failed: "Failed" };
const ROW = 48;

/* ---------- Icons ---------- */

const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
const HandIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 1.8 10.8 10H1.2L6 1.8Z" fill="currentColor" />
  </svg>
);

export function AgentLanes({ agents, tasks, span = 30 * MIN, now: nowProp, onApprove, onReject, onOpen, title = "Agents", className }: AgentLanesProps) {
  const uid = useId();
  const [tick, setTick] = useState(() => Date.now());
  /** The block whose decision or tooltip is open */
  const [opened, setOpened] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Partial<LaneTask>>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  // Real time: blocks and curves are drawn from the same clock, every quarter second – they always move together
  useEffect(() => {
    if (nowProp !== undefined) return;
    const id = window.setInterval(() => setTick(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [nowProp]);
  const now = nowProp ?? tick;
  const from = now - span;

  // Without handlers the lanes decide on their own: Approve runs on, Reject fails
  const list = tasks.map((t) => (local[t.id] ? { ...t, ...local[t.id] } : t));
  const decide = (t: LaneTask, ok: boolean) => {
    setOpened(null);
    const handler = ok ? onApprove : onReject;
    if (handler) return handler(t);
    setLocal((l) => ({ ...l, [t.id]: ok ? { status: "running" } : { status: "failed", end: now } }));
  };

  /** Position in the window, 0–100 – below 0 the block is sliding out on the left */
  const x = (t: number) => Math.min(100, ((t - from) / span) * 100);
  /*
   * Blocks and curves sit on a fixed timeline that starts at the first render; the whole layer slides left as one
   * piece (a transform, so it moves in sub-pixels instead of snapping every block's position to whole pixels).
   */
  const origin = useRef(now).current;
  const at = (t: number) => ((t - origin) / span) * 100 + 100;
  const shift = ((now - origin) / span) * 100;
  const visible = list.filter((t) => (t.end === undefined ? now : ms(t.end)) > from);

  // Ticks at a round step that gives six labels or fewer, labelled relative to now
  const ticks = useMemo(() => {
    const step = (STEPS.find((m) => span / (m * MIN) <= 6) ?? Math.ceil(span / (6 * 1440 * MIN)) * 1440) * MIN;
    const out: number[] = [];
    for (let t = span - step; t > 0; t -= step) out.push(t);
    return { step, ago: out };
  }, [span]);

  // Hand-offs: from the end of one block to the start of the next agent's block
  const row = (agentId: string) => agents.findIndex((a) => a.id === agentId);
  const curves = visible.flatMap((t) => {
    const next = t.handoffTo ? list.find((n) => n.id === t.handoffTo) : undefined;
    if (!next) return [];
    const x1 = at(t.end === undefined ? now : ms(t.end)) * 10;
    const x2 = at(ms(next.start)) * 10;
    const y1 = row(t.agentId) * ROW + ROW / 2;
    const y2 = row(next.agentId) * ROW + ROW / 2;
    if (y1 < 0 || y2 < 0) return [];
    const bend = Math.max(24, Math.abs(x2 - x1) / 2);
    return [{ id: `${t.id}>${next.id}`, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, live: next.status === "running" }];
  });

  // A click anywhere else closes the tooltip or decision
  useEffect(() => {
    if (!opened) return;
    const away = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.(`[data-task="${opened}"], .ui-alc__pop`)) setOpened(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [opened]);
  const openTask = visible.find((t) => t.id === opened);
  // The tag keeps its last word while it fades out
  const lastState = useRef<Record<string, string>>({});
  for (const a of agents) {
    const b = list.find((t) => t.agentId === a.id && (t.status === "running" || t.status === "waiting"));
    if (b?.status === "waiting") lastState.current[a.id] = "Needs you";
    else if (!b) lastState.current[a.id] = "Idle";
  }

  const needs = list.filter((t) => t.status === "waiting").length;
  const running = list.filter((t) => t.status === "running").length;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && opened) {
      e.stopPropagation();
      rootRef.current?.querySelector<HTMLElement>(`[data-task="${opened}"]`)?.focus();
      setOpened(null);
    }
  };

  return (
    <div ref={rootRef} className={["ui-alc", className].filter(Boolean).join(" ")} onKeyDown={onKeyDown}>
      <style href="ui-agent-lanes-clean" precedence="default">
        {css}
      </style>

      <div className="ui-alc__card">
        <header className="ui-alc__bar">
          <span className="ui-alc__spark">
            <Spark />
          </span>
          <span className="ui-alc__title" title={title}>
            {title}
          </span>
          <span className="ui-alc__summary">
            <span data-kind="running">{running} running</span>
            {needs > 0 && <span data-kind="needs">{needs} {needs === 1 ? "needs" : "need"} you</span>}
          </span>
          <span className="ui-alc__window">Last {mins(span)}</span>
        </header>

        <div className="ui-alc__body" style={{ ["--rows" as string]: agents.length }}>
          {/* Who */}
          <ul className="ui-alc__agents">
            {agents.map((a) => {
              const busy = list.find((t) => t.agentId === a.id && (t.status === "running" || t.status === "waiting"));
              return (
                <li key={a.id} className="ui-alc__agent">
                  <span className="ui-alc__avatar" data-logo={a.avatar ? "" : undefined}>
                    {a.avatar ?? initials(a.name)}
                  </span>
                  <span className="ui-alc__who" data-state={busy?.status ?? "idle"}>
                    <span className="ui-alc__name-line">
                      <span className="ui-alc__name" dir="auto" title={a.name}>
                        {a.name}
                      </span>
                        {/* Idle or Needs you as a small tag that fades in and out */}
                        <span className="ui-alc__state" data-show={busy?.status === "running" ? undefined : ""} aria-hidden={busy?.status === "running"}>
                          <span>{busy?.status === "waiting" ? "Needs you" : busy ? (lastState.current[a.id] ?? "Idle") : "Idle"}</span>
                        </span>
                    </span>
                    <span className="ui-alc__model">
                      {a.model && (
                        <span className="ui-alc__model-name" title={a.model}>
                          {a.model}
                        </span>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>

          {/* When */}
          <div className="ui-alc__track">
            <div className="ui-alc__grid" aria-hidden="true">
              {ticks.ago.map((ago) => (
                <span key={ago} className="ui-alc__tick" style={{ left: `${100 - (ago / span) * 100}%` }}>
                  <span>−{mins(ago)}</span>
                </span>
              ))}
            </div>

            {/* Blocks and curves: clipped at the left edge, where they fade as they slide out */}
            <div className="ui-alc__clip">
              <div className="ui-alc__layer" style={{ transform: `translateX(${-shift}%)` }}>
              <svg className="ui-alc__curves" viewBox={`0 0 1000 ${agents.length * ROW}`} preserveAspectRatio="none" aria-hidden="true">
                {curves.map((c) => (
                  <path key={c.id} d={c.d} data-live={c.live ? "" : undefined} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>

              {agents.map((a, i) => (
                <ul key={a.id} className="ui-alc__lane" style={{ top: i * ROW }} aria-label={`${a.name}'s tasks`}>
                  {visible
                    .filter((t) => t.agentId === a.id)
                    .map((t) => {
                      const end = t.end === undefined ? now : ms(t.end);
                      const width = ((end - ms(t.start)) / span) * 100;
                      const took = mins(end - ms(t.start));
                      const open = opened === t.id;
                      // A running or waiting block that began before the window: its title moves in past the left fade
                      const cut = t.end === undefined && ms(t.start) < from ? (from - ms(t.start)) / (end - ms(t.start)) : 0;
                      return (
                        <li key={t.id} className="ui-alc__slot" data-status={t.status} style={{ left: `${at(ms(t.start))}%`, width: `${width}%` }}>
                          <button
                            type="button"
                            data-task={t.id}
                            className="ui-alc__block"
                            data-status={t.status}
                            title={t.title}
                            style={cut ? { paddingLeft: `calc(${cut * 100}% + 40px)` } : undefined}
                            data-open={open ? "" : undefined}
                            aria-expanded={open}
                            aria-controls={`${uid}-${t.id}`}
                            aria-label={`${a.name}: ${t.title} – ${STATE[t.status]}${t.status === "done" ? `, took ${took}` : `, ${took}`}`}
                            onClick={() => setOpened(open ? null : t.id)}
                          >
                            {t.tools && t.tools.length > 0 && (
                              <span className="ui-alc__tools" aria-hidden="true">
                                {t.tools.slice(0, 3).map((tool, k) => (
                                  <span key={k} className="ui-alc__tool">
                                    {tool}
                                  </span>
                                ))}
                              </span>
                            )}
                            <span className="ui-alc__label" dir="auto">
                              {t.title}
                            </span>
                          </button>
                          {t.status === "waiting" && (
                            <span className="ui-alc__flag" aria-hidden="true">
                              <HandIcon />
                              Needs you
                            </span>
                          )}
                        </li>
                      );
                    })}
                </ul>
              ))}
              </div>
            </div>

            {/* The open block's decision or tooltip – outside the clip, so it is never cut */}
            {openTask &&
              (() => {
                const lane = row(openTask.agentId);
                const up = lane >= agents.length / 2;
                const end = openTask.end === undefined ? now : ms(openTask.end);
                const a = agents[lane];
                if (openTask.status === "waiting")
                  return (
                    <div
                      className="ui-alc__pop ui-alc__ask"
                      id={`${uid}-${openTask.id}`}
                      role="dialog"
                      aria-label={`Decide: ${openTask.title}`}
                      data-up={up ? "" : undefined}
                      style={{ top: up ? lane * ROW + 6 : (lane + 1) * ROW - 6, right: `${100 - x(end)}%` }}
                    >
                      <span className="ui-alc__ask-title" dir="auto">
                        {openTask.title}
                      </span>
                      {openTask.ask && (
                        <span className="ui-alc__ask-text" dir="auto">
                          {openTask.ask}
                        </span>
                      )}
                      <span className="ui-alc__ask-actions">
                        <button type="button" className="ui-alc__btn" onClick={() => decide(openTask, false)}>
                          Reject
                        </button>
                        <button type="button" className="ui-alc__btn ui-alc__btn--primary" autoFocus onClick={() => decide(openTask, true)}>
                          Approve
                        </button>
                      </span>
                    </div>
                  );
                // A small dark tooltip under (or over) the visible part of the block
                const mid = (Math.max(0, x(ms(openTask.start))) + x(end)) / 2;
                return (
                  <div
                    className="ui-alc__pop ui-alc__tip"
                    id={`${uid}-${openTask.id}`}
                    role="tooltip"
                    data-up={up ? "" : undefined}
                    style={{ top: up ? lane * ROW + 6 : (lane + 1) * ROW - 6, left: `${Math.max(14, Math.min(86, mid))}%` }}
                  >
                    {/* A long name shortens, the state and the time stay */}
                    <span className="ui-alc__tip-head">
                      <span className="ui-alc__tip-name" dir="auto">
                        {a?.name}
                      </span>
                      <span>
                        · {STATE[openTask.status]} · {mins(end - ms(openTask.start))}
                      </span>
                    </span>
                    {openTask.summary?.length ? (
                      <ul className="ui-alc__tip-list">
                        {openTask.summary.map((line) => (
                          <li key={line} dir="auto">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="ui-alc__tip-title" dir="auto">
                        {openTask.title}
                      </span>
                    )}
                    {onOpen && (
                      <button type="button" className="ui-alc__tip-open" onClick={() => onOpen(openTask)}>
                        Open
                      </button>
                    )}
                  </div>
                );
              })()}

            <span className="ui-alc__now" aria-hidden="true">
              <span>now</span>
            </span>
          </div>
        </div>
      </div>

      <span className="ui-alc__sr" aria-live="polite">
        {needs > 0 ? `${needs} task${needs === 1 ? "" : "s"} need you` : `${running} running`}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-alc */
.ui-alc {
  --ui-alc-card: #ffffff;
  --ui-alc-strong: #000000;
  --ui-alc-ink: rgba(0, 0, 0, 0.88);
  --ui-alc-text: rgba(0, 0, 0, 0.61);
  --ui-alc-muted: rgba(0, 0, 0, 0.45);
  --ui-alc-faint: rgba(0, 0, 0, 0.27);
  --ui-alc-line: rgba(0, 0, 0, 0.06);
  --ui-alc-rail: rgba(0, 0, 0, 0.15);
  --ui-alc-wash: rgba(0, 0, 0, 0.03);
  --ui-alc-fill: rgba(0, 0, 0, 0.06);
  --ui-alc-done: rgba(0, 0, 0, 0.05);
  --ui-alc-solid: rgba(0, 0, 0, 0.88);
  --ui-alc-on-solid: #fcfcfc;
  /* Subtle tones after the Radix scales: a soft background and its foreground */
  --ui-alc-run-bg: #008ff519;
  --ui-alc-run-fg: #006dcbf2;
  --ui-alc-run-edge: rgba(0, 96, 226, 0.5);
  --ui-alc-warn-bg: #ff9c0029;
  --ui-alc-warn-fg: #cc4e00;
  --ui-alc-danger-bg: #f52b0018;
  --ui-alc-danger-fg: #d72400da;
  --ui-alc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-alc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-alc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-alc-row: ${ROW}px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 760px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-alc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-alc *, .ui-alc *::before, .ui-alc *::after { box-sizing: border-box; }
:where(.ui-alc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-alc button:focus-visible { outline: 2px solid var(--ui-alc-focus); outline-offset: 1px; }
.ui-alc ul { margin: 0; padding: 0; list-style: none; }
.ui-alc svg { display: block; flex: none; }
.ui-alc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* One white card – the edge is a shadow, not a border */
.ui-alc__card { border-radius: 10px; background: var(--ui-alc-card); box-shadow: var(--ui-alc-shadow); }

/* ----- Bar ----- */
.ui-alc__bar { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 14px 16px; border-bottom: 0.5px solid var(--ui-alc-line); }
.ui-alc__spark { display: grid; flex: none; place-items: center; width: 16px; color: rgba(0, 96, 226, 0.765); }
.ui-alc__title { font-weight: 500; color: var(--ui-alc-strong); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-alc__summary { display: flex; flex: 1; gap: 12px; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-alc-muted); white-space: nowrap; }
.ui-alc__summary span { display: inline-flex; align-items: center; gap: 6px; }
.ui-alc__summary span::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-alc-run-fg); }
.ui-alc__summary [data-kind="needs"] { color: var(--ui-alc-warn-fg); }
.ui-alc__summary [data-kind="needs"]::before { background: var(--ui-alc-warn-fg); animation: ui-alc-pulse 1600ms ease-in-out infinite; }
.ui-alc__window { flex: none; padding: 2px 8px; border-radius: 6px; background: var(--ui-alc-fill); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-alc-text); }

/* ----- Lanes ----- */
.ui-alc__body { display: grid; grid-template-columns: 168px minmax(0, 1fr); padding: 26px 16px 12px 0; }
.ui-alc__agents { display: grid; grid-auto-rows: var(--ui-alc-row); }
.ui-alc__agent { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 0 12px 0 16px; }
.ui-alc__avatar { display: grid; flex: none; place-items: center; width: 24px; height: 24px; overflow: hidden; border-radius: 6px; background: var(--ui-alc-fill); font-size: 10px; font-weight: 500; letter-spacing: 0.3px; color: var(--ui-alc-text); }
/* A logo sits on a small white tile */
.ui-alc__avatar[data-logo] { background: var(--ui-alc-card); box-shadow: var(--ui-alc-shadow); }
.ui-alc__avatar > svg { width: 14px; height: 14px; }
.ui-alc__who { display: grid; min-width: 0; }
.ui-alc__name { overflow: hidden; font-weight: 500; color: var(--ui-alc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-alc__name-line { display: flex; align-items: center; min-width: 0; }
.ui-alc__model { display: flex; align-items: center; min-width: 0; font-size: 12px; line-height: 16px; color: var(--ui-alc-muted); white-space: nowrap; }
.ui-alc__model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The state tag: collapses to nothing while the agent works, fades in when it is free or waits */
.ui-alc__state { display: inline-grid; flex: none; grid-template-columns: 0fr; margin-left: 0; opacity: 0; transition: grid-template-columns 320ms ease, margin-left 320ms ease, opacity 220ms ease; }
.ui-alc__state[data-show] { grid-template-columns: 1fr; margin-left: 6px; opacity: 1; transition: grid-template-columns 320ms ease, margin-left 320ms ease, opacity 260ms ease 80ms; }
.ui-alc__state > span { min-width: 0; overflow: hidden; padding: 0 5px; border-radius: 4px; background: var(--ui-alc-fill); font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-alc-text); white-space: nowrap; }
.ui-alc__who[data-state="waiting"] .ui-alc__state > span { background: var(--ui-alc-warn-bg); color: var(--ui-alc-warn-fg); }

.ui-alc__track { position: relative; height: calc(var(--rows) * var(--ui-alc-row)); }
/* Quiet lane separators and time ticks */
.ui-alc__track::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--ui-alc-row) - 0.5px), var(--ui-alc-line) calc(var(--ui-alc-row) - 0.5px), var(--ui-alc-line) var(--ui-alc-row)); pointer-events: none; }
.ui-alc__grid { position: absolute; inset: 0; pointer-events: none; }
.ui-alc__tick { position: absolute; top: 0; bottom: 0; width: 0; border-left: 0.5px dashed var(--ui-alc-line); }
.ui-alc__tick > span { position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; font-size: 11px; line-height: 14px; color: var(--ui-alc-faint); white-space: nowrap; transform: translateX(-50%); font-variant-numeric: tabular-nums; }

/* Blocks and curves slide out on the left and fade there instead of being cut */
.ui-alc__clip { position: absolute; inset: 0; overflow: hidden; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 40px); mask-image: linear-gradient(to right, transparent 0, #000 40px); }
.ui-alc__layer { position: absolute; inset: 0; will-change: transform; }
.ui-alc__curves { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.ui-alc__curves path { fill: none; stroke: var(--ui-alc-rail); stroke-width: 1; stroke-dasharray: 3 3; }
.ui-alc__curves path[data-live] { stroke: var(--ui-alc-run-edge); animation: ui-alc-flow 900ms linear infinite; }

.ui-alc__lane { position: absolute; left: 0; right: 0; height: var(--ui-alc-row); }
.ui-alc__slot { position: absolute; top: 10px; bottom: 10px; min-width: 6px; }
/* Running and waiting blocks grow out of "now" from nothing, so they never poke past it */
.ui-alc__slot:is([data-status="running"], [data-status="waiting"]), .ui-alc__slot:is([data-status="running"], [data-status="waiting"]) .ui-alc__block { min-width: 0; }
.ui-alc__block { display: flex; align-items: center; width: 100%; height: 100%; min-width: 6px; padding: 0 8px; overflow: hidden; border-radius: 6px; background: var(--ui-alc-done); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-alc-text); white-space: nowrap; transition: background-color 300ms ease, color 300ms ease; }
.ui-alc__label { min-width: 0; overflow: hidden; text-overflow: clip; text-align: start; }
/* Tools: the plain logos side by side, before the title */
.ui-alc__tools { display: flex; flex: none; gap: 4px; margin-right: 6px; }
.ui-alc__tool { display: grid; place-items: center; width: 12px; height: 12px; }
.ui-alc__tool > svg { width: 12px; height: 12px; }
.ui-alc__block:hover { background: var(--ui-alc-fill); }
.ui-alc__block[data-status="running"] { position: relative; background: var(--ui-alc-run-bg); color: var(--ui-alc-run-fg); box-shadow: inset -2px 0 0 var(--ui-alc-run-edge); }
.ui-alc__block[data-status="running"]::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.55) 50%, transparent 100%) 0 0 / 50% 100% no-repeat; animation: ui-alc-shimmer 2200ms ease-in-out infinite; }
.ui-alc__block[data-status="waiting"] { background: var(--ui-alc-warn-bg); color: var(--ui-alc-warn-fg); }
.ui-alc__block[data-status="failed"] { background: var(--ui-alc-danger-bg); color: var(--ui-alc-danger-fg); }
.ui-alc__block[data-open] { filter: brightness(0.97); }

/* Needs you: a small flag inside the block's end, where it meets "now" */
.ui-alc__flag { position: absolute; top: 50%; right: 4px; display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 4px; background: var(--ui-alc-card); box-shadow: var(--ui-alc-shadow); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-alc-warn-fg); white-space: nowrap; transform: translateY(-50%); pointer-events: none; animation: ui-alc-pulse 1600ms ease-in-out infinite; }
.ui-alc__slot:has(.ui-alc__block[data-status="waiting"]) { z-index: 2; }

/* Popovers sit under the block – over it in the lower lanes, so they stay inside the card */
.ui-alc__pop { position: absolute; z-index: 5; animation: ui-alc-in 180ms ease both; }
.ui-alc__pop[data-up] { transform: translateY(-100%); animation-name: ui-alc-in-up; }
/* Decide in place */
.ui-alc__ask { display: grid; gap: 2px; width: 280px; padding: 12px; border-radius: 10px; background: var(--ui-alc-card); box-shadow: var(--ui-alc-pop); max-width: calc(100cqw - 24px); overflow-wrap: anywhere; }
/* What got done: a small dark tooltip */
.ui-alc__tip { display: grid; gap: 4px; width: max-content; max-width: min(calc(100cqw - 24px), 220px); padding: 8px 10px; border-radius: 8px; background: rgba(24, 24, 27, 0.92); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.35); font-size: 12px; line-height: 16px; color: rgba(255, 255, 255, 0.86); translate: -50% 0; overflow-wrap: anywhere; }
.ui-alc__tip-head { display: flex; gap: 4px; min-width: 0; font-size: 11px; color: rgba(255, 255, 255, 0.55); white-space: nowrap; }
.ui-alc__tip-title { color: #fff; }
.ui-alc__tip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-alc__tip-head > span:last-child { flex: none; }
.ui-alc__tip-list { display: grid; gap: 2px; }
.ui-alc__tip-list li { position: relative; padding-left: 10px; }
.ui-alc__tip-list li::before { content: ""; position: absolute; top: 7px; left: 1px; width: 3px; height: 3px; border-radius: 50%; background: rgba(255, 255, 255, 0.5); }
.ui-alc__tip-open { justify-self: start; margin-top: 2px; font-size: 12px; font-weight: 500; color: #fff; text-decoration: underline; text-decoration-color: rgba(255, 255, 255, 0.35); text-underline-offset: 2px; }
.ui-alc__ask-title { font-weight: 500; color: var(--ui-alc-strong); }
.ui-alc__ask-text { font-size: 12px; line-height: 16px; color: var(--ui-alc-text); }
.ui-alc__ask-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.ui-alc__btn { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 6px; background: var(--ui-alc-card); box-shadow: var(--ui-alc-shadow); font-size: 13px; font-weight: 500; color: var(--ui-alc-strong); }
.ui-alc__btn:hover { background: var(--ui-alc-wash); }
.ui-alc__btn--primary { background: var(--ui-alc-solid); box-shadow: none; color: var(--ui-alc-on-solid); }
.ui-alc__btn--primary:hover { background: #33333a; }

/* Now: a small label over the right edge, where running work meets the clock */
.ui-alc__now { position: absolute; top: -6px; right: 0; width: 0; pointer-events: none; }
.ui-alc__now > span { position: absolute; bottom: 100%; right: 0; padding: 0 5px; border-radius: 4px; background: var(--ui-alc-run-bg); font-size: 10px; font-weight: 500; line-height: 14px; color: var(--ui-alc-run-fg); }

@keyframes ui-alc-pulse { 50% { opacity: 0.55; } }
@keyframes ui-alc-shimmer { from { background-position: -100% 0; } to { background-position: 200% 0; } }
@keyframes ui-alc-flow { to { stroke-dashoffset: -6; } }
@keyframes ui-alc-in { from { opacity: 0; transform: translateY(-3px); } }
@keyframes ui-alc-in-up { from { opacity: 0; transform: translateY(calc(-100% + 3px)); } to { transform: translateY(-100%); } }

/* Narrow containers: the names column shrinks to the avatars */
@container (max-width: 520px) {
  .ui-alc__tip { max-width: 200px; }
  .ui-alc__body { grid-template-columns: 48px minmax(0, 1fr); }
  .ui-alc__who { display: none; }
  .ui-alc__summary [data-kind="running"] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-alc *, .ui-alc *::before, .ui-alc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-alc {
  --ui-alc-card: #1c1c1f;
  --ui-alc-strong: #ffffff;
  --ui-alc-ink: rgba(255, 255, 255, 0.9);
  --ui-alc-text: rgba(255, 255, 255, 0.62);
  --ui-alc-muted: rgba(255, 255, 255, 0.45);
  --ui-alc-faint: rgba(255, 255, 255, 0.28);
  --ui-alc-line: rgba(255, 255, 255, 0.08);
  --ui-alc-rail: rgba(255, 255, 255, 0.2);
  --ui-alc-wash: rgba(255, 255, 255, 0.04);
  --ui-alc-fill: rgba(255, 255, 255, 0.08);
  --ui-alc-done: rgba(255, 255, 255, 0.06);
  --ui-alc-solid: rgba(255, 255, 255, 0.92);
  --ui-alc-on-solid: #141416;
  --ui-alc-run-bg: #0077ff3a;
  --ui-alc-run-fg: #70b8ff;
  --ui-alc-run-edge: rgba(112, 184, 255, 0.6);
  --ui-alc-warn-bg: #fb6a0025;
  --ui-alc-warn-fg: #ffa057;
  --ui-alc-danger-bg: #ff35232b;
  --ui-alc-danger-fg: #ff977d;
  --ui-alc-focus: rgba(91, 154, 255, 0.45);
  --ui-alc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-alc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-alc__btn--primary:hover { background: #d6d6da; }
:where(.dark, [data-theme="dark"]) .ui-alc__block[data-status="running"]::after { background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 50%, transparent 100%); }
/* Dark mode: the tooltip turns light, so it stands out from the dark card */
:where(.dark, [data-theme="dark"]) .ui-alc__tip { background: rgba(250, 250, 250, 0.94); box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6); color: rgba(0, 0, 0, 0.82); }
:where(.dark, [data-theme="dark"]) .ui-alc__tip-head { color: rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) .ui-alc__tip-title, :where(.dark, [data-theme="dark"]) .ui-alc__tip-open { color: #000; }
:where(.dark, [data-theme="dark"]) .ui-alc__tip-open { text-decoration-color: rgba(0, 0, 0, 0.3); }
:where(.dark, [data-theme="dark"]) .ui-alc__tip-list li::before { background: rgba(0, 0, 0, 0.4); }
`;
