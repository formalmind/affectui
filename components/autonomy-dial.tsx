"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Autonomy Dial – how much an agent may do on its own, in a single self-contained file.
 * A white card on a soft gray tray: three levels as a segmented control – Always ask, If risky, Full auto – with a raised
 * pill that glides to the chosen one, and the agent's real actions on the tray below, as small cards in two groups,
 * "Runs on its own" and "Asks you first"; risky and destructive ones carry a small tag.
 *   · pick a level and the actions glide from one group to the other, so the setting reads as what it does
 *   · the lock on an action pins it to "Asks you first", whatever the dial says – e.g. spending money
 *   · the counts next to both groups roll when they change
 * Click a level or use the arrow keys. Controlled or uncontrolled for both the level and the pins.
 * The styles are injected below, so no extra files are needed.
 */

export type AutonomyLevel = 0 | 1 | 2;
export type ActionRisk = "safe" | "risky" | "destructive";

export type AgentAction = {
  id: string;
  label: string;
  /** A few words on what it touches, e.g. "Gmail · to customers" */
  detail?: string;
  risk: ActionRisk;
  /** A 16px glyph or a small brand mark */
  icon?: ReactNode;
};

export type AutonomyDialProps = {
  actions: AgentAction[];
  /** 0 Ask every time · 1 Ask before risky actions · 2 Full auto */
  level?: AutonomyLevel;
  defaultLevel?: AutonomyLevel;
  onLevelChange?: (level: AutonomyLevel) => void;
  /** Ids of actions that always ask, whatever the level */
  pinned?: string[];
  defaultPinned?: string[];
  onPinnedChange?: (pinned: string[]) => void;
  /** Heading, e.g. the agent's name */
  title?: string;
  /** Line under the heading */
  subtitle?: string;
  className?: string;
};

/** Does the agent have to ask before this action? */
export const asksFirst = (action: AgentAction, level: AutonomyLevel, pinned: string[] = []) =>
  pinned.includes(action.id) || level === 0 || (level === 1 && action.risk !== "safe");

/* ---------- Helpers ---------- */

const LEVELS: { id: AutonomyLevel; label: string; hint: string }[] = [
  { id: 0, label: "Always ask", hint: "Nothing happens without your OK" },
  { id: 1, label: "If risky", hint: "Safe actions run, risky ones wait for you" },
  { id: 2, label: "Full auto", hint: "Everything runs, except what you locked" },
];
const RISK: Record<ActionRisk, string> = { safe: "", risky: "Risky", destructive: "Destructive" };
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** A calm in-and-out – the rows settle without a snap */
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const clamp = (n: number): AutonomyLevel => (Math.max(0, Math.min(2, Math.round(n))) as AutonomyLevel);
/** A broken or out-of-range level lands on the nearest real one */
const toLevel = (n: unknown, fallback: AutonomyLevel = 1): AutonomyLevel => (typeof n === "number" && Number.isFinite(n) ? clamp(n) : fallback);
/** An unknown risk counts as risky – it asks first, as before, and now carries its tag */
const toRisk = (r: unknown): ActionRisk => (r === "safe" || r === "destructive" ? r : "risky");
const num = new Intl.NumberFormat("en");
type Item = AgentAction & { key: string };

/* ---------- Icons ---------- */

