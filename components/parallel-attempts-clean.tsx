"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Parallel Attempts – an agent tries the same task several ways at once and the best one wins, in a single
 * self-contained file. Like a race: every attempt is a card of its own – its model's logo, its approach and a bar that
 * grows while it works; when they're through, each one has a score, the best is marked and picked – and you can pick
 * another.
 *   · every row keeps its height: what it does right now turns into its outcome in place, nothing jumps
 *   · bars are tinted by state: running blue with a sweeping shine and a soft glow at its edge, done green,
 *     failed red – a failed one stops where it failed
 *   · the best finished attempt is marked "Best", picked on its own and gets a soft green wash, unless you pick
 *     another – point at a finished row and "Use this one" takes the place of its time and cost
 * The styles are injected below, so no extra files are needed.
 */

export type AttemptStatus = "running" | "done" | "failed";

export type Attempt = {
  id: string;
  /** A short name – e.g. "Attempt A" */
  name: string;
  /** How this one goes about it, in a few words – e.g. "Mock the payment API" */
  approach: string;
  /** The model behind it – shown after the name */
  model?: string;
  /** A small mark, e.g. the model maker's logo */
  icon?: ReactNode;
  status: AttemptStatus;
  /** How far it is, 0 to 1 – the bar's length while it runs */
  progress?: number;
  /** What it does right now, while it runs – e.g. "Running tests 12/20" */
  step?: string;
  /** 0–100 once done – the highest finished score is the best */
  score?: number;
  /** One line about the outcome – e.g. "20/20 runs green" or the error */
  note?: string;
  /** How long it took, in ms */
  took?: number;
  cost?: number;
};

