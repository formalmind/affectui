"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/*
 * Agent Inbox – every background task your agents are working on, as a calm board, in a single self-contained file.
 * Tasks sit in soft gray columns – Needs you, Running, Done – as white cards: a status glyph and the title,
 * two lines on what the agent is doing, and a quiet footer with the state ("Waiting for you", "Running · 2m 14s")
 * and how many tools and sources it used.
 *   · click a card and it unfolds in place: the last steps as a tiny timeline, and what you can do now –
 *     Approve / Reject when it waits, Retry when it failed, Open when it runs or is done
 *   · a card that changes state shows it in place first, then glides over to its new column
 *   · Board / List switches the layout; narrow containers always get the list
 * The styles are injected below, so no extra files are needed.
 */

export type AgentTaskStatus = "running" | "waiting" | "done" | "failed";

export type AgentTaskStep = {
  label: string;
  /** Ready-to-show time, e.g. "2m ago" or "14:02" */
  time?: string;
};

export type AgentTask = {
  id: string;
  title: string;
  /** One or two sentences on what the task is about or where it stands */
  description?: string;
  /** Name of the agent or model, e.g. "Opus 5.5" */
  agent: string;
  status: AgentTaskStatus;
  /** When the task started – the clock ticks from here while it runs or waits */
  startedAt?: number | Date;
  /** How long it took in ms – shown for done and failed tasks */
  elapsed?: number;
  /** Tool calls so far – shown with a small wrench */
  tools?: number;
  /** Sources or files read – shown with a small magnifier */
  sources?: number;
  /** What the agent did so far, oldest first – the last four are shown when the card is open */
  steps?: AgentTaskStep[];
};

export type AgentInboxView = "board" | "list";

export type AgentInboxProps = {
  tasks: AgentTask[];
  /** With a handler the inbox shows exactly the tasks you pass; without one it changes the status on its own */
  onApprove?: (task: AgentTask) => void;
  onReject?: (task: AgentTask) => void;
  onRetry?: (task: AgentTask) => void;
  /** Shows an Open button on running and done tasks */
  onOpen?: (task: AgentTask) => void;
  /** Heading on the left of the bar */
  title?: string;
  /** Controlled layout */
  view?: AgentInboxView;
  defaultView?: AgentInboxView;
  onViewChange?: (view: AgentInboxView) => void;
  className?: string;
};

/* ---------- Helpers ---------- */

type Lane = "needs" | "running" | "done";
const LANES: { id: Lane; label: string }[] = [
  { id: "needs", label: "Needs you" },
  { id: "running", label: "Running" },
  { id: "done", label: "Done" },
];
const laneOf = (s: AgentTaskStatus): Lane => (s === "waiting" || s === "failed" ? "needs" : s === "running" ? "running" : "done");
const STATE: Record<AgentTaskStatus, string> = { waiting: "Waiting for you", running: "Running", done: "Done", failed: "Failed" };
const live = (s: AgentTaskStatus) => s === "running" || s === "waiting";
const ms = (d: number | Date) => (typeof d === "number" ? d : d.getTime());
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (time: number) => {
  const s = Math.max(0, Math.floor(time / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
// 18240 → "18.2K" on the card, the exact number in the tooltip
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat("en");

// One shared second for every running clock – only the clocks render again, not the whole inbox
const ticker = { subs: new Set<() => void>(), id: 0 };
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    ticker.subs.add(tick);
    if (!ticker.id) ticker.id = window.setInterval(() => ticker.subs.forEach((f) => f()), 1000);
    return () => {
      ticker.subs.delete(tick);
      if (!ticker.subs.size) {
        window.clearInterval(ticker.id);
        ticker.id = 0;
      }
    };
  }, [active]);
  return now;
};
/** Live tasks count up from `since`; finished ones show `fixed` */
const Clock = ({ since, fixed }: { since?: number; fixed: number }) => {
  const now = useNow(since !== undefined);
  return <>{clock(since !== undefined ? now - since : fixed)}</>;
};
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)";

