"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Parallel Attempts – an agent tries the same task several ways at once and the best one wins, in a single
 * self-contained file. A soft gray tray with the task, and on it, like a race, every attempt as a white card of its own – its model's logo, its approach and a bar that
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
    <div className={["ui-pa", className].filter(Boolean).join(" ")}>
      <style href="ui-parallel-attempts" precedence="default">
        {css}
      </style>

      <header className="ui-pa__bar">
        <span className="ui-pa__mark">
          <RaceMark />
        </span>
        <span className="ui-pa__title" id={label} dir="auto" title={title}>
          {title ?? `Best of ${count.format(attempts.length)}`}
        </span>
        {task && (
          <span className="ui-pa__task" dir="auto" title={task}>
            {task}
          </span>
        )}
        <span className="ui-pa__sum">
          <span>
            <b>{count.format(finished.length)}</b> of {count.format(attempts.length)} done
          </span>
          <span>
            <b>{formatCost(cost)}</b>
          </span>
        </span>
      </header>

      <div className="ui-pa__panel" role="radiogroup" aria-labelledby={label}>
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
              className="ui-pa__row"
              data-status={a.status}
              data-best={isBest ? "" : undefined}
              data-picked={isPicked ? "" : undefined}
              data-quiet={settled && picked && !isPicked ? "" : undefined}
              style={{ "--i": i, "--p": progress } as CSSProperties}
            >
              {/* Two lines, always: what and how – then what it does right now, which turns into how it went */}
              <span className="ui-pa__icon" aria-hidden="true">
                {a.icon ?? initial(a.name)}
              </span>
              <div className="ui-pa__who">
                <span className="ui-pa__name" title={[a.name, a.model, a.approach].filter(Boolean).join(" · ")}>
                  <span className="ui-pa__name-text" dir="auto">
                    {a.name}
                  </span>
                  {a.model && <span className="ui-pa__model">{a.model}</span>}
                  {a.approach && (
                    <span className="ui-pa__approach" dir="auto">
                      {a.approach}
                    </span>
                  )}
                </span>
                <span className="ui-pa__line" key={a.status} dir="auto" title={line}>
                  {line}
                </span>
              </div>

              <div className="ui-pa__lane" aria-hidden="true">
                <span className="ui-pa__fill" />
              </div>

              <div className="ui-pa__end">
                <span className="ui-pa__score" key={a.status}>
                  {a.status === "running" ? (
                    <span className="ui-pa__pct">{Math.round(progress * 100)}%</span>
                  ) : a.status === "failed" ? (
                    <span className="ui-pa__failed">Failed</span>
                  ) : (
                    <>
                      {isBest && <span className="ui-pa__best">Best</span>}
                      {score !== undefined ? Math.round(score) : STATUS.done}
                    </>
                  )}
                </span>
                <span className="ui-pa__meta-slot">
                  <span className="ui-pa__meta" data-hide={a.status === "done" && (isPicked || settled) ? "" : undefined}>
                    {meta}
                  </span>
                  {a.status === "done" && settled && (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isPicked}
                      className="ui-pa__use"
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
/* Colors, sizes and motion as variables – override them on .ui-pa */
.ui-pa {
  --ui-pa-tray: #f0f0f0;
  --ui-pa-panel: #ffffff;
  --ui-pa-card: #ffffff;
  --ui-pa-strong: #171717;
  --ui-pa-ink: #171717;
  --ui-pa-text: #6b6b6b;
  --ui-pa-muted: #8a8a8a;
  --ui-pa-faint: #c2c2c2;
  --ui-pa-line: #ececec;
  --ui-pa-fill: rgba(0, 0, 0, 0.05);
  --ui-pa-track: #f2f2f2;
  --ui-pa-accent: #2f6bff;
  --ui-pa-focus: rgba(23, 23, 23, 0.22);
  /* Bars by state: a tint, its edge and the ink */
  --ui-pa-running-bg: #e3ecff;
  --ui-pa-running-edge: #a9c2ff;
  --ui-pa-running-ink: #2456d6;
  --ui-pa-done-bg: #dcf3e4;
  --ui-pa-done-edge: #9fd9b4;
  --ui-pa-done-ink: #1a7f45;
  --ui-pa-failed-bg: #fde3df;
  --ui-pa-failed-edge: #f1a397;
  --ui-pa-failed-ink: #c2331f;
  --ui-pa-best-bg: #c4ebd1;
  --ui-pa-best-edge: #6fc590;
  --ui-pa-shine: rgba(255, 255, 255, 0.9);
  --ui-pa-wash: #f3fbf6;
  --ui-pa-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-pa-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-pa-tray);
  container: ui-pa / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-pa-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pa *, .ui-pa *::before, .ui-pa *::after { box-sizing: border-box; }
:where(.ui-pa) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-pa button:focus-visible { outline: 2px solid var(--ui-pa-focus); outline-offset: 1px; }
.ui-pa svg { display: block; flex: none; }

/* ----- On the tray: what they try, how many are through ----- */
.ui-pa__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 8px 12px 12px; }
.ui-pa__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-pa-accent); }
.ui-pa__title { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-pa-strong); }
.ui-pa__task { min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-pa-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-pa__sum { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ui-pa-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-pa__sum b { font-weight: 600; color: var(--ui-pa-ink); }

/* ----- One white card per attempt, stacked on the tray ----- */
.ui-pa__panel { display: grid; gap: 4px; }
.ui-pa__row { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) minmax(120px, 36%) minmax(100px, auto); align-items: center; column-gap: 14px; padding: 14px 18px 14px 14px; border-radius: 16px; background: var(--ui-pa-panel); box-shadow: var(--ui-pa-shadow); transition: opacity 320ms ease, background-color 500ms ease, box-shadow 300ms ease; animation: ui-pa-in 420ms var(--ui-pa-ease) calc(min(var(--i, 0), 12) * 70ms) backwards; }
.ui-pa__row > .ui-pa__lane { margin-left: 6px; }
/* The model's logo on a small square tile */
.ui-pa__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--ui-pa-card); box-shadow: var(--ui-pa-shadow); font-size: 13px; font-weight: 600; color: var(--ui-pa-text); }
.ui-pa__icon > svg { width: 16px; height: 16px; }
/* The one in use gets a soft green wash and edge; once one is picked, the others step back a little */
.ui-pa__row[data-picked] { background: var(--ui-pa-wash); box-shadow: 0 0 0 1px var(--ui-pa-done-edge), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-pa__row[data-quiet] { opacity: 0.55; }
.ui-pa__row[data-quiet]:hover, .ui-pa__row[data-quiet]:focus-within { opacity: 1; }

/* Two lines, always the same height */
.ui-pa__who { display: grid; min-width: 0; }
.ui-pa__name { display: flex; align-items: baseline; gap: 6px; min-width: 0; font-weight: 600; line-height: 20px; color: var(--ui-pa-ink); white-space: nowrap; }
.ui-pa__model { flex: 0 10 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 400; color: var(--ui-pa-muted); }
.ui-pa__name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pa__approach { flex: 0 100 auto; min-width: 0; overflow: hidden; font-weight: 400; color: var(--ui-pa-muted); text-overflow: ellipsis; }
.ui-pa__approach::before { content: "·"; margin-right: 6px; color: var(--ui-pa-faint); }
.ui-pa__line { overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-pa-text); white-space: nowrap; text-overflow: ellipsis; animation: ui-pa-fade 320ms ease both; }
.ui-pa__row[data-status="running"] .ui-pa__line { color: var(--k-ink); }
.ui-pa__row[data-status="failed"] .ui-pa__line { color: var(--ui-pa-failed-ink); }

