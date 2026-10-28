"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * Fallback Chain – one request finding a model that answers, drawn as a small flow diagram, in a single self-contained file.
 * The request sits on the left and branches out to every model in its fallback order; every model has a line on to
 * the response on the right. A soft light runs along the branch to the model being tried; when that model fails
 * (rate limited, timed out, down) its branch turns into a red dashed line and the next one is tried – until one
 * answers: its branches light up green, all the way to the response. Each model is a card of fixed size with its place
 * in the order, its status, its time and cost so far, and a row of small blocks that fill toward its timeout. On top: the
 * attempt and the running totals. Point at a model, the request or the response (or tab to it) for a small card with
 * more: who serves it and where, tokens, price, the prompt or the answer. On narrow screens the diagram turns into a
 * tree, top to bottom.
 * The data is yours: pass the attempts with their status, times and costs – the component sums, draws and animates them.
 * The styles are injected below, so no extra files are needed.
 */

export type AttemptStatus = "waiting" | "trying" | "failed" | "answered" | "skipped";

/** One line in a hover card, e.g. { label: "Tokens", value: "1,284 in · 96 out" } */
export type ChainDetail = { label: string; value: ReactNode };

export type FallbackAttempt = {
  id: string;
  /** The model, e.g. "Claude Opus 5.5" */
  model: string;
  /** Who serves it, e.g. "Anthropic" or "Azure" */
  provider?: string;
  /** A small mark – defaults to the initials */
  logo?: ReactNode;
  /** Defaults to waiting */
  status?: AttemptStatus;
  /** When this attempt started – drives the live timer while it's trying */
  startedAt?: number | Date;
  /** How long it took, in ms, once it failed or answered */
  duration?: number;
  /** How long it may take before it counts as failed, in ms (default 10s) – its blocks fill toward it */
  timeout?: number;
  /** What it cost so far, in US dollars – update it while it runs and the counters follow */
  cost?: number;
  /** Why it failed, e.g. "Rate limited · 429" */
  reason?: string;
  /** A short line once it answered, e.g. "412 tokens" */
  note?: string;
  /** Who serves it, as a logo – leads its hover card (e.g. AWS for Claude on Bedrock) */
  providerLogo?: ReactNode;
  /** Where it's served, e.g. "us-east-1" */
  region?: string;
  /** More lines for its hover card – tokens, price, the error code */
  details?: ChainDetail[];
};

/** Where the request came from or where the answer goes – shown in the hover cards on the two ends */
export type ChainEnd = {
  /** e.g. "HubSpot · Ticket #4821" or "Slack · #support" */
  name?: string;
  logo?: ReactNode;
  /** The prompt, or the answer – a short preview in the card */
  text?: string;
  details?: ChainDetail[];
};

export type FallbackChainProps = {
  attempts: FallbackAttempt[];
  /** What was asked, above the diagram */
  title?: string;
  /** The route on the request node, e.g. "openrouter/auto" */
  route?: string;
  /** Where the request came from – its hover card */
  request?: ChainEnd;
  /** Where the answer goes – its hover card */
  response?: ChainEnd;
  /** A clock you control – without it the timer follows real time */
  now?: number;
  /** Shown as a button once every model failed */
  onRetry?: () => void;
  className?: string;
};

/* Fixed geometry, so the branches can be drawn without measuring: card height, gap between cards, branch length */
const ROW = 60;
const GAP = 10;
const LINK = 48;

