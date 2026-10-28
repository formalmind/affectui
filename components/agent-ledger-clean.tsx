"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Agent Ledger – everything an agent changed in your systems, each change with an undo, in a single
 * self-contained file. A bar on top with the agent and the count, one quiet white panel with a row per change –
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
    <div className={["ui-alc", className].filter(Boolean).join(" ")}>
      <style href="ui-agent-ledger-clean" precedence="default">
        {css}
      </style>

      <header className="ui-alc__bar">
        <span className="ui-alc__mark">
          <LedgerMark />
        </span>
        <span className="ui-alc__title" id={label}>
          {title}
        </span>
        {agent && <span className="ui-alc__agent">{agent}</span>}
        <span className="ui-alc__sum">
          <span>
            <b>{count.toLocaleString("en-US")}</b> {count === 1 ? "change" : "changes"}
          </span>
          {undoneCount > 0 && (
            <span className="ui-alc__sum-undone">
              <b>{undoneCount.toLocaleString("en-US")}</b> undone
            </span>
          )}
        </span>
      </header>

      <ol className="ui-alc__panel" aria-labelledby={label}>
        {sorted.map((e) => {
          const isUndone = undone.has(e.id);
          const mark = previewIds.get(e.id);
          const blocked = e.reversible === false;
          const builtOn = isUndone || blocked ? 0 : chainOf(e.id).length;
          const change = e.change && (e.change[0].trim() || e.change[1].trim()) ? e.change : undefined;
          return (
            <li
              key={e.id}
              className="ui-alc__row"
              data-undone={isUndone ? "" : undefined}
              data-initial={initial.current?.has(e.id) ? "" : undefined}
              data-preview={lit === e.id ? "" : undefined}
              data-chain={mark}
              style={{ "--o": order[e.id] ?? 0 } as CSSProperties}
            >
              <span className="ui-alc__icon" aria-hidden="true">
                {e.icon ?? firstLetter(e.system)}
              </span>
              <div className="ui-alc__main">
                <span className="ui-alc__what" title={e.target ? `${e.action} ${e.target}` : e.action}>
                  <span className="ui-alc__action" dir="auto">
                    {e.action}
                  </span>
                  {e.target && (
                    <span className="ui-alc__target" dir="auto">
                      {e.target}
                    </span>
                  )}
                  {/* The strike: a line drawn across what was done when it's undone */}
                  <span className="ui-alc__strike" aria-hidden="true" />
                </span>
                <span className="ui-alc__change" title={change ? `${change[0]} → ${change[1]}` : e.detail}>
                  {change ? (
                    <>
                      <span className="ui-alc__before" dir="auto">
                        {change[0]}
                      </span>
                      <span className="ui-alc__arrow" aria-label="to">
                        →
                      </span>
                      <span className="ui-alc__after" dir="auto">
                        {change[1]}
                      </span>
                    </>
                  ) : (
                    <span className="ui-alc__detail" dir="auto">
                      {e.detail}
                    </span>
                  )}
                </span>
              </div>

              {/* On the right, always one slot: the time – or Undo, Redo, and what an undo would do to this row */}
              <div className="ui-alc__end">
                {mark ? (
                  <span className="ui-alc__flag" data-kind={mark}>
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
                    <span className="ui-alc__time" data-hide={isUndone || !blocked ? "" : undefined}>
                      {isUndone ? (
                        "Undone"
                      ) : (
                        <>
                          {when(e.at, now)}
                          <span className="ui-alc__sys"> · {e.system}</span>
                        </>
                      )}
                    </span>
                    {isUndone ? (
                      <button type="button" className="ui-alc__act" onClick={() => redo(e)} aria-label={`Redo: ${e.action}${e.target ? ` ${e.target}` : ""}`}>
                        <RedoIcon />
                        <span className="ui-alc__act-label">Redo</span>
                      </button>
                    ) : blocked ? null : (
                      <button
                        type="button"
                        className="ui-alc__act"
                        onMouseEnter={() => setPreview(e.id)}
                        onMouseLeave={() => setPreview((p) => (p === e.id ? null : p))}
                        onFocus={() => setPreview(e.id)}
                        onBlur={() => setPreview((p) => (p === e.id ? null : p))}
                        onClick={() => undo(e)}
                        aria-label={`Undo: ${e.action}${e.target ? ` ${e.target}` : ""}${builtOn ? ` – and ${builtOn} that build on it` : ""}`}
                      >
                        <UndoIcon />
                        <span className="ui-alc__act-label">Undo</span>
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
/* Colors, sizes and motion as variables – override them on .ui-alc */
.ui-alc {
  --ui-alc-panel: #ffffff;
  --ui-alc-card: #ffffff;
  --ui-alc-strong: #000000;
  --ui-alc-ink: rgba(0, 0, 0, 0.88);
  --ui-alc-text: rgba(0, 0, 0, 0.61);
  --ui-alc-muted: rgba(0, 0, 0, 0.45);
  --ui-alc-faint: rgba(0, 0, 0, 0.27);
  --ui-alc-line: rgba(0, 0, 0, 0.06);
  --ui-alc-fill: rgba(0, 0, 0, 0.06);
  --ui-alc-accent: rgba(0, 96, 226, 0.765);
  --ui-alc-focus: rgba(0, 96, 226, 0.35);
  --ui-alc-undo-bg: rgba(0, 96, 226, 0.06);
  --ui-alc-also-bg: rgba(0, 96, 226, 0.045);
  --ui-alc-also-fg: #0058cf;
  --ui-alc-kept-bg: #ff9c0014;
  --ui-alc-kept-fg: #cc4e00;
  --ui-alc-ok-fg: #007d2ee0;
  --ui-alc-strike: rgba(0, 0, 0, 0.45);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-alc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-alc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  --ui-alc-row: 56px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container: ui-alc / inline-size;
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
.ui-alc svg { display: block; flex: none; }

/* ----- The bar: whose changes, how many ----- */
.ui-alc__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin-bottom: 16px; }
.ui-alc__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-alc-accent); }
.ui-alc__title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; color: var(--ui-alc-strong); }
.ui-alc__agent { min-width: 0; overflow: hidden; color: var(--ui-alc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-alc__sum { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-alc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-alc__sum b { font-weight: 500; color: var(--ui-alc-ink); }
.ui-alc__sum-undone { animation: ui-alc-fade 240ms ease both; }

/* ----- The white panel: one row per change, newest first ----- */
.ui-alc__panel { display: grid; margin: 0; padding: 4px; overflow: hidden; border-radius: 10px; background: var(--ui-alc-panel); box-shadow: var(--ui-alc-shadow); list-style: none; }
.ui-alc__row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; column-gap: 12px; height: var(--ui-alc-row); padding: 9px 12px 9px 10px; border-radius: 7px; transition: background-color 200ms ease; animation: ui-alc-grow 520ms var(--ui-alc-ease) backwards; }
/* A new change opens its row – the panel grows smoothly instead of jumping – and then fades in */
.ui-alc__row > * { animation: ui-alc-in 420ms var(--ui-alc-ease) 140ms backwards; }
.ui-alc__row[data-initial], .ui-alc__row[data-initial] > * { animation: none; }
.ui-alc__row + .ui-alc__row::before { content: ""; position: absolute; top: -0.25px; right: 12px; left: 50px; height: 0.5px; background: var(--ui-alc-line); }
.ui-alc__row:hover { background: rgba(0, 0, 0, 0.015); }
/* Pointing at Undo: this row and every change built on it light up */
.ui-alc__row[data-preview] { background: var(--ui-alc-undo-bg); }
.ui-alc__row[data-chain="also"] { background: var(--ui-alc-also-bg); }
.ui-alc__row[data-chain="kept"] { background: var(--ui-alc-kept-bg); }
.ui-alc__row:is([data-preview], [data-chain]) + .ui-alc__row::before, .ui-alc__row:is([data-preview], [data-chain])::before { opacity: 0; }

.ui-alc__icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: var(--ui-alc-card); box-shadow: var(--ui-alc-shadow); font-size: 12px; font-weight: 500; color: var(--ui-alc-text); transition: opacity 300ms ease, filter 300ms ease; }
.ui-alc__icon > svg { width: 14px; height: 14px; }

/* Two lines: what was done to what – then before → after */
.ui-alc__main { position: relative; display: grid; min-width: 0; }
.ui-alc__what { position: relative; display: flex; align-items: baseline; gap: 6px; justify-self: start; min-width: 0; max-width: 100%; white-space: nowrap; }
/* The target gives way first, then the action – both end in "…", the full line is in the tooltip */
.ui-alc__action { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 500; color: var(--ui-alc-ink); transition: color 300ms ease; }
.ui-alc__target { flex: 0 100 auto; min-width: 0; overflow: hidden; color: var(--ui-alc-text); text-overflow: ellipsis; transition: color 300ms ease; }
.ui-alc__change { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 12px; line-height: 17px; color: var(--ui-alc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Before gives way, the new value stays readable */
.ui-alc__before { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-decoration: line-through; text-decoration-color: var(--ui-alc-faint); }
.ui-alc__arrow { flex: none; color: var(--ui-alc-faint); }
.ui-alc__detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-alc__after { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--ui-alc-text); text-overflow: ellipsis; }

/* Undone: a line draws across the text, a beat after each other down the chain, and the row goes quiet */
.ui-alc__strike { position: absolute; top: 50%; left: -2px; width: calc(100% + 4px); height: 1px; border-radius: 1px; background: var(--ui-alc-strike); transform: scaleX(0); transform-origin: left; pointer-events: none; transition: transform 380ms var(--ui-alc-ease) calc(var(--o, 0) * 110ms); }
.ui-alc__row[data-undone] .ui-alc__strike { transform: scaleX(1); }
.ui-alc__row[data-undone] :is(.ui-alc__action, .ui-alc__target, .ui-alc__after) { color: var(--ui-alc-muted); transition-delay: calc(var(--o, 0) * 110ms); }
.ui-alc__row[data-undone] .ui-alc__icon { opacity: 0.5; filter: grayscale(1); transition-delay: calc(var(--o, 0) * 110ms); }

/* On the right: one slot – the time, or Undo / Redo on hover, or what an undo does to this row */
.ui-alc__end { position: relative; display: grid; justify-items: end; align-items: center; min-width: 108px; height: 24px; }
/* The time only shows – the buttons in the same slot sit on top and get every click */
.ui-alc__time { grid-area: 1 / 1; pointer-events: none; font-size: 12px; line-height: 16px; color: var(--ui-alc-muted); white-space: nowrap; font-variant-numeric: tabular-nums; transition: opacity 140ms ease; }
.ui-alc__row[data-undone] .ui-alc__time { color: var(--ui-alc-faint); }
.ui-alc__act { position: relative; z-index: 1; grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 5px; height: 24px; margin-right: -6px; padding: 0 7px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--ui-alc-ink); white-space: nowrap; opacity: 0; transition: opacity 140ms ease, background-color 140ms ease; }
.ui-alc__row:is(:hover, :focus-within) .ui-alc__time[data-hide] { opacity: 0; }
.ui-alc__row:is(:hover, :focus-within, [data-preview]) .ui-alc__act { opacity: 1; }
.ui-alc__row[data-preview] .ui-alc__time[data-hide] { opacity: 0; }
.ui-alc__row[data-preview] .ui-alc__act { background: rgba(0, 96, 226, 0.09); color: var(--ui-alc-also-fg); }
.ui-alc__act:hover { background: var(--ui-alc-fill); }
.ui-alc__flag { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 7px; border-radius: 5px; font-size: 11.5px; font-weight: 500; line-height: 20px; white-space: nowrap; animation: ui-alc-fade 160ms ease both; }
.ui-alc__flag[data-kind="also"] { background: rgba(0, 96, 226, 0.09); color: var(--ui-alc-also-fg); }
.ui-alc__flag[data-kind="kept"] { background: #ff9c0026; color: var(--ui-alc-kept-fg); }

/* ----- Narrow: smaller gaps, the system's name drops from the time ----- */
@container ui-alc (max-width: 480px) {
  .ui-alc__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-alc__row { column-gap: 10px; padding: 9px 8px 9px 8px; }
  .ui-alc__row + .ui-alc__row::before { left: 46px; right: 8px; }
  .ui-alc__end { min-width: 64px; }
  /* The logo already says where – the time stands alone */
  .ui-alc__sys { display: none; }
  /* Undo and Redo shrink to their icon – the label stays for screen readers */
  .ui-alc__act { width: 28px; justify-content: center; padding: 0; }
  .ui-alc__act-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
/* Touch screens can't point: Undo and Redo show on every row, in place of the time */
@media (hover: none) {
  .ui-alc__act { opacity: 1; }
  .ui-alc__time[data-hide] { opacity: 0; }
}

@keyframes ui-alc-grow { from { height: 0; padding-top: 0; padding-bottom: 0; } }
@keyframes ui-alc-in { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ui-alc-fade { from { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-alc *, .ui-alc *::before, .ui-alc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-alc {
  --ui-alc-panel: #1c1c1f;
  --ui-alc-card: #232326;
  --ui-alc-strong: #ffffff;
  --ui-alc-ink: rgba(255, 255, 255, 0.9);
  --ui-alc-text: rgba(255, 255, 255, 0.62);
  --ui-alc-muted: rgba(255, 255, 255, 0.45);
  --ui-alc-faint: rgba(255, 255, 255, 0.28);
  --ui-alc-line: rgba(255, 255, 255, 0.08);
  --ui-alc-fill: rgba(255, 255, 255, 0.08);
  --ui-alc-accent: #5b9aff;
  --ui-alc-focus: rgba(91, 154, 255, 0.45);
  --ui-alc-undo-bg: rgba(91, 154, 255, 0.1);
  --ui-alc-also-bg: rgba(91, 154, 255, 0.07);
  --ui-alc-also-fg: #8ab8ff;
  --ui-alc-kept-bg: rgba(255, 160, 40, 0.09);
  --ui-alc-kept-fg: #ffb357;
  --ui-alc-ok-fg: #3dd68c;
  --ui-alc-strike: rgba(255, 255, 255, 0.5);
  --ui-alc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
`;
