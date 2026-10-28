"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

/*
 * Agent Steering – steer an agent while it works, without stopping it, in a single self-contained file.
 * A white card on a soft gray tray: the run on top (title, model, a live clock, Pause) and the plan below it – done
 * steps, the active step with a spinner and its own clock, the steps still to come. On the tray under the card:
 * the queued notes and the field, "Steer the agent…".
 *   · ↵ queues a note for the next step: it lands as a small card between the plan and the field
 *   · when the agent finishes a step and takes the note in, the card glides up into the plan and stays there,
 *     attached to the step it changed, with "Picked up"
 *   · ⌘↵ (or "Now" on a queued note) interrupts: the note goes to the active step right away
 * The run is yours: the component shows the steps and the queue you pass and reports what people type – your agent
 * decides when a note is taken in (move it from `queue` to a step's `notes`, the glide happens by itself).
 * The styles are injected below, so no extra files are needed.
 */

export type SteerNote = {
  id: string;
  text: string;
  /** Set when the agent took the note in – shows "Picked up" (or "Interrupted" when it was applied right away) */
  picked?: "next" | "now";
};

export type SteerStepStatus = "done" | "active" | "pending";

export type SteerStep = {
  id: string;
  title: string;
  status?: SteerStepStatus;
  /** Time the step took in ms – shown on done steps */
  duration?: number;
  /** When the active step started – its clock ticks from here */
  startedAt?: number | Date;
  /** Notes the agent took in for this step – a note that leaves the queue and shows up here glides over */
  notes?: SteerNote[];
};

export type SteerRunStatus = "running" | "paused" | "done";

export type AgentSteeringProps = {
  /** What the agent is working on, e.g. "Migrate users table" */
  title: string;
  /** Name of the agent or model, e.g. "Opus 5.5" */
  agent?: string;
  steps: SteerStep[];
  /** Notes waiting for the next step, oldest first */
  queue: SteerNote[];
  status?: SteerRunStatus;
  /** When the run started – the clock in the header ticks from here */
  startedAt?: number | Date;
  /** ↵ in the field: queue this note for the next step */
  onQueue?: (text: string) => void;
  /** ⌘↵ in the field, or "Now" on a queued note (then with its id): apply it to the active step right away */
  onInterrupt?: (text: string, queuedId?: string) => void;
  /** Controlled text in the field, e.g. to prefill it – pair with onDraftChange */
  draft?: string;
  onDraftChange?: (text: string) => void;
  /** ✕ on a queued note */
  onRemove?: (id: string) => void;
  /** Shows Pause / Resume in the header */
  onPause?: () => void;
  onResume?: () => void;
  placeholder?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const ms = (d: number | Date) => (typeof d === "number" ? d : d.getTime());
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (time: number) => {
  const s = Number.isFinite(time) ? Math.max(0, Math.floor(time / 1000)) : 0;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};
// A step's time: tenths under a minute ("4.2s"), then the clock ("12m 04s") – nothing when it isn't a number
const seconds = (time: number) => (!Number.isFinite(time) ? "" : time < 60_000 ? `${(Math.max(0, time) / 1000).toFixed(1)}s` : clock(time));
const count = new Intl.NumberFormat("en");

// One shared tick for every clock on the page – only the clocks render again, not the whole plan
const ticker = { subs: new Set<() => void>(), id: 0 };
const useNow = (live: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const tick = () => setNow(Date.now());
    tick();
    ticker.subs.add(tick);
    if (!ticker.id) ticker.id = window.setInterval(() => ticker.subs.forEach((f) => f()), 100);
    return () => {
      ticker.subs.delete(tick);
      if (!ticker.subs.size) {
        window.clearInterval(ticker.id);
        ticker.id = 0;
      }
    };
  }, [live]);
  return now;
};
/** Time since `from`, ticking while `live` – stops where it is when the run pauses or ends */
const Elapsed = ({ from, live, format }: { from: number; live: boolean; format: (time: number) => string }) => {
  const now = useNow(live);
  return <>{format(now - from)}</>;
};
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)";

