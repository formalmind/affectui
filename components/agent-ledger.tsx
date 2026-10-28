"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Agent Ledger – everything an agent changed in your systems, each change with an undo, in a single
 * self-contained file. A soft gray tray with the agent and the count, a white card with a row per change –
 * newest first, new ones sliding in as the agent works.
 *   · every row keeps its height: the system's logo, what was done and to what, and before → after
 *   · point at a row and its time turns into "Undo"; point at Undo and every change that builds on it lights up –
 *     "Also undone" where it can be reversed, "Can't undo" where it can't (a sent email, a payout)
 *   · undo strikes the change through, its dependents a beat after each other; "Redo" brings them back
 * The styles are injected below, so no extra files are needed.
 */

export type LedgerEntry = {
  id: string;
  /** What was done, in a few words – e.g. "Changed price" */
  action: string;
  /** To what – e.g. "Pro plan" */
  target?: string;
  /** Where – e.g. "Stripe"; shown after the time and in the labels */
  system: string;
  /** The system's logo */
  icon?: ReactNode;
  /** When it happened (epoch ms) */
  at: number;
  /** Before and after – e.g. ["$29", "$34"]; or a single line of detail */
  change?: [before: string, after: string];
  detail?: string;
  /** False for changes that can't be taken back – a sent email, a payout (default true) */
  reversible?: boolean;
  /** Ids of the changes this one builds on – undoing one of those undoes this one too */
  dependsOn?: string[];
};

export type AgentLedgerProps = {
  entries: LedgerEntry[];
  /** Who made the changes – e.g. "Launch agent" */
  agent?: string;
  /** The clock for "2m ago" – defaults to now */
  now?: number;
  /** Controlled ids of undone changes */
  undone?: string[];
  defaultUndone?: string[];
  /** Undo sends the change and its reversible dependents, Redo the same set back */
  onUndo?: (ids: string[]) => void;
  onRedo?: (ids: string[]) => void;
  /** Lights up a change and what builds on it, as if its Undo were pointed at – e.g. for a walkthrough */
  pointAt?: string | null;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
};
/** "2m ago" for the last month – older (or a clock ahead of ours) gets its date, "Sep 20" or "Sep 20, 2025" */
const when = (at: number, now: number) => {
  const ms = now - at;
  if (ms > -60_000 && ms < 30 * 86_400_000) return ago(ms);
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(at);
};
/** The first letter or digit, whole – an emoji or a space in front doesn't split it */
const firstLetter = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

/** Who builds directly on each change – looked up once, so a long ledger stays quick */
const childrenOf = (entries: LedgerEntry[]) => {
  const map = new Map<string, LedgerEntry[]>();
  for (const e of entries) for (const parent of e.dependsOn ?? []) map.set(parent, [...(map.get(parent) ?? []), e]);
  return map;
};
/** Everything that builds on a change, directly or through others */
const dependentsOf = (id: string, children: Map<string, LedgerEntry[]>): LedgerEntry[] => {
  const out: LedgerEntry[] = [];
  const seen = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const e of children.get(queue[i]) ?? []) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
        queue.push(e.id);
      }
    }
  }
  return out;
};

/* ---------- Icons ---------- */