/* ---------- Icons ---------- */

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** The agent's mark – a small four-point spark, colored by state */
const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
const StateIcon = ({ status }: { status: AgentTaskStatus }) => (
  <span className="ui-aic__state-icon" data-status={status} aria-hidden="true">
    {status === "running" && (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
        <path d="M6 1.4a4.6 4.6 0 0 1 4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )}
    {status === "waiting" && (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <path d="M6 1.6 11 10.2H1L6 1.6Z" fill="currentColor" />
      </svg>
    )}
    {status === "done" && (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="3.4" fill="currentColor" />
      </svg>
    )}
    {status === "failed" && (
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="4.8" fill="currentColor" />
        <path d="M6 3.6v2.8M6 8.3v.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )}
  </span>
);
const WrenchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M7.6 1.6a2.6 2.6 0 0 0-2.4 3.5L1.7 8.6a1.1 1.1 0 0 0 1.6 1.6l3.5-3.5a2.6 2.6 0 0 0 3.5-2.4l-1.5 1.1-1.5-.4-.4-1.5 1.1-1.5c-.1 0-.3-.4-.4-.4Z" {...line} strokeWidth={1.2} />
  </svg>
);
const SearchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="5.2" cy="5.2" r="3.3" {...line} strokeWidth={1.2} />
    <path d="m7.7 7.7 2.6 2.6" {...line} strokeWidth={1.2} />
  </svg>
);
const BoardIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
    <rect x="1.8" y="2.2" width="3.2" height="9.6" rx="1" {...line} strokeWidth={1.2} />
    <rect x="8.9" y="2.2" width="3.2" height="6.4" rx="1" {...line} strokeWidth={1.2} />
  </svg>
);
const ListIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M2.2 3.6h9.6M2.2 7h9.6M2.2 10.4h9.6" {...line} strokeWidth={1.2} />
  </svg>
);