/* Risk, lock and unlock: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) – rounded 1.5px strokes */
const RiskyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M12 9V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M12.125 16.75H12M12.25 16.75C12.25 16.8881 12.1381 17 12 17C11.8619 17 11.75 16.8881 11.75 16.75C11.75 16.6119 11.8619 16.5 12 16.5C12.1381 16.5 12.25 16.6119 12.25 16.75Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
);
const DestructiveIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5.92089 5.92089C8.15836 3.68342 9.2771 2.56468 10.5857 2.19562C11.5105 1.93479 12.4895 1.93479 13.4143 2.19562C14.7229 2.56468 15.8416 3.68342 18.0791 5.92089C20.3166 8.15836 21.4353 9.2771 21.8044 10.5857C22.0652 11.5105 22.0652 12.4895 21.8044 13.4143C21.4353 14.7229 20.3166 15.8416 18.0791 18.0791C15.8416 20.3166 14.7229 21.4353 13.4143 21.8044C12.4895 22.0652 11.5105 22.0652 10.5857 21.8044C9.2771 21.4353 8.15836 20.3166 5.92089 18.0791C3.68342 15.8416 2.56468 14.7229 2.19562 13.4143C1.93479 12.4895 1.93479 11.5105 2.19562 10.5857C2.56468 9.2771 3.68342 8.15836 5.92089 5.92089Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M12 8V12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M12.125 15.75H12M12.25 15.75C12.25 15.8881 12.1381 16 12 16C11.8619 16 11.75 15.8881 11.75 15.75C11.75 15.6119 11.8619 15.5 12 15.5C12.1381 15.5 12.25 15.6119 12.25 15.75Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
);
const LockedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 14.5V17.5M13 14.5C13 15.0523 12.5523 15.5 12 15.5C11.4477 15.5 11 15.0523 11 14.5C11 13.9477 11.4477 13.5 12 13.5C12.5523 13.5 13 13.9477 13 14.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M16.5 9V6.5C16.5 4.01472 14.4853 2 12 2C9.51471 2 7.49999 4.01472 7.49999 6.5V9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M4.2678 18.8447C4.49268 20.515 5.87612 21.8235 7.55965 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.8789 17.7547 20 16.6376 20 15.5C20 14.3624 19.8789 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55965 9.09909C5.87612 9.17649 4.49268 10.485 4.2678 12.1553C4.12104 13.2453 3.99999 14.3624 3.99999 15.5C3.99999 16.6376 4.12104 17.7547 4.2678 18.8447Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
);
const UnlockedIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 14.5V17.5M13 14.5C13 15.0523 12.5523 15.5 12 15.5C11.4477 15.5 11 15.0523 11 14.5C11 13.9477 11.4477 13.5 12 13.5C12.5523 13.5 13 13.9477 13 14.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C13.9593 2 15.8664 3.25221 16.5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
    <path d="M4.26781 18.8447C4.49269 20.515 5.87613 21.8235 7.55966 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.879 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55966 9.09909C5.87613 9.17649 4.49269 10.485 4.26781 12.1553C4.12104 13.2453 4 14.3624 4 15.5C4 16.6376 4.12104 17.7547 4.26781 18.8447Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
  </svg>
);


const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
const DotIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.4" fill="currentColor" />
  </svg>
);

/** A number that rolls to its new value */
function Roll({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (value === shown) return;
    setDir(value > shown ? "up" : "down");
    setShown(value);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span key={shown} className="ui-ad__roll" data-dir={dir ?? undefined}>
      {num.format(shown)}
    </span>
  );
}