/* ---------- Icons ---------- */

const line = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
/** The agent's mark – a small four-point spark */
const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
const StepIcon = ({ status }: { status: SteerStepStatus }) => (
  <span className="ui-st__step-icon" data-status={status} aria-hidden="true">
    {status === "done" && (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6.5" fill="currentColor" />
        <path d="m5.4 8.2 1.8 1.8 3.4-3.7" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    {status === "active" && (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.6" />
        <path d="M8 2.2a5.8 5.8 0 0 1 5.8 5.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )}
    {status === "pending" && (
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 2.2" />
      </svg>
    )}
  </span>
);
const PauseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="4.2" y="3.4" width="2.6" height="9.2" rx="0.9" fill="currentColor" />
    <rect x="9.2" y="3.4" width="2.6" height="9.2" rx="0.9" fill="currentColor" />
  </svg>
);
const PlayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5 3.6v8.8c0 .6.6.9 1.1.6l6.6-4.4a.7.7 0 0 0 0-1.2L6.1 3c-.5-.3-1.1 0-1.1.6Z" fill="currentColor" />
  </svg>
);
const BoltIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M6.9 1 2.6 6.6h3l-.5 4.4 4.3-5.6h-3L6.9 1Z" fill="currentColor" />
  </svg>
);
const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="m3.4 3.4 5.2 5.2M8.6 3.4 3.4 8.6" {...line} />
  </svg>
);
const ArrowUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 12.6V3.6M4.2 7.2 8 3.4l3.8 3.8" {...line} strokeWidth={1.6} />
  </svg>
);
const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="m2.8 6.2 2 2 4.4-4.6" {...line} strokeWidth={1.5} />
  </svg>
);
const CornerIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M3 2.4v3.4c0 .9.7 1.6 1.6 1.6h4.6M7.6 5.6l1.8 1.8-1.8 1.8" {...line} strokeWidth={1.2} />
  </svg>
);