/* The bar: a tint with an edge; running, a shine sweeps over it and its leading edge glows */
.ui-pa__lane { position: relative; height: 10px; border-radius: 5px; background: var(--ui-pa-track); }
.ui-pa__fill { position: absolute; inset: 0 auto 0 0; width: calc(var(--p) * 100%); border-radius: 5px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); overflow: hidden; transition: width 600ms var(--ui-pa-ease), background-color 400ms ease, box-shadow 400ms ease; }
.ui-pa__row[data-status="running"] .ui-pa__fill::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 60px; background: linear-gradient(90deg, transparent, var(--ui-pa-shine), transparent); opacity: 0.85; animation: ui-pa-sweep 1500ms linear infinite; }
.ui-pa__row[data-status="running"] .ui-pa__fill::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 24px; background: linear-gradient(90deg, transparent, var(--k-edge)); animation: ui-pa-glow 1100ms ease-in-out infinite alternate; }
.ui-pa__row[data-best] .ui-pa__fill { background: var(--ui-pa-best-bg); box-shadow: inset 0 0 0 1px var(--ui-pa-best-edge); }

/* On the right: the share done, then the score (or Failed) – and under it time and cost, or the pick */
.ui-pa__end { display: grid; justify-items: end; min-width: 0; text-align: right; }
.ui-pa__score { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 600; line-height: 20px; color: var(--ui-pa-ink); font-variant-numeric: tabular-nums; animation: ui-pa-fade 320ms ease both; }
.ui-pa__pct { font-weight: 400; color: var(--ui-pa-muted); }
.ui-pa__failed { font-weight: 500; color: var(--ui-pa-failed-ink); }
.ui-pa__best { height: 20px; padding: 0 8px; border-radius: 999px; background: var(--ui-pa-done-bg); font-size: 12px; font-weight: 500; line-height: 20px; color: var(--ui-pa-done-ink); animation: ui-pa-pop 420ms var(--ui-pa-ease) both; }
.ui-pa__meta-slot { position: relative; display: grid; justify-items: end; height: 19px; }
.ui-pa__meta { font-size: 13px; line-height: 19px; color: var(--ui-pa-muted); font-variant-numeric: tabular-nums; white-space: nowrap; transition: opacity 160ms ease; }
.ui-pa__use { position: absolute; top: -4px; right: -8px; display: inline-flex; align-items: center; gap: 4px; height: 26px; padding: 0 9px; border-radius: 999px; font-size: 13px; font-weight: 500; color: var(--ui-pa-text); white-space: nowrap; opacity: 0; transition: opacity 160ms ease, background-color 160ms ease, color 160ms ease; }
/* Pointing at a finished card: its time and cost make room for "Use this one" – the one in use says so */
.ui-pa__row:hover .ui-pa__meta[data-hide], .ui-pa__row:focus-within .ui-pa__meta[data-hide], .ui-pa__row[data-picked] .ui-pa__meta[data-hide] { opacity: 0; }
.ui-pa__row:hover .ui-pa__use, .ui-pa__use:focus-visible, .ui-pa__use[data-on] { opacity: 1; }
.ui-pa__use:hover { background: var(--ui-pa-fill); color: var(--ui-pa-ink); }
.ui-pa__use[data-on] { color: var(--ui-pa-done-ink); cursor: default; }
.ui-pa__use[data-on]:hover { background: none; }