export function AutonomyDial({
  actions,
  level,
  defaultLevel = 1,
  onLevelChange,
  pinned,
  defaultPinned = [],
  onPinnedChange,
  title = "Agent permissions",
  subtitle = "What it may do without asking you",
  className,
}: AutonomyDialProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [innerLevel, setInnerLevel] = useState<AutonomyLevel>(() => toLevel(defaultLevel));
  const [innerPinned, setInnerPinned] = useState<string[]>(() => (Array.isArray(defaultPinned) ? defaultPinned : []));
  const lvl = level == null ? innerLevel : toLevel(level, innerLevel);
  const pins = Array.isArray(pinned) ? pinned : innerPinned;

  const setLevel = (next: AutonomyLevel) => {
    if (next === lvl) return;
    setInnerLevel(next);
    onLevelChange?.(next);
  };
  const togglePin = (id: string) => {
    const next = pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
    setInnerPinned(next);
    onPinnedChange?.(next);
  };

  // Gaps are skipped, labels become text, risks are known ones – and a repeated id gets its own key
  const seen = new Map<string, number>();
  const items: Item[] = (Array.isArray(actions) ? actions : [])
    .filter((a): a is AgentAction => !!a && typeof a === "object")
    .map((a) => {
      const id = String(a.id ?? "");
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return { ...a, id, label: String(a.label ?? ""), risk: toRisk(a.risk), key: n ? `${id}#${n}` : id };
    });
  const own = items.filter((a) => !asksFirst(a, lvl, pins));
  const ask = items.filter((a) => asksFirst(a, lvl, pins));

  /* ---------- The levels: a segmented control, arrow keys move between them ---------- */

  const segRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);
  // The pill sits under the chosen level – the levels are as wide as their words, so it is measured
  useLayoutEffect(() => {
    const btn = segRef.current?.querySelector<HTMLElement>(`[data-level="${lvl}"]`);
    if (btn) setPill({ x: btn.offsetLeft, w: btn.offsetWidth });
  }, [lvl]);
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = clamp(lvl + step);
    setLevel(next);
    segRef.current?.querySelector<HTMLElement>(`[data-level="${next}"]`)?.focus();
  };

  /* ---------- Motion: actions glide between the groups ---------- */

  const rows = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, DOMRect>());
  const cardRef = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const shape = `${own.map((a) => a.key).join(",")}|${ask.map((a) => a.key).join(",")}`;
  const lastShape = useRef(shape);
  if (rootRef.current && shape !== lastShape.current) {
    before.current = new Map([...rows.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
    height.current = rootRef.current?.offsetHeight ?? 0;
  }
  useLayoutEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    if (reduced()) return;
    const card = rootRef.current;
    if (card && height.current && Math.abs(card.offsetHeight - height.current) > 1) {
      card.animate([{ height: `${height.current}px` }, { height: `${card.offsetHeight}px` }], { duration: 420, easing: EASE });
    }
    let k = 0;
    for (const [id, el] of rows.current) {
      const from = before.current.get(id);
      if (!from) continue;
      const to = el.getBoundingClientRect();
      const dy = from.top - to.top;
      if (Math.abs(dy) < 1) continue;
      // Rows that change group glide a beat after each other
      el.animate([{ transform: `translateY(${dy}px)`, zIndex: 2 }, { transform: "none", zIndex: 2 }], {
        duration: 420,
        delay: k++ * 20,
        easing: EASE,
        fill: "backwards",
      });
    }
  }, [shape]);

  /* ---------- One action ---------- */

  const row = (a: Item, asks: boolean) => {
    const isPinned = pins.includes(a.id);
    return (
      <li
        key={a.key}
        className="ui-ad__row"
        data-asks={asks ? "" : undefined}
        ref={(el) => {
          if (el) rows.current.set(a.key, el);
          else rows.current.delete(a.key);
        }}
      >
        <span className="ui-ad__icon">{a.icon ?? <DotIcon />}</span>
        <span className="ui-ad__name">
          <span className="ui-ad__line">
            <span className="ui-ad__label" dir="auto" title={a.label}>
              {a.label}
            </span>
            {a.risk !== "safe" && (
              <span className="ui-ad__risk" data-risk={a.risk}>
                {a.risk === "risky" ? <RiskyIcon /> : <DestructiveIcon />}
                {RISK[a.risk]}
              </span>
            )}
          </span>
          {a.detail && (
            <span className="ui-ad__detail" dir="auto" title={String(a.detail)}>
              {a.detail}
            </span>
          )}
        </span>
        <button
          type="button"
          className="ui-ad__pin"
          aria-pressed={isPinned}
          aria-label={isPinned ? `${a.label}: always asks – unlock` : `Always ask before: ${a.label}`}
          title={isPinned ? "Always asks – click to follow the dial again" : "Always ask, whatever the dial says"}
          onClick={() => togglePin(a.id)}
        >
          {isPinned ? <LockedIcon /> : <UnlockedIcon />}
        </button>
      </li>
    );
  };

  const current = LEVELS[lvl];

  return (
    <div ref={rootRef} className={["ui-ad", className].filter(Boolean).join(" ")} data-level={lvl}>
      <style href="ui-autonomy-dial" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-ad__card">
        <header className="ui-ad__head">
          <span className="ui-ad__spark">
            <Spark />
          </span>
          <span className="ui-ad__heading">
            <span className="ui-ad__title" dir="auto" title={title}>
              {title}
            </span>
            {subtitle && (
              <span className="ui-ad__sub" dir="auto" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
        </header>

        {/* ----- The levels ----- */}
        <div className="ui-ad__levels">
          <div
            ref={segRef}
            className="ui-ad__segmented"
            role="radiogroup"
            aria-label="Autonomy"
            aria-describedby={`${uid}-hint`}
            style={pill ? { ["--x" as string]: `${pill.x}px`, ["--w" as string]: `${pill.w}px` } : undefined}
            onKeyDown={onKey}
          >
            <span className="ui-ad__pill" aria-hidden="true" />
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={l.id === lvl}
                tabIndex={l.id === lvl ? 0 : -1}
                data-level={l.id}
                className="ui-ad__level"
                onClick={() => setLevel(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="ui-ad__sr" id={`${uid}-hint`}>
            {current.hint}
          </span>
        </div>
      </div>

      {/* ----- On the tray: what it does on its own, and what waits for you ----- */}
      <div className="ui-ad__groups">
        <section className="ui-ad__group" aria-labelledby={`${uid}-own`}>
          <h4 className="ui-ad__group-head" id={`${uid}-own`}>
            Runs on its own
            <span className="ui-ad__count">
              <Roll value={own.length} />
            </span>
          </h4>
          <ul className="ui-ad__list">
            {own.map((a) => row(a, false))}
            {own.length === 0 && <li className="ui-ad__empty">Every action waits for you</li>}
          </ul>
        </section>
        <section className="ui-ad__group" aria-labelledby={`${uid}-ask`}>
          <h4 className="ui-ad__group-head" id={`${uid}-ask`}>
            Asks you first
            <span className="ui-ad__count">
              <Roll value={ask.length} />
            </span>
          </h4>
          <ul className="ui-ad__list">
            {ask.map((a) => row(a, true))}
            {ask.length === 0 && <li className="ui-ad__empty">The agent runs everything itself</li>}
          </ul>
        </section>
      </div>

      <span className="ui-ad__sr" aria-live="polite">
        {`${current.label}: ${own.length} on its own, ${ask.length} ask first`}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-ad */
.ui-ad {
  --ui-ad-tray: #f0f0f0;
  --ui-ad-card: #ffffff;
  --ui-ad-ink: #171717;
  --ui-ad-text: #6b6b6b;
  --ui-ad-muted: #8a8a8a;
  --ui-ad-faint: #b8b8b8;
  --ui-ad-line: #ececec;
  --ui-ad-chip: #f5f5f5;
  --ui-ad-track: #f0f0f0;
  --ui-ad-accent: #2f6bff;
  --ui-ad-warn-bg: #fff3e0;
  --ui-ad-warn-fg: #b85c00;
  --ui-ad-danger-bg: #fdecea;
  --ui-ad-danger-fg: #c2331f;
  --ui-ad-ring: rgba(23, 23, 23, 0.22);
  --ui-ad-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  padding: 4px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--ui-ad-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-ad-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-ad *, .ui-ad *::before, .ui-ad *::after { box-sizing: border-box; }
:where(.ui-ad) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-ad button:focus-visible { outline: 2px solid var(--ui-ad-ring); outline-offset: 2px; }
.ui-ad ul { margin: 0; padding: 0; list-style: none; }
.ui-ad h4 { margin: 0; }
.ui-ad svg { display: block; flex: none; }
.ui-ad__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* The white card holds the heading and the levels */
.ui-ad__card { position: relative; border-radius: 16px; background: var(--ui-ad-card); box-shadow: 0 0 0 1px var(--ui-ad-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-ad__head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 0; }
.ui-ad__spark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-ad-accent); }
.ui-ad__heading { display: grid; min-width: 0; }
.ui-ad__title { overflow: hidden; font-weight: 600; color: var(--ui-ad-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-ad__sub { overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-ad-muted); white-space: nowrap; text-overflow: ellipsis; }

/* ----- The levels: a gray track, a raised white pill glides to the chosen one ----- */
.ui-ad__levels { padding: 14px 16px 16px; }
.ui-ad__segmented { position: relative; display: flex; padding: 3px; border-radius: 12px; background: var(--ui-ad-track); }
.ui-ad__pill { position: absolute; top: 3px; bottom: 3px; left: 0; width: var(--w, 0); border-radius: 9px; background: var(--ui-ad-card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04); transform: translateX(var(--x, 0)); transition: transform 320ms var(--ui-ad-ease), width 320ms var(--ui-ad-ease); }
.ui-ad__level { position: relative; flex: 1; height: 30px; padding: 0 10px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--ui-ad-muted); text-align: center !important; white-space: nowrap; transition: color 200ms ease; }
.ui-ad__level[aria-checked="true"] { color: var(--ui-ad-ink); }
.ui-ad__level[aria-checked="false"]:hover { color: var(--ui-ad-ink); }

/* ----- On the tray: the two groups ----- */
.ui-ad__groups { display: grid; gap: 14px; padding: 14px 4px 4px; }
.ui-ad__group-head { display: flex; align-items: center; gap: 6px; margin: 0 8px 8px !important; font-size: 12.5px; font-weight: 500; line-height: 18px; color: var(--ui-ad-muted); }
.ui-ad__count { display: grid; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; overflow: hidden; border-radius: 6px; background: var(--ui-ad-card); box-shadow: 0 0 0 1px var(--ui-ad-line), 0 1px 2px rgba(0, 0, 0, 0.04); font-size: 11px; color: var(--ui-ad-text); font-variant-numeric: tabular-nums; }
.ui-ad__roll { display: block; }
.ui-ad__roll[data-dir="up"] { animation: ui-ad-roll-up 360ms var(--ui-ad-ease) both; }
.ui-ad__roll[data-dir="down"] { animation: ui-ad-roll-down 360ms var(--ui-ad-ease) both; }
.ui-ad__list { display: grid; gap: 4px; }
.ui-ad__row { position: relative; display: flex; align-items: center; gap: 12px; min-height: 42px; padding: 4px 6px 4px 14px; border-radius: 12px; background: var(--ui-ad-card); box-shadow: 0 0 0 1px var(--ui-ad-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-ad__icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: var(--ui-ad-muted); }
.ui-ad__icon > svg { width: 16px; height: 16px; }
/* An image as icon fits its 16px tile, whatever its shape */
.ui-ad__icon { overflow: hidden; }
.ui-ad__icon > img { display: block; width: 16px; height: 16px; object-fit: contain; }
.ui-ad__name { display: grid; flex: 1; min-width: 0; }
.ui-ad__line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-ad__label { overflow: hidden; font-size: 13.5px; font-weight: 500; color: var(--ui-ad-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-ad__detail { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-ad-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Risk: a small pill right after the name – glyph and word; safe actions carry nothing */
.ui-ad__risk { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 20px; padding: 0 8px 0 6px; border-radius: 999px; background: var(--ui-ad-warn-bg); font-size: 11.5px; font-weight: 500; line-height: 16px; color: var(--ui-ad-warn-fg); }
.ui-ad__risk > svg { width: 12px; height: 12px; }
.ui-ad__risk[data-risk="destructive"] { background: var(--ui-ad-danger-bg); color: var(--ui-ad-danger-fg); }
.ui-ad__pin { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 9px; color: var(--ui-ad-faint); opacity: 0; transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease; }
.ui-ad__row:hover .ui-ad__pin, .ui-ad__pin:focus-visible, .ui-ad__pin[aria-pressed="true"] { opacity: 1; }
.ui-ad__pin:hover { background: var(--ui-ad-chip); color: var(--ui-ad-ink); }
.ui-ad__pin[aria-pressed="true"] { color: var(--ui-ad-text); }
/* Empty group: one quiet tag across the whole width */
.ui-ad__empty { display: flex; align-items: center; justify-content: center; min-height: 42px; padding: 8px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.035); font-size: 12.5px; line-height: 18px; color: var(--ui-ad-muted); text-align: center; }

@keyframes ui-ad-roll-up { from { opacity: 0; transform: translateY(70%); } }
@keyframes ui-ad-roll-down { from { opacity: 0; transform: translateY(-70%); } }

@container (max-width: 340px) {
  .ui-ad__detail { display: none; }
  .ui-ad__level { padding: 0 6px; font-size: 12px; }
}
@media (hover: none) {
  .ui-ad__pin { opacity: 1; }
}
@media (pointer: coarse) {
  .ui-ad__level { height: 36px; }
  .ui-ad__pin { width: 36px; height: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-ad *, .ui-ad *::before, .ui-ad *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ad {
  --ui-ad-tray: #111113;
  --ui-ad-card: #19191b;
  --ui-ad-ink: #ededed;
  --ui-ad-text: #a1a1a1;
  --ui-ad-muted: #8b8b92;
  --ui-ad-faint: #5c5c63;
  --ui-ad-line: #2a2a2e;
  --ui-ad-chip: #232326;
  --ui-ad-track: #232326;
  --ui-ad-accent: #5b8cff;
  --ui-ad-warn-bg: rgba(255, 160, 87, 0.14);
  --ui-ad-warn-fg: #ffa057;
  --ui-ad-danger-bg: rgba(255, 119, 102, 0.14);
  --ui-ad-danger-fg: #ff977d;
  --ui-ad-ring: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-ad__pill { background: #2c2c30; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
:where(.dark, [data-theme="dark"]) .ui-ad__empty { background: rgba(255, 255, 255, 0.04); }
`;
