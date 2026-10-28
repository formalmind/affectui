"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/*
 * Agent Inbox – every background task your agents are working on, as a calm board, in a single self-contained file.
 * On a soft gray tray, tasks sit in three columns – Needs you, Running, Done – as white cards: a status glyph and the title,
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
  /** A button in the bar, e.g. { label: "New task", onClick } */
  action?: { label: string; onClick: () => void };
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
  <span className="ui-ai__state-icon" data-status={status} aria-hidden="true">
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

const PlusIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6 2.2v7.6M2.2 6h7.6" {...line} strokeWidth={1.5} />
  </svg>
);

export function AgentInbox({
  tasks,
  onApprove,
  onReject,
  onRetry,
  onOpen,
  title = "Agent inbox",
  action,
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
      rootRef.current?.querySelector<HTMLElement>(`[data-id="${opened}"] .ui-ai__card-main`)?.focus({ preventScroll: true });
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
        className="ui-ai__card"
        data-status={t.status}
        data-open={isOpen ? "" : undefined}
        ref={(el) => {
          if (el) cards.current.set(t.id, el);
          else cards.current.delete(t.id);
        }}
      >
        <button type="button" className="ui-ai__card-main" aria-expanded={isOpen} aria-controls={`${uid}-${t.id}`} onClick={() => toggle(t.id)}>
          <span className="ui-ai__title-row">
            <span className="ui-ai__spark">
              <Spark />
            </span>
            <span className="ui-ai__title" dir="auto">
              {t.title}
            </span>
          </span>
          {t.description && (
            <span className="ui-ai__desc" dir="auto">
              {t.description}
            </span>
          )}
          <span className="ui-ai__foot">
            <span className="ui-ai__state" data-status={t.status}>
              <StateIcon status={t.status} />
              {/* The word may shorten, the time never does */}
              <span className="ui-ai__state-word">{word}</span>
              {t.status !== "failed" && (
                <span className="ui-ai__time">
                  <Clock since={sinceOf(t)} fixed={t.elapsed ?? 0} />
                </span>
              )}
            </span>
            <span className="ui-ai__meta">
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

        <div id={`${uid}-${t.id}`} className="ui-ai__fold" data-open={isOpen ? "" : undefined} inert={!isOpen}>
          <div className="ui-ai__clip">
            <div className="ui-ai__more">
              <div className="ui-ai__agent">{t.agent}</div>
              {steps.length > 0 && (
                <ol className="ui-ai__steps">
                  {steps.map((s, i) => (
                    <li key={i} data-last={i === steps.length - 1 ? "" : undefined}>
                      <span dir="auto">{s.label}</span>
                      {s.time && <time>{s.time}</time>}
                    </li>
                  ))}
                </ol>
              )}
              <div className="ui-ai__actions">
                {t.status === "waiting" && (
                  <>
                    <button type="button" className="ui-ai__btn" onClick={() => decide(t, "failed", "You rejected the request", onReject)}>
                      Reject
                    </button>
                    <button type="button" className="ui-ai__btn ui-ai__btn--primary" onClick={() => decide(t, "running", "You approved – continuing", onApprove)}>
                      Approve
                    </button>
                  </>
                )}
                {t.status === "failed" && (
                  <button type="button" className="ui-ai__btn ui-ai__btn--primary" onClick={() => decide(t, "running", "Retrying", onRetry)}>
                    Retry
                  </button>
                )}
                {(t.status === "running" || t.status === "done") && onOpen && (
                  <button type="button" className="ui-ai__btn" onClick={() => onOpen(t)}>
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
    <div ref={rootRef} className={["ui-ai", className].filter(Boolean).join(" ")} data-view={layout} onKeyDown={onKeyDown}>
      <style href="ui-agent-inbox" precedence="default">
        {css}
      </style>

      <div className="ui-ai__bar">
        <span className="ui-ai__heading">
          <span className="ui-ai__crumb">Agents</span>
          <span className="ui-ai__slash" aria-hidden="true">
            /
          </span>
          <span className="ui-ai__heading-title" title={title}>
            {title}
          </span>
        </span>
        <div className="ui-ai__tools">
        {action && (
          // In a narrow inbox only the plus remains – the label stays its name
          <button type="button" className="ui-ai__action" aria-label={action.label} title={action.label} onClick={action.onClick}>
            <PlusIcon />
            <span className="ui-ai__action-label">{action.label}</span>
          </button>
        )}
        <div className="ui-ai__views" role="radiogroup" aria-label="Layout">
          {(["board", "list"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={layout === v} className="ui-ai__view" onClick={() => setView(v)}>
              {v === "board" ? <BoardIcon /> : <ListIcon />}
              {v === "board" ? "Board" : "List"}
            </button>
          ))}
        </div>
        </div>
      </div>

      <div className="ui-ai__lanes">
        {LANES.map((lane) => (
          <section key={lane.id} className="ui-ai__lane" aria-label={lane.label}>
            <header className="ui-ai__lane-head">
              <span className="ui-ai__lane-spark" aria-hidden="true">
                <Spark />
              </span>
              <span className="ui-ai__lane-name">{lane.label}</span>
              <span className="ui-ai__count">{counts[lane.id]}</span>
            </header>
            <ul className="ui-ai__cards">
              {list.filter((t) => laneFor(t) === lane.id).map(card)}
              {counts[lane.id] === 0 && <li className="ui-ai__empty">Nothing here</li>}
            </ul>
          </section>
        ))}
      </div>

      <span className="ui-ai__sr" aria-live="polite">
        {summary}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-ai */
.ui-ai {
  --ui-ai-tray: #f0f0f0;
  --ui-ai-card: #ffffff;
  --ui-ai-line: #ececec;
  --ui-ai-chip: #f5f5f5;
  --ui-ai-track: #e6e6e6;
  --ui-ai-ink: #171717;
  --ui-ai-text: #6b6b6b;
  --ui-ai-muted: #8a8a8a;
  --ui-ai-faint: #b8b8b8;
  --ui-ai-blue: #2f6bff;
  --ui-ai-amber: #d98a00;
  --ui-ai-green: #1a9a52;
  --ui-ai-red: #e0453a;
  --ui-ai-brand-bg: #eaf1ff;
  --ui-ai-brand-fg: #2456d6;
  --ui-ai-warn-bg: #fff3e0;
  --ui-ai-warn-fg: #b85c00;
  --ui-ai-ok-bg: #e6f6ec;
  --ui-ai-ok-fg: #1a7f45;
  --ui-ai-danger-bg: #fdecea;
  --ui-ai-danger-fg: #c2331f;
  --ui-ai-ring: rgba(23, 23, 23, 0.22);
  --ui-ai-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-ai-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-ai-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-ai *, .ui-ai *::before, .ui-ai *::after { box-sizing: border-box; }
:where(.ui-ai) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-ai button:focus-visible { outline: 2px solid var(--ui-ai-ring); outline-offset: 2px; }
.ui-ai ul, .ui-ai ol { margin: 0; padding: 0; list-style: none; }
.ui-ai svg { display: block; flex: none; }
.ui-ai__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- Bar on the tray: where you are, an optional action and the layout ----- */
.ui-ai__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 8px 10px 14px; }
.ui-ai__heading { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; font-weight: 600; color: var(--ui-ai-ink); white-space: nowrap; }
.ui-ai__crumb { flex: none; color: var(--ui-ai-muted); font-weight: 500; }
.ui-ai__slash { flex: none; color: var(--ui-ai-faint); font-weight: 400; }
.ui-ai__heading-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-ai__tools { display: flex; flex: none; align-items: center; gap: 8px; }
.ui-ai__action-label { max-width: 200px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-ai__action { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px 0 10px; border-radius: 999px; font-size: 13px; font-weight: 500; color: var(--ui-ai-ink); transition: background-color 160ms ease; }
.ui-ai__action:hover { background: var(--ui-ai-track); }
/* A gray track, the chosen layout raised in white */
.ui-ai__views { display: flex; flex: none; padding: 3px; border-radius: 12px; background: var(--ui-ai-track); }
.ui-ai__view { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--ui-ai-muted); transition: background-color 200ms ease, color 200ms ease, box-shadow 200ms ease; }
.ui-ai__view:hover { color: var(--ui-ai-ink); }
.ui-ai__view[aria-checked="true"] { background: var(--ui-ai-card); color: var(--ui-ai-ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04); }

/* ----- Columns: headings on the tray, white cards below ----- */
.ui-ai__lanes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; align-items: start; }
.ui-ai__lane { min-width: 0; }
.ui-ai__lane-head { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 10px; }
.ui-ai__lane-spark { display: grid; color: var(--ui-ai-blue); }
.ui-ai__lane[aria-label="Needs you"] .ui-ai__lane-spark { color: var(--ui-ai-amber); }
.ui-ai__lane[aria-label="Done"] .ui-ai__lane-spark { color: var(--ui-ai-green); }
.ui-ai__lane-name { overflow: hidden; font-size: 13px; font-weight: 600; color: var(--ui-ai-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-ai__count { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--ui-ai-card); box-shadow: 0 0 0 1px var(--ui-ai-line); font-size: 11.5px; font-weight: 500; color: var(--ui-ai-text); font-variant-numeric: tabular-nums; }
.ui-ai__cards { display: grid; gap: 4px; }
.ui-ai__empty { padding: 18px 0 20px; border-radius: 16px; box-shadow: inset 0 0 0 1px var(--ui-ai-track); font-size: 13px; text-align: center; color: var(--ui-ai-muted); }

/* ----- A card ----- */
.ui-ai__card { position: relative; border-radius: 16px; background: var(--ui-ai-card); box-shadow: 0 0 0 1px var(--ui-ai-line), 0 1px 2px rgba(0, 0, 0, 0.04); transition: box-shadow 200ms ease; }
.ui-ai__card:hover, .ui-ai__card[data-open] { box-shadow: 0 0 0 1px #e0e0e0, 0 6px 16px -8px rgba(0, 0, 0, 0.14); }
.ui-ai__card-main { display: grid; gap: 6px; width: 100%; padding: 14px 14px 12px; border-radius: 16px; container: ai-card / inline-size; }
/* Top-aligned: the spark stays on the first line when a long title wraps */
.ui-ai__title-row { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ui-ai__spark { display: grid; flex: none; place-items: center; width: 16px; height: 20px; color: var(--ui-ai-blue); transition: color 300ms ease; }
.ui-ai__card[data-status="waiting"] .ui-ai__spark { color: var(--ui-ai-amber); }
.ui-ai__card[data-status="failed"] .ui-ai__spark { color: var(--ui-ai-red); }
.ui-ai__card[data-status="done"] .ui-ai__spark { color: var(--ui-ai-green); }
.ui-ai__title { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 600; line-height: 20px; color: var(--ui-ai-ink); text-align: start; white-space: nowrap; text-overflow: ellipsis; overflow-wrap: anywhere; }
.ui-ai__desc { display: -webkit-box; padding-left: 26px; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-ai-text); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
/* Open: the whole title and description, nothing cut off */
.ui-ai__card[data-open] .ui-ai__title { white-space: normal; }
.ui-ai__card[data-open] .ui-ai__desc { -webkit-line-clamp: unset; }
.ui-ai__foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; margin-top: 6px; padding-left: 26px; }
/* The state: a pill on a soft tone, with its glyph */
.ui-ai__state { display: inline-flex; align-items: center; gap: 6px; min-width: 0; height: 24px; padding: 0 10px 0 8px; border-radius: 999px; background: var(--ui-ai-brand-bg); font-size: 12.5px; font-weight: 500; color: var(--ui-ai-brand-fg); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-ai__state[data-status="waiting"] { background: var(--ui-ai-warn-bg); color: var(--ui-ai-warn-fg); }
.ui-ai__state[data-status="done"] { background: var(--ui-ai-ok-bg); color: var(--ui-ai-ok-fg); }
.ui-ai__state[data-status="failed"] { background: var(--ui-ai-danger-bg); color: var(--ui-ai-danger-fg); }
.ui-ai__state-word { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; margin-right: -6px; }
.ui-ai__time { flex: none; }
.ui-ai__state-icon { display: grid; flex: none; place-items: center; width: 12px; height: 12px; color: currentColor; animation: ui-ai-pop 360ms var(--ui-ai-ease) both; }
.ui-ai__state-icon[data-status="running"] svg { animation: ui-ai-spin 900ms linear infinite; }
.ui-ai__meta { display: inline-flex; flex: none; align-items: center; font-size: 12.5px; color: var(--ui-ai-muted); font-variant-numeric: tabular-nums; }
.ui-ai__meta > span { display: inline-flex; align-items: center; gap: 5px; padding: 0 9px; }
.ui-ai__meta > span + span { border-left: 1px solid var(--ui-ai-line); }
.ui-ai__meta > span:last-child { padding-right: 0; }

/* Open: steps and decisions unfold under the card's text */
.ui-ai__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 460ms var(--ui-ai-ease), opacity 240ms ease; }
.ui-ai__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 460ms var(--ui-ai-ease), opacity 320ms ease 100ms; }
.ui-ai__clip { min-height: 0; overflow: hidden; }
.ui-ai__more { margin: 0 14px; padding: 12px 0 14px; border-top: 1px solid var(--ui-ai-line); }
.ui-ai__agent { font-size: 12.5px; font-weight: 500; color: var(--ui-ai-muted); }
.ui-ai__steps { position: relative; display: grid; gap: 6px; margin-top: 8px !important; padding-left: 14px !important; }
.ui-ai__steps li { position: relative; display: flex; justify-content: space-between; gap: 10px; font-size: 13px; line-height: 18px; color: var(--ui-ai-text); }
.ui-ai__steps li::before { content: ""; position: absolute; top: 6px; left: -14px; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-ai-faint); }
.ui-ai__steps li:not(:last-child)::after { content: ""; position: absolute; top: 15px; bottom: -9px; left: -11.5px; width: 1px; background: var(--ui-ai-line); }
.ui-ai__steps li[data-last]::before { background: var(--ui-ai-ink); }
.ui-ai__steps li > span { min-width: 0; text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
.ui-ai__steps time { flex: none; color: var(--ui-ai-muted); }
.ui-ai__actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 12px; }
.ui-ai__actions:empty { display: none; }
.ui-ai__btn { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border-radius: 10px; background: var(--ui-ai-card); box-shadow: 0 0 0 1px var(--ui-ai-line), 0 1px 2px rgba(0, 0, 0, 0.04); font-size: 13.5px; font-weight: 500; color: var(--ui-ai-ink); transition: background-color 160ms ease, opacity 160ms ease; }
.ui-ai__btn:hover { background: var(--ui-ai-chip); }
.ui-ai__btn--primary { background: var(--ui-ai-ink); box-shadow: none; color: var(--ui-ai-card); }
.ui-ai__btn--primary:hover { background: var(--ui-ai-ink); opacity: 0.88; }

/* ----- List layout: the columns stack, one after another ----- */
.ui-ai[data-view="list"] .ui-ai__lanes { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.ui-ai__lanes { animation: ui-ai-in 320ms ease both; }

@keyframes ui-ai-spin { to { transform: rotate(360deg); } }
@keyframes ui-ai-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-ai-in { from { opacity: 0.4; } }

/* Narrow containers: always the list, without the switch */
@container (max-width: 620px) {
  .ui-ai__views { display: none; }
  .ui-ai__action { justify-content: center; width: 30px; padding: 0; background: var(--ui-ai-track); }
  .ui-ai__action-label { display: none; }
  .ui-ai .ui-ai__lanes { grid-template-columns: minmax(0, 1fr); gap: 8px; }
}
/* Slim cards (three columns in a narrow board): the text starts under the spark, so the footer keeps its words */
@container ai-card (max-width: 300px) {
  .ui-ai__desc, .ui-ai__foot { padding-left: 0; }
  .ui-ai__state:not([data-status="failed"]) .ui-ai__state-word { display: none; }
}
@container (max-width: 360px) {
  .ui-ai__desc, .ui-ai__foot { padding-left: 0; }
  .ui-ai__title { white-space: normal; }
}

@media (pointer: coarse) {
  .ui-ai__view { height: 34px; }
  .ui-ai__btn { height: 40px; padding: 0 18px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-ai *, .ui-ai *::before, .ui-ai *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ai {
  --ui-ai-tray: #111113;
  --ui-ai-card: #1c1c1f;
  --ui-ai-line: #2a2a2e;
  --ui-ai-chip: #26262a;
  --ui-ai-track: #1f1f22;
  --ui-ai-ink: #ededed;
  --ui-ai-text: #a1a1a6;
  --ui-ai-muted: #7c7c82;
  --ui-ai-faint: #4a4a50;
  --ui-ai-blue: #5b9aff;
  --ui-ai-amber: #f5b638;
  --ui-ai-green: #3ecf8e;
  --ui-ai-red: #ff6b66;
  --ui-ai-brand-bg: #16243f;
  --ui-ai-brand-fg: #8ab4ff;
  --ui-ai-warn-bg: #3a2410;
  --ui-ai-warn-fg: #ffa057;
  --ui-ai-ok-bg: #12301f;
  --ui-ai-ok-fg: #3dd68c;
  --ui-ai-danger-bg: #3b1714;
  --ui-ai-danger-fg: #ff977d;
  --ui-ai-ring: rgba(237, 237, 237, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-ai__card:hover, :where(.dark, [data-theme="dark"]) .ui-ai__card[data-open] { box-shadow: 0 0 0 1px #34343a, 0 6px 18px -8px rgba(0, 0, 0, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-ai__view[aria-checked="true"] { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) .ui-ai__state-icon[data-status="failed"] path { stroke: var(--ui-ai-danger-bg); }
`;