export type ParallelAttemptsProps = {
  attempts: Attempt[];
  /** What all of them try to do – e.g. "Fix the flaky checkout test" */
  task?: string;
  /** Controlled pick – defaults to the best finished attempt */
  picked?: string | null;
  onPick?: (attempt: Attempt) => void;
  /** Formats every cost – defaults to dollars, e.g. "$0.31" */
  formatCost?: (amount: number) => string;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const SEC = 1000;
const dollars = (n: number): string => {
  if (n < 0) return `-${dollars(-n)}`;
  return n === 0 ? "$0" : n < 0.001 ? "<$0.001" : n < 0.01 ? `$${n.toFixed(3)}` : n < 100 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`;
};
const pad = (n: number) => String(n).padStart(2, "0");
const took = (ms: number) => {
  if (ms < SEC) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 10 * SEC) return `${(ms / SEC).toFixed(1)}s`;
  const s = Math.round(ms / SEC);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
/** A number the card can show – NaN and Infinity count as not given */
const num = (n?: number) => (n !== undefined && Number.isFinite(n) ? n : undefined);
const count = new Intl.NumberFormat("en");
/** The first whole letter or digit – never half an emoji */
const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase();
const STATUS: Record<AttemptStatus, string> = { running: "Running", done: "Done", failed: "Failed" };

/* ---------- Icons ---------- */

/* Three lanes and a finish mark for the title (drawn for affectUI) */
const RaceMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.5" y="2.5" width="9" height="2.4" rx="1.2" fill="currentColor" />
    <rect x="1.5" y="6.8" width="12" height="2.4" rx="1.2" fill="currentColor" opacity="0.55" />
    <rect x="1.5" y="11.1" width="6" height="2.4" rx="1.2" fill="currentColor" opacity="0.3" />
  </svg>
);
/* Tick: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const Tick = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
  </svg>
);

export function ParallelAttempts({ attempts, task, picked: pickedProp, onPick, formatCost = dollars, title, className }: ParallelAttemptsProps) {
  const [own, setOwn] = useState<string | null>(null);
  const label = useId();

  const finished = attempts.filter((a) => a.status !== "running");
  const done = attempts.filter((a) => a.status === "done");
  const best = done.reduce<Attempt | undefined>((b, a) => (b === undefined || (num(a.score) ?? 0) > (num(b.score) ?? 0) ? a : b), undefined);
  const settled = finished.length === attempts.length && attempts.length > 0;
  // The best one is picked on its own once all are through – unless you picked one yourself
  const picked = pickedProp !== undefined ? pickedProp : (own ?? (settled ? (best?.id ?? null) : null));
  const cost = attempts.reduce((sum, a) => sum + (num(a.cost) ?? 0), 0);
  const pick = (a: Attempt) => {
    setOwn(a.id);
    onPick?.(a);
  };

  return (
    <div className={["ui-pac", className].filter(Boolean).join(" ")}>
      <style href="ui-parallel-attempts-clean" precedence="default">
        {css}
      </style>

      <header className="ui-pac__bar">
        <span className="ui-pac__mark">
          <RaceMark />
        </span>
        <span className="ui-pac__title" id={label} dir="auto" title={title}>
          {title ?? `Best of ${count.format(attempts.length)}`}
        </span>
        {task && (
          <span className="ui-pac__task" dir="auto" title={task}>
            {task}
          </span>
        )}
        <span className="ui-pac__sum">
          <span>
            <b>{count.format(finished.length)}</b> of {count.format(attempts.length)} done
          </span>
          <span>
            <b>{formatCost(cost)}</b>
          </span>
        </span>
      </header>

      <div className="ui-pac__panel" role="radiogroup" aria-labelledby={label}>
        {attempts.map((a, i) => {
          const isBest = settled && a.id === best?.id;
          const isPicked = a.id === picked;
          const line = a.status === "running" ? a.step ?? "Working…" : a.note ?? STATUS[a.status];
          const progress = a.status === "done" ? 1 : Math.max(0.03, Math.min(1, num(a.progress) ?? 0));
          const score = num(a.score);
          const meta = [num(a.took) !== undefined ? took(a.took!) : undefined, num(a.cost) !== undefined ? formatCost(a.cost!) : undefined].filter(Boolean).join(" · ");
          return (
            <div
              key={a.id}
              className="ui-pac__row"
              data-status={a.status}
              data-best={isBest ? "" : undefined}
              data-picked={isPicked ? "" : undefined}
              data-quiet={settled && picked && !isPicked ? "" : undefined}
              style={{ "--i": i, "--p": progress } as CSSProperties}
            >
              {/* Two lines, always: what and how – then what it does right now, which turns into how it went */}
              <span className="ui-pac__icon" aria-hidden="true">
                {a.icon ?? initial(a.name)}
              </span>
              <div className="ui-pac__who">
                <span className="ui-pac__name" title={[a.name, a.model, a.approach].filter(Boolean).join(" · ")}>
                  <span className="ui-pac__name-text" dir="auto">
                    {a.name}
                  </span>
                  {a.model && <span className="ui-pac__model">{a.model}</span>}
                  {a.approach && (
                    <span className="ui-pac__approach" dir="auto">
                      {a.approach}
                    </span>
                  )}
                </span>
                <span className="ui-pac__line" key={a.status} dir="auto" title={line}>
                  {line}
                </span>
              </div>

              <div className="ui-pac__lane" aria-hidden="true">
                <span className="ui-pac__fill" />
              </div>

              <div className="ui-pac__end">
                <span className="ui-pac__score" key={a.status}>
                  {a.status === "running" ? (
                    <span className="ui-pac__pct">{Math.round(progress * 100)}%</span>
                  ) : a.status === "failed" ? (
                    <span className="ui-pac__failed">Failed</span>
                  ) : (
                    <>
                      {isBest && <span className="ui-pac__best">Best</span>}
                      {score !== undefined ? Math.round(score) : STATUS.done}
                    </>
                  )}
                </span>
                <span className="ui-pac__meta-slot">
                  <span className="ui-pac__meta" data-hide={a.status === "done" && (isPicked || settled) ? "" : undefined}>
                    {meta}
                  </span>
                  {a.status === "done" && settled && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      className="ui-pac__use"
                      data-on={isPicked ? "" : undefined}
                      onClick={() => pick(a)}
                      aria-label={`${isPicked ? "Using" : "Use"} ${a.name}${score !== undefined ? `, score ${Math.round(score)}` : ""}`}
                    >
                      {isPicked ? (
                        <>
                          <Tick />
                          In use
                        </>
                      ) : (
                        "Use this one"
                      )}
                    </button>
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-pac */
.ui-pac {
  --ui-pac-panel: #ffffff;
  --ui-pac-card: #ffffff;
  --ui-pac-strong: #000000;
  --ui-pac-ink: rgba(0, 0, 0, 0.88);
  --ui-pac-text: rgba(0, 0, 0, 0.61);
  --ui-pac-muted: rgba(0, 0, 0, 0.45);
  --ui-pac-faint: rgba(0, 0, 0, 0.27);
  --ui-pac-line: rgba(0, 0, 0, 0.06);
  --ui-pac-fill: rgba(0, 0, 0, 0.06);
  --ui-pac-track: rgba(0, 0, 0, 0.035);
  --ui-pac-accent: rgba(0, 96, 226, 0.765);
  --ui-pac-focus: rgba(0, 96, 226, 0.35);
  /* Bars by state: a tint, its edge and the ink – the Trace Waterfall bar recipe */
  --ui-pac-running-bg: rgba(0, 96, 226, 0.12);
  --ui-pac-running-edge: rgba(0, 96, 226, 0.34);
  --ui-pac-running-ink: #0058cf;
  --ui-pac-done-bg: rgba(0, 164, 51, 0.14);
  --ui-pac-done-edge: rgba(0, 140, 50, 0.32);
  --ui-pac-done-ink: #007d2ee0;
  --ui-pac-failed-bg: #f52b0020;
  --ui-pac-failed-edge: rgba(215, 36, 0, 0.36);
  --ui-pac-failed-ink: #d72400da;
  --ui-pac-best-bg: rgba(0, 164, 51, 0.24);
  --ui-pac-best-edge: rgba(0, 140, 50, 0.48);
  --ui-pac-shine: rgba(255, 255, 255, 0.85);
  --ui-pac-wash: rgba(0, 164, 51, 0.035);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-pac-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-pac-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container: ui-pac / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-pac-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pac *, .ui-pac *::before, .ui-pac *::after { box-sizing: border-box; }
:where(.ui-pac) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-pac button:focus-visible { outline: 2px solid var(--ui-pac-focus); outline-offset: 1px; }
.ui-pac svg { display: block; flex: none; }

/* ----- The bar: what they try, how many are through ----- */
.ui-pac__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin-bottom: 16px; }
.ui-pac__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-pac-accent); }
.ui-pac__title { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 500; color: var(--ui-pac-strong); }
.ui-pac__task { min-width: 0; overflow: hidden; color: var(--ui-pac-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-pac__sum { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-pac-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-pac__sum b { font-weight: 500; color: var(--ui-pac-ink); }

/* ----- The white panel: one row per attempt ----- */
/* One card per attempt, a little space between them */
.ui-pac__panel { display: grid; gap: 8px; }
.ui-pac__row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(120px, 36%) minmax(96px, auto); align-items: center; column-gap: 14px; padding: 12px 16px 12px 12px; border-radius: 10px; background: var(--ui-pac-panel); box-shadow: var(--ui-pac-shadow); transition: opacity 320ms ease, background-color 500ms ease, box-shadow 300ms ease; animation: ui-pac-in 420ms var(--ui-pac-ease) calc(min(var(--i, 0), 12) * 70ms) backwards; }
.ui-pac__row > .ui-pac__lane { margin-left: 6px; }
/* The model's logo on a small square tile */
.ui-pac__icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: var(--ui-pac-card); box-shadow: var(--ui-pac-shadow); font-size: 12px; font-weight: 500; color: var(--ui-pac-text); }
.ui-pac__icon > svg { width: 14px; height: 14px; }
/* The one in use gets a soft wash; once one is picked, the others step back a little */
.ui-pac__row[data-picked] { background: linear-gradient(var(--ui-pac-wash), var(--ui-pac-wash)), var(--ui-pac-panel); box-shadow: var(--ui-pac-shadow), 0 0 0 0.5px var(--ui-pac-done-edge); }
.ui-pac__row[data-quiet] { opacity: 0.5; }
.ui-pac__row[data-quiet]:hover, .ui-pac__row[data-quiet]:focus-within { opacity: 1; }

/* Two lines, always the same height */
.ui-pac__who { display: grid; min-width: 0; }
.ui-pac__name { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 500; line-height: 20px; color: var(--ui-pac-ink); white-space: nowrap; }
.ui-pac__model { flex: 0 10 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 400; color: var(--ui-pac-muted); }
.ui-pac__name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pac__approach { flex: 0 100 auto; min-width: 0; overflow: hidden; font-weight: 400; color: var(--ui-pac-muted); text-overflow: ellipsis; }
.ui-pac__approach::before { content: "·"; margin-right: 6px; color: var(--ui-pac-faint); }
.ui-pac__line { overflow: hidden; font-size: 12px; line-height: 18px; color: var(--ui-pac-text); white-space: nowrap; text-overflow: ellipsis; animation: ui-pac-fade 320ms ease both; }
.ui-pac__row[data-status="running"] .ui-pac__line { color: var(--k-ink); }
.ui-pac__row[data-status="failed"] .ui-pac__line { color: var(--ui-pac-failed-ink); }

/* The bar: a tint with a hairline edge; running, a shine sweeps over it and its leading edge glows */
.ui-pac__lane { position: relative; height: 8px; border-radius: 4px; background: var(--ui-pac-track); }
.ui-pac__fill { position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%); border-radius: 4px; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); overflow: hidden; transition: width 600ms var(--ui-pac-ease), background-color 400ms ease, box-shadow 400ms ease; }
.ui-pac__row[data-status="running"] .ui-pac__fill::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 60px; background: linear-gradient(90deg, transparent, var(--ui-pac-shine), transparent); opacity: 0.8; animation: ui-pac-sweep 1500ms linear infinite; }
.ui-pac__row[data-status="running"] .ui-pac__fill::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 24px; background: linear-gradient(90deg, transparent, var(--k-edge)); animation: ui-pac-glow 1100ms ease-in-out infinite alternate; }
.ui-pac__row[data-best] .ui-pac__fill { background: var(--ui-pac-best-bg); box-shadow: inset 0 0 0 0.5px var(--ui-pac-best-edge); }

/* On the right: the share done, then the score (or Failed) – and under it time and cost, or the pick */
.ui-pac__end { display: grid; justify-items: end; min-width: 0; text-align: right; }
.ui-pac__score { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-pac-ink); font-variant-numeric: tabular-nums; animation: ui-pac-fade 320ms ease both; }
.ui-pac__pct { font-weight: 400; color: var(--ui-pac-muted); }
.ui-pac__failed { color: var(--ui-pac-failed-ink); }
.ui-pac__best { height: 18px; padding: 0 6px; border-radius: 4px; background: var(--ui-pac-done-bg); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-pac-done-ink); animation: ui-pac-pop 420ms var(--ui-pac-ease) both; }
.ui-pac__meta-slot { position: relative; display: grid; justify-items: end; height: 18px; }
.ui-pac__meta { font-size: 12px; line-height: 18px; color: var(--ui-pac-muted); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity 160ms ease; }
.ui-pac__use { position: absolute; top: -3px; right: -6px; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 6px; font-size: 12px; font-weight: 500; color: var(--ui-pac-text); white-space: nowrap; opacity: 0; transition: opacity 160ms ease, background-color 160ms ease, color 160ms ease; }
/* Pointing at a finished row: its time and cost make room for "Use this one" – the one in use says so */
.ui-pac__row:hover .ui-pac__meta[data-hide], .ui-pac__row:focus-within .ui-pac__meta[data-hide], .ui-pac__row[data-picked] .ui-pac__meta[data-hide] { opacity: 0; }
.ui-pac__row:hover .ui-pac__use, .ui-pac__use:focus-visible, .ui-pac__use[data-on] { opacity: 1; }
.ui-pac__use:hover { background: var(--ui-pac-fill); color: var(--ui-pac-ink); }
.ui-pac__use[data-on] { color: var(--ui-pac-done-ink); cursor: default; }
.ui-pac__use[data-on]:hover { background: none; }

/* Every state's colors in one place */
.ui-pac [data-status="running"] { --k-bg: var(--ui-pac-running-bg); --k-edge: var(--ui-pac-running-edge); --k-ink: var(--ui-pac-running-ink); }
.ui-pac [data-status="done"] { --k-bg: var(--ui-pac-done-bg); --k-edge: var(--ui-pac-done-edge); --k-ink: var(--ui-pac-done-ink); }
.ui-pac [data-status="failed"] { --k-bg: var(--ui-pac-failed-bg); --k-edge: var(--ui-pac-failed-edge); --k-ink: var(--ui-pac-failed-ink); }
.ui-pac__row[data-best] { --k-bg: var(--ui-pac-best-bg); --k-edge: var(--ui-pac-best-edge); }

/* ----- Narrow: the bar under the name, the score beside it ----- */
@container ui-pac (max-width: 560px) {
  .ui-pac__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-pac__row { grid-template-columns: 28px minmax(0, 1fr) minmax(84px, auto); grid-template-areas: "icon who end" "lane lane lane"; row-gap: 12px; column-gap: 12px; padding: 12px 14px 14px 12px; }
  .ui-pac__icon { grid-area: icon; }
  .ui-pac__who { grid-area: who; }
  .ui-pac__end { grid-area: end; }
  .ui-pac__row > .ui-pac__lane { grid-area: lane; margin-left: 0; }
  .ui-pac__approach { display: none; }
  /* The step and the outcome get two lines here – always reserved, so nothing jumps when one turns into the other */
  .ui-pac__line { display: -webkit-box; min-height: 36px; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
}

@keyframes ui-pac-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes ui-pac-fade { from { opacity: 0; } }
@keyframes ui-pac-pop { 0% { opacity: 0; transform: scale(0.8); } 60% { opacity: 1; transform: scale(1.06); } 100% { transform: scale(1); } }
@keyframes ui-pac-sweep { from { transform: translateX(-60px); } to { transform: translateX(900px); } }
@keyframes ui-pac-glow { from { opacity: 0.45; } to { opacity: 1; } }

/* Touch screens can't point: "Use this one" shows on every finished card, in place of its time and cost */
@media (hover: none) {
  .ui-pac__use { opacity: 1; }
  .ui-pac__meta[data-hide] { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pac *, .ui-pac *::before, .ui-pac *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pac {
  --ui-pac-panel: #1c1c1f;
  --ui-pac-card: #232326;
  --ui-pac-strong: #ffffff;
  --ui-pac-ink: rgba(255, 255, 255, 0.9);
  --ui-pac-text: rgba(255, 255, 255, 0.62);
  --ui-pac-muted: rgba(255, 255, 255, 0.45);
  --ui-pac-faint: rgba(255, 255, 255, 0.28);
  --ui-pac-line: rgba(255, 255, 255, 0.08);
  --ui-pac-fill: rgba(255, 255, 255, 0.08);
  --ui-pac-track: rgba(255, 255, 255, 0.05);
  --ui-pac-accent: #5b9aff;
  --ui-pac-focus: rgba(91, 154, 255, 0.45);
  --ui-pac-running-bg: rgba(60, 130, 255, 0.24);
  --ui-pac-running-edge: rgba(112, 170, 255, 0.5);
  --ui-pac-running-ink: #8ab8ff;
  --ui-pac-done-bg: rgba(40, 200, 110, 0.2);
  --ui-pac-done-edge: rgba(60, 220, 130, 0.4);
  --ui-pac-done-ink: #3dd68c;
  --ui-pac-failed-bg: rgba(255, 70, 50, 0.22);
  --ui-pac-failed-edge: rgba(255, 110, 90, 0.48);
  --ui-pac-failed-ink: #ff977d;
  --ui-pac-best-bg: rgba(40, 200, 110, 0.32);
  --ui-pac-best-edge: rgba(60, 220, 130, 0.6);
  --ui-pac-shine: rgba(255, 255, 255, 0.3);
  --ui-pac-wash: rgba(40, 200, 110, 0.06);
  --ui-pac-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
`;