export function AgentSteering({
  title,
  agent,
  steps,
  queue,
  status = "running",
  startedAt,
  onQueue,
  onInterrupt,
  onRemove,
  draft: draftProp,
  onDraftChange,
  onPause,
  onResume,
  placeholder = "Steer the agent…",
  className,
}: AgentSteeringProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const [innerDraft, setInnerDraft] = useState("");
  const draft = draftProp ?? innerDraft;
  const setDraft = (text: string) => {
    setInnerDraft(text);
    onDraftChange?.(text);
  };
  const [announce, setAnnounce] = useState("");
  const mod = isMac() ? "⌘" : "Ctrl";

  // The clocks tick every 100 ms while the run is going – each clock on its own, see <Elapsed>
  const live = status === "running";
  const firstSeen = useRef(Date.now());
  const runFrom = startedAt !== undefined ? ms(startedAt) : firstSeen.current;
  const activeSince = useRef(new Map<string, number>());
  const stepFrom = (s: SteerStep) => {
    if (s.startedAt !== undefined) return ms(s.startedAt);
    let since = activeSince.current.get(s.id);
    if (since === undefined) activeSince.current.set(s.id, (since = Date.now()));
    return since;
  };

  const done = steps.filter((s) => s.status === "done").length;
  const open = status !== "done";

  /* ---------- Motion: every note and step glides from where it was – a note that left the queue flies into the plan ---------- */

  const tracked = useRef(new Map<string, HTMLElement>());
  const track = (key: string) => (el: HTMLElement | null) => {
    if (el) tracked.current.set(key, el);
    else tracked.current.delete(key);
  };
  const before = useRef(new Map<string, DOMRect>());
  const cardHeight = useRef(0);
  const shape = JSON.stringify([steps.map((s) => [s.id, s.status, s.title, (s.notes ?? []).map((n) => n.id)]), queue.map((n) => n.id)]);
  const lastShape = useRef(shape);
  // Read during render, before React changes the DOM – only when something moves, not on every clock tick
  if (rootRef.current && shape !== lastShape.current) {
    before.current = new Map([...tracked.current].map(([key, el]) => [key, el.getBoundingClientRect()]));
    cardHeight.current = rootRef.current?.offsetHeight ?? 0;
  }
  useLayoutEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    if (reduced()) return;
    // The card grows and shrinks smoothly instead of jumping
    const card = rootRef.current;
    if (card && cardHeight.current && Math.abs(card.offsetHeight - cardHeight.current) > 1) {
      card.animate([{ height: `${cardHeight.current}px` }, { height: `${card.offsetHeight}px` }], { duration: 480, easing: EASE });
    }
    for (const [key, el] of tracked.current) {
      const id = key.slice(key.indexOf(":") + 1);
      // A note keeps its id from the queue into the plan – look for it under both keys
      const from = before.current.get(key) ?? (key.startsWith("note:") ? before.current.get(`queued:${id}`) : undefined);
      const to = el.getBoundingClientRect();
      if (!from) {
        el.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 360, easing: EASE });
        continue;
      }
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      const flew = !before.current.has(key);
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 2 },
          { transform: "none", zIndex: 2 },
        ],
        { duration: flew ? 620 : 480, easing: EASE },
      );
      // Landed in the plan: a soft wash says "this changed"
      if (flew) el.setAttribute("data-landed", "");
    }
  }, [shape]);

  // What the agent took in, for screen readers
  const pickedKey = steps.flatMap((s) => (s.notes ?? []).filter((n) => n.picked).map((n) => n.id)).join("|");
  const seenPicked = useRef(new Set(pickedKey.split("|").filter(Boolean)));
  useEffect(() => {
    for (const s of steps)
      for (const n of s.notes ?? [])
        if (n.picked && !seenPicked.current.has(n.id)) {
          seenPicked.current.add(n.id);
          setAnnounce(`${agent ?? "The agent"} picked up: ${n.text}`);
        }
  }, [pickedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- The field ---------- */

  const send = (now: boolean) => {
    const text = draft.trim();
    if (!text || !open) return;
    if (now) onInterrupt?.(text);
    else onQueue?.(text);
    setAnnounce(now ? `Interrupting: ${text}` : `Queued for the next step: ${text}`);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(e.metaKey || e.ctrlKey);
    } else if (e.key === "Escape" && draft) {
      e.stopPropagation();
      setDraft("");
    }
  };
  // The field grows with its text, up to three lines
  useLayoutEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 60)}px`;
  }, [draft]);

  const runClock = <Elapsed from={runFrom} live={live} format={clock} />;
  const state = status === "done" ? <>Done in {runClock}</> : status === "paused" ? "Paused" : <>Running · {runClock}</>;

  return (
    <div ref={rootRef} className={["ui-st", className].filter(Boolean).join(" ")} data-status={status}>
      <style href="ui-agent-steering" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-st__card">
        {/* ----- The run ----- */}
        <header className="ui-st__head">
          <span className="ui-st__spark">
            <Spark />
          </span>
          <div className="ui-st__heading">
            <span className="ui-st__title" dir="auto" title={title}>
              {title}
            </span>
            {/* A long agent name shortens – the step count always stays */}
            <span className="ui-st__sub">
              {agent && (
                <>
                  <span className="ui-st__agent" title={agent}>
                    {agent}
                  </span>
                  {steps.length > 0 && (
                    <span className="ui-st__dot" aria-hidden="true">
                      ·
                    </span>
                  )}
                </>
              )}
              {steps.length > 0 && (
                <span className="ui-st__count">
                  {status === "done"
                    ? `${count.format(steps.length)} ${steps.length === 1 ? "step" : "steps"}`
                    : `Step ${count.format(Math.min(done + 1, steps.length))} of ${count.format(steps.length)}`}
                </span>
              )}
            </span>
          </div>
          <span className="ui-st__state" data-status={status}>
            <span className="ui-st__pulse" aria-hidden="true" />
            {state}
          </span>
          {status === "running" && onPause && (
            <button type="button" className="ui-st__icon-btn" aria-label="Pause the run" title="Pause" onClick={onPause}>
              <PauseIcon />
            </button>
          )}
          {status === "paused" && onResume && (
            <button type="button" className="ui-st__icon-btn" aria-label="Resume the run" title="Resume" onClick={onResume}>
              <PlayIcon />
            </button>
          )}
        </header>

        {/* ----- The plan ----- */}
        {steps.length > 0 && (
        <ol className="ui-st__plan" aria-label="Plan">
          {steps.map((s) => {
            const st = s.status ?? "pending";
            return (
              <li key={s.id} ref={track(`step:${s.id}`)} className="ui-st__step" data-status={st} aria-current={st === "active" ? "step" : undefined}>
                <div className="ui-st__step-row">
                  <StepIcon status={st} />
                  <span className="ui-st__step-title" dir="auto" title={s.title}>
                    {s.title}
                  </span>
                  <span className="ui-st__step-time">
                    {st === "done" && s.duration !== undefined ? (
                      seconds(s.duration)
                    ) : st === "active" && status === "running" ? (
                      <Elapsed from={stepFrom(s)} live format={seconds} />
                    ) : (
                      ""
                    )}
                  </span>
                </div>
                {(s.notes ?? []).map((n) => (
                  <div key={n.id} ref={track(`note:${n.id}`)} className="ui-st__note" data-picked={n.picked ?? undefined}>
                    <CornerIcon />
                    <span className="ui-st__note-text" dir="auto">
                      {n.text}
                    </span>
                    {n.picked && (
                      <span className="ui-st__note-tag">
                        <CheckIcon />
                        {n.picked === "now" ? "Interrupted" : "Picked up"}
                      </span>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ol>
        )}
      </div>

      {/* ----- On the tray: waiting for the next step ----- */}
      {queue.length > 0 && (
        <div className="ui-st__queue" ref={track("queue:box")}>
          <div className="ui-st__label">
            Queued for the next step <span>{count.format(queue.length)}</span>
          </div>
          <ul className="ui-st__queued">
            {queue.map((n) => (
              <li key={n.id} ref={track(`queued:${n.id}`)} className="ui-st__chip">
                <span className="ui-st__chip-text" dir="auto">
                  {n.text}
                </span>
                {onInterrupt && open && (
                  <button type="button" className="ui-st__chip-btn" title={`Apply now (${mod}↵)`} onClick={() => onInterrupt(n.text, n.id)}>
                    <BoltIcon />
                    Now
                  </button>
                )}
                {onRemove && (
                  <button type="button" className="ui-st__chip-x" aria-label={`Remove “${n.text}”`} onClick={() => onRemove(n.id)}>
                    <CloseIcon />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ----- Steer ----- */}
      <div className="ui-st__compose" ref={track("compose:box")} data-disabled={open ? undefined : ""}>
        <div
          className="ui-st__field"
          // A click on the free space puts the caret in – never one on its buttons, and never scrolling the page
          onClick={(e) => !(e.target as HTMLElement).closest("button") && fieldRef.current?.focus({ preventScroll: true })}
        >
          <textarea
            ref={fieldRef}
            id={`${uid}-field`}
            rows={1}
            value={draft}
            disabled={!open}
            placeholder={open ? placeholder : "The run has finished"}
            aria-label="Steer the agent"
            dir="auto"
            aria-describedby={`${uid}-hint`}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button
            type="button"
            className="ui-st__send"
            aria-label="Queue for the next step"
            disabled={!draft.trim() || !open}
            onClick={() => send(false)}
          >
            <ArrowUpIcon />
          </button>
        </div>
        <div className="ui-st__hint" id={`${uid}-hint`}>
          {open ? (
            <>
              <span>
                <kbd>↵</kbd> next step
              </span>
              {onInterrupt && (
                <span>
                  <kbd>{mod}</kbd>
                  <kbd>↵</kbd> interrupt now
                </span>
              )}
            </>
          ) : (
            <span>Notes still in the queue were not used</span>
          )}
        </div>
      </div>

      <span className="ui-st__sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-st */
.ui-st {
  --ui-st-tray: #f0f0f0;
  --ui-st-card: #ffffff;
  --ui-st-ink: #171717;
  --ui-st-text: #6b6b6b;
  --ui-st-muted: #8a8a8a;
  --ui-st-faint: #b8b8b8;
  --ui-st-line: #ececec;
  --ui-st-rail: #d4d4d8;
  --ui-st-hover: #e4e4e5;
  --ui-st-chip: #f5f5f5;
  --ui-st-accent: #2f6bff;
  --ui-st-accent-bg: rgba(47, 107, 255, 0.08);
  --ui-st-amber: #e8a20c;
  --ui-st-green: #22a05a;
  --ui-st-on-ink: #ffffff;
  --ui-st-ring: rgba(23, 23, 23, 0.22);
  --ui-st-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 460px;
  padding: 4px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--ui-st-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-st-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-st *, .ui-st *::before, .ui-st *::after { box-sizing: border-box; }
:where(.ui-st) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-st button:focus-visible { outline: 2px solid var(--ui-st-ring); outline-offset: 2px; }
.ui-st ol, .ui-st ul { margin: 0; padding: 0; list-style: none; }
.ui-st svg { display: block; flex: none; }
.ui-st__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* The white card holds the run and its plan */
.ui-st__card { position: relative; border-radius: 16px; background: var(--ui-st-card); box-shadow: 0 0 0 1px var(--ui-st-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* ----- The run ----- */
.ui-st__head { display: flex; align-items: center; gap: 12px; min-width: 0; padding: 14px 14px 12px 16px; }
.ui-st__spark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-st-accent); }
.ui-st[data-status="paused"] .ui-st__spark { color: var(--ui-st-amber); }
.ui-st[data-status="done"] .ui-st__spark { color: var(--ui-st-green); }
.ui-st__heading { display: grid; flex: 1; min-width: 0; }
.ui-st__title { text-align: start; overflow: hidden; font-weight: 600; color: var(--ui-st-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-st__sub { display: flex; min-width: 0; overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-st-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-st__dot { flex: none; margin: 0 6px; color: var(--ui-st-faint); }
.ui-st__agent { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-st__count { flex: none; font-variant-numeric: tabular-nums; }
.ui-st__state { display: inline-flex; flex: none; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border-radius: 999px; background: var(--ui-st-chip); font-size: 12.5px; font-weight: 500; color: var(--ui-st-text); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-st__pulse { position: relative; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-st-accent); }
.ui-st__pulse::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; background: var(--ui-st-accent); opacity: 0; animation: ui-st-pulse 1600ms ease-out infinite; }
.ui-st__state[data-status="paused"] .ui-st__pulse { background: var(--ui-st-amber); }
.ui-st__state[data-status="done"] .ui-st__pulse { background: var(--ui-st-green); }
.ui-st__state:not([data-status="running"]) .ui-st__pulse::after { display: none; }
.ui-st__icon-btn { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: var(--ui-st-muted); box-shadow: inset 0 0 0 1px var(--ui-st-line); transition: color 160ms ease, background-color 160ms ease; }
.ui-st__icon-btn:hover { color: var(--ui-st-ink); background: var(--ui-st-chip); }

/* ----- The plan ----- */
.ui-st__plan { display: grid; grid-template-columns: minmax(0, 1fr); padding: 10px 16px 14px !important; border-top: 1px solid var(--ui-st-line); }
.ui-st__step { position: relative; padding: 6px 0; }
/* Short rail segments between the icons, with a little air on both ends */
.ui-st__step:not(:last-child)::after { content: ""; position: absolute; top: 27px; bottom: -3px; left: 7.5px; width: 1px; background: var(--ui-st-rail); }
.ui-st__step-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ui-st__step-icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: var(--ui-st-faint); }
.ui-st__step-icon[data-status="done"] { color: var(--ui-st-ink); animation: ui-st-pop 360ms var(--ui-st-ease) both; }
.ui-st__step-icon[data-status="active"] { color: var(--ui-st-accent); }
.ui-st__step-icon[data-status="active"] svg { animation: ui-st-spin 900ms linear infinite; }
.ui-st__step-title { flex: 1; min-width: 0; text-align: start; overflow: hidden; color: var(--ui-st-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-st__step[data-status="done"] .ui-st__step-title { color: var(--ui-st-text); }
.ui-st__step[data-status="pending"] .ui-st__step-title { color: var(--ui-st-muted); }
.ui-st[data-status="running"] .ui-st__step[data-status="active"] .ui-st__step-title {
  background: linear-gradient(90deg, var(--ui-st-ink) 0%, var(--ui-st-ink) 40%, var(--ui-st-faint) 50%, var(--ui-st-ink) 60%, var(--ui-st-ink) 100%) 0 0 / 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ui-st-shimmer 2200ms linear infinite;
}
.ui-st__step[data-status="active"] .ui-st__step-title { font-weight: 500; }
.ui-st__step-time { flex: none; font-size: 12.5px; color: var(--ui-st-faint); font-variant-numeric: tabular-nums; }

/* A note the agent took in – attached to its step */
.ui-st__note { display: flex; align-items: flex-start; gap: 6px; margin: 6px 0 2px 28px; padding: 6px 10px 6px 8px; border-radius: 10px; background: var(--ui-st-chip); font-size: 13px; line-height: 18px; color: var(--ui-st-ink); }
.ui-st__note > svg { margin-top: 3px; color: var(--ui-st-muted); }
.ui-st__note-text { flex: 1; min-width: 0; text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
.ui-st__note-tag { display: inline-flex; flex: none; align-items: center; gap: 3px; font-size: 12px; font-weight: 500; color: var(--ui-st-accent); white-space: nowrap; }
.ui-st__note[data-landed] { animation: ui-st-land 1400ms ease both; }

/* ----- On the tray: queued notes ----- */
.ui-st__queue { padding: 12px 8px 0; }
.ui-st__label { display: flex; align-items: center; gap: 6px; margin: 0 4px 8px; font-size: 12px; font-weight: 500; color: var(--ui-st-muted); }
.ui-st__label span { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 6px; background: var(--ui-st-hover); color: var(--ui-st-text); font-variant-numeric: tabular-nums; }
.ui-st__queued { display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.ui-st__chip { position: relative; display: flex; align-items: center; gap: 6px; min-height: 36px; padding: 4px 4px 4px 12px; border-radius: 12px; background: var(--ui-st-card); box-shadow: 0 0 0 1px var(--ui-st-line), 0 1px 2px rgba(0, 0, 0, 0.04); color: var(--ui-st-ink); }
.ui-st__chip::before { content: ""; position: absolute; top: 9px; bottom: 9px; left: 0; width: 3px; border-radius: 0 3px 3px 0; background: var(--ui-st-accent); }
.ui-st__chip-text { flex: 1; min-width: 0; text-align: start; overflow-wrap: anywhere; white-space: pre-line; font-size: 13px; line-height: 18px; }
.ui-st__chip-btn { display: inline-flex; flex: none; align-items: center; gap: 4px; height: 28px; padding: 0 10px 0 8px; border-radius: 8px; font-size: 12.5px; font-weight: 500; color: var(--ui-st-text); transition: background-color 160ms ease, color 160ms ease; }
.ui-st__chip-btn:hover { background: var(--ui-st-accent-bg); color: var(--ui-st-accent); }
.ui-st__chip-x { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; color: var(--ui-st-faint); transition: background-color 160ms ease, color 160ms ease; }
.ui-st__chip-x:hover { background: var(--ui-st-chip); color: var(--ui-st-ink); }

/* ----- On the tray: steer ----- */
.ui-st__compose { padding: 10px 8px 8px; }
.ui-st__field { display: flex; align-items: flex-end; gap: 8px; min-height: 42px; padding: 5px 5px 5px 14px; border-radius: 14px; background: var(--ui-st-card); box-shadow: 0 0 0 1px var(--ui-st-line), 0 1px 2px rgba(0, 0, 0, 0.04); cursor: text; transition: box-shadow 160ms ease; }
.ui-st__field:focus-within { box-shadow: 0 0 0 1px var(--ui-st-rail), 0 0 0 4px var(--ui-st-accent-bg); }
.ui-st__field textarea { flex: 1; min-width: 0; height: 20px; margin: 6px 0; padding: 0; border: 0; outline: none; background: none; font: inherit; color: var(--ui-st-ink); resize: none; }
.ui-st__field textarea::placeholder { color: var(--ui-st-muted); }
.ui-st__field textarea:focus-visible { outline: none; }
.ui-st__send { display: grid; flex: none; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--ui-st-ink); color: var(--ui-st-on-ink); transition: opacity 160ms ease, transform 160ms ease; }
.ui-st__send:disabled { opacity: 0.16; cursor: default; }
.ui-st__send:not(:disabled):active { transform: scale(0.94); }
.ui-st__hint { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin: 8px 6px 2px; font-size: 12px; line-height: 16px; color: var(--ui-st-muted); }
.ui-st__hint > span { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
.ui-st kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px; background: var(--ui-st-card); box-shadow: 0 0 0 1px var(--ui-st-line); font: inherit; font-size: 10.5px; color: var(--ui-st-text); }
.ui-st__compose[data-disabled] .ui-st__field { opacity: 0.6; cursor: default; }

@keyframes ui-st-spin { to { transform: rotate(360deg); } }
@keyframes ui-st-pop { from { opacity: 0; transform: scale(0.6); } }
@keyframes ui-st-pulse { from { opacity: 0.45; transform: scale(0.6); } to { opacity: 0; transform: scale(1.8); } }
@keyframes ui-st-shimmer { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes ui-st-land { 0%, 30% { background-color: var(--ui-st-accent-bg); box-shadow: inset 0 0 0 1px var(--ui-st-accent-bg); } }

/* Narrow containers: tighter padding */
@container (max-width: 380px) {
  /* The status moves under the title, so the title gets the full width */
  .ui-st__head { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 12px; row-gap: 8px; }
  .ui-st__spark { grid-row: 1; align-self: center; }
  .ui-st__heading { grid-column: 2; grid-row: 1; }
  .ui-st__state { grid-column: 2; grid-row: 2; justify-self: start; }
  .ui-st__head > .ui-st__icon-btn { grid-column: 3; grid-row: 1; }
    .ui-st__head { padding-left: 14px; }
  .ui-st__plan { padding-left: 14px; padding-right: 14px; }
}
@media (pointer: coarse) {
  .ui-st__icon-btn, .ui-st__send { width: 36px; height: 36px; }
  .ui-st__chip-btn, .ui-st__chip-x { height: 32px; }
  .ui-st__chip-x { width: 32px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-st *, .ui-st *::before, .ui-st *::after { animation: none !important; transition: none !important; }
  .ui-st[data-status="running"] .ui-st__step[data-status="active"] .ui-st__step-title { background: none; color: var(--ui-st-ink); }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-st {
  --ui-st-tray: #111113;
  --ui-st-card: #19191b;
  --ui-st-ink: #ededed;
  --ui-st-text: #a1a1a1;
  --ui-st-muted: #8b8b92;
  --ui-st-faint: #5c5c63;
  --ui-st-line: #2a2a2e;
  --ui-st-rail: #3a3a40;
  --ui-st-hover: #2a2a2e;
  --ui-st-chip: #232326;
  --ui-st-accent: #5b8cff;
  --ui-st-accent-bg: rgba(91, 140, 255, 0.14);
  --ui-st-amber: #f5b638;
  --ui-st-green: #3ecf8e;
  --ui-st-on-ink: #19191b;
  --ui-st-ring: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-st__step-icon[data-status="done"] path { stroke: #19191b; }
`;