export function AgentInbox({
  tasks,
  onApprove,
  onReject,
  onRetry,
  onOpen,
  title = "Agent inbox",
  view,
  defaultView = "board",
  onViewChange,
  className,
}: AgentInboxProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [innerView, setInnerView] = useState(defaultView);
  const layout = view ?? innerView;
  const [opened, setOpened] = useState<string | null>(null);

  // Without handlers the inbox runs the decisions itself
  const [local, setLocal] = useState<Record<string, { status: AgentTaskStatus; startedAt?: number; steps?: AgentTaskStep[] }>>({});
  const list = tasks.map((t) => (local[t.id] ? { ...t, ...local[t.id] } : t));

  // Where a live task's clock counts from – without startedAt, from when the inbox first saw it
  const seen = useRef<Record<string, number>>({});
  for (const t of list) seen.current[t.id] ??= Date.now();
  const sinceOf = (t: AgentTask) =>
    !live(t.status) ? undefined : t.startedAt !== undefined ? ms(t.startedAt) : seen.current[t.id] - (t.elapsed ?? 0);

  /* ---------- A changed card shows its new state in place, then moves to its new column ---------- */

  const [placed, setPlaced] = useState<Record<string, Lane>>(() => Object.fromEntries(list.map((t) => [t.id, laneOf(t.status)])));
  const laneKey = list.map((t) => `${t.id}:${laneOf(t.status)}`).join("|");
  useEffect(() => {
    const pending = list.some((t) => placed[t.id] !== laneOf(t.status));
    if (!pending) return;
    const timer = window.setTimeout(() => setPlaced(Object.fromEntries(list.map((t) => [t.id, laneOf(t.status)]))), reduced() ? 0 : 900);
    return () => window.clearTimeout(timer);
  }, [laneKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const laneFor = (t: AgentTask) => placed[t.id] ?? laneOf(t.status);

  // FLIP: remember where every card was, and glide from there after the move
  const cards = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, DOMRect>());
  const placedKey = JSON.stringify(placed) + layout;
  const lastKey = useRef(placedKey);
  // Only measure when a card is about to move – not on every render
  if (rootRef.current && lastKey.current !== placedKey) {
    before.current = new Map([...cards.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  }
  useLayoutEffect(() => {
    if (lastKey.current === placedKey) return;
    lastKey.current = placedKey;
    if (reduced()) return;
    for (const [id, el] of cards.current) {
      const from = before.current.get(id);
      if (!from) {
        el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE });
        continue;
      }
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)`, zIndex: 2 }, { transform: "none", zIndex: 2 }], { duration: 560, easing: EASE });
    }
  }, [placedKey]);

  /* ---------- Decisions ---------- */

  const decide = (task: AgentTask, next: AgentTaskStatus, note: string, handler?: (t: AgentTask) => void) => {
    if (handler) return handler(task);
    setLocal((l) => ({
      ...l,
      [task.id]: { status: next, startedAt: Date.now(), steps: [...(task.steps ?? []), { label: note, time: "now" }] },
    }));
  };
  const toggle = (id: string) => setOpened((o) => (o === id ? null : id));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && opened) {
      e.stopPropagation();
      rootRef.current?.querySelector<HTMLElement>(`[data-id="${opened}"] .ui-aic__card-main`)?.focus({ preventScroll: true });
      setOpened(null);
    }
  };
  const setView = (v: AgentInboxView) => {
    setInnerView(v);
    onViewChange?.(v);
  };

  /* ---------- One card ---------- */

  const card = (t: AgentTask) => {
    const isOpen = opened === t.id;
    const steps = (t.steps ?? []).slice(-4);
    // The word goes first when a card is slim – the glyph already says it – so the time always fits
    const word = t.status === "done" ? "Done in " : t.status === "failed" ? STATE.failed : `${STATE[t.status]} · `;
    return (
      <li
        key={t.id}
        data-id={t.id}
        className="ui-aic__card"
        data-status={t.status}
        data-open={isOpen ? "" : undefined}
        ref={(el) => {
          if (el) cards.current.set(t.id, el);
          else cards.current.delete(t.id);
        }}
      >
        <button type="button" className="ui-aic__card-main" aria-expanded={isOpen} aria-controls={`${uid}-${t.id}`} onClick={() => toggle(t.id)}>
          <span className="ui-aic__title-row">
            <span className="ui-aic__spark">
              <Spark />
            </span>
            <span className="ui-aic__title" dir="auto">
              {t.title}
            </span>
          </span>
          {t.description && (
            <span className="ui-aic__desc" dir="auto">
              {t.description}
            </span>
          )}
          <span className="ui-aic__foot">
            <span className="ui-aic__state" data-status={t.status}>
              <StateIcon status={t.status} />
              {/* The word may shorten, the time never does */}
              <span className="ui-aic__state-word">{word}</span>
              {t.status !== "failed" && (
                <span className="ui-aic__time">
                  <Clock since={sinceOf(t)} fixed={t.elapsed ?? 0} />
                </span>
              )}
            </span>
            <span className="ui-aic__meta">
              {t.sources !== undefined && (
                <span title={`Sources read: ${exact.format(t.sources)}`}>
                  <SearchIcon />
                  {compact.format(t.sources)}
                </span>
              )}
              {t.tools !== undefined && (
                <span title={`Tool calls: ${exact.format(t.tools)}`}>
                  <WrenchIcon />
                  {compact.format(t.tools)}
                </span>
              )}
            </span>
          </span>
        </button>

        <div id={`${uid}-${t.id}`} className="ui-aic__fold" data-open={isOpen ? "" : undefined} inert={!isOpen}>
          <div className="ui-aic__clip">
            <div className="ui-aic__more">
              <div className="ui-aic__agent">{t.agent}</div>
              {steps.length > 0 && (
                <ol className="ui-aic__steps">
                  {steps.map((s, i) => (
                    <li key={i} data-last={i === steps.length - 1 ? "" : undefined}>
                      <span dir="auto">{s.label}</span>
                      {s.time && <time>{s.time}</time>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="ui-aic__actions">
                {t.status === "waiting" && (
                  <>
                    <button type="button" className="ui-aic__btn" onClick={() => decide(t, "failed", "You rejected the request", onReject)}>
                      Reject
                    </button>
                    <button type="button" className="ui-aic__btn ui-aic__btn--primary" onClick={() => decide(t, "running", "You approved – continuing", onApprove)}>
                      Approve
                    </button>
                  </>
                )}
                {t.status === "failed" && (
                  <button type="button" className="ui-aic__btn ui-aic__btn--primary" onClick={() => decide(t, "running", "Retrying", onRetry)}>
                    Retry
                  </button>
                )}
                {(t.status === "running" || t.status === "done") && onOpen && (
                  <button type="button" className="ui-aic__btn" onClick={() => onOpen(t)}>
                    Open
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </li>
    );
  };

  const counts = Object.fromEntries(LANES.map((l) => [l.id, list.filter((t) => laneFor(t) === l.id).length])) as Record<Lane, number>;
  const needs = list.filter((t) => t.status === "waiting" || t.status === "failed").length;
  const summary = `${needs} ${needs === 1 ? "needs" : "need"} you, ${list.filter((t) => t.status === "running").length} running`;

  return (
    <div ref={rootRef} className={["ui-aic", className].filter(Boolean).join(" ")} data-view={layout} onKeyDown={onKeyDown}>
      <style href="ui-agent-inbox-clean" precedence="default">
        {css}
      </style>

      <div className="ui-aic__bar">
        <span className="ui-aic__heading">
          <span className="ui-aic__crumb">Agents</span>
          <span className="ui-aic__slash" aria-hidden="true">
            /
          </span>
          <span className="ui-aic__heading-title" title={title}>
            {title}
          </span>
        </span>
        <div className="ui-aic__views" role="radiogroup" aria-label="Layout">
          {(["board", "list"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={layout === v} className="ui-aic__view" onClick={() => setView(v)}>
              {v === "board" ? <BoardIcon /> : <ListIcon />}
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
      </div>

      <div className="ui-aic__lanes">
        {LANES.map((lane) => (
          <section key={lane.id} className="ui-aic__lane" aria-label={lane.label}>
            <header className="ui-aic__lane-head">
              <span className="ui-aic__lane-spark" aria-hidden="true">
                <Spark />
              </span>
              <span className="ui-aic__lane-name">{lane.label}</span>
              <span className="ui-aic__count">{counts[lane.id]}</span>
            </header>
            <ul className="ui-aic__cards">
              {list.filter((t) => laneFor(t) === lane.id).map(card)}
              {counts[lane.id] === 0 && <li className="ui-aic__empty">Nothing here</li>}
            </ul>
          </section>
        ))}
      </div>

      <span className="ui-aic__sr" aria-live="polite">
        {summary}
      </span>
    </div>
  );
}

const css = /* css */ `
.ui-aic {
  --ui-aic-lane: #f4f4f5;
  --ui-aic-card: #ffffff;
  --ui-aic-line: #e9e9ec;
  --ui-aic-ink: #1c1c1f;
  --ui-aic-text: #55555c;
  --ui-aic-muted: #8e8e96;
  --ui-aic-faint: #b4b4bb;
  --ui-aic-blue: #2f6bff;
  --ui-aic-amber: #e8a20c;
  --ui-aic-green: #22a05a;
  --ui-aic-red: #e5484d;
  --ui-aic-focus: rgba(23, 23, 23, 0.22);
  --ui-aic-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-aic-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-aic *, .ui-aic *::before, .ui-aic *::after { box-sizing: border-box; }
:where(.ui-aic) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-aic button:focus-visible { outline: 2px solid var(--ui-aic-focus); outline-offset: 2px; }
.ui-aic ul, .ui-aic ol { margin: 0; padding: 0; list-style: none; }
.ui-aic svg { display: block; flex: none; }
.ui-aic__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- Bar: where you are, and the layout ----- */
.ui-aic__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; padding: 0 2px; }
.ui-aic__heading { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 14px; font-weight: 500; color: var(--ui-aic-ink); white-space: nowrap; }
.ui-aic__crumb { flex: none; color: var(--ui-aic-muted); font-weight: 400; }
.ui-aic__slash { flex: none; color: var(--ui-aic-faint); }
.ui-aic__heading-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-aic__views { display: flex; flex: none; gap: 2px; padding: 3px; border-radius: 10px; background: var(--ui-aic-lane); }
.ui-aic__view { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--ui-aic-muted); transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease; }
.ui-aic__view:hover { color: var(--ui-aic-ink); }
.ui-aic__view[aria-checked="true"] { background: var(--ui-aic-card); color: var(--ui-aic-ink); box-shadow: 0 1px 2px rgba(16, 16, 24, 0.08), 0 0 0 1px rgba(16, 16, 24, 0.04); }

/* ----- Columns ----- */
.ui-aic__lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; align-items: start; }
.ui-aic__lane { min-width: 0; padding: 4px 4px 4px; border-radius: 14px; background: var(--ui-aic-lane); }
.ui-aic__lane-head { display: grid; grid-template-columns: 20px 1fr 20px; align-items: center; height: 34px; padding: 0 8px 0 10px; }
.ui-aic__lane-spark { color: var(--ui-aic-blue); opacity: 0.7; }
.ui-aic__lane-name { overflow: hidden; font-size: 11px; font-weight: 500; letter-spacing: 0.08em; text-align: center; text-transform: uppercase; color: var(--ui-aic-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-aic__count { display: grid; place-items: center; min-width: 20px; height: 18px; padding: 0 5px; border-radius: 6px; background: rgba(16, 16, 24, 0.06); font-size: 11px; font-weight: 500; color: var(--ui-aic-text); font-variant-numeric: tabular-nums; }
.ui-aic__cards { display: grid; gap: 6px; }
.ui-aic__empty { padding: 18px 0 20px; font-size: 12.5px; text-align: center; color: var(--ui-aic-faint); }

/* ----- A card ----- */
.ui-aic__card { position: relative; border-radius: 10px; background: var(--ui-aic-card); box-shadow: 0 0 0 1px var(--ui-aic-line), 0 1px 2px rgba(16, 16, 24, 0.04); transition: box-shadow 200ms ease; }
.ui-aic__card:hover, .ui-aic__card[data-open] { box-shadow: 0 0 0 1px #dcdce1, 0 4px 14px -6px rgba(16, 16, 24, 0.12); }
.ui-aic__card-main { display: grid; gap: 6px; width: 100%; padding: 12px 14px 12px 12px; border-radius: 10px; container: aic-card / inline-size; }
/* Top-aligned: the spark stays on the first line when a long title wraps */
.ui-aic__title-row { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ui-aic__spark { display: grid; flex: none; place-items: center; width: 16px; height: 20px; color: var(--ui-aic-blue); transition: color 300ms ease; }
.ui-aic__card[data-status="waiting"] .ui-aic__spark { color: var(--ui-aic-amber); }
.ui-aic__card[data-status="failed"] .ui-aic__spark { color: var(--ui-aic-red); }
.ui-aic__card[data-status="done"] .ui-aic__spark { color: var(--ui-aic-green); }
.ui-aic__title { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--ui-aic-ink); text-align: start; white-space: nowrap; text-overflow: ellipsis; overflow-wrap: anywhere; }
.ui-aic__desc { display: -webkit-box; padding-left: 26px; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-aic-text); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* Open: the whole title and description, nothing cut off */
.ui-aic__card[data-open] .ui-aic__title { white-space: normal; }
.ui-aic__card[data-open] .ui-aic__desc { -webkit-line-clamp: unset; }
.ui-aic__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; margin-top: 4px; padding-left: 26px; }
.ui-aic__state { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-size: 12.5px; color: var(--ui-aic-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-aic__state-word { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; margin-right: -8px; }
.ui-aic__time { flex: none; }
.ui-aic__state-icon { display: grid; flex: none; place-items: center; width: 12px; height: 12px; color: var(--ui-aic-blue); animation: ui-aic-pop 360ms var(--ui-aic-ease) both; }
.ui-aic__state-icon[data-status="running"] svg { animation: ui-aic-spin 900ms linear infinite; }
.ui-aic__state-icon[data-status="waiting"] { color: var(--ui-aic-amber); }
.ui-aic__state-icon[data-status="done"] { color: var(--ui-aic-green); }
.ui-aic__state-icon[data-status="failed"] { color: var(--ui-aic-red); }
.ui-aic__meta { display: inline-flex; flex: none; align-items: center; font-size: 12px; color: var(--ui-aic-muted); font-variant-numeric: tabular-nums; }
.ui-aic__meta > span { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; }
.ui-aic__meta > span + span { border-left: 1px solid var(--ui-aic-line); }
.ui-aic__meta > span:last-child { padding-right: 0; }

/* Open: steps and decisions unfold under the card's text */
.ui-aic__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 460ms var(--ui-aic-ease), opacity 240ms ease; }
.ui-aic__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 460ms var(--ui-aic-ease), opacity 320ms ease 100ms; }
.ui-aic__clip { min-height: 0; overflow: hidden; }
/* Starts at the card's left edge, like the spark – the full width for reading */
.ui-aic__more { margin: 0 14px 0 12px; padding: 10px 0 12px; border-top: 1px solid var(--ui-aic-line); }
.ui-aic__agent { font-size: 12px; color: var(--ui-aic-muted); }
.ui-aic__steps { position: relative; display: grid; gap: 5px; margin-top: 6px !important; padding-left: 12px !important; }
.ui-aic__steps li { position: relative; display: flex; justify-content: space-between; gap: 10px; font-size: 12.5px; line-height: 18px; color: var(--ui-aic-text); }
.ui-aic__steps li::before { content: ""; position: absolute; top: 7px; left: -12px; width: 4px; height: 4px; border-radius: 50%; background: var(--ui-aic-faint); }
/* Short line segments between the dots, with a little air on both ends */
.ui-aic__steps li:not(:last-child)::after { content: ""; position: absolute; top: 15px; bottom: -8px; left: -10.5px; width: 1px; background: var(--ui-aic-line); }
.ui-aic__steps li[data-last]::before { background: var(--ui-aic-ink); }
.ui-aic__steps li > span { min-width: 0; text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
.ui-aic__steps time { flex: none; color: var(--ui-aic-muted); }
.ui-aic__actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
.ui-aic__actions:empty { display: none; }
.ui-aic__btn { display: inline-flex; align-items: center; height: 28px; padding: 0 12px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--ui-aic-line); background: var(--ui-aic-card); font-size: 12.5px; font-weight: 500; color: var(--ui-aic-ink); transition: background-color 160ms ease; }
.ui-aic__btn:hover { background: var(--ui-aic-lane); }
.ui-aic__btn--primary { background: var(--ui-aic-ink); box-shadow: none; color: var(--ui-aic-card); }
.ui-aic__btn--primary:hover { background: #33333a; }

/* ----- List layout: the columns stack, one after another ----- */
.ui-aic[data-view="list"] .ui-aic__lanes { grid-template-columns: minmax(0, 1fr); }
.ui-aic[data-view="list"] .ui-aic__lane-head { grid-template-columns: 20px auto 1fr; gap: 4px; }
.ui-aic[data-view="list"] .ui-aic__lane-name { text-align: left; }
.ui-aic[data-view="list"] .ui-aic__count { justify-self: start; }
.ui-aic__lanes { animation: ui-aic-in 320ms ease both; }

@keyframes ui-aic-spin { to { transform: rotate(360deg); } }
@keyframes ui-aic-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-aic-in { from { opacity: 0.4; } }

/* Narrow containers: always the list, without the switch */
@container (max-width: 620px) {
  .ui-aic__views { display: none; }
  .ui-aic .ui-aic__lanes { grid-template-columns: minmax(0, 1fr); }
  .ui-aic .ui-aic__lane-head { grid-template-columns: 20px auto 1fr; gap: 4px; }
  .ui-aic .ui-aic__lane-name { text-align: left; }
  .ui-aic .ui-aic__count { justify-self: start; }
}
/* Slim cards (three columns in a narrow board): the text starts under the spark, so the footer keeps its words */
@container aic-card (max-width: 300px) {
  .ui-aic__desc, .ui-aic__foot { padding-left: 0; }
  .ui-aic__state:is([data-status="running"], [data-status="done"]) .ui-aic__state-word { display: none; }
}
@container (max-width: 360px) {
  .ui-aic__desc, .ui-aic__foot { padding-left: 0; }
  .ui-aic__title { white-space: normal; }
}

@media (pointer: coarse) {
  .ui-aic__view { height: 32px; }
  .ui-aic__btn { height: 36px; padding: 0 16px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-aic *, .ui-aic *::before, .ui-aic *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-aic {
  --ui-aic-lane: #161618;
  --ui-aic-card: #1e1e21;
  --ui-aic-line: #2c2c31;
  --ui-aic-ink: #ededed;
  --ui-aic-text: #b6b6bd;
  --ui-aic-muted: #85858d;
  --ui-aic-faint: #5c5c63;
  --ui-aic-blue: #5b8cff;
  --ui-aic-amber: #f5b638;
  --ui-aic-green: #3ecf8e;
  --ui-aic-red: #ff6b66;
  --ui-aic-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-aic__card:hover, :where(.dark, [data-theme="dark"]) .ui-aic__card[data-open] { box-shadow: 0 0 0 1px #3a3a40, 0 6px 18px -8px rgba(0, 0, 0, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-aic__count { background: rgba(255, 255, 255, 0.07); }
:where(.dark, [data-theme="dark"]) .ui-aic__btn--primary:hover { background: #d6d6da; }
:where(.dark, [data-theme="dark"]) .ui-aic__state-icon[data-status="failed"] path { stroke: #1e1e21; }
`;
