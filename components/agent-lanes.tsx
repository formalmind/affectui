"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Agent Lanes – where every agent is right now, as a live timeline, in a single self-contained file.
 * A soft gray tray with the summary on top and a white card below: a lane per agent (avatar, name, model on the
 * left), its tasks as blocks along the time it took, and a "now" line on the right edge. The window slides with the clock, so the picture is always the last half hour.
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
      if (!(e.target as HTMLElement).closest?.(`[data-task="${opened}"], .ui-al__pop`)) setOpened(null);
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
    <div ref={rootRef} className={["ui-al", className].filter(Boolean).join(" ")} onKeyDown={onKeyDown}>
      <style href="ui-agent-lanes" precedence="default">
        {css}
      </style>

      <header className="ui-al__bar">
        <span className="ui-al__spark">
          <Spark />
        </span>
        <span className="ui-al__title" title={title}>
            {title}
          </span>
        <span className="ui-al__summary">
          <span data-kind="running">{running} running</span>
          {needs > 0 && <span data-kind="needs">{needs} {needs === 1 ? "needs" : "need"} you</span>}
        </span>
        <span className="ui-al__window">Last {mins(span)}</span>
      </header>

      <div className="ui-al__card">

        <div className="ui-al__body" style={{ ["--rows" as string]: agents.length }}>
          {/* Who */}
          <ul className="ui-al__agents">
            {agents.map((a) => {
              const busy = list.find((t) => t.agentId === a.id && (t.status === "running" || t.status === "waiting"));
              return (
                <li key={a.id} className="ui-al__agent">
                  <span className="ui-al__avatar" data-logo={a.avatar ? "" : undefined}>
                    {a.avatar ?? initials(a.name)}
                  </span>
                  <span className="ui-al__who" data-state={busy?.status ?? "idle"}>
                    <span className="ui-al__name-line">
                      <span className="ui-al__name" dir="auto" title={a.name}>
                        {a.name}
                      </span>
                        {/* Idle or Needs you as a small tag that fades in and out */}
                        <span className="ui-al__state" data-show={busy?.status === "running" ? undefined : ""} aria-hidden={busy?.status === "running"}>
                          <span>{busy?.status === "waiting" ? "Needs you" : busy ? (lastState.current[a.id] ?? "Idle") : "Idle"}</span>
                        </span>
                    </span>
                    <span className="ui-al__model">
                      {a.model && (
                        <span className="ui-al__model-name" title={a.model}>
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
          <div className="ui-al__track">
            <div className="ui-al__grid" aria-hidden="true">
              {ticks.ago.map((ago) => (
                <span key={ago} className="ui-al__tick" style={{ left: `${100 - (ago / span) * 100}%` }}>
                  <span>−{mins(ago)}</span>
                </span>
              ))}
            </div>

            {/* Blocks and curves: clipped at the left edge, where they fade as they slide out */}
            <div className="ui-al__clip">
              <div className="ui-al__layer" style={{ transform: `translateX(${-shift}%)` }}>
              <svg className="ui-al__curves" viewBox={`0 0 1000 ${agents.length * ROW}`} preserveAspectRatio="none" aria-hidden="true">
                {curves.map((c) => (
                  <path key={c.id} d={c.d} data-live={c.live ? "" : undefined} vectorEffect="non-scaling-stroke" />
                ))}
              </svg>

              {agents.map((a, i) => (
                <ul key={a.id} className="ui-al__lane" style={{ top: i * ROW }} aria-label={`${a.name}'s tasks`}>
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
                        <li key={t.id} className="ui-al__slot" data-status={t.status} style={{ left: `${at(ms(t.start))}%`, width: `${width}%` }}>
                          <button
                            type="button"
                            data-task={t.id}
                            className="ui-al__block"
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
                              <span className="ui-al__tools" aria-hidden="true">
                                {t.tools.slice(0, 3).map((tool, k) => (
                                  <span key={k} className="ui-al__tool">
                                    {tool}
                                  </span>
                                ))}
                              </span>
                            )}
                            <span className="ui-al__label" dir="auto">
                              {t.title}
                            </span>
                          </button>
                          {t.status === "waiting" && (
                            <span className="ui-al__flag" aria-hidden="true">
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
                      className="ui-al__pop ui-al__ask"
                      id={`${uid}-${openTask.id}`}
                      role="dialog"
                      aria-label={`Decide: ${openTask.title}`}
                      data-up={up ? "" : undefined}
                      style={{ top: up ? lane * ROW + 6 : (lane + 1) * ROW - 6, right: `${100 - x(end)}%` }}
                    >
                      <span className="ui-al__ask-title" dir="auto">
                        {openTask.title}
                      </span>
                      {openTask.ask && (
                        <span className="ui-al__ask-text" dir="auto">
                          {openTask.ask}
                        </span>
                      )}
                      <span className="ui-al__ask-actions">
                        <button type="button" className="ui-al__btn" onClick={() => decide(openTask, false)}>
                          Reject
                        </button>
                        <button type="button" className="ui-al__btn ui-al__btn--primary" autoFocus onClick={() => decide(openTask, true)}>
                          Approve
                        </button>
                      </span>
                    </div>
                  );
                // A small dark tooltip under (or over) the visible part of the block
                const mid = (Math.max(0, x(ms(openTask.start))) + x(end)) / 2;
                return (
                  <div
                    className="ui-al__pop ui-al__tip"
                    id={`${uid}-${openTask.id}`}
                    role="tooltip"
                    data-up={up ? "" : undefined}
                    style={{ top: up ? lane * ROW + 6 : (lane + 1) * ROW - 6, left: `${Math.max(14, Math.min(86, mid))}%` }}
                  >
                    {/* A long name shortens, the state and the time stay */}
                    <span className="ui-al__tip-head">
                      <span className="ui-al__tip-name" dir="auto">
                        {a?.name}
                      </span>
                      <span>
                        · {STATE[openTask.status]} · {mins(end - ms(openTask.start))}
                      </span>
                    </span>
                    {openTask.summary?.length ? (
                      <ul className="ui-al__tip-list">
                        {openTask.summary.map((line) => (
                          <li key={line} dir="auto">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="ui-al__tip-title" dir="auto">
                        {openTask.title}
                      </span>
                    )}
                    {onOpen && (
                      <button type="button" className="ui-al__tip-open" onClick={() => onOpen(openTask)}>
                        Open
                      </button>
                    )}
                  </div>
                );
              })()}

            <span className="ui-al__now" aria-hidden="true">
              <span>now</span>
            </span>
          </div>
        </div>
      </div>

      <span className="ui-al__sr" aria-live="polite">
        {needs > 0 ? `${needs} task${needs === 1 ? "" : "s"} need you` : `${running} running`}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-al */
.ui-al {
  --ui-al-tray: #f0f0f0;
  --ui-al-card: #ffffff;
  --ui-al-strong: #171717;
  --ui-al-ink: #171717;
  --ui-al-text: #6b6b6b;
  --ui-al-muted: #8a8a8a;
  --ui-al-faint: #b8b8b8;
  --ui-al-line: #ececec;
  --ui-al-rail: #c4c4c8;
  --ui-al-wash: #f6f6f6;
  --ui-al-fill: #ececec;
  --ui-al-done: #f2f2f3;
  --ui-al-solid: #171717;
  --ui-al-on-solid: #ffffff;
  --ui-al-run-bg: rgba(47, 107, 255, 0.1);
  --ui-al-run-fg: #2f6bff;
  --ui-al-run-edge: rgba(47, 107, 255, 0.55);
  --ui-al-warn-bg: #fff3e0;
  --ui-al-warn-fg: #b85c00;
  --ui-al-danger-bg: #fdecea;
  --ui-al-danger-fg: #c2331f;
  --ui-al-focus: rgba(23, 23, 23, 0.22);
  --ui-al-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-al-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-al-row: ${ROW}px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 760px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-al-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-al-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-al *, .ui-al *::before, .ui-al *::after { box-sizing: border-box; }
:where(.ui-al) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-al button:focus-visible { outline: 2px solid var(--ui-al-focus); outline-offset: 1px; }
.ui-al ul { margin: 0; padding: 0; list-style: none; }
.ui-al svg { display: block; flex: none; }
.ui-al__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* The white card holds the lanes */
.ui-al__card { border-radius: 16px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); }

/* ----- Bar ----- */
/* ----- On the tray: what is going on ----- */
.ui-al__bar { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px 10px 12px 14px; }
.ui-al__spark { display: grid; flex: none; place-items: center; width: 16px; color: rgba(0, 96, 226, 0.765); }
.ui-al__title { font-weight: 600; color: var(--ui-al-strong); white-space: nowrap; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-al__summary { display: flex; flex: 1; gap: 12px; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-al-muted); white-space: nowrap; }
.ui-al__summary span { display: inline-flex; align-items: center; gap: 6px; }
.ui-al__summary span::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-al-run-fg); }
.ui-al__summary [data-kind="needs"] { color: var(--ui-al-warn-fg); }
.ui-al__summary [data-kind="needs"]::before { background: var(--ui-al-warn-fg); animation: ui-al-pulse 1600ms ease-in-out infinite; }
.ui-al__window { flex: none; padding: 3px 10px; border-radius: 999px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-al-text); }

/* ----- Lanes ----- */
.ui-al__body { display: grid; grid-template-columns: 168px minmax(0, 1fr); padding: 26px 16px 12px 0; }
.ui-al__agents { display: grid; grid-auto-rows: var(--ui-al-row); }
.ui-al__agent { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 0 12px 0 16px; }
.ui-al__avatar { display: grid; flex: none; place-items: center; width: 26px; height: 26px; overflow: hidden; border-radius: 50%; background: var(--ui-al-fill); font-size: 10px; font-weight: 500; letter-spacing: 0.3px; color: var(--ui-al-text); }
/* A logo sits on a small white tile */
.ui-al__avatar[data-logo] { background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); }
.ui-al__avatar > svg { width: 14px; height: 14px; }
.ui-al__who { display: grid; min-width: 0; }
.ui-al__name { overflow: hidden; font-weight: 500; color: var(--ui-al-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-al__name-line { display: flex; align-items: center; min-width: 0; }
.ui-al__model { display: flex; align-items: center; min-width: 0; font-size: 12px; line-height: 16px; color: var(--ui-al-muted); white-space: nowrap; }
.ui-al__model-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The state tag: collapses to nothing while the agent works, fades in when it is free or waits */
.ui-al__state { display: inline-grid; flex: none; grid-template-columns: 0fr; margin-left: 0; opacity: 0; transition: grid-template-columns 320ms ease, margin-left 320ms ease, opacity 220ms ease; }
.ui-al__state[data-show] { grid-template-columns: 1fr; margin-left: 6px; opacity: 1; transition: grid-template-columns 320ms ease, margin-left 320ms ease, opacity 260ms ease 80ms; }
.ui-al__state > span { min-width: 0; overflow: hidden; padding: 0 5px; border-radius: 4px; background: var(--ui-al-fill); font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-al-text); white-space: nowrap; }
.ui-al__who[data-state="waiting"] .ui-al__state > span { background: var(--ui-al-warn-bg); color: var(--ui-al-warn-fg); }

.ui-al__track { position: relative; height: calc(var(--rows) * var(--ui-al-row)); }
/* Quiet lane separators and time ticks */
.ui-al__track::before { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--ui-al-row) - 0.5px), var(--ui-al-line) calc(var(--ui-al-row) - 0.5px), var(--ui-al-line) var(--ui-al-row)); pointer-events: none; }
.ui-al__grid { position: absolute; inset: 0; pointer-events: none; }
.ui-al__tick { position: absolute; top: 0; bottom: 0; width: 0; border-left: 0.5px dashed var(--ui-al-line); }
.ui-al__tick > span { position: absolute; bottom: 100%; left: 0; margin-bottom: 6px; font-size: 11px; line-height: 14px; color: var(--ui-al-faint); white-space: nowrap; transform: translateX(-50%); font-variant-numeric: tabular-nums; }

.ui-al__clip { position: absolute; inset: 0; overflow: hidden; -webkit-mask-image: linear-gradient(to right, transparent 0, #000 40px); mask-image: linear-gradient(to right, transparent 0, #000 40px); }
.ui-al__layer { position: absolute; inset: 0; will-change: transform; }
.ui-al__curves { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.ui-al__curves path { fill: none; stroke: var(--ui-al-rail); stroke-width: 1; stroke-dasharray: 3 3; }
.ui-al__curves path[data-live] { stroke: var(--ui-al-run-edge); animation: ui-al-flow 900ms linear infinite; }

.ui-al__lane { position: absolute; left: 0; right: 0; height: var(--ui-al-row); }
.ui-al__slot { position: absolute; top: 10px; bottom: 10px; min-width: 6px; }
/* Running and waiting blocks grow out of "now" from nothing, so they never poke past it */
.ui-al__slot:is([data-status="running"], [data-status="waiting"]), .ui-al__slot:is([data-status="running"], [data-status="waiting"]) .ui-al__block { min-width: 0; }
.ui-al__block { display: flex; align-items: center; width: 100%; height: 100%; min-width: 6px; padding: 0 10px; overflow: hidden; border-radius: 8px; background: var(--ui-al-done); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-al-text); white-space: nowrap; transition: background-color 300ms ease, color 300ms ease; }
.ui-al__label { min-width: 0; overflow: hidden; text-overflow: clip; text-align: start; }
/* Tools: the plain logos side by side, before the title */
.ui-al__tools { display: flex; flex: none; gap: 4px; margin-right: 6px; }
.ui-al__tool { display: grid; place-items: center; width: 12px; height: 12px; }
.ui-al__tool > svg { width: 12px; height: 12px; }
.ui-al__block:hover { background: var(--ui-al-fill); }
.ui-al__block[data-status="running"] { position: relative; background: var(--ui-al-run-bg); color: var(--ui-al-run-fg); box-shadow: inset -2px 0 0 var(--ui-al-run-edge); }
.ui-al__block[data-status="running"]::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.55) 50%, transparent 100%) 0 0 / 50% 100% no-repeat; animation: ui-al-shimmer 2200ms ease-in-out infinite; }
.ui-al__block[data-status="waiting"] { background: var(--ui-al-warn-bg); color: var(--ui-al-warn-fg); }
.ui-al__block[data-status="failed"] { background: var(--ui-al-danger-bg); color: var(--ui-al-danger-fg); }
.ui-al__block[data-open] { filter: brightness(0.97); }

/* Needs you: a small flag inside the block's end, where it meets "now" */
.ui-al__flag { position: absolute; top: 50%; right: 4px; display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 4px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-al-warn-fg); white-space: nowrap; transform: translateY(-50%); pointer-events: none; animation: ui-al-pulse 1600ms ease-in-out infinite; }
.ui-al__slot:has(.ui-al__block[data-status="waiting"]) { z-index: 2; }