const ms = (d: number | Date) => (typeof d === "number" ? d : d.getTime());
const secs = (n: number) => {
  const v = Math.max(0, n);
  if (v < 1000) return `${Math.round(v / 10) * 10}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  const s = Math.round(v / 1000);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const usd = (n: number) => {
  const v = Math.max(0, Number.isFinite(n) ? n : 0);
  return v === 0 ? "$0" : v < 0.0001 ? "<$0.0001" : v < 0.01 ? `$${v.toFixed(4)}` : v < 1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
};
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** A model's time against its timeout: square blocks of this size and gap – as many as fit the card's row */
const BLOCK = 5;
const BLOCK_GAP = 2;

/** A soft S-curve from one side to the other */
const curve = (y1: number, y2: number, w: number) => `M0 ${y1}C${w * 0.55} ${y1} ${w * 0.45} ${y2} ${w} ${y2}`;
/** A tree branch: down the spine, then round into the card */
const branch = (y: number, x: number) => `M${x} 0V${Math.max(0, y - 10)}Q${x} ${y} ${x + 10} ${y}H${x + 22}`;

/** The route: three stops, the last one reached */
const RouteIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3.5" cy="3.5" r="1.75" fill="currentColor" opacity="0.45" />
    <circle cx="12.5" cy="8" r="1.75" fill="currentColor" opacity="0.45" />
    <circle cx="3.5" cy="12.5" r="2.25" fill="currentColor" />
    <path d="M5.2 3.5h4.3a3 3 0 0 1 0 6H6.3a1.5 1.5 0 0 0 0 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.7" />
  </svg>
);
/** The answer: a speech bubble – outlined while waiting, filled once there is one */
const ReplyIcon = ({ filled }: { filled?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H8l-3 2.5V11h-.5A1.5 1.5 0 0 1 3 9.5v-5Z" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M5.75 6.25h4.5M5.75 8.25h2.75" stroke={filled ? "var(--ui-fcc-card)" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

const STATUS_LABEL: Record<AttemptStatus, string> = { waiting: "Waiting", trying: "Trying", failed: "Failed", answered: "Answered", skipped: "Not needed" };

/** A small card that opens on hover or focus: a head with a logo, an optional quote, then label – value lines */
function Pop({ id, logo, title, sub, badge, tone, quote, rows, place }: { id: string; logo?: ReactNode; title: ReactNode; sub?: ReactNode; badge?: string; tone?: string; quote?: string; rows: ChainDetail[]; place: string }) {
  return (
    <span className="ui-fcc__pop" id={id} role="tooltip" data-place={place}>
      <span className="ui-fcc__pop-head">
        {logo && <span className="ui-fcc__pop-logo">{logo}</span>}
        <span className="ui-fcc__pop-who">
          <span className="ui-fcc__pop-title">{title}</span>
          {sub && <span className="ui-fcc__pop-sub">{sub}</span>}
        </span>
        {badge && (
          <span className="ui-fcc__pop-badge" data-tone={tone}>
            {badge}
          </span>
        )}
      </span>
      {quote && (
        <span className="ui-fcc__pop-quote">
          <span>{quote}</span>
        </span>
      )}
      {rows.length > 0 && (
        <span className="ui-fcc__pop-rows">
          {rows.map((r, i) => (
            <span key={`${r.label}-${i}`} className="ui-fcc__pop-row">
              <span className="ui-fcc__pop-label">{r.label}</span>
              <span className="ui-fcc__pop-value">{r.value}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/**
 * The light on a branch: a gradient that fades in, peaks and fades out (0 → 100% → 0) and sweeps along the branch,
 * so the streak has soft ends instead of a hard dash
 */
function Light({ id, d, size, vertical }: { id: string; d: string; size: number; vertical?: boolean }) {
  const band = Math.min(size * 0.7, 120);
  const axis = vertical ? { x1: 0, y1: 0, x2: 0, y2: band } : { x1: 0, y1: 0, x2: band, y2: 0 };
  const move = vertical ? [`0 ${-band}`, `0 ${size}`] : [`${-band} 0`, `${size} 0`];
  return (
    <>
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" {...axis}>
          <stop offset="0" style={{ stopColor: "var(--ui-fcc-accent)", stopOpacity: 0 }} />
          <stop offset="0.5" style={{ stopColor: "var(--ui-fcc-accent)", stopOpacity: 1 }} />
          <stop offset="1" style={{ stopColor: "var(--ui-fcc-accent)", stopOpacity: 0 }} />
          <animateTransform attributeName="gradientTransform" type="translate" from={move[0]} to={move[1]} dur="1.4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.55 1" />
        </linearGradient>
      </defs>
      <path className="ui-fcc__light" d={d} stroke={`url(#${id})`} />
    </>
  );
}