/* Every state's colors in one place */
.ui-pa [data-status="running"] { --k-bg: var(--ui-pa-running-bg); --k-edge: var(--ui-pa-running-edge); --k-ink: var(--ui-pa-running-ink); }
.ui-pa [data-status="done"] { --k-bg: var(--ui-pa-done-bg); --k-edge: var(--ui-pa-done-edge); --k-ink: var(--ui-pa-done-ink); }
.ui-pa [data-status="failed"] { --k-bg: var(--ui-pa-failed-bg); --k-edge: var(--ui-pa-failed-edge); --k-ink: var(--ui-pa-failed-ink); }

/* ----- Narrow: the bar under the name, the score beside it ----- */
@container ui-pa (max-width: 560px) {
  .ui-pa__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-pa__row { grid-template-columns: 32px minmax(0, 1fr) minmax(88px, auto); grid-template-areas: "icon who end" "lane lane lane"; row-gap: 12px; column-gap: 12px; padding: 14px 16px 16px 14px; }
  .ui-pa__icon { grid-area: icon; }
  .ui-pa__who { grid-area: who; }
  .ui-pa__end { grid-area: end; }
  .ui-pa__row > .ui-pa__lane { grid-area: lane; margin-left: 0; }
  .ui-pa__approach { display: none; }
  /* The step and the outcome get two lines here – always reserved, so nothing jumps when one turns into the other */
  .ui-pa__line { display: -webkit-box; min-height: 38px; white-space: normal; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
}

@keyframes ui-pa-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes ui-pa-fade { from { opacity: 0; } }
@keyframes ui-pa-pop { 0% { opacity: 0; transform: scale(0.8); } 60% { opacity: 1; transform: scale(1.06); } 100% { transform: scale(1); } }
@keyframes ui-pa-sweep { from { transform: translateX(-60px); } to { transform: translateX(900px); } }
@keyframes ui-pa-glow { from { opacity: 0.45; } to { opacity: 1; } }

/* Touch screens can't point: "Use this one" shows on every finished card, in place of its time and cost */
@media (hover: none) {
  .ui-pa__use { opacity: 1; }
  .ui-pa__meta[data-hide] { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pa *, .ui-pa *::before, .ui-pa *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pa {
  --ui-pa-tray: #1a1a1c;
  --ui-pa-panel: #232326;
  --ui-pa-card: #2a2a2e;
  --ui-pa-strong: #f5f5f5;
  --ui-pa-ink: #f0f0f0;
  --ui-pa-text: #a1a1a1;
  --ui-pa-muted: #8a8a8a;
  --ui-pa-faint: #5c5c5c;
  --ui-pa-line: #2e2e31;
  --ui-pa-fill: rgba(255, 255, 255, 0.06);
  --ui-pa-track: #2b2b2f;
  --ui-pa-accent: #6d93ff;
  --ui-pa-focus: rgba(255, 255, 255, 0.3);
  --ui-pa-running-bg: #1d2b4d;
  --ui-pa-running-edge: #3c5fb3;
  --ui-pa-running-ink: #8aaeff;
  --ui-pa-done-bg: #15321f;
  --ui-pa-done-edge: #2f7a4b;
  --ui-pa-done-ink: #55d68c;
  --ui-pa-failed-bg: #3d1a16;
  --ui-pa-failed-edge: #8f3a2e;
  --ui-pa-failed-ink: #ff8a76;
  --ui-pa-best-bg: #1d4a2d;
  --ui-pa-best-edge: #3f9a62;
  --ui-pa-shine: rgba(255, 255, 255, 0.28);
  --ui-pa-wash: #1c2b22;
  --ui-pa-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
}
`;