.ui-al__pop { position: absolute; z-index: 5; animation: ui-al-in 180ms ease both; }
.ui-al__pop[data-up] { transform: translateY(-100%); animation-name: ui-al-in-up; }
/* Decide in place */
.ui-al__ask { display: grid; gap: 2px; width: 290px; padding: 14px; border-radius: 14px; background: var(--ui-al-card); box-shadow: var(--ui-al-pop); max-width: calc(100cqw - 24px); overflow-wrap: anywhere; }
/* What got done: a small dark tooltip */
.ui-al__tip { display: grid; gap: 4px; width: max-content; max-width: min(calc(100cqw - 24px), 230px); padding: 10px 12px; border-radius: 12px; background: rgba(23, 23, 23, 0.92); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 10px 28px -8px rgba(0, 0, 0, 0.35); font-size: 12.5px; line-height: 17px; color: rgba(255, 255, 255, 0.86); translate: -50% 0; overflow-wrap: anywhere; }
.ui-al__tip-head { display: flex; gap: 4px; min-width: 0; font-size: 11.5px; color: rgba(255, 255, 255, 0.55); white-space: nowrap; }
.ui-al__tip-title { color: #fff; }
.ui-al__tip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-al__tip-head > span:last-child { flex: none; }
.ui-al__tip-list { display: grid; gap: 2px; }
.ui-al__tip-list li { position: relative; padding-left: 10px; }
.ui-al__tip-list li::before { content: ""; position: absolute; top: 8px; left: 1px; width: 3px; height: 3px; border-radius: 50%; background: rgba(255, 255, 255, 0.5); }
.ui-al__tip-open { justify-self: start; margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #fff; text-decoration: underline; text-decoration-color: rgba(255, 255, 255, 0.35); text-underline-offset: 2px; }
.ui-al__ask-title { font-weight: 500; color: var(--ui-al-strong); }
.ui-al__ask-text { font-size: 12px; line-height: 16px; color: var(--ui-al-text); }
.ui-al__ask-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.ui-al__btn { display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 9px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); font-size: 13px; font-weight: 500; color: var(--ui-al-strong); }
.ui-al__btn:hover { background: var(--ui-al-wash); }
.ui-al__btn--primary { background: var(--ui-al-solid); box-shadow: none; color: var(--ui-al-on-solid); }
.ui-al__btn--primary:hover { background: #33333a; }

/* Now: a small label over the right edge, where running work meets the clock */
.ui-al__now { position: absolute; top: -6px; right: 0; width: 0; pointer-events: none; }
.ui-al__now > span { position: absolute; bottom: 100%; right: 0; padding: 0 5px; border-radius: 4px; background: var(--ui-al-run-bg); font-size: 10px; font-weight: 500; line-height: 14px; color: var(--ui-al-run-fg); }

@keyframes ui-al-pulse { 50% { opacity: 0.55; } }
@keyframes ui-al-shimmer { from { background-position: -100% 0; } to { background-position: 200% 0; } }
@keyframes ui-al-flow { to { stroke-dashoffset: -6; } }
@keyframes ui-al-in { from { opacity: 0; transform: translateY(-3px); } }
@keyframes ui-al-in-up { from { opacity: 0; transform: translateY(calc(-100% + 3px)); } to { transform: translateY(-100%); } }

/* Narrow containers: the names column shrinks to the avatars */
@container (max-width: 520px) {
  .ui-al__tip { max-width: 200px; }
  .ui-al__body { grid-template-columns: 48px minmax(0, 1fr); }
  .ui-al__who { display: none; }
  .ui-al__summary [data-kind="running"] { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-al *, .ui-al *::before, .ui-al *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-al {
  --ui-al-tray: #111113;
  --ui-al-card: #19191b;
  --ui-al-strong: #ffffff;
  --ui-al-ink: rgba(255, 255, 255, 0.9);
  --ui-al-text: rgba(255, 255, 255, 0.62);
  --ui-al-muted: rgba(255, 255, 255, 0.45);
  --ui-al-faint: rgba(255, 255, 255, 0.28);
  --ui-al-line: rgba(255, 255, 255, 0.08);
  --ui-al-rail: rgba(255, 255, 255, 0.2);
  --ui-al-wash: rgba(255, 255, 255, 0.04);
  --ui-al-fill: rgba(255, 255, 255, 0.08);
  --ui-al-done: rgba(255, 255, 255, 0.06);
  --ui-al-solid: rgba(255, 255, 255, 0.92);
  --ui-al-on-solid: #141416;
  --ui-al-run-bg: #0077ff3a;
  --ui-al-run-fg: #70b8ff;
  --ui-al-run-edge: rgba(112, 184, 255, 0.6);
  --ui-al-warn-bg: #fb6a0025;
  --ui-al-warn-fg: #ffa057;
  --ui-al-danger-bg: #ff35232b;
  --ui-al-danger-fg: #ff977d;
  --ui-al-focus: rgba(91, 154, 255, 0.45);
  --ui-al-shadow: 0 0 0 1px #2a2a2e, 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-al-pop: 0 0 0 1px #2a2a2e, 0 16px 36px -12px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-al__btn--primary:hover { background: #d6d6da; }
:where(.dark, [data-theme="dark"]) .ui-al__block[data-status="running"]::after { background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.12) 50%, transparent 100%); }
/* Dark mode: the tooltip turns light, so it stands out from the dark card */
:where(.dark, [data-theme="dark"]) .ui-al__tip { background: rgba(250, 250, 250, 0.94); box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6); color: rgba(0, 0, 0, 0.82); }
:where(.dark, [data-theme="dark"]) .ui-al__tip-head { color: rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) .ui-al__tip-title, :where(.dark, [data-theme="dark"]) .ui-al__tip-open { color: #000; }
:where(.dark, [data-theme="dark"]) .ui-al__tip-open { text-decoration-color: rgba(0, 0, 0, 0.3); }
:where(.dark, [data-theme="dark"]) .ui-al__tip-list li::before { background: rgba(0, 0, 0, 0.4); }
`;