export function FallbackChain({ attempts, title = "Request", route, request, response, now: nowProp, onRetry, className }: FallbackChainProps) {
  const uid = "fcc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const statusOf = (a: FallbackAttempt): AttemptStatus => a.status ?? "waiting";
  const live = attempts.some((a) => statusOf(a) === "trying");

  // A live clock while something is being tried – only when you don't pass one
  // Count how many blocks fit a card's row, and keep counting as it resizes
  const models = useRef<HTMLOListElement>(null);
  const [blocks, setBlocks] = useState(30);
  useLayoutEffect(() => {
    const row = models.current?.querySelector<HTMLElement>(".ui-fcc__blocks");
    if (!row) return;
    const fit = () => setBlocks(Math.max(8, Math.floor((row.clientWidth + BLOCK_GAP) / (BLOCK + BLOCK_GAP))));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(row);
    return () => ro.disconnect();
  }, [attempts.length]);

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined || !live) return;
    const id = window.setInterval(() => setTick(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [nowProp, live]);
  const now = nowProp ?? tick;

  const ran = (a: FallbackAttempt) => ["trying", "failed", "answered"].includes(statusOf(a));
  const took = (a: FallbackAttempt) => {
    const s = statusOf(a);
    if (s === "trying") return a.startedAt !== undefined ? Math.max(0, now - ms(a.startedAt)) : 0;
    if (s === "failed" || s === "answered") return a.duration ?? 0;
    return 0;
  };

  const tryingAt = attempts.findIndex((a) => statusOf(a) === "trying");
  const answeredAt = attempts.findIndex((a) => statusOf(a) === "answered");
  const tried = attempts.filter(ran);
  const allFailed = attempts.length > 0 && attempts.every((a) => ["failed", "skipped"].includes(statusOf(a))) && attempts.some((a) => statusOf(a) === "failed");
  const time = tried.reduce((n, a) => n + took(a), 0);
  const spent = tried.reduce((n, a) => n + (a.cost ?? 0), 0);
  const winner = answeredAt >= 0 ? attempts[answeredAt] : undefined;
  const state = winner ? "answered" : allFailed ? "failed" : tryingAt >= 0 ? "trying" : "waiting";

  const n = Math.max(1, attempts.length);
  const height = n * ROW + (n - 1) * GAP;
  const mid = height / 2;
  const rowY = (i: number) => i * (ROW + GAP) + ROW / 2;

  const lineOf = (a: FallbackAttempt, i: number) => {
    const s = statusOf(a);
    if (s === "trying") return "Trying…";
    if (s === "failed") return a.reason ?? "Failed";
    if (s === "answered") return a.note ? `Answered · ${a.note}` : "Answered";
    if (s === "skipped") return "Not needed";
    return i === tried.length && state === "trying" ? "Up next" : "Waiting";
  };

  // In: a branch from the request to every model – the one being tried carries the light
  const inLinks = (shape: (y: number) => string, size: number, vertical?: boolean) =>
    attempts.map((a, i) => {
      const s = statusOf(a);
      const d = shape(rowY(i));
      return (
        <g key={a.id}>
          <path className="ui-fcc__link" data-status={s} d={d} key={s} pathLength={1} />
          {s === "trying" && <Light id={`${uid}-${vertical ? "t" : "w"}${i}`} d={d} size={size} vertical={vertical} />}
        </g>
      );
    });

  return (
    <div className={["ui-fcc", className].filter(Boolean).join(" ")}>
      <style href="ui-fallback-chain-clean" precedence="default">
        {css}
      </style>

      {/* Above the diagram: what was asked, the attempt and the running totals */}
      <header className="ui-fcc__bar">
        <span className="ui-fcc__title">{title}</span>
        <span className="ui-fcc__summary" data-state={state} role="status">
          <span className="ui-fcc__state" key={state}>
            {state === "answered" ? (
              "Answered"
            ) : state === "failed" ? (
              "No model answered"
            ) : state === "trying" ? (
              <>
                Attempt <b key={tryingAt}>{tryingAt + 1}</b> of {attempts.length}
              </>
            ) : (
              "Waiting"
            )}
          </span>
          <span className="ui-fcc__total" aria-label="Time so far">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <circle cx="6" cy="6" r="4.6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M6 3.6V6l1.6 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            {secs(time)}
          </span>
          <span className="ui-fcc__total" aria-label="Cost so far">
            {usd(spent)}
          </span>
        </span>
        {state === "failed" && onRetry && (
          <button type="button" className="ui-fcc__btn" onClick={onRetry}>
            Retry
          </button>
        )}
      </header>

      <div className="ui-fcc__card">
        <div className="ui-fcc__flow">
          {/* Where it starts */}
          <div className="ui-fcc__node ui-fcc__node--from ui-fcc__hov" tabIndex={0} aria-describedby={`${uid}-req`}>
            <span className="ui-fcc__node-icon">
              <RouteIcon />
            </span>
            <span className="ui-fcc__node-text">
              <span className="ui-fcc__node-title">Request</span>
              {route && <span className="ui-fcc__node-sub">{route}</span>}
            </span>
            <Pop
              id={`${uid}-req`}
              place="start"
              logo={request?.logo ?? <RouteIcon />}
              title={request?.name ?? "Request"}
              sub={route}
              quote={request?.text}
              rows={[...(request?.details ?? []), { label: "Tried so far", value: `${tried.length} of ${attempts.length}` }]}
            />
          </div>

          {/* Branches out to every model – side by side on wide screens, a tree on narrow ones */}
          <svg className="ui-fcc__links ui-fcc__links--wide" width={LINK} height={height} viewBox={`0 0 ${LINK} ${height}`} aria-hidden="true">
            {inLinks((y) => curve(mid, y, LINK), LINK)}
          </svg>
          <svg className="ui-fcc__links ui-fcc__links--tree" width="44" height={height} viewBox={`0 0 44 ${height}`} aria-hidden="true">
            {inLinks((y) => branch(y, 20), height, true)}
          </svg>

          <ol ref={models} className="ui-fcc__models" aria-label="Models, in the order they're tried">
            {attempts.length === 0 && <li className="ui-fcc__empty">No models in this chain</li>}
            {attempts.map((a, i) => {
              const s = statusOf(a);
              const share = Math.min(1, took(a) / Math.max(1, a.timeout ?? 10_000));
              return (
                <li key={a.id} className="ui-fcc__model ui-fcc__hov" data-status={s} tabIndex={0} aria-describedby={`${uid}-m${i}`}>
                  <span className="ui-fcc__logo" data-logo={a.logo ? "" : undefined}>
                    {a.logo ?? initials(a.model)}
                    <span className="ui-fcc__n">{i + 1}</span>
                  </span>
                  <span className="ui-fcc__who">
                    <span className="ui-fcc__top">
                      <span className="ui-fcc__name">{a.model}</span>
                      {a.provider && <span className="ui-fcc__provider">{a.provider}</span>}
                    </span>
                    <span className="ui-fcc__status" key={s}>
                      {lineOf(a, i)}
                    </span>
                  </span>
                  <span className="ui-fcc__meta">
                    <span>{ran(a) ? secs(took(a)) : "–"}</span>
                    <span>{ran(a) ? usd(a.cost ?? 0) : ""}</span>
                  </span>
                  {/* Its time against its timeout: a row of blocks that fill one by one */}
                  <span className="ui-fcc__blocks" aria-hidden="true">
                    {Array.from({ length: blocks }, (_, k) => {
                      const filled = Math.round(share * blocks);
                      return <i key={k} data-on={k < filled || undefined} data-head={(s === "trying" && k === filled - 1) || undefined} />;
                    })}
                  </span>
                  {/* More on hover: who serves it and where, its time and cost, tokens and price */}
                  <Pop
                    id={`${uid}-m${i}`}
                    place={i < n / 2 ? "below" : "above"}
                    logo={a.providerLogo ?? a.logo}
                    title={a.provider ?? a.model}
                    sub={a.region}
                    badge={STATUS_LABEL[s]}
                    tone={s}
                    rows={[
                      { label: "Model", value: a.model },
                      { label: "Time", value: ran(a) ? `${secs(took(a))} of ${secs(a.timeout ?? 10_000)}` : `up to ${secs(a.timeout ?? 10_000)}` },
                      ...(ran(a) ? [{ label: "Cost", value: usd(a.cost ?? 0) }] : []),
                      ...(a.details ?? []),
                      ...(s === "failed" ? [{ label: "Why", value: <span className="ui-fcc__pop-err">{a.reason ?? "Failed"}</span> }] : []),
                    ]}
                  />
                </li>
              );
            })}
          </ol>

          {/* Out: a line from every model on to the response – only the one that answered lights up */}
          <svg className="ui-fcc__links ui-fcc__links--wide" width={LINK} height={height} viewBox={`0 0 ${LINK} ${height}`} aria-hidden="true">
            {attempts.map((a, i) => (
              <path key={`${a.id}-${i === answeredAt}`} className="ui-fcc__link ui-fcc__link--out" data-status={i === answeredAt ? "answered" : "idle"} d={curve(rowY(i), mid, LINK)} pathLength={1} />
            ))}
          </svg>

          {/* Where it ends */}
          <div className="ui-fcc__node ui-fcc__node--to ui-fcc__hov" data-state={state} tabIndex={0} aria-describedby={`${uid}-res`}>
            <span className="ui-fcc__node-icon">
              <ReplyIcon filled={state === "answered"} />
            </span>
            <span className="ui-fcc__node-text">
              <span className="ui-fcc__node-title">{state === "failed" ? "No answer" : "Response"}</span>
              <span className="ui-fcc__node-sub" key={state}>
                {state === "answered" ? (winner?.note ?? winner?.model) : state === "failed" ? `${attempts.length} failed` : "Waiting…"}
              </span>
            </span>
            <Pop
              id={`${uid}-res`}
              place="end"
              logo={response?.logo ?? <ReplyIcon filled={state === "answered"} />}
              title={response?.name ?? "Response"}
              sub={state === "answered" ? `from ${winner?.model}` : state === "failed" ? "No model answered" : "Waiting for an answer"}
              badge={state === "answered" ? "Delivered" : state === "failed" ? "Failed" : "Pending"}
              tone={state === "answered" ? "answered" : state === "failed" ? "failed" : "waiting"}
              quote={state === "answered" ? response?.text : undefined}
              rows={[
                { label: "Total time", value: secs(time) },
                { label: "Total cost", value: usd(spent) },
                { label: "Attempts", value: `${tried.length} of ${attempts.length}` },
                ...(state === "answered" ? (response?.details ?? []) : []),
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-fcc */
.ui-fcc {
  --ui-fcc-card: #ffffff;
  --ui-fcc-strong: #000000;
  --ui-fcc-ink: rgba(0, 0, 0, 0.88);
  --ui-fcc-text: rgba(0, 0, 0, 0.61);
  --ui-fcc-muted: rgba(0, 0, 0, 0.45);
  --ui-fcc-faint: rgba(0, 0, 0, 0.27);
  --ui-fcc-line: rgba(0, 0, 0, 0.06);
  --ui-fcc-link: rgba(0, 0, 0, 0.14);
  --ui-fcc-fill: rgba(0, 0, 0, 0.05);
  --ui-fcc-idle: #f4f4f5;
  --ui-fcc-wait: #f9f9fa;
  --ui-fcc-area: #fbfbfb;
  --ui-fcc-grid: rgba(0, 0, 0, 0.05);
  --ui-fcc-accent: #0060e2;
  --ui-fcc-accent-soft: rgba(0, 96, 226, 0.3);
  --ui-fcc-accent-bg: rgba(0, 96, 226, 0.07);
  --ui-fcc-ok: #108a4a;
  --ui-fcc-ok-soft: rgba(16, 138, 74, 0.34);
  --ui-fcc-ok-bg: rgba(16, 138, 74, 0.07);
  --ui-fcc-fail: #d72400;
  --ui-fcc-fail-soft: rgba(215, 36, 0, 0.38);
  --ui-fcc-fail-bg: rgba(215, 36, 0, 0.07);
  --ui-fcc-focus: rgba(0, 96, 226, 0.35);
  --ui-fcc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-fcc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-fcc-row: ${ROW}px;
  --ui-fcc-gap: ${GAP}px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 740px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-fcc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-fcc *, .ui-fcc *::before, .ui-fcc *::after { box-sizing: border-box; }
:where(.ui-fcc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-fcc button:focus-visible { outline: 2px solid var(--ui-fcc-focus); outline-offset: 1px; }
:where(.ui-fcc) ol { margin: 0; padding: 0; list-style: none; }
:where(.ui-fcc) svg { display: block; flex: none; }
.ui-fcc b { font-weight: 500; }

/* ----- Above the diagram: no layer of its own ----- */
.ui-fcc__bar { display: flex; align-items: center; gap: 12px; min-width: 0; min-height: 28px; margin-bottom: 10px; padding: 0 2px; }
.ui-fcc__title { flex: 1; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-fcc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-fcc__summary { display: flex; flex: none; align-items: center; gap: 12px; font-size: 12px; line-height: 16px; color: var(--ui-fcc-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-fcc__state { display: inline-flex; align-items: center; gap: 6px; animation: ui-fcc-swap 300ms var(--ui-fcc-ease); }
.ui-fcc__state::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-fcc-faint); transition: background-color 300ms ease; }
.ui-fcc__summary[data-state="trying"] .ui-fcc__state::before { background: var(--ui-fcc-accent); animation: ui-fcc-breathe 1200ms ease-in-out infinite alternate; }
.ui-fcc__summary[data-state="answered"] .ui-fcc__state { color: var(--ui-fcc-ok); }
.ui-fcc__summary[data-state="answered"] .ui-fcc__state::before { background: var(--ui-fcc-ok); }
.ui-fcc__summary[data-state="failed"] .ui-fcc__state { color: var(--ui-fcc-fail); }
.ui-fcc__summary[data-state="failed"] .ui-fcc__state::before { background: var(--ui-fcc-fail); }
.ui-fcc__state b { color: var(--ui-fcc-ink); }
/* The running totals: time and cost, quiet and tabular so they don't jump */
.ui-fcc__total { display: inline-flex; align-items: center; gap: 4px; padding-left: 12px; box-shadow: inset 0.5px 0 0 var(--ui-fcc-link); color: var(--ui-fcc-ink); }
.ui-fcc__total svg { color: var(--ui-fcc-faint); }
.ui-fcc__btn { flex: none; height: 28px; padding: 0 10px; border-radius: 6px; background: var(--ui-fcc-card); box-shadow: var(--ui-fcc-shadow); font-weight: 500; color: var(--ui-fcc-strong); transition: background-color 160ms ease; }
.ui-fcc__btn:hover { background: var(--ui-fcc-fill); }

/* ----- The diagram: request → models → response, on a faint dotted canvas ----- */
.ui-fcc__card { border-radius: 12px; background: var(--ui-fcc-area); box-shadow: var(--ui-fcc-shadow); }
.ui-fcc__flow {
  display: grid;
  grid-template-columns: 140px ${LINK}px minmax(0, 1fr) ${LINK}px 140px;
  align-items: center;
  padding: 22px 16px;
  border-radius: inherit;
  background-image: radial-gradient(circle, var(--ui-fcc-grid) 0.9px, transparent 1.1px);
  background-size: 12px 12px;
  background-position: 6px 6px;
}
.ui-fcc__links { overflow: visible; }
.ui-fcc__links--tree { display: none; }

/* The two ends: small cards with an icon – the response fills in once there is one */
.ui-fcc__node { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; min-width: 0; height: 52px; padding: 0 8px; border-radius: 10px; background: var(--ui-fcc-card); box-shadow: var(--ui-fcc-shadow); transition: background-color 400ms ease, box-shadow 400ms ease; }
.ui-fcc__node-icon { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: var(--ui-fcc-fill); color: var(--ui-fcc-text); transition: background-color 400ms ease, color 400ms ease; }
.ui-fcc__node--from .ui-fcc__node-icon { background: var(--ui-fcc-accent-bg); color: var(--ui-fcc-accent); }
.ui-fcc__node-text { display: grid; min-width: 0; }
.ui-fcc__node-title { overflow: hidden; font-size: 12.5px; font-weight: 500; line-height: 17px; color: var(--ui-fcc-ink); white-space: nowrap; text-overflow: ellipsis; transition: color 400ms ease; }
.ui-fcc__node-sub { overflow: hidden; font-size: 11px; line-height: 15px; color: var(--ui-fcc-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; animation: ui-fcc-swap 300ms var(--ui-fcc-ease); }
.ui-fcc__node--from .ui-fcc__node-sub { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px; letter-spacing: -0.1px; animation: none; }
/* Waiting for an answer: a light grey card with the same soft shadow as the others, so the dots don't show through */
.ui-fcc__node--to:is([data-state="waiting"], [data-state="trying"]) { background: var(--ui-fcc-wait); box-shadow: var(--ui-fcc-shadow); }
/* Its icon sits on a small white tile, like the models' logos */
.ui-fcc__node--to:is([data-state="waiting"], [data-state="trying"]) .ui-fcc__node-icon { background: var(--ui-fcc-card); box-shadow: var(--ui-fcc-shadow); color: var(--ui-fcc-faint); }
.ui-fcc__node--to:is([data-state="waiting"], [data-state="trying"]) .ui-fcc__node-title { color: var(--ui-fcc-muted); }
.ui-fcc__node--to[data-state="answered"] { box-shadow: 0 0 0 1px var(--ui-fcc-ok-soft), 0 0 0 4px var(--ui-fcc-ok-bg), var(--ui-fcc-shadow); transition-delay: 500ms; }
.ui-fcc__node--to[data-state="answered"] .ui-fcc__node-icon { background: var(--ui-fcc-ok-bg); color: var(--ui-fcc-ok); transition-delay: 500ms; }
.ui-fcc__node--to[data-state="answered"] .ui-fcc__node-sub { color: var(--ui-fcc-ok); }
.ui-fcc__node--to[data-state="failed"] { box-shadow: 0 0 0 1px var(--ui-fcc-fail-soft), var(--ui-fcc-shadow); }
.ui-fcc__node--to[data-state="failed"] .ui-fcc__node-icon { background: var(--ui-fcc-fail-bg); color: var(--ui-fcc-fail); }
.ui-fcc__node--to[data-state="failed"] .ui-fcc__node-sub { color: var(--ui-fcc-fail); }

/* Branches: grey until used; the one being tried draws itself in blue, a failed one turns red and dashed, the answer green */
.ui-fcc__link { fill: none; stroke: var(--ui-fcc-link); stroke-width: 1.25; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.ui-fcc__link:is([data-status="waiting"], [data-status="idle"]) { stroke-dasharray: 0.012 0.03; }
.ui-fcc__link[data-status="skipped"] { stroke-dasharray: 0.012 0.03; opacity: 0.5; }
.ui-fcc__link[data-status="trying"] { stroke: var(--ui-fcc-accent-soft); stroke-dasharray: 1 1; animation: ui-fcc-draw 600ms var(--ui-fcc-ease) both; }
.ui-fcc__link[data-status="failed"] { stroke: var(--ui-fcc-fail-soft); stroke-dasharray: 0.035 0.035; animation: ui-fcc-fade 500ms ease both; }
.ui-fcc__link[data-status="answered"] { stroke: var(--ui-fcc-ok); stroke-width: 1.5; stroke-dasharray: 1 1; animation: ui-fcc-draw 500ms var(--ui-fcc-ease) both; }
/* The answer goes on to the response right after its branch in is drawn */
.ui-fcc__link--out[data-status="answered"] { animation-delay: 300ms; }
.ui-fcc__light { fill: none; stroke-width: 2.5; stroke-linecap: round; vector-effect: non-scaling-stroke; animation: ui-fcc-fade 400ms ease 300ms both; }

/* ----- Models: one card each, fixed size ----- */
.ui-fcc__models { display: grid; grid-auto-rows: var(--ui-fcc-row); gap: var(--ui-fcc-gap); min-width: 0; }
.ui-fcc__model {
  position: relative;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  row-gap: 7px;
  align-content: center;
  align-items: center;
  column-gap: 10px;
  min-width: 0;
  padding: 0 12px 0 10px;
  border-radius: 10px;
  background: var(--ui-fcc-card);
  box-shadow: var(--ui-fcc-shadow);
  transition: box-shadow 400ms ease, opacity 400ms ease;
}
.ui-fcc__model[data-status="trying"] { box-shadow: 0 0 0 1px var(--ui-fcc-accent-soft), 0 0 0 4px var(--ui-fcc-accent-bg), var(--ui-fcc-shadow); }
.ui-fcc__model[data-status="answered"] { box-shadow: 0 0 0 1px var(--ui-fcc-ok-soft), 0 0 0 4px var(--ui-fcc-ok-bg), var(--ui-fcc-shadow); }
.ui-fcc__model[data-status="waiting"] :is(.ui-fcc__logo, .ui-fcc__name) { opacity: 0.6; }
.ui-fcc__model[data-status="skipped"] > :not(.ui-fcc__pop) { opacity: 0.5; }
.ui-fcc__logo { position: relative; grid-row: 1 / 3; display: grid; place-items: center; width: 26px; height: 26px; border-radius: 7px; background: var(--ui-fcc-fill); font-size: 10px; font-weight: 500; letter-spacing: 0.3px; color: var(--ui-fcc-text); transition: opacity 400ms ease; }
.ui-fcc__logo[data-logo] { background: var(--ui-fcc-card); box-shadow: var(--ui-fcc-shadow); }
.ui-fcc__logo > svg { width: 14px; height: 14px; }
/* Its place in the order, on the corner of its mark */
.ui-fcc__n { position: absolute; right: -5px; bottom: -4px; display: grid; place-items: center; min-width: 13px; height: 13px; padding: 0 3px; border-radius: 7px; background: var(--ui-fcc-card); box-shadow: 0 0 0 0.5px var(--ui-fcc-line), 0 1px 2px rgba(0, 0, 0, 0.08); font-size: 8.5px; font-weight: 500; line-height: 13px; color: var(--ui-fcc-muted); font-variant-numeric: tabular-nums; transition: background-color 300ms ease, color 300ms ease; }
.ui-fcc__model[data-status="trying"] .ui-fcc__n { background: var(--ui-fcc-accent); color: var(--ui-fcc-card); box-shadow: none; }
.ui-fcc__model[data-status="failed"] .ui-fcc__n { background: var(--ui-fcc-fail); color: var(--ui-fcc-card); box-shadow: none; }
.ui-fcc__model[data-status="answered"] .ui-fcc__n { background: var(--ui-fcc-ok); color: var(--ui-fcc-card); box-shadow: none; }
.ui-fcc__who { display: grid; min-width: 0; }
.ui-fcc__top { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
/* The provider gives way first when the name needs the room */
.ui-fcc__name { flex: 0 1 auto; min-width: 0; overflow: hidden; font-size: 12.5px; font-weight: 500; line-height: 17px; color: var(--ui-fcc-ink); white-space: nowrap; text-overflow: ellipsis; transition: opacity 400ms ease; }
.ui-fcc__provider { flex: 0 1000 auto; min-width: 0; overflow: hidden; font-size: 11px; line-height: 16px; color: var(--ui-fcc-faint); white-space: nowrap; text-overflow: ellipsis; }
.ui-fcc__status { min-width: 0; overflow: hidden; font-size: 11.5px; line-height: 16px; color: var(--ui-fcc-muted); white-space: nowrap; text-overflow: ellipsis; animation: ui-fcc-swap 300ms var(--ui-fcc-ease); }
.ui-fcc__model[data-status="trying"] .ui-fcc__status { color: var(--ui-fcc-accent); }
.ui-fcc__model[data-status="failed"] .ui-fcc__status { color: var(--ui-fcc-fail); }
.ui-fcc__model[data-status="answered"] .ui-fcc__status { color: var(--ui-fcc-ok); }
/* Its time and cost so far, stacked like the name and status */
.ui-fcc__meta { display: grid; justify-items: end; font-size: 11.5px; line-height: 16px; color: var(--ui-fcc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-fcc__meta > :first-child { line-height: 17px; color: var(--ui-fcc-ink); }
.ui-fcc__model:is([data-status="waiting"], [data-status="skipped"]) .ui-fcc__meta > :first-child { color: var(--ui-fcc-faint); }
/* Its time against its timeout: small blocks in a row, each one filling as its share of the timeout passes */
/* Square blocks of a fixed size, as many as fit – spread out so the row fills the card's width */
.ui-fcc__blocks { grid-column: 2 / 4; display: flex; justify-content: space-between; gap: ${BLOCK_GAP}px; min-width: 0; overflow: hidden; }
.ui-fcc__blocks > i { flex: none; width: ${BLOCK}px; height: ${BLOCK}px; border-radius: 1.25px; background: var(--ui-fcc-fill); transition: background-color 220ms ease, opacity 220ms ease; }
.ui-fcc__model[data-status="trying"] .ui-fcc__blocks > i[data-on] { background: var(--ui-fcc-accent); opacity: 0.7; }
.ui-fcc__model[data-status="failed"] .ui-fcc__blocks > i[data-on] { background: var(--ui-fcc-fail-soft); }
.ui-fcc__model[data-status="answered"] .ui-fcc__blocks > i[data-on] { background: var(--ui-fcc-ok-soft); }
/* Waiting and not needed: the empty row steps back, so only the running and finished rows stand out */
.ui-fcc__model:is([data-status="waiting"], [data-status="skipped"]) .ui-fcc__blocks > i { opacity: 0.55; }
/* The block filling right now breathes */
.ui-fcc__blocks > i[data-head] { animation: ui-fcc-breathe 700ms ease-in-out infinite alternate; }
.ui-fcc__empty { display: grid; place-items: center; height: var(--ui-fcc-row); font-size: 12px; color: var(--ui-fcc-muted); }

/* While a model runs, a soft sheen sweeps over its time and cost now and then – and over the totals on top */
.ui-fcc__model[data-status="trying"] .ui-fcc__meta > span, .ui-fcc__summary[data-state="trying"] .ui-fcc__total {
  --ui-fcc-shine: var(--ui-fcc-ink);
  background: linear-gradient(100deg, var(--ui-fcc-shine) 0 40%, var(--ui-fcc-faint) 50%, var(--ui-fcc-shine) 60% 100%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: ui-fcc-shimmer 2600ms ease-in-out infinite;
}
.ui-fcc__model[data-status="trying"] .ui-fcc__meta > span:last-child { --ui-fcc-shine: var(--ui-fcc-muted); }
.ui-fcc__summary[data-state="trying"] .ui-fcc__total svg { color: var(--ui-fcc-faint); }

/* ----- Hover cards ----- */
.ui-fcc__hov { outline: none; cursor: default; }
.ui-fcc__hov:is(:hover, :focus-visible) { z-index: 20; }
.ui-fcc__model.ui-fcc__hov:focus-visible, .ui-fcc__node.ui-fcc__hov:focus-visible { box-shadow: 0 0 0 2px var(--ui-fcc-focus), var(--ui-fcc-shadow); }
.ui-fcc__pop {
  position: absolute;
  z-index: 30;
  display: grid;
  gap: 10px;
  width: 280px;
  padding: 12px;
  border-radius: 12px;
  background: var(--ui-fcc-card);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 4px 12px -4px rgba(0, 0, 0, 0.12), 0 16px 32px -12px rgba(0, 0, 0, 0.16);
  text-align: left;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 160ms ease, transform 200ms var(--ui-fcc-ease), visibility 0s linear 200ms;
}
.ui-fcc__pop[data-place="below"] { top: calc(100% + 8px); left: 50%; transform: translate(-50%, -4px); }
.ui-fcc__pop[data-place="above"] { bottom: calc(100% + 8px); left: 50%; transform: translate(-50%, 4px); }
.ui-fcc__pop[data-place="start"] { top: calc(100% + 8px); left: 0; transform: translateY(-4px); }
.ui-fcc__pop[data-place="end"] { top: calc(100% + 8px); right: 0; transform: translateY(-4px); }
/* Opens after a short pause, so moving across the diagram doesn't flash cards */
.ui-fcc__hov:is(:hover, :focus-visible) > .ui-fcc__pop { opacity: 1; visibility: visible; transition: opacity 160ms ease 140ms, transform 220ms var(--ui-fcc-ease) 140ms, visibility 0s; }
.ui-fcc__hov:is(:hover, :focus-visible) > .ui-fcc__pop:is([data-place="below"], [data-place="above"]) { transform: translate(-50%, 0); }
.ui-fcc__hov:is(:hover, :focus-visible) > .ui-fcc__pop:is([data-place="start"], [data-place="end"]) { transform: none; }
.ui-fcc__pop-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ui-fcc__pop-logo { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--ui-fcc-card); box-shadow: var(--ui-fcc-shadow); color: var(--ui-fcc-text); }
.ui-fcc__pop-logo > svg { width: 16px; height: 16px; }
.ui-fcc__pop-who { display: grid; flex: 1; min-width: 0; }
.ui-fcc__pop-title { overflow: hidden; font-size: 12.5px; font-weight: 500; line-height: 17px; color: var(--ui-fcc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-fcc__pop-sub { overflow: hidden; font-size: 11.5px; line-height: 16px; color: var(--ui-fcc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-fcc__pop-badge { flex: none; height: 20px; padding: 0 7px; border-radius: 6px; background: var(--ui-fcc-fill); font-size: 11px; font-weight: 500; line-height: 20px; color: var(--ui-fcc-text); white-space: nowrap; }
.ui-fcc__pop-badge[data-tone="trying"] { background: var(--ui-fcc-accent-bg); color: var(--ui-fcc-accent); }
.ui-fcc__pop-badge[data-tone="failed"] { background: var(--ui-fcc-fail-bg); color: var(--ui-fcc-fail); }
.ui-fcc__pop-badge[data-tone="answered"] { background: var(--ui-fcc-ok-bg); color: var(--ui-fcc-ok); }
.ui-fcc__pop-quote { display: block; padding: 8px 10px; border-radius: 8px; background: var(--ui-fcc-idle); font-size: 12px; line-height: 17px; color: var(--ui-fcc-text); }
/* Three lines at most – the clamp sits inside the padding, so no half line peeks out */
.ui-fcc__pop-quote > span { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow-wrap: anywhere; }
.ui-fcc__pop-rows { display: grid; gap: 5px; padding-top: 10px; border-top: 0.5px solid var(--ui-fcc-line); }
.ui-fcc__pop-row { display: flex; align-items: baseline; gap: 12px; min-width: 0; font-size: 12px; line-height: 16px; }
.ui-fcc__pop-label { flex: none; color: var(--ui-fcc-muted); }
.ui-fcc__pop-value { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-fcc-ink); text-align: right; white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-fcc__pop-err { color: var(--ui-fcc-fail); }

@keyframes ui-fcc-swap { from { opacity: 0; transform: translateY(2px); } }
@keyframes ui-fcc-shimmer { 0% { background-position: 100% 0; } 55%, 100% { background-position: 0 0; } }
@keyframes ui-fcc-breathe { from { opacity: 0.4; } to { opacity: 1; } }
@keyframes ui-fcc-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ui-fcc-fade { from { opacity: 0; } }

/* Less room: the provider goes (it stays in the hover card), so the model's name keeps its room */
@container (max-width: 680px) {
  .ui-fcc__provider { display: none; }
}
/* Narrow: a tree, top to bottom – the request on top, the models branching off one line, the response goes */
@container (max-width: 520px) {
  .ui-fcc__flow { grid-template-columns: 44px minmax(0, 1fr); padding: 16px 12px 16px 14px; }
  .ui-fcc__node--from { grid-column: 1 / -1; justify-self: start; min-width: 150px; margin-bottom: 12px; }
  .ui-fcc__links--wide, .ui-fcc__node--to { display: none; }
  .ui-fcc__links--tree { display: block; align-self: start; margin-top: -12px; }
  .ui-fcc__bar { flex-wrap: wrap; row-gap: 4px; }
  .ui-fcc__title { flex-basis: 100%; }
  .ui-fcc__pop { width: min(280px, calc(100cqw - 24px)); }
  .ui-fcc__pop:is([data-place="below"], [data-place="above"]) { left: auto; right: 0; transform: translateY(-4px); }
  .ui-fcc__hov:is(:hover, :focus-visible) > .ui-fcc__pop:is([data-place="below"], [data-place="above"]) { transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-fcc *, .ui-fcc *::before, .ui-fcc *::after { animation: none !important; transition: none !important; }
  .ui-fcc__light { display: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-fcc {
  --ui-fcc-card: #232327;
  --ui-fcc-strong: #ffffff;
  --ui-fcc-ink: rgba(255, 255, 255, 0.9);
  --ui-fcc-text: rgba(255, 255, 255, 0.62);
  --ui-fcc-muted: rgba(255, 255, 255, 0.45);
  --ui-fcc-faint: rgba(255, 255, 255, 0.28);
  --ui-fcc-line: rgba(255, 255, 255, 0.08);
  --ui-fcc-link: rgba(255, 255, 255, 0.2);
  --ui-fcc-fill: rgba(255, 255, 255, 0.08);
  --ui-fcc-idle: #1f1f22;
  --ui-fcc-wait: #1f1f22;
  --ui-fcc-area: #19191b;
  --ui-fcc-grid: rgba(255, 255, 255, 0.06);
  --ui-fcc-accent: #70b8ff;
  --ui-fcc-accent-soft: rgba(112, 184, 255, 0.5);
  --ui-fcc-accent-bg: rgba(112, 184, 255, 0.1);
  --ui-fcc-ok: #3dd68c;
  --ui-fcc-ok-soft: rgba(61, 214, 140, 0.45);
  --ui-fcc-ok-bg: rgba(61, 214, 140, 0.1);
  --ui-fcc-fail: #ff977d;
  --ui-fcc-fail-soft: rgba(255, 151, 125, 0.5);
  --ui-fcc-fail-bg: rgba(255, 151, 125, 0.12);
  --ui-fcc-focus: rgba(91, 154, 255, 0.45);
  --ui-fcc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
:where(.dark, [data-theme="dark"]) .ui-fcc__pop { background: #2a2a2f; box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 16px 32px -12px rgba(0, 0, 0, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-fcc__pop-logo { background: #333338; }
`;