/* A small ledger mark for the title (drawn for affectUI) */
const LedgerMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="1.8" width="12" height="12.4" rx="2.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 5.4h6M5 8h6M5 10.6h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
/* Undo, redo and lock: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const UndoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7H15C18.3137 7 21 9.68629 21 13C21 16.3137 18.3137 19 15 19H8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M8 3L4 7L8 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const RedoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 7H9C5.68629 7 3 9.68629 3 13C3 16.3137 5.68629 19 9 19H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M16 3L20 7L16 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Lock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.26781 18.8447C4.49269 20.515 5.87613 21.8235 7.55966 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.879 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55966 9.09909C5.87613 9.17649 4.49269 10.485 4.26781 12.1553C4.12104 13.2453 4 14.3624 4 15.5C4 16.6376 4.12104 17.7547 4.26781 18.8447Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5V9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);

export function AgentLedger({ entries, agent, now: nowProp, undone: undoneProp, defaultUndone = [], onUndo, onRedo, pointAt = null, title = "Ledger", className }: AgentLedgerProps) {
  const label = useId();
  // The changes already there when the ledger appears just show – only the ones added later grow in
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(entries.map((e) => e.id));
  const [ownUndone, setOwnUndone] = useState<string[]>(defaultUndone);
  const undone = new Set(undoneProp ?? ownUndone);
  const [preview, setPreview] = useState<string | null>(null);
  /** The order rows were struck through in, for the stagger */
  const [order, setOrder] = useState<Record<string, number>>({});
  // Undone from outside: the ones that just joined strike through in the order they're listed
  const before = useRef<string[]>(undoneProp ?? []);
  useEffect(() => {
    if (!undoneProp) return;
    const fresh = undoneProp.filter((id) => !before.current.includes(id));
    before.current = undoneProp;
    if (fresh.length) setOrder(Object.fromEntries(fresh.map((id, i) => [id, i])));
  }, [undoneProp]);

  // Without a clock from outside, "2m ago" keeps itself fresh
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return;
    const t = window.setInterval(() => setTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;

  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const children = useMemo(() => childrenOf(entries), [entries]);
  const chainOf = (id: string) => dependentsOf(id, children).filter((e) => !undone.has(e.id));
  const lit = preview ?? pointAt;
  const previewChain = lit ? chainOf(lit) : [];
  const previewIds = new Map(previewChain.map((e) => [e.id, e.reversible !== false ? "also" : "kept"] as const));

  const undo = (e: LedgerEntry) => {
    const ids = [e.id, ...chainOf(e.id).filter((d) => d.reversible !== false).map((d) => d.id)];
    setOrder(Object.fromEntries(ids.map((id, i) => [id, i])));
    setOwnUndone((u) => [...u, ...ids.filter((id) => !u.includes(id))]);
    setPreview(null);
    onUndo?.(ids);
  };
  const redo = (e: LedgerEntry) => {
    // Back with it come the ones that went with it
    const ids = [e.id, ...dependentsOf(e.id, children).filter((d) => undone.has(d.id)).map((d) => d.id)];
    setOrder({});
    setOwnUndone((u) => u.filter((id) => !ids.includes(id)));
    onRedo?.(ids);
  };

  const count = entries.length;
  const undoneCount = entries.filter((e) => undone.has(e.id)).length;

  return (
    <div className={["ui-al", className].filter(Boolean).join(" ")}>
      <style href="ui-agent-ledger" precedence="default">
        {css}
      </style>

      <header className="ui-al__bar">
        <span className="ui-al__mark">
          <LedgerMark />
        </span>
        <span className="ui-al__title" id={label}>
          {title}
        </span>
        {agent && <span className="ui-al__agent">{agent}</span>}
        <span className="ui-al__sum">
          <span>
            <b>{count.toLocaleString("en-US")}</b> {count === 1 ? "change" : "changes"}
          </span>
          {undoneCount > 0 && (
            <span className="ui-al__sum-undone">
              <b>{undoneCount.toLocaleString("en-US")}</b> undone
            </span>
          )}
        </span>
      </header>

      <ol className="ui-al__panel" aria-labelledby={label}>
        {sorted.map((e) => {
          const isUndone = undone.has(e.id);
          const mark = previewIds.get(e.id);
          const blocked = e.reversible === false;
          const builtOn = isUndone || blocked ? 0 : chainOf(e.id).length;
          const change = e.change && (e.change[0].trim() || e.change[1].trim()) ? e.change : undefined;
          return (
            <li
              key={e.id}
              className="ui-al__row"
              data-undone={isUndone ? "" : undefined}
              data-initial={initial.current?.has(e.id) ? "" : undefined}
              data-preview={lit === e.id ? "" : undefined}
              data-chain={mark}
              style={{ "--o": order[e.id] ?? 0 } as CSSProperties}
            >
              <span className="ui-al__icon" aria-hidden="true">
                {e.icon ?? firstLetter(e.system)}
              </span>
              <div className="ui-al__main">
                <span className="ui-al__what" title={e.target ? `${e.action} ${e.target}` : e.action}>
                  <span className="ui-al__action" dir="auto">
                    {e.action}
                  </span>
                  {e.target && (
                    <span className="ui-al__target" dir="auto">
                      {e.target}
                    </span>
                  )}
                  {/* The strike: a line drawn across what was done when it's undone */}
                  <span className="ui-al__strike" aria-hidden="true" />
                </span>
                <span className="ui-al__change" title={change ? `${change[0]} → ${change[1]}` : e.detail}>
                  {change ? (
                    <>
                      <span className="ui-al__before" dir="auto">
                        {change[0]}
                      </span>
                      <span className="ui-al__arrow" aria-label="to">
                        →
                      </span>
                      <span className="ui-al__after" dir="auto">
                        {change[1]}
                      </span>
                    </>
                  ) : (
                    <span className="ui-al__detail" dir="auto">
                      {e.detail}
                    </span>
                  )}
                </span>
              </div>

              {/* On the right, always one slot: the time – or Undo, Redo, and what an undo would do to this row */}
              <div className="ui-al__end">
                {mark ? (
                  <span className="ui-al__flag" data-kind={mark}>
                    {mark === "also" ? (
                      "Also undone"
                    ) : (
                      <>
                        <Lock />
                        Can't undo
                      </>
                    )}
                  </span>
                ) : (
                  <>
                    <span className="ui-al__time" data-hide={isUndone || !blocked ? "" : undefined}>
                      {isUndone ? (
                        "Undone"
                      ) : (
                        <>
                          {when(e.at, now)}
                          <span className="ui-al__sys"> · {e.system}</span>
                        </>
                      )}
                    </span>
                    {isUndone ? (
                      <button type="button" className="ui-al__act" onClick={() => redo(e)} aria-label={`Redo: ${e.action}${e.target ? ` ${e.target}` : ""}`}>
                        <RedoIcon />
                        <span className="ui-al__act-label">Redo</span>
                      </button>
                    ) : blocked ? null : (
                      <button
                        type="button"
                        className="ui-al__act"
                        onMouseEnter={() => setPreview(e.id)}
                        onMouseLeave={() => setPreview((p) => (p === e.id ? null : p))}
                        onFocus={() => setPreview(e.id)}
                        onBlur={() => setPreview((p) => (p === e.id ? null : p))}
                        onClick={() => undo(e)}
                        aria-label={`Undo: ${e.action}${e.target ? ` ${e.target}` : ""}${builtOn ? ` – and ${builtOn} that build on it` : ""}`}
                      >
                        <UndoIcon />
                        <span className="ui-al__act-label">Undo</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-al */
.ui-al {
  --ui-al-tray: #f0f0f0;
  --ui-al-panel: #ffffff;
  --ui-al-card: #ffffff;
  --ui-al-strong: #171717;
  --ui-al-ink: #171717;
  --ui-al-text: #6b6b6b;
  --ui-al-muted: #8a8a8a;
  --ui-al-faint: #c2c2c2;
  --ui-al-line: #f0f0f0;
  --ui-al-fill: rgba(0, 0, 0, 0.05);
  --ui-al-accent: #2f6bff;
  --ui-al-focus: rgba(23, 23, 23, 0.22);
  --ui-al-undo-bg: #f2f6ff;
  --ui-al-also-bg: #f5f8ff;
  --ui-al-also-chip: #e3ecff;
  --ui-al-also-fg: #2456d6;
  --ui-al-kept-bg: #fff8ee;
  --ui-al-kept-chip: #ffefd6;
  --ui-al-kept-fg: #b85c00;
  --ui-al-strike: #8a8a8a;
  --ui-al-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-al-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-al-row: 62px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-al-tray);
  container: ui-al / inline-size;
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
:where(.ui-al) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-al button:focus-visible { outline: 2px solid var(--ui-al-focus); outline-offset: 1px; }
.ui-al svg { display: block; flex: none; }

/* ----- On the tray: whose changes, how many ----- */
.ui-al__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 8px 12px 12px; }
.ui-al__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-al-accent); }
.ui-al__title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-al-strong); }
.ui-al__agent { min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-al-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-al__sum { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ui-al-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-al__sum b { font-weight: 600; color: var(--ui-al-ink); }
.ui-al__sum-undone { animation: ui-al-fade 240ms ease both; }

/* ----- The white card: one row per change, newest first ----- */
.ui-al__panel { display: grid; margin: 0; padding: 6px; overflow: hidden; border-radius: 16px; background: var(--ui-al-panel); box-shadow: var(--ui-al-shadow); list-style: none; }
.ui-al__row { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; column-gap: 12px; height: var(--ui-al-row); padding: 10px 12px 10px 10px; border-radius: 11px; transition: background-color 200ms ease; animation: ui-al-grow 520ms var(--ui-al-ease) backwards; }
/* A new change opens its row – the card grows smoothly instead of jumping – and then fades in */
.ui-al__row > * { animation: ui-al-in 420ms var(--ui-al-ease) 140ms backwards; }
.ui-al__row[data-initial], .ui-al__row[data-initial] > * { animation: none; }
.ui-al__row + .ui-al__row::before { content: ""; position: absolute; top: 0; right: 12px; left: 54px; height: 1px; background: var(--ui-al-line); }
.ui-al__row:hover { background: #fafafa; }
/* Pointing at Undo: this row and every change built on it light up */
.ui-al__row[data-preview] { background: var(--ui-al-undo-bg); }
.ui-al__row[data-chain="also"] { background: var(--ui-al-also-bg); }
.ui-al__row[data-chain="kept"] { background: var(--ui-al-kept-bg); }
.ui-al__row:is([data-preview], [data-chain]) + .ui-al__row::before, .ui-al__row:is([data-preview], [data-chain])::before { opacity: 0; }

.ui-al__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); font-size: 13px; font-weight: 600; color: var(--ui-al-text); transition: opacity 300ms ease, filter 300ms ease; }
.ui-al__icon > svg { width: 16px; height: 16px; }

/* Two lines: what was done to what – then before → after */
.ui-al__main { position: relative; display: grid; min-width: 0; }
.ui-al__what { position: relative; display: flex; align-items: baseline; gap: 6px; justify-self: start; min-width: 0; max-width: 100%; white-space: nowrap; }
/* The target gives way first, then the action – both end in "…", the full line is in the tooltip */
.ui-al__action { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--ui-al-ink); transition: color 300ms ease; }
.ui-al__target { flex: 0 100 auto; min-width: 0; overflow: hidden; color: var(--ui-al-text); text-overflow: ellipsis; transition: color 300ms ease; }
.ui-al__change { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-al-muted); white-space: nowrap; }
/* Before gives way, the new value stays readable */
.ui-al__before { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-decoration: line-through; text-decoration-color: var(--ui-al-faint); }
.ui-al__arrow { flex: none; color: var(--ui-al-faint); }
.ui-al__detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-al__after { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--ui-al-text); text-overflow: ellipsis; }

/* Undone: a line draws across what was done, a beat after each other down the chain, and the row goes quiet */
.ui-al__strike { position: absolute; top: 50%; left: -2px; width: calc(100% + 4px); height: 1.5px; border-radius: 1px; background: var(--ui-al-strike); transform: scaleX(0); transform-origin: left; pointer-events: none; transition: transform 380ms var(--ui-al-ease) calc(var(--o, 0) * 110ms); }
.ui-al__row[data-undone] .ui-al__strike { transform: scaleX(1); }
.ui-al__row[data-undone] :is(.ui-al__action, .ui-al__target, .ui-al__after) { color: var(--ui-al-muted); transition-delay: calc(var(--o, 0) * 110ms); }
.ui-al__row[data-undone] .ui-al__icon { opacity: 0.5; filter: grayscale(1); transition-delay: calc(var(--o, 0) * 110ms); }

/* On the right: one slot – the time, or Undo / Redo on hover, or what an undo does to this row */
.ui-al__end { position: relative; display: grid; justify-items: end; align-items: center; min-width: 120px; height: 28px; }
/* The time only shows – the buttons in the same slot sit on top and get every click */
.ui-al__time { grid-area: 1 / 1; pointer-events: none; font-size: 13px; line-height: 18px; color: var(--ui-al-muted); white-space: nowrap; font-variant-numeric: tabular-nums; transition: opacity 140ms ease; }
.ui-al__row[data-undone] .ui-al__time { color: var(--ui-al-faint); }
.ui-al__act { position: relative; z-index: 1; grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 6px; height: 28px; margin-right: -4px; padding: 0 11px 0 9px; border-radius: 999px; background: var(--ui-al-card); box-shadow: var(--ui-al-shadow); font-size: 13px; font-weight: 500; color: var(--ui-al-ink); white-space: nowrap; opacity: 0; transition: opacity 140ms ease, box-shadow 140ms ease; }
.ui-al__row:is(:hover, :focus-within, [data-preview]) .ui-al__act { opacity: 1; }
.ui-al__row:is(:hover, :focus-within) .ui-al__time[data-hide], .ui-al__row[data-preview] .ui-al__time[data-hide] { opacity: 0; }
.ui-al__act:hover { box-shadow: 0 0 0 1px #e2e2e2, 0 2px 6px rgba(0, 0, 0, 0.08); }
.ui-al__row[data-preview] .ui-al__act { color: var(--ui-al-also-fg); }
.ui-al__flag { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 500; line-height: 24px; white-space: nowrap; animation: ui-al-fade 160ms ease both; }
.ui-al__flag[data-kind="also"] { background: var(--ui-al-also-chip); color: var(--ui-al-also-fg); }
.ui-al__flag[data-kind="kept"] { background: var(--ui-al-kept-chip); color: var(--ui-al-kept-fg); }

/* ----- Narrow: smaller gaps, the time stands alone ----- */
@container ui-al (max-width: 480px) {
  .ui-al__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-al__row { column-gap: 10px; padding: 10px 8px 10px 8px; }
  .ui-al__row + .ui-al__row::before { left: 50px; right: 8px; }
  .ui-al__end { min-width: 76px; }
  /* The logo already says where – the time stands alone */
  .ui-al__sys { display: none; }
  /* Undo and Redo shrink to their icon – the label stays for screen readers */
  .ui-al__act { width: 28px; justify-content: center; padding: 0; }
  .ui-al__act-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
/* Touch screens can't point: Undo and Redo show on every row, in place of the time */
@media (hover: none) {
  .ui-al__act { opacity: 1; }
  .ui-al__time[data-hide] { opacity: 0; }
}

@keyframes ui-al-grow { from { height: 0; padding-top: 0; padding-bottom: 0; } }
@keyframes ui-al-in { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ui-al-fade { from { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-al *, .ui-al *::before, .ui-al *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-al {
  --ui-al-tray: #1a1a1c;
  --ui-al-panel: #232326;
  --ui-al-card: #2a2a2e;
  --ui-al-strong: #f5f5f5;
  --ui-al-ink: #f0f0f0;
  --ui-al-text: #a1a1a1;
  --ui-al-muted: #8a8a8a;
  --ui-al-faint: #5c5c5c;
  --ui-al-line: #2e2e31;
  --ui-al-fill: rgba(255, 255, 255, 0.06);
  --ui-al-accent: #6d93ff;
  --ui-al-focus: rgba(255, 255, 255, 0.3);
  --ui-al-undo-bg: #1d2436;
  --ui-al-also-bg: #1c2232;
  --ui-al-also-chip: #1d2b4d;
  --ui-al-also-fg: #8aaeff;
  --ui-al-kept-bg: #2a2219;
  --ui-al-kept-chip: #3a2a12;
  --ui-al-kept-fg: #ffb357;
  --ui-al-strike: #8a8a8a;
  --ui-al-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
}
`;
