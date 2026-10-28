"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Autonomy Dial – how much an agent may do on its own, in a single self-contained file.
 * One quiet white card: three levels as a segmented control – Always ask, If risky, Full auto – and the agent's real
 * actions below it in two groups, "Runs on its own" and "Asks you first"; risky and destructive ones carry a small tag.
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
    <span key={shown} className="ui-adc__roll" data-dir={dir ?? undefined}>
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
    height.current = cardRef.current?.offsetHeight ?? 0;
  }
  useLayoutEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    if (reduced()) return;
    const card = cardRef.current;
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
        className="ui-adc__row"
        data-asks={asks ? "" : undefined}
        ref={(el) => {
          if (el) rows.current.set(a.key, el);
          else rows.current.delete(a.key);
        }}
      >
        <span className="ui-adc__icon">{a.icon ?? <DotIcon />}</span>
        <span className="ui-adc__name">
          <span className="ui-adc__line">
            <span className="ui-adc__label" dir="auto" title={a.label}>
              {a.label}
            </span>
            {a.risk !== "safe" && (
              <span className="ui-adc__risk" data-risk={a.risk}>
                {a.risk === "risky" ? <RiskyIcon /> : <DestructiveIcon />}
                {RISK[a.risk]}
              </span>
            )}
          </span>
          {a.detail && (
            <span className="ui-adc__detail" dir="auto" title={String(a.detail)}>
              {a.detail}
            </span>
          )}
        </span>
        <button
          type="button"
          className="ui-adc__pin"
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
    <div ref={rootRef} className={["ui-adc", className].filter(Boolean).join(" ")} data-level={lvl}>
      <style href="ui-autonomy-dial-clean" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-adc__card">
        <header className="ui-adc__head">
          <span className="ui-adc__spark">
            <Spark />
          </span>
          <span className="ui-adc__heading">
            <span className="ui-adc__title" dir="auto" title={title}>
              {title}
            </span>
            {subtitle && (
              <span className="ui-adc__sub" dir="auto" title={subtitle}>
                {subtitle}
              </span>
            )}
          </span>
        </header>

        {/* ----- The levels ----- */}
        <div className="ui-adc__levels">
          <div
            ref={segRef}
            className="ui-adc__segmented"
            role="radiogroup"
            aria-label="Autonomy"
            aria-describedby={`${uid}-hint`}
            onKeyDown={onKey}
          >
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={l.id === lvl}
                tabIndex={l.id === lvl ? 0 : -1}
                data-level={l.id}
                className="ui-adc__level"
                onClick={() => setLevel(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="ui-adc__sr" id={`${uid}-hint`}>
            {current.hint}
          </span>
        </div>

        {/* ----- What it does on its own, and what waits for you ----- */}
        <div className="ui-adc__groups">
          <section className="ui-adc__group" aria-labelledby={`${uid}-own`}>
            <h4 className="ui-adc__group-head" id={`${uid}-own`}>
              Runs on its own
              <span className="ui-adc__count">
                <Roll value={own.length} />
              </span>
            </h4>
            <ul className="ui-adc__list">
              {own.map((a) => row(a, false))}
              {own.length === 0 && <li className="ui-adc__empty">Every action waits for you</li>}
            </ul>
          </section>
          <section className="ui-adc__group" aria-labelledby={`${uid}-ask`}>
            <h4 className="ui-adc__group-head" id={`${uid}-ask`}>
              Asks you first
              <span className="ui-adc__count">
                <Roll value={ask.length} />
              </span>
            </h4>
            <ul className="ui-adc__list">
              {ask.map((a) => row(a, true))}
              {ask.length === 0 && <li className="ui-adc__empty">The agent runs everything itself</li>}
            </ul>
          </section>
        </div>
      </div>

      <span className="ui-adc__sr" aria-live="polite">
        {`${current.label}: ${own.length} on its own, ${ask.length} ask first`}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-adc */
.ui-adc {
  --ui-adc-card: #ffffff;
  --ui-adc-strong: #000000;
  --ui-adc-ink: rgba(0, 0, 0, 0.88);
  --ui-adc-text: rgba(0, 0, 0, 0.61);
  --ui-adc-muted: rgba(0, 0, 0, 0.45);
  --ui-adc-faint: rgba(0, 0, 0, 0.27);
  --ui-adc-icon: rgba(0, 0, 0, 0.447);
  --ui-adc-line: rgba(0, 0, 0, 0.06);
  --ui-adc-wash: rgba(0, 0, 0, 0.03);
  --ui-adc-fill: rgba(0, 0, 0, 0.06);
  --ui-adc-accent: rgba(0, 96, 226, 0.765);
  /* Subtle tones after Interfere's tokens (Radix scales): a soft background and its foreground */
  --ui-adc-brand-bg: #008ff519;
  --ui-adc-brand-fg: #006dcbf2;
  --ui-adc-warn-bg: #ff9c0029;
  --ui-adc-warn-fg: #cc4e00;
  --ui-adc-danger-bg: #f52b0018;
  --ui-adc-danger-fg: #d72400da;
  --ui-adc-amber: #cc4e00;
  --ui-adc-red: #d72400da;
  --ui-adc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-adc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-adc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 400px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-adc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-adc *, .ui-adc *::before, .ui-adc *::after { box-sizing: border-box; }
:where(.ui-adc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-adc button:focus-visible { outline: 2px solid var(--ui-adc-focus); outline-offset: 1px; }
.ui-adc ul { margin: 0; padding: 0; list-style: none; }
.ui-adc h4 { margin: 0; }
.ui-adc svg { display: block; flex: none; }
.ui-adc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* One white card – the edge is a shadow, not a border */
.ui-adc__card { overflow: hidden; border-radius: 10px; background: var(--ui-adc-card); box-shadow: var(--ui-adc-shadow); }

.ui-adc__head { display: flex; align-items: center; gap: 10px; padding: 16px 16px 0; }
.ui-adc__spark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-adc-accent); }
.ui-adc__heading { display: grid; min-width: 0; }
.ui-adc__title { overflow: hidden; font-weight: 500; color: var(--ui-adc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-adc__sub { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-adc-muted); white-space: nowrap; text-overflow: ellipsis; }

/* ----- The levels: three tab buttons ----- */
.ui-adc__levels { padding: 16px 16px 18px; }
.ui-adc__segmented { position: relative; display: flex; gap: 8px; }
/* Separate buttons: the others are gray, the chosen one is white with a hairline and a soft lift */
.ui-adc__level { position: relative; flex: 1; padding: 3px 8px; border-radius: 6px; background: var(--ui-adc-fill); font-size: 12px; font-weight: 500; line-height: 18px; color: var(--ui-adc-text); text-align: center !important; white-space: nowrap; transition: color 180ms ease, background-color 180ms ease, box-shadow 180ms ease; }
.ui-adc__level[aria-checked="true"] { background: var(--ui-adc-card); box-shadow: var(--ui-adc-shadow); color: var(--ui-adc-strong); }
.ui-adc__level[aria-checked="false"]:hover { background: rgba(0, 0, 0, 0.08); color: var(--ui-adc-ink); }

/* ----- The two groups: spacing between them, one hairline above ----- */
.ui-adc__groups { display: grid; gap: 14px; padding: 14px 10px 12px; border-top: 0.5px solid var(--ui-adc-line); }
.ui-adc__group-head { display: flex; align-items: center; gap: 6px; margin: 0 6px 4px !important; font-size: 12px; font-weight: 400; line-height: 16px; color: var(--ui-adc-muted); }
/* The count: a small white label with a hairline and a soft lift – no taller than the heading */
.ui-adc__count { display: grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; overflow: hidden; border-radius: 4px; background: var(--ui-adc-card); box-shadow: var(--ui-adc-shadow); font-size: 10px; font-weight: 500; line-height: 16px; color: var(--ui-adc-text); font-variant-numeric: tabular-nums; }
.ui-adc__roll { display: block; }
.ui-adc__roll[data-dir="up"] { animation: ui-adc-roll-up 360ms var(--ui-adc-ease) both; }
.ui-adc__roll[data-dir="down"] { animation: ui-adc-roll-down 360ms var(--ui-adc-ease) both; }
.ui-adc__list { display: grid; }
.ui-adc__row { position: relative; display: flex; align-items: center; gap: 12px; min-height: 30px; padding: 0 4px 0 6px; border-radius: 6px; background: var(--ui-adc-card); transition: background-color 160ms ease; }
.ui-adc__row:hover { background: var(--ui-adc-wash); }
.ui-adc__icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: var(--ui-adc-icon); }
.ui-adc__icon > svg { width: 16px; height: 16px; }
/* An image as icon fits its 16px tile, whatever its shape */
.ui-adc__icon { overflow: hidden; }
.ui-adc__icon > img { display: block; width: 16px; height: 16px; object-fit: contain; }
.ui-adc__name { display: grid; flex: 1; min-width: 0; }
.ui-adc__label { overflow: hidden; color: var(--ui-adc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-adc__detail { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-adc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Risk: a small tag right after the name – glyph and word on a subtle tone; safe actions carry nothing */
.ui-adc__line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-adc__risk { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 18px; padding: 0 6px 0 4px; border-radius: 4px; background: var(--ui-adc-warn-bg); font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-adc-warn-fg); }
.ui-adc__risk > svg { width: 12px; height: 12px; }
.ui-adc__risk[data-risk="destructive"] { background: var(--ui-adc-danger-bg); color: var(--ui-adc-danger-fg); }
.ui-adc__pin { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 6px; color: var(--ui-adc-faint); opacity: 0; transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease; }
.ui-adc__row:hover .ui-adc__pin, .ui-adc__pin:focus-visible, .ui-adc__pin[aria-pressed="true"] { opacity: 1; }
.ui-adc__pin:hover { background: var(--ui-adc-fill); color: var(--ui-adc-ink); }
.ui-adc__pin[aria-pressed="true"] { color: var(--ui-adc-icon); }
/* Empty group: one quiet gray tag across the whole width */
.ui-adc__empty { display: flex; align-items: center; justify-content: center; min-height: 30px; margin: 2px 0; padding: 6px 10px; border-radius: 6px; background: var(--ui-adc-wash); font-size: 12px; line-height: 16px; color: var(--ui-adc-muted); text-align: center; }

@keyframes ui-adc-roll-up { from { opacity: 0; transform: translateY(70%); } }
@keyframes ui-adc-roll-down { from { opacity: 0; transform: translateY(-70%); } }

/* Narrow containers: the detail lines go, the levels get tighter */
@container (max-width: 340px) {
  .ui-adc__detail { display: none; }
  .ui-adc__segmented { gap: 4px; }
  .ui-adc__level { padding: 4px 6px; font-size: 12px; }
}
/* Touch: no hover – the locks are always visible */
@media (hover: none) {
  .ui-adc__pin { opacity: 1; }
}
@media (pointer: coarse) {
  .ui-adc__level { padding: 8px 10px; }
  .ui-adc__pin { width: 34px; height: 34px; }
  .ui-adc__row { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-adc *, .ui-adc *::before, .ui-adc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-adc__level[aria-checked="false"]:hover { background: rgba(255, 255, 255, 0.11); }
:where(.dark, [data-theme="dark"]) .ui-adc {
  --ui-adc-card: #1c1c1f;
  --ui-adc-strong: #ffffff;
  --ui-adc-ink: rgba(255, 255, 255, 0.9);
  --ui-adc-text: rgba(255, 255, 255, 0.62);
  --ui-adc-muted: rgba(255, 255, 255, 0.45);
  --ui-adc-faint: rgba(255, 255, 255, 0.28);
  --ui-adc-icon: rgba(255, 255, 255, 0.5);
  --ui-adc-line: rgba(255, 255, 255, 0.08);
  --ui-adc-wash: rgba(255, 255, 255, 0.04);
  --ui-adc-fill: rgba(255, 255, 255, 0.08);
  --ui-adc-accent: #5b9aff;
  --ui-adc-brand-bg: #0077ff3a;
  --ui-adc-brand-fg: #70b8ff;
  --ui-adc-warn-bg: #fb6a0025;
  --ui-adc-warn-fg: #ffa057;
  --ui-adc-danger-bg: #ff35232b;
  --ui-adc-danger-fg: #ff977d;
  --ui-adc-amber: #ffa057;
  --ui-adc-red: #ff977d;
  --ui-adc-focus: rgba(91, 154, 255, 0.45);
  --ui-adc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
`;
