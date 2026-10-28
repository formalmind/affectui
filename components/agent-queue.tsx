"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/*
 * Agent Queue – the work waiting for your agents, and how fast it moves, in a single self-contained file.
 * Jobs flow from left to right: they wait in the queue, a free worker pulls the front one, runs it, and it lands in
 * Done – or in Failed, or back in the queue for another try. A white card on a soft gray tray, the queue in numbers on top.
 *   · the next jobs wait as small cards with their name and how long they've waited; the rest of the backlog is a heap
 *     of tinted squares that grows and shrinks – new jobs drop in at the back, a high-priority job glides past the others
 *   · every worker slot shows its running job as a growing bar: tinted by kind, a sheen sweeping along, a glowing front
 *   · a finished job flies into Done with a tick; a failed one flashes red and goes to Failed or slides back for a retry
 *   · when the provider rate-limits, the workers pause in amber with a countdown, and you watch the queue build up and drain
 *   · a live chart of the queue depth over the last minutes, with the backpressure line and the rate-limited stretches
 *   · hover a job for a small card – click it (or press Enter) to pin it, with Move to front and Cancel
 *   · Pause/Resume and a – N + stepper for the number of workers, when you pass the handlers
 * Narrow containers stack the flow: queue on top, workers below, Done and Failed under them. The styles are injected
 * below, so no extra files are needed. All motion is CSS transitions plus one requestAnimationFrame loop for the numbers
 * (it sleeps while nothing moves and while the queue is off-screen).
 */

export type QueueJobKind = "llm" | "tool" | "agent" | "human";
export type QueueJobStatus = "queued" | "running" | "done" | "failed";
export type QueueJobPriority = "high" | "normal" | "low";

export type QueueJob = {
  id: string;
  name: string;
  kind: QueueJobKind;
  status: QueueJobStatus;
  /** High jumps ahead of the others, low waits behind them (default "normal") */
  priority?: QueueJobPriority;
  /** When it (last) entered the queue – ms, on the same clock as `now` */
  enqueuedAt: number;
  /** When a worker picked it up – clear it when the job goes back into the queue */
  startedAt?: number;
  /** When it finished or failed */
  endedAt?: number;
  /** The id of the worker that runs it */
  worker?: string;
  /** 0–1 while it runs – leave it out and it's estimated from `estimate` */
  progress?: number;
  /** How long it's expected to run, in ms */
  estimate?: number;
  /** 1 for the first try, 2 for the first retry … */
  attempt?: number;
  maxAttempts?: number;
  /** A few muted words – the source, the target, the model */
  detail?: string;
  /** A small mark, e.g. the tool's logo – defaults to a glyph for the kind */
  icon?: ReactNode;
  /** What went wrong – shown in its card */
  error?: string;
};

export type QueueWorker = {
  id: string;
  name: string;
  /** One muted line under the name, e.g. the model or "Worker 2" */
  detail?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the initials */
  icon?: ReactNode;
};

export type QueueRateLimit = {
  from: number;
  until: number;
  /** e.g. "Token limit · 2M/min" – shown with the countdown */
  label?: string;
};

export type AgentQueueProps = {
  /** Waiting and running jobs, plus finished ones for as long as the chart should count them */
  jobs: QueueJob[];
  /** The worker slots – their number is the concurrency */
  workers: QueueWorker[];
  /** The clock in ms – without it, the component keeps its own (Date.now) while there is work */
  now?: number;
  /** Stretches when the provider rate-limits – while one is active the workers show as paused */
  rateLimits?: QueueRateLimit[];
  /** The queue is paused – no new jobs start */
  paused?: boolean;
  /** Shows a Pause/Resume button */
  onPausedChange?: (paused: boolean) => void;
  /** Shows a – N + stepper for the number of workers */
  onConcurrencyChange?: (workers: number) => void;
  minConcurrency?: number;
  maxConcurrency?: number;
  /** A depth that means trouble – drawn as a dashed line on the chart; above it Waiting turns amber */
  backpressure?: number;
  /** How far back the chart looks, in ms (default 2 minutes) */
  window?: number;
  /** Counts since the start, when `jobs` only holds the recent ones */
  totals?: { done?: number; failed?: number };
  /** Controlled id of the job whose card is pinned */
  openId?: string | null;
  defaultOpenId?: string | null;
  onOpenChange?: (id: string | null, job?: QueueJob) => void;
  /** Shows "Move to front" in a waiting job's card */
  onPromote?: (job: QueueJob) => void;
  /** Shows "Cancel" in a waiting or running job's card */
  onCancel?: (job: QueueJob) => void;
  title?: string;
  /** The queue's name, muted next to the title */
  name?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const KIND: Record<QueueJobKind, string> = { llm: "LLM call", tool: "Tool call", agent: "Sub-agent", human: "Human review" };
const STATUS: Record<QueueJobStatus, string> = { queued: "Waiting", running: "Running", done: "Done", failed: "Failed" };
const RANK: Record<QueueJobPriority, number> = { high: 0, normal: 1, low: 2 };
/** Motion: how long a job takes to move, to land in a bin, and how long a fresh high-priority job waits before it jumps */
const MOVE = 560;
const LAND = 1100;
const FLASH = 1500;
const JUMP = 520;
/** A finished job shows its result in its slot for a moment before it flies – a failure a little longer */
const HOLD_DONE = 200;
const HOLD_FAIL = 520;
const MINUTE = 60_000;
/** Heights the chart's scale snaps to */
const SCALES = [4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120, 160, 200, 300, 400, 500, 600, 800, 1000, 1500, 2000];

const took = (ms: number) => {
  const v = Math.max(0, ms);
  if (v < 10_000) return `${(v / 1000).toFixed(1)}s`;
  const s = Math.round(v / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const int = (n: number) => Math.round(n).toLocaleString("en-US");
/** Counts that must fit a small box: exact up to 99,999, then "128K", "1.3M" – the exact number goes in the title */
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const count = (n: number) => (Math.round(n) < 100_000 ? int(n) : compact.format(Math.round(n)));
const pct = (list: number[], p: number) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const initials = (name: string) => {
  // Whole characters, never half an emoji – words that start with a symbol or emoji are skipped
  const words = name.trim().split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w));
  const marks = words.slice(0, 2).map((w) => Array.from(w)[0]);
  return (marks.length ? marks.join("") : (Array.from(name.trim())[0] ?? "")).toUpperCase();
};
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A smooth line through the points that never overshoots (monotone cubic) – x in px, y in queue depth */
const smooth = (p: [number, number][]) => {
  const n = p.length;
  if (n < 2) return "";
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0] || 1e-6;
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (3 * (dx[i - 1] + dx[i])) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  t[n - 1] = m[n - 2];
  let d = `M${r2(p[0][0])},${r2(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${r2(p[i][0] + h)},${r2(p[i][1] + t[i] * h)} ${r2(p[i + 1][0] - h)},${r2(p[i + 1][1] - t[i + 1] * h)} ${r2(p[i + 1][0])},${r2(p[i + 1][1])}`;
  }
  return d;
};

/* ---------- The flow's layout: every job, slot and bin is a box, computed from the width ---------- */

type Box = { x: number; y: number; w: number; h: number };
type Layout = {
  narrow: boolean;
  height: number;
  pad: number;
  heads: { queue: Box; workers: Box };
  chips: Box[];
  /** The backlog: a well with a grid of squares, spread so the padding is even on all sides */
  well: Box;
  grid: { x: number; y: number; cols: number; rows: number; step: number };
  slots: Box[];
  /** Where the running job sits inside a slot, relative to the slot */
  rail: { x: number; y: number; w: number; h: number };
  done: Box;
  failed: Box;
};
const SQ = 12;
const STEP = 16;
const CHIP = 28;
const SLOT = 40;
const GAP = 6;
const WELL = 10;
/** Room on the chart's left for the scale */
const GUTTER = 26;
const gridIn = (well: Box, rows: number) => {
  const cols = Math.max(2, Math.floor((well.w - 2 * WELL + STEP - SQ) / STEP));
  const h = rows * STEP - (STEP - SQ);
  return { x: well.x + WELL, y: well.y + (well.h - h) / 2, cols, rows, step: (well.w - 2 * WELL - SQ) / (cols - 1) };
};

const layoutFor = (W: number, n: number): Layout => {
  const narrow = W < 600;
  const count = Math.max(1, n);
  const slotsH = count * SLOT + (count - 1) * GAP;
  if (!narrow) {
    const pad = 16;
    const top = 14;
    const y0 = top + 16 + 10;
    const qw = clamp(Math.round(W * 0.26), 188, 236);
    const bw = 92;
    const g = 24;
    const content = Math.max(slotsH, 4 * SLOT + 3 * GAP);
    const qx = pad;
    const wx = pad + qw + g;
    const ww = W - 2 * pad - qw - bw - 2 * g;
    const bx = W - pad - bw;
    const chips = [0, 1, 2].map((i) => ({ x: qx, y: y0 + i * (CHIP + 4), w: qw, h: CHIP }));
    const gy = y0 + 3 * (CHIP + 4) + 2;
    const rows = Math.max(1, Math.floor((y0 + content - gy - 2 * WELL + STEP - SQ) / STEP));
    const well = { x: qx, y: gy, w: qw, h: y0 + content - gy };
    const iw = clamp(Math.round(ww * 0.4), 112, 164);
    const half = (content - 8) / 2;
    return {
      narrow,
      height: y0 + content + 18,
      pad,
      heads: { queue: { x: qx, y: top, w: qw, h: 16 }, workers: { x: wx, y: top, w: ww, h: 16 } },
      chips,
      well,
      grid: gridIn(well, rows),
      slots: Array.from({ length: n }, (_, i) => ({ x: wx, y: y0 + i * (SLOT + GAP), w: ww, h: SLOT })),
      rail: { x: iw, y: 6, w: ww - iw - 6, h: CHIP },
      done: { x: bx, y: y0, w: bw, h: half },
      failed: { x: bx, y: y0 + half + 8, w: bw, h: half },
    };
  }
  const pad = 12;
  const fw = W - 2 * pad;
  let y = 12;
  const queueHead = { x: pad, y, w: fw, h: 16 };
  y += 16 + 8;
  const chips = [0, 1].map((i) => ({ x: pad, y: y + i * (CHIP + 4), w: fw, h: CHIP }));
  const gy = y + 2 * (CHIP + 4) + 2;
  const well = { x: pad, y: gy, w: fw, h: 2 * STEP - (STEP - SQ) + 2 * WELL };
  y = gy + well.h;
  y += 18;
  const workersHead = { x: pad, y, w: fw, h: 16 };
  y += 16 + 8;
  const sy = y;
  y += slotsH;
  y += 12;
  // Phones: only the worker's mark – the rail gets the room
  const iw = 40;
  const half = (fw - 8) / 2;
  return {
    narrow,
    height: y + 40 + 12,
    pad,
    heads: { queue: queueHead, workers: workersHead },
    chips,
    well,
    grid: gridIn(well, 2),
    slots: Array.from({ length: n }, (_, i) => ({ x: pad, y: sy + i * (SLOT + GAP), w: fw, h: SLOT })),
    rail: { x: iw, y: 6, w: fw - iw - 6, h: CHIP },
    done: { x: pad, y, w: half, h: 40 },
    failed: { x: pad + half + 8, y, w: half, h: 40 },
  };
};

/* ---------- Icons ---------- */

/* Hugeicons Free (MIT, © Hugeicons, hugeicons.com): the queue, pause, play, plus, minus, tick, cancel, alert, retry, arrow-up and the kind glyphs */
const S = (p: { children: ReactNode; size?: number }) => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {p.children}
  </svg>
);
const QueueGlyph = () => (
  <S size={16}>
    <path d="M18 18H6C5.05719 18 4.58579 18 4.29289 17.7071C4 17.4142 4 16.9428 4 16C4 15.0572 4 14.5858 4.29289 14.2929C4.58579 14 5.05719 14 6 14H18C18.9428 14 19.4142 14 19.7071 14.2929C20 14.5858 20 15.0572 20 16C20 16.9428 20 17.4142 19.7071 17.7071C19.4142 18 18.9428 18 18 18Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M4 10H20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M4 6H20" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </S>
);
const Pause = () => (
  <S>
    <path d="M4 7C4 5.58579 4 4.87868 4.43934 4.43934C4.87868 4 5.58579 4 7 4C8.41421 4 9.12132 4 9.56066 4.43934C10 4.87868 10 5.58579 10 7V17C10 18.4142 10 19.1213 9.56066 19.5607C9.12132 20 8.41421 20 7 20C5.58579 20 4.87868 20 4.43934 19.5607C4 19.1213 4 18.4142 4 17V7Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M14 7C14 5.58579 14 4.87868 14.4393 4.43934C14.8787 4 15.5858 4 17 4C18.4142 4 19.1213 4 19.5607 4.43934C20 4.87868 20 5.58579 20 7V17C20 18.4142 20 19.1213 19.5607 19.5607C19.1213 20 18.4142 20 17 20C15.5858 20 14.8787 20 14.4393 19.5607C14 19.1213 14 18.4142 14 17V7Z" stroke="currentColor" strokeWidth="1.8" />
  </S>
);
const Play = () => (
  <S>
    <path d="M18.8906 12.846C18.5371 14.189 16.8667 15.138 13.5257 17.0361C10.296 18.8709 8.6812 19.7884 7.37983 19.4196C6.8418 19.2671 6.35159 18.9776 5.95624 18.5787C5 17.6139 5 15.7426 5 12C5 8.2574 5 6.3861 5.95624 5.42132C6.35159 5.02245 6.8418 4.73288 7.37983 4.58042C8.6812 4.21165 10.296 5.12907 13.5257 6.96393C16.8667 8.86197 18.5371 9.811 18.8906 11.154C19.0365 11.7084 19.0365 12.2916 18.8906 12.846Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
  </S>
);
const Plus = () => (
  <S>
    <path d="M12 4V20M20 12H4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </S>
);
const Minus = () => (
  <S>
    <path d="M20 12L4 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </S>
);
const Tick = () => (
  <S size={12}>
    <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
  </S>
);
const Cross = ({ size = 12, w = 2.4 }: { size?: number; w?: number }) => (
  <S size={size}>
    <path d="M18 6L6.00081 17.9992M17.9992 18L6 6.00085" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={w} />
  </S>
);
const Alert = () => (
  <S size={12}>
    <path d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    <path d="M12 9V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
    <path d="M12 16.8V17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
  </S>
);
const Retry = () => (
  <S size={10}>
    <path d="M20.4879 15C19.2524 18.4956 15.9187 21 12 21C7.02943 21 3 16.9706 3 12C3 7.02943 7.02943 3 12 3C15.7292 3 18.9286 5.26806 20.2941 8.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
    <path d="M15 9H18C19.4142 9 20.1213 9 20.5607 8.56066C21 8.12132 21 7.41421 21 6V3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
  </S>
);
const Up = () => (
  <S size={10}>
    <path d="M12 5.5V19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" />
    <path d="M18 11C18 11 13.5811 5.00001 12 5C10.4188 4.99999 6 11 6 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" />
  </S>
);
const KindGlyph = ({ kind }: { kind: QueueJobKind }) =>
  kind === "llm" ? (
    <S size={12}>
      <path d="M15 2L15.5387 4.39157C15.9957 6.42015 17.5798 8.00431 19.6084 8.46127L22 9L19.6084 9.53873C17.5798 9.99569 15.9957 11.5798 15.5387 13.6084L15 16L14.4613 13.6084C14.0043 11.5798 12.4202 9.99569 10.3916 9.53873L8 9L10.3916 8.46127C12.4201 8.00431 14.0043 6.42015 14.4613 4.39158L15 2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
      <path d="M7 12L7.38481 13.7083C7.71121 15.1572 8.84275 16.2888 10.2917 16.6152L12 17L10.2917 17.3848C8.84275 17.7112 7.71121 18.8427 7.38481 20.2917L7 22L6.61519 20.2917C6.28879 18.8427 5.15725 17.7112 3.70827 17.3848L2 17L3.70827 16.6152C5.15725 16.2888 6.28879 15.1573 6.61519 13.7083L7 12Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </S>
  ) : kind === "tool" ? (
    <S size={12}>
      <path d="M20.3584 13.3567C19.1689 14.546 16.9308 14.4998 13.4992 14.4998C11.2914 14.4998 9.50138 12.7071 9.50024 10.4993C9.50024 7.07001 9.454 4.83065 10.6435 3.64138C11.8329 2.45212 12.3583 2.50027 17.6274 2.50027C18.1366 2.49809 18.3929 3.11389 18.0329 3.47394L15.3199 6.18714C14.6313 6.87582 14.6294 7.99233 15.3181 8.68092C16.0068 9.36952 17.1234 9.36959 17.8122 8.68109L20.5259 5.96855C20.886 5.60859 21.5019 5.86483 21.4997 6.37395C21.4997 11.6422 21.5479 12.1675 20.3584 13.3567Z" stroke="currentColor" strokeWidth="2" />
      <path d="M13.5 14.5L7.32842 20.6716C6.22386 21.7761 4.433 21.7761 3.32843 20.6716C2.22386 19.567 2.22386 17.7761 3.32843 16.6716L9.5 10.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </S>
  ) : kind === "agent" ? (
    <S size={12}>
      <path d="M13 7H11C8.19108 7 6.78661 7 5.77772 7.67412C5.34096 7.96596 4.96596 8.34096 4.67412 8.77772C4 9.78661 4 11.1911 4 14C4 16.8089 4 18.2134 4.67412 19.2223C4.96596 19.659 5.34096 20.034 5.77772 20.3259C6.78661 21 8.19108 21 11 21H13C15.8089 21 17.2134 21 18.2223 20.3259C18.659 20.034 19.034 19.659 19.3259 19.2223C20 18.2134 20 16.8089 20 14C20 11.1911 20 9.78661 19.3259 8.77772C19.034 8.34096 18.659 7.96596 18.2223 7.67412C17.2134 7 15.8089 7 13 7Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M15 11V13M9 11V13M10 17H14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <path d="M12 7C12 5.11438 12 4.17157 11.4142 3.58579C10.8284 3 9.88562 3 8 3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </S>
  ) : (
    <S size={12}>
      <path d="M20 21.0001C19.713 17.269 16.7289 14.3151 12.995 14.0662L12 13.9999C11.6446 14.0096 11.3134 14.0225 11.0008 14.0378C7.3 14.2192 4.28417 17.3057 4 21.0001" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      <circle cx="12" cy="6.99988" r="4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </S>
  );

type Shape = "chip" | "square" | "bar" | "gone";
type Placed = { job: QueueJob; shape: Shape; box: Box; index?: number; flash: boolean; p?: number };
type Num = { el: HTMLElement | null; shown: number; target: number; fmt: (n: number) => string };

export function AgentQueue({
  jobs,
  workers,
  now: nowProp,
  rateLimits = [],
  paused = false,
  onPausedChange,
  onConcurrencyChange,
  minConcurrency = 1,
  maxConcurrency = 8,
  backpressure,
  window: span = 2 * MINUTE,
  totals,
  openId,
  defaultOpenId = null,
  onOpenChange,
  onPromote,
  onCancel,
  title = "Queue",
  name,
  className,
}: AgentQueueProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const jobEls = useRef(new Map<string, HTMLButtonElement>());
  const gradId = "ui-agq-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");

  /* ---------- Width ---------- */

  const [W, setW] = useState(0);
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const width = W || 812;

  /* ---------- The clock: yours, or our own while there is work ---------- */

  const [tick, setTick] = useState(() => Date.now());
  const now = nowProp ?? tick;
  const activeLimit = rateLimits.find((l) => l.from <= now && now < l.until);
  const limited = !!activeLimit;
  const queuedAll = jobs.filter((j) => j.status === "queued");
  const runningAll = jobs.filter((j) => j.status === "running");
  const needClock = nowProp === undefined && (queuedAll.length > 0 || runningAll.length > 0 || limited);

  /* ---------- Memory: what each job was last time – so we can see it finish, fail, retry or arrive ---------- */

  const mem = useRef({
    seen: new Map<string, { status: QueueJobStatus; attempt: number; first: number; fresh: boolean; worker?: string }>(),
    gone: new Map<string, number>(),
    flash: new Map<string, number>(),
    limited: false,
    over: false,
    msg: "",
    msgAt: 0,
    mounted: false,
  });
  const real = typeof performance !== "undefined" ? performance.now() : 0;
  {
    const m = mem.current;
    const say = (text: string) => {
      m.msg = text;
      m.msgAt = real;
    };
    for (const j of jobs) {
      const attempt = j.attempt ?? 1;
      const prev = m.seen.get(j.id);
      if (!prev) {
        m.seen.set(j.id, { status: j.status, attempt, first: real, fresh: m.mounted, worker: j.worker });
        continue;
      }
      if (j.status === "running" && j.worker) prev.worker = j.worker;
      if (prev.status === j.status && prev.attempt === attempt) continue;
      const wasLive = prev.status === "running" || prev.status === "queued";
      if ((j.status === "done" || j.status === "failed") && wasLive) m.gone.set(j.id, real);
      if (j.status === "failed" && wasLive) say(`${j.name} failed${j.error ? `: ${j.error}` : ""}`);
      if (j.status === "queued" && prev.status === "running") {
        m.flash.set(j.id, real);
        if (attempt > prev.attempt) say(`${j.name} failed – retrying, attempt ${attempt}${j.maxAttempts ? ` of ${j.maxAttempts}` : ""}`);
      }
      prev.status = j.status;
      prev.attempt = attempt;
    }
    if (limited !== m.limited) {
      if (m.mounted) say(limited ? `Rate limited – workers paused for ${Math.ceil((activeLimit!.until - now) / 1000)} seconds` : "Rate limit lifted – workers resumed");
      m.limited = limited;
    }
    const over = backpressure !== undefined && queuedAll.length > backpressure;
    if (over !== m.over) {
      if (over && m.mounted) say(`${int(queuedAll.length)} jobs waiting – above the backpressure line of ${backpressure}`);
      m.over = over;
    }
    for (const [id, at] of m.gone) if (real - at > LAND) m.gone.delete(id);
    for (const [id, at] of m.flash) if (real - at > FLASH) m.flash.delete(id);
    if (m.seen.size > jobs.length + 64) {
      const ids = new Set(jobs.map((j) => j.id));
      for (const id of m.seen.keys()) if (!ids.has(id)) m.seen.delete(id);
    }
  }
  const [announce, setAnnounce] = useState("");
  useEffect(() => {
    mem.current.mounted = true;
    if (mem.current.msg && mem.current.msg !== announce) setAnnounce(mem.current.msg);
  });

  /* ---------- Where every job is: waiting in order, running in its slot, landing in a bin ---------- */

  const L = layoutFor(width, workers.length);
  const rankOf = (j: QueueJob) => {
    const r = RANK[j.priority ?? "normal"];
    const s = mem.current.seen.get(j.id);
    // A fresh high-priority job lands at the back first, then glides past the others
    return r === 0 && s?.fresh && real - s.first < JUMP ? 1 : r;
  };
  const order = [...queuedAll].sort((a, b) => rankOf(a) - rankOf(b) || a.enqueuedAt - b.enqueuedAt || (a.id < b.id ? -1 : 1));
  const K = L.chips.length;
  const capFull = L.grid.cols * L.grid.rows;
  const overflow = order.length > K + capFull;
  const cap = overflow ? capFull - 3 : capFull;
  const hiddenCount = Math.max(0, order.length - K - cap);
  const slotOf = new Map(workers.map((w, i) => [w.id, i]));

  const placed: Placed[] = [];
  const barIn = (slot: Box): Box => ({ x: slot.x + L.rail.x, y: slot.y + L.rail.y, w: L.rail.w, h: L.rail.h });
  // A job that just failed or finished stays in its slot for a beat – red or green – before it moves on
  const heldSlot = (j: QueueJob, since: number | undefined, hold: number) => {
    if (since === undefined || real - since >= hold) return undefined;
    const w = mem.current.seen.get(j.id)?.worker ?? j.worker;
    const s = w !== undefined ? slotOf.get(w) : undefined;
    return s === undefined ? undefined : L.slots[s];
  };
  let queuedIndex = 0;
  order.forEach((j) => {
    const flash = mem.current.flash.has(j.id);
    const held = heldSlot(j, mem.current.flash.get(j.id), HOLD_FAIL);
    if (held) {
      placed.push({ job: j, shape: "bar", box: barIn(held), flash: true, p: 1 });
      return;
    }
    const i = queuedIndex++;
    if (i < K) placed.push({ job: j, shape: "chip", box: L.chips[i], index: i, flash });
    else if (i < K + cap) {
      const g = i - K;
      placed.push({ job: j, shape: "square", box: { x: L.grid.x + (g % L.grid.cols) * L.grid.step, y: L.grid.y + Math.floor(g / L.grid.cols) * STEP, w: SQ, h: SQ }, index: i, flash });
    }
  });
  for (const j of runningAll) {
    const s = j.worker !== undefined ? slotOf.get(j.worker) : undefined;
    if (s === undefined) continue;
    placed.push({ job: j, shape: "bar", box: barIn(L.slots[s]), flash: false });
  }
  for (const j of jobs) {
    if (!mem.current.gone.has(j.id) || (j.status !== "done" && j.status !== "failed")) continue;
    const held = heldSlot(j, mem.current.gone.get(j.id), j.status === "done" ? HOLD_DONE : HOLD_FAIL);
    if (held) {
      placed.push({ job: j, shape: "bar", box: barIn(held), flash: false, p: 1 });
      continue;
    }
    const bin = j.status === "done" ? L.done : L.failed;
    placed.push({ job: j, shape: "gone", box: { x: bin.x + 17, y: bin.y + (L.narrow ? 15 : 17), w: 10, h: 10 }, flash: false });
  }
  // Stable DOM order, so moving jobs keep their element (and their focus)
  placed.sort((a, b) => (a.job.id < b.job.id ? -1 : 1));

  /* ---------- The queue in numbers ---------- */

  const doneCount = totals?.done ?? jobs.filter((j) => j.status === "done").length;
  const failedCount = totals?.failed ?? jobs.filter((j) => j.status === "failed").length;
  const perMinute = jobs.filter((j) => j.status === "done" && j.endedAt !== undefined && j.endedAt > now - MINUTE && j.endedAt <= now).length;
  const waits = [
    ...jobs.filter((j) => j.startedAt !== undefined && j.status !== "queued" && j.startedAt > now - MINUTE).map((j) => j.startedAt! - j.enqueuedAt),
    ...queuedAll.map((j) => now - j.enqueuedAt),
  ];
  const p95 = pct(waits, 0.95);
  const over = backpressure !== undefined && queuedAll.length > backpressure;
  const state = limited ? "limited" : paused ? "paused" : queuedAll.length || runningAll.length ? "live" : "idle";

  /* ---------- The chart: queue depth over the window, sampled at fixed times so the line glides ---------- */

  const t0 = now - span;
  const stepT = span / 96;
  // A job counts from when it was queued until it started (or ended) – waiting at t means queued <= t < left.
  // Sorted once per list of jobs, not on every tick of the clock
  const { starts, ends } = useMemo(() => {
    const starts: number[] = [];
    const ends: number[] = [];
    for (const j of jobs) {
      const left = j.status === "queued" ? Infinity : (j.startedAt ?? j.endedAt ?? Infinity);
      starts.push(j.enqueuedAt);
      ends.push(Math.max(j.enqueuedAt, left));
    }
    starts.sort((a, b) => a - b);
    ends.sort((a, b) => a - b);
    return { starts, ends };
  }, [jobs]);
  // The samples go forward in time, so both pointers only move ahead – one pass, however many jobs
  let si = 0;
  let ei = 0;
  const depthAt = (t: number) => {
    while (si < starts.length && starts[si] <= t) si++;
    while (ei < ends.length && ends[ei] <= t) ei++;
    return si - ei;
  };
  const samples: [number, number][] = [[t0, depthAt(t0)]];
  for (let t = Math.ceil(t0 / stepT) * stepT; t < now - stepT * 0.25; t += stepT) samples.push([t, depthAt(t)]);
  samples.push([now, queuedAll.length]);
  const peak = Math.max(0, ...samples.map((s) => s[1]));
  const want = Math.max(peak * 1.15, (backpressure ?? 0) * 1.2, 4);
  const ymax = SCALES.find((v) => v >= want) ?? Math.ceil(want / 500) * 500;
  // Room on the left for the scale: 26px, wider once its labels reach four digits
  const gutter = Math.max(GUTTER, 10 + int(ymax).length * 7);
  const plotW = Math.max(40, width - 2 * L.pad - gutter);
  const plotH = L.narrow ? 88 : 112;
  const xOf = (t: number) => ((t - t0) / span) * plotW;
  const pts = samples.map(([t, d]) => [xOf(t), d] as [number, number]);
  const line = smooth(pts);
  const area = line ? `${line}L${r2(plotW)},0L0,0Z` : "";
  const avg = samples.reduce((s, p) => s + p[1], 0) / samples.length;
  const bands = rateLimits.filter((l) => l.until > t0 && l.from < now).map((l) => ({ l, x1: xOf(Math.max(l.from, t0)), x2: xOf(Math.min(l.until, now)) }));
  const minutes = span / MINUTE;
  const spanLabel =
    minutes >= 2 * 24 * 60 ? `${+(minutes / 1440).toFixed(1)} days` : minutes >= 120 ? `${+(minutes / 60).toFixed(1)} h` : minutes >= 2 ? `${+minutes.toFixed(1)} min` : `${Math.round(span / 1000)}s`;
  const summary = `Queue depth over the last ${spanLabel}: ${queuedAll.length} waiting now, peak ${peak}, average ${avg.toFixed(1)}${backpressure !== undefined ? `, backpressure line at ${backpressure}` : ""}${bands.length ? `, rate limited ${bands.length === 1 ? "once" : `${bands.length} times`}` : ""}${failedCount ? `, ${failedCount} failed in all` : ""}.`;

  /* ---------- Numbers that tick: one frame loop eases every number to its new value, writing the text directly ---------- */

  const nums = useRef(new Map<string, Num>());
  const num = (key: string, value: number, fmt: (n: number) => string) => {
    let n = nums.current.get(key);
    if (!n) {
      n = { el: null, shown: value, target: value, fmt };
      nums.current.set(key, n);
    }
    n.target = value;
    n.fmt = fmt;
    const rec = n;
    return (
      <span
        className="ui-agq__num"
        ref={(el) => {
          rec.el = el;
          if (el && !el.textContent) el.textContent = rec.fmt(rec.shown);
        }}
      />
    );
  };
  const live = useRef({ needClock, ymax });
  live.current = { needClock, ymax };
  const wake = useRef<() => void>(() => {});
  useEffect(() => {
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let lastClock = 0;
    let shownMax = live.current.ymax;
    rootRef.current?.style.setProperty("--ui-agq-ymax", String(shownMax));
    const frame = (t: number) => {
      raf = 0;
      const dt = Math.min(64, t - last);
      last = t;
      const instant = reduced();
      const k = 1 - Math.exp(-dt / 110);
      let busy = false;
      for (const n of nums.current.values()) {
        if (n.shown === n.target) continue;
        const d = n.target - n.shown;
        n.shown = instant || Math.abs(d) < 0.02 * Math.max(1, Math.abs(n.target)) * 0.05 + 0.004 ? n.target : n.shown + d * k;
        if (n.el) n.el.textContent = n.fmt(n.shown);
        busy = true;
      }
      const goal = live.current.ymax;
      if (shownMax !== goal) {
        const d = goal - shownMax;
        shownMax = instant || Math.abs(d) < 0.01 ? goal : shownMax + d * (1 - Math.exp(-dt / 160));
        rootRef.current?.style.setProperty("--ui-agq-ymax", String(shownMax));
        busy = true;
      }
      if (live.current.needClock) {
        busy = true;
        if (t - lastClock > 33) {
          lastClock = t;
          setTick(Date.now());
        }
      }
      if (busy && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    wake.current = start;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) start();
    });
    if (rootRef.current) io.observe(rootRef.current);
    document.addEventListener("visibilitychange", start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", start);
    };
  }, []);
  useEffect(() => wake.current());
  useLayoutEffect(() => {
    rootRef.current?.style.setProperty("--ui-agq-ymax", String(live.current.ymax));
  }, []);

  // Landings, red flashes and priority jumps run on real time – make sure we look again when they are due
  const [, bump] = useState(0);
  const pending = mem.current.gone.size > 0 || mem.current.flash.size > 0 || queuedAll.some((j) => j.priority === "high" && real - (mem.current.seen.get(j.id)?.first ?? 0) < JUMP);
  useEffect(() => {
    if (!pending) return;
    const t = window.setTimeout(() => bump((b) => b + 1), 120);
    return () => window.clearTimeout(t);
  });

  /* ---------- Hover card and pinned card ---------- */

  const [innerOpen, setInnerOpen] = useState<string | null>(defaultOpenId);
  const wantOpen = openId === undefined ? innerOpen : openId;
  const setOpen = (id: string | null) => {
    setInnerOpen(id);
    onOpenChange?.(id, id ? jobs.find((j) => j.id === id) : undefined);
  };
  const [hover, setHover] = useState<string | null>(null);
  const live2 = placed.filter((p) => p.shape !== "gone");
  const openPlaced = wantOpen ? live2.find((p) => p.job.id === wantOpen) : undefined;
  const hoverPlaced = !openPlaced && hover ? live2.find((p) => p.job.id === hover) : undefined;
  const cardOf = openPlaced ?? hoverPlaced;
  // A pinned job that finished or left closes its card
  useEffect(() => {
    if (wantOpen && !openPlaced) setOpen(null);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!openPlaced) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || [...jobEls.current.values()].some((el) => el.contains(t))) return;
      setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const [popH, setPopH] = useState(120);
  useLayoutEffect(() => {
    const h = popRef.current?.offsetHeight;
    if (h && Math.abs(h - popH) > 1) setPopH(h);
  });

  /* ---------- Keyboard: one job in the tab order, arrows walk through the slots and the queue ---------- */

  const walkOrder = [
    ...runningAll.filter((j) => j.worker !== undefined && slotOf.has(j.worker)).sort((a, b) => slotOf.get(a.worker!)! - slotOf.get(b.worker!)!),
    ...order.slice(0, K + cap),
  ];
  const [active, setActive] = useState<string | null>(null);
  const activeId = active && walkOrder.some((j) => j.id === active) ? active : walkOrder[0]?.id;
  const focusJob = (j?: QueueJob) => {
    if (!j) return;
    setActive(j.id);
    jobEls.current.get(j.id)?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, j: QueueJob) => {
    const i = walkOrder.findIndex((x) => x.id === j.id);
    const keys: Record<string, () => void> = {
      ArrowDown: () => focusJob(walkOrder[i + 1]),
      ArrowRight: () => focusJob(walkOrder[i + 1]),
      ArrowUp: () => focusJob(walkOrder[i - 1]),
      ArrowLeft: () => focusJob(walkOrder[i - 1]),
      Home: () => focusJob(walkOrder[0]),
      End: () => focusJob(walkOrder[walkOrder.length - 1]),
      Escape: () => wantOpen && setOpen(null),
    };
    if (!keys[e.key]) return;
    e.preventDefault();
    keys[e.key]();
  };

  /* ---------- One job ---------- */

  const progressOf = (j: QueueJob) =>
    j.status === "done" || j.status === "failed" ? 1 : j.status !== "running" ? 0 : clamp(j.progress ?? (j.startedAt !== undefined && j.estimate ? (now - j.startedAt) / j.estimate : 0.5), 0.015, 1);
  const describe = (p: Placed) => {
    const j = p.job;
    const bits = [j.name, KIND[j.kind]];
    if (j.status === "queued") bits.push(`waiting ${took(now - j.enqueuedAt)}`, `position ${int((p.index ?? 0) + 1)} of ${int(order.length)}`);
    if (j.status === "running") bits.push(limited ? "paused by the rate limit" : `running ${took(now - (j.startedAt ?? now))}, ${Math.round(progressOf(j) * 100)}%`);
    if (j.priority === "high") bits.push("high priority");
    if (j.priority === "low") bits.push("low priority");
    if ((j.attempt ?? 1) > 1) bits.push(`attempt ${j.attempt}${j.maxAttempts ? ` of ${j.maxAttempts}` : ""}`);
    return bits.join(", ");
  };
  const job = (p: Placed) => {
    const j = p.job;
    const gone = p.shape === "gone";
    const attempt = j.attempt ?? 1;
    const halted = j.status === "running" && limited;
    const meta =
      j.status === "queued" ? took(now - j.enqueuedAt) : j.status === "running" ? (halted ? "Paused" : took(now - (j.startedAt ?? now))) : j.status === "done" ? "Done" : "Failed";
    const s = mem.current.seen.get(j.id);
    const enter = s && !s.fresh ? Math.min(420, (p.index ?? 0) * 22) : 0;
    return (
      <button
        key={j.id}
        ref={(el) => {
          if (el) jobEls.current.set(j.id, el);
          else jobEls.current.delete(j.id);
        }}
        type="button"
        className="ui-agq__job"
        data-shape={p.shape}
        data-kind={j.kind}
        data-status={j.status}
        data-flash={p.flash ? "" : undefined}
        data-halted={halted ? "" : undefined}
        data-priority={j.priority && j.priority !== "normal" ? j.priority : undefined}
        data-open={wantOpen === j.id ? "" : undefined}
        tabIndex={!gone && activeId === j.id ? 0 : -1}
        aria-hidden={gone || undefined}
        aria-label={describe(p)}
        aria-haspopup="dialog"
        aria-expanded={wantOpen === j.id}
        style={{ translate: `${p.box.x}px ${p.box.y}px`, width: p.box.w, height: p.box.h, "--p": p.p ?? progressOf(j), animationDelay: `${enter}ms` } as CSSProperties}
        onPointerEnter={() => !gone && setHover(j.id)}
        onPointerLeave={() => setHover((h) => (h === j.id ? null : h))}
        onFocus={() => setActive(j.id)}
        onClick={() => {
          if (gone) return;
          setActive(j.id);
          setOpen(wantOpen === j.id ? null : j.id);
        }}
        onKeyDown={(e) => onKey(e, j)}
      >
        <span className="ui-agq__fill" aria-hidden="true" />
        <span className="ui-agq__job-in" aria-hidden="true">
          <span className="ui-agq__job-icon" data-logo={j.icon ? "" : undefined}>
            {j.icon ?? <KindGlyph kind={j.kind} />}
          </span>
          <span className="ui-agq__job-name" dir="auto">
            {j.name}
          </span>
          {j.priority === "high" && (
            <span className="ui-agq__badge" data-kind="high" title="High priority">
              <Up />
            </span>
          )}
          {attempt > 1 && (
            <span className="ui-agq__badge" data-kind="retry" title={`Attempt ${attempt}`}>
              <Retry />
              {attempt}
            </span>
          )}
          <span className="ui-agq__job-meta">{meta}</span>
        </span>
      </button>
    );
  };

  /* ---------- Its card: on hover a peek, on click pinned with actions ---------- */

  const pop = (p: Placed) => {
    const j = p.job;
    const pinned = !!openPlaced;
    const attempt = j.attempt ?? 1;
    const worker = j.worker ? workers.find((w) => w.id === j.worker) : undefined;
    const rows: [string, string][] = [
      j.status === "queued" ? ["Waiting", took(now - j.enqueuedAt)] : ["Waited", took((j.startedAt ?? now) - j.enqueuedAt)],
      ...(j.status === "running" ? [["Running", took(now - (j.startedAt ?? now))] as [string, string]] : []),
      ...(j.status === "queued" ? [["Position", `${int((p.index ?? 0) + 1)} of ${int(order.length)}`] as [string, string]] : []),
      ...(j.status === "running" && worker ? [["Worker", worker.name] as [string, string]] : []),
      ["Priority", j.priority === "high" ? "High" : j.priority === "low" ? "Low" : "Normal"],
      ["Attempt", `${attempt}${j.maxAttempts ? ` of ${j.maxAttempts}` : ""}`],
    ];
    const w = Math.min(L.narrow ? width - 2 * L.pad : 280, width - 16);
    const below = p.box.y + p.box.h + 6;
    const y = below + popH > L.height + 120 && p.box.y - popH - 6 > 0 ? p.box.y - popH - 6 : below;
    const x = clamp(p.box.x, 8, width - w - 8);
    const halted = j.status === "running" && limited;
    const pill = halted ? "Paused" : STATUS[j.status];
    return (
      <div
        key={j.id}
        ref={popRef}
        className="ui-agq__pop"
        role={pinned ? "dialog" : "tooltip"}
        aria-label={`${j.name} details`}
        data-pinned={pinned ? "" : undefined}
        data-kind={j.kind}
        data-status={halted ? "halted" : j.status}
        style={{ translate: `${x}px ${y}px`, width: w }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setOpen(null);
          jobEls.current.get(j.id)?.focus();
        }}
      >
        <div className="ui-agq__pop-head">
          <span className="ui-agq__pop-icon" data-logo={j.icon ? "" : undefined}>
            {j.icon ?? <KindGlyph kind={j.kind} />}
          </span>
          <span className="ui-agq__pop-who">
            <span className="ui-agq__pop-name" dir="auto">
              {j.name}
            </span>
            <span className="ui-agq__pop-kind" dir="auto">
              {KIND[j.kind]}
              {j.detail ? ` · ${j.detail}` : ""}
            </span>
          </span>
          <span className="ui-agq__pill" data-status={halted ? "halted" : j.status}>
            {pill}
          </span>
          {pinned && (
            <button
              type="button"
              className="ui-agq__close"
              aria-label="Close details"
              onClick={() => {
                setOpen(null);
                jobEls.current.get(j.id)?.focus();
              }}
            >
              <Cross size={14} w={1.8} />
            </button>
          )}
        </div>
        <dl className="ui-agq__pop-stats">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {j.error && (
          <p className="ui-agq__pop-error">
            <Alert />
            <span dir="auto">{j.error}</span>
          </p>
        )}
        {pinned && (onPromote || onCancel) && (j.status === "queued" || j.status === "running") && (
          <div className="ui-agq__pop-actions">
            {onPromote && j.status === "queued" && (p.index ?? 0) > 0 && (
              <button type="button" className="ui-agq__btn" onClick={() => onPromote(j)}>
                <Up />
                Move to front
              </button>
            )}
            {onCancel && (
              <button
                type="button"
                className="ui-agq__btn"
                data-kind="danger"
                onClick={() => {
                  onCancel(j);
                  setOpen(null);
                }}
              >
                <Cross size={10} />
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  /* ---------- The whole thing ---------- */

  const at = (b: Box): CSSProperties => ({ translate: `${b.x}px ${b.y}px`, width: b.w, height: b.h });
  const busyCount = runningAll.filter((j) => j.worker !== undefined && slotOf.has(j.worker)).length;
  const stats: { label: string; value: ReactNode; kind?: string }[] = [
    { label: "Waiting", value: num("waiting", queuedAll.length, int), kind: over ? "warn" : undefined },
    {
      label: "Running",
      value: (
        <>
          {num("running", busyCount, int)}
          <span className="ui-agq__of">/{workers.length}</span>
        </>
      ),
    },
    {
      label: "Throughput",
      value: (
        <>
          {num("rate", perMinute, int)}
          <span className="ui-agq__of">/min</span>
        </>
      ),
    },
    { label: "Wait p95", value: num("p95", p95, took) },
  ];
  const left = activeLimit ? Math.max(0, Math.ceil((activeLimit.until - now) / 1000)) : 0;
  const pillText = state === "paused" ? "Paused" : state === "live" ? "Live" : "Idle";
  const canLess = workers.length > minConcurrency;
  const canMore = workers.length < maxConcurrency;

  return (
    <div ref={rootRef} className={["ui-agq", className].filter(Boolean).join(" ")} data-state={state}>
      <style href="ui-agent-queue" precedence="default">
        {css}
      </style>

      <header className="ui-agq__head">
        <span className="ui-agq__mark">
          <QueueGlyph />
        </span>
        <span className="ui-agq__title" title={title}>
          {title}
        </span>
        {name && <span className="ui-agq__name">{name}</span>}
        <span className="ui-agq__pill" data-status={state} role={state === "limited" ? "status" : undefined} title={state === "limited" ? activeLimit?.label : undefined}>
          {(state === "live" || state === "limited") && <span className="ui-agq__pulse" aria-hidden="true" />}
          {state === "limited" ? (
            <>
              Rate limited · <span className="ui-agq__num">{left < 100 ? `${left}s` : took(left * 1000)}</span>
            </>
          ) : (
            pillText
          )}
        </span>
        <span className="ui-agq__tools">
          {onPausedChange && (
            <button type="button" className="ui-agq__btn" aria-pressed={paused} aria-label={paused ? "Resume the queue" : "Pause the queue"} onClick={() => onPausedChange(!paused)}>
              {paused ? <Play /> : <Pause />}
              <span className="ui-agq__btn-text">{paused ? "Resume" : "Pause"}</span>
            </button>
          )}
          {onConcurrencyChange && (
            <span className="ui-agq__stepper" role="group" aria-label="Workers">
              <button type="button" aria-label="One worker less" disabled={!canLess} onClick={() => canLess && onConcurrencyChange(workers.length - 1)}>
                <Minus />
              </button>
              <output className="ui-agq__stepper-value" aria-live="polite" aria-label={`${workers.length} workers`}>
                {workers.length}
              </output>
              <button type="button" aria-label="One worker more" disabled={!canMore} onClick={() => canMore && onConcurrencyChange(workers.length + 1)}>
                <Plus />
              </button>
            </span>
          )}
        </span>
      </header>

      <div ref={cardRef} className="ui-agq__card">
        <dl className="ui-agq__stats">
          {stats.map((s) => (
            <div key={s.label} className="ui-agq__stat" data-kind={s.kind}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>

        {/* The flow: queue → workers → done / failed */}
        <div className="ui-agq__flow" style={{ height: L.height }} data-narrow={L.narrow ? "" : undefined}>
          <span className="ui-agq__col-head" style={at(L.heads.queue)}>
            <span>Queue</span>
            <b>{num("depth", queuedAll.length, int)}</b>
            {hiddenCount > 0 && L.narrow && <span className="ui-agq__col-more">+{int(hiddenCount)} more</span>}
          </span>
          <span className="ui-agq__col-head" style={at(L.heads.workers)}>
            <span>Workers</span>
            <b>
              {busyCount}/{workers.length}
            </b>
          </span>

          {/* The well the backlog sits in */}
          {/* The well the backlog sits in – only while there is a backlog */}
          <span className="ui-agq__well" aria-hidden="true" data-empty={order.length <= K ? "" : undefined} style={at(L.well)} />
          {order.length === 0 && (
            <span className="ui-agq__empty" style={at({ x: L.chips[0].x, y: L.chips[0].y, w: L.chips[0].w, h: L.well.y + L.well.h - L.chips[0].y })}>
              Nothing waiting
            </span>
          )}
          {overflow && (
            <span
              className="ui-agq__more"
              aria-hidden="true"
              style={at({ x: L.grid.x + ((capFull - 3) % L.grid.cols) * L.grid.step, y: L.grid.y + Math.floor((capFull - 3) / L.grid.cols) * STEP, w: 2 * L.grid.step + SQ, h: SQ })}
            >
              +{count(hiddenCount)}
            </span>
          )}


          {workers.map((w, i) => {
            const slot = L.slots[i];
            const busy = runningAll.some((j) => j.worker === w.id);
            return (
              <div key={w.id} className="ui-agq__slot" data-busy={busy ? "" : undefined} data-limited={limited ? "" : undefined} style={at(slot)}>
                <span className="ui-agq__who" style={{ width: L.rail.x - 16 }}>
                  <span className="ui-agq__logo" data-logo={w.icon ? "" : undefined}>
                    {w.icon ?? initials(w.name)}
                  </span>
                  <span className="ui-agq__who-text">
                    <span className="ui-agq__who-name">{w.name}</span>
                  </span>
                </span>
                <span className="ui-agq__rail" style={{ left: L.rail.x, top: L.rail.y, width: L.rail.w, height: L.rail.h }}>
                  {!busy && <span>{limited || paused ? "Paused" : "Idle"}</span>}
                </span>
              </div>
            );
          })}

          {(["done", "failed"] as const).map((k) => {
            const n = k === "done" ? doneCount : failedCount;
            return (
              <div key={k} className="ui-agq__bin" data-kind={k} style={at(k === "done" ? L.done : L.failed)}>
                <span className="ui-agq__bin-icon">{k === "done" ? <Tick /> : <Cross />}</span>
                <span className="ui-agq__bin-label">{k === "done" ? "Done" : "Failed"}</span>
                <span className="ui-agq__bin-count" title={int(n)}>
                  {num(`bin-${k}`, n, count)}
                </span>
                <span key={n} className="ui-agq__bin-hit" aria-hidden="true" />
              </div>
            );
          })}

          <div className="ui-agq__jobs" role="group" aria-label={`Jobs: ${busyCount} running, ${order.length} waiting`}>
            {placed.map(job)}
          </div>
          {cardOf && pop(cardOf)}
        </div>

        {/* The chart: how deep the queue has been */}
        <div className="ui-agq__chart" style={{ "--ui-agq-gutter": `${gutter}px` } as CSSProperties}>
          <div className="ui-agq__chart-head">
            <span className="ui-agq__chart-title">Queue depth</span>
          </div>
          <div className="ui-agq__plot" role="img" aria-label={summary} style={{ height: plotH }}>
            {[0, ymax].map((v) => (
              <span key={v} className="ui-agq__grid" data-zero={v === 0 ? "" : undefined} style={{ "--v": v } as CSSProperties} aria-hidden="true">
                {(backpressure === undefined || Math.abs(v - backpressure) > ymax * 0.1) && <span>{int(v)}</span>}
              </span>
            ))}
            <svg className="ui-agq__svg" width={plotW} height={plotH} viewBox={`0 0 ${plotW} ${plotH}`} aria-hidden="true">
              <defs>
                <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0" className="ui-agq__stop" data-at="top" />
                  <stop offset="1" className="ui-agq__stop" data-at="bottom" />
                </linearGradient>
              </defs>
              {bands.map(({ l, x1, x2 }) => (
                <g key={l.from} className="ui-agq__band">
                  <rect x={x1} y={0} width={Math.max(1, x2 - x1)} height={plotH} />
                </g>
              ))}
              <g className="ui-agq__scaled" style={{ "--h": plotH } as CSSProperties}>
                <path className="ui-agq__area" d={area} fill={`url(#${gradId})`} />
                <path className="ui-agq__line" d={line} />
                {backpressure !== undefined && <line className="ui-agq__bp" x1={0} x2={plotW} y1={backpressure} y2={backpressure} />}
              </g>
            </svg>
            {backpressure !== undefined && (
              <span className="ui-agq__bp-label" style={{ "--v": backpressure } as CSSProperties} aria-hidden="true">
                {backpressure}
              </span>
            )}
            <span className="ui-agq__dot" style={{ "--v": queuedAll.length } as CSSProperties} aria-hidden="true" />
          </div>
          <div className="ui-agq__axis" aria-hidden="true">
            <span>{spanLabel} ago</span>
            <span>now</span>
          </div>
        </div>
      </div>

      <div className="ui-agq__sr" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

const css = /* css */ `
/* The chart's scale glides, so it's registered as a number */
@property --ui-agq-ymax { syntax: "<number>"; inherits: true; initial-value: 10; }
/* Colors, sizes and motion as variables – override them on .ui-agq */
.ui-agq {
  --ui-agq-tray: #f0f0f0;
  --ui-agq-card: #ffffff;
  --ui-agq-strong: #171717;
  --ui-agq-ink: #171717;
  --ui-agq-text: #6b6b6b;
  --ui-agq-muted: #8a8a8a;
  --ui-agq-faint: #b8b8b8;
  --ui-agq-line: #ececec;
  --ui-agq-grid: #f1f1f1;
  --ui-agq-chip: #f5f5f5;
  --ui-agq-wash: #f7f7f7;
  --ui-agq-well: #fafafa;
  --ui-agq-accent: #2f6bff;
  --ui-agq-depth: #5a45d4;
  --ui-agq-depth-fill: rgba(90, 69, 212, 0.16);
  --ui-agq-depth-fade: rgba(90, 69, 212, 0);
  /* Jobs by kind: a tint, its edge, the ink on it and a stronger tint for the backlog squares */
  --ui-agq-agent-bg: #eef0f3;
  --ui-agq-agent-edge: #d3d8e0;
  --ui-agq-agent-ink: #4b5363;
  --ui-agq-agent-sq: #d9dde4;
  --ui-agq-llm-bg: #efecff;
  --ui-agq-llm-edge: #cbc2fb;
  --ui-agq-llm-ink: #5a45d4;
  --ui-agq-llm-sq: #d4ccfb;
  --ui-agq-tool-bg: #e4f5f1;
  --ui-agq-tool-edge: #a9ddd1;
  --ui-agq-tool-ink: #0e7a67;
  --ui-agq-tool-sq: #bfe6dc;
  --ui-agq-human-bg: #eaf1ff;
  --ui-agq-human-edge: #bcd0fb;
  --ui-agq-human-ink: #2456d6;
  --ui-agq-human-sq: #cddcfd;
  --ui-agq-error-bg: #fde8e5;
  --ui-agq-error-edge: #f1a397;
  --ui-agq-error-ink: #c2331f;
  --ui-agq-ok-bg: #e6f6ec;
  --ui-agq-ok-edge: #a6dcb9;
  --ui-agq-ok-fg: #1a7f45;
  --ui-agq-warn: #e08a00;
  --ui-agq-warn-bg: #fff3e0;
  --ui-agq-warn-edge: #f5cf94;
  --ui-agq-warn-fg: #b85c00;
  --ui-agq-brand-fg: #2456d6;
  --ui-agq-ring: rgba(23, 23, 23, 0.22);
  --ui-agq-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-agq-lift: 0 0 0 1px #e8e8e8, 0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 6px -2px rgba(0, 0, 0, 0.06);
  --ui-agq-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-agq-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-agq-tray);
  container: ui-agq / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-agq-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-agq *, .ui-agq *::before, .ui-agq *::after { box-sizing: border-box; }
:where(.ui-agq) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-agq button:focus-visible { outline: 2px solid var(--ui-agq-ring); outline-offset: 1px; }
.ui-agq :is(p, dl, dd) { margin: 0; }
.ui-agq svg { display: block; flex: none; }
.ui-agq__num { font-variant-numeric: tabular-nums; }

/* ----- On the tray: the queue's name, its state and the controls ----- */
.ui-agq__head { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; padding: 4px 4px 8px 12px; }
.ui-agq__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-agq-accent); }
.ui-agq__title { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-agq-strong); }
.ui-agq__name { flex: 0 1000 auto; min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-agq-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agq__pill { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 22px; padding: 0 9px; border-radius: 999px; background: var(--ui-agq-chip); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-agq-text); white-space: nowrap; }
.ui-agq__head .ui-agq__pill { background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); }
.ui-agq__pill[data-status="live"] { color: var(--ui-agq-brand-fg); }
.ui-agq__pill[data-status="limited"] { color: var(--ui-agq-warn-fg); }
.ui-agq__head .ui-agq__pill[data-status="limited"] { background: var(--ui-agq-warn-bg); box-shadow: inset 0 0 0 1px var(--ui-agq-warn-edge); }
.ui-agq__pill[data-status="running"] { color: var(--ui-agq-brand-fg); }
.ui-agq__pill[data-status="done"] { color: var(--ui-agq-ok-fg); }
.ui-agq__pill[data-status="failed"] { color: var(--ui-agq-error-ink); }
.ui-agq__pop .ui-agq__pill[data-status="running"] { background: #eaf1ff; }
.ui-agq__pulse { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: ui-agq-pulse 1400ms ease-in-out infinite; }
.ui-agq__tools { display: flex; flex: none; align-items: center; gap: 6px; margin-left: auto; }
.ui-agq__btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px 0 9px; border-radius: 9px; background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); font-size: 13px; font-weight: 500; color: var(--ui-agq-ink); white-space: nowrap; transition: box-shadow 140ms ease, background-color 140ms ease; }
.ui-agq__btn:hover { box-shadow: 0 0 0 1px #dedede, 0 1px 3px rgba(0, 0, 0, 0.08); }
.ui-agq__btn[aria-pressed="true"] { color: var(--ui-agq-brand-fg); }
.ui-agq__btn[data-kind="danger"] { color: var(--ui-agq-error-ink); }
.ui-agq__stepper { display: inline-flex; align-items: center; height: 28px; padding: 0 2px 0 10px; border-radius: 9px; background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); }
.ui-agq__stepper button { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 7px; color: var(--ui-agq-text); transition: background-color 140ms ease, color 140ms ease; }
.ui-agq__stepper button:hover:not(:disabled) { background: var(--ui-agq-chip); color: var(--ui-agq-ink); }
.ui-agq__stepper button:disabled { opacity: 0.35; cursor: default; }
.ui-agq__stepper-value { min-width: 18px; font-size: 13px; font-weight: 600; color: var(--ui-agq-ink); text-align: center; font-variant-numeric: tabular-nums; }

/* ----- The white card: the queue in numbers, the flow and the chart ----- */
.ui-agq__card { position: relative; border-radius: 16px; background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); }
.ui-agq__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 14px 0; border-bottom: 1px solid var(--ui-agq-line); }
.ui-agq__stat { display: grid; gap: 2px; min-width: 0; padding: 0 16px; }
.ui-agq__stat:first-child { padding-left: 22px; }
.ui-agq__stat:last-child { padding-right: 10px; }
.ui-agq__stat + .ui-agq__stat { border-left: 1px solid var(--ui-agq-line); }
.ui-agq__stat dt { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-agq-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agq__stat dd { overflow: hidden; font-size: 16px; font-weight: 600; line-height: 22px; letter-spacing: -0.01em; color: var(--ui-agq-ink); white-space: nowrap; font-variant-numeric: tabular-nums; transition: color 240ms ease; }
.ui-agq__of { margin-left: 1px; font-size: 13px; font-weight: 500; color: var(--ui-agq-muted); }
.ui-agq__stat[data-kind="warn"] dd { color: var(--ui-agq-warn-fg); }
.ui-agq__stat[data-kind="failed"] dd { color: var(--ui-agq-error-ink); }

/* ----- The flow: everything in it is placed by its box and glides to the next one ----- */
.ui-agq__flow { position: relative; border-bottom: 1px solid var(--ui-agq-line); transition: height 360ms var(--ui-agq-ease); }
.ui-agq__flow > *, .ui-agq__jobs > * { position: absolute; top: 0; left: 0; }
.ui-agq__col-head { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--ui-agq-muted); white-space: nowrap; }
.ui-agq__col-head > b { font-weight: 600; color: var(--ui-agq-ink); font-variant-numeric: tabular-nums; }
/* The rate limit, with its countdown – a line under it runs out until the workers resume */

.ui-agq__col-head > .ui-agq__col-more { margin-left: auto; font-weight: 400; }
.ui-agq__well { border-radius: 8px; background: var(--ui-agq-well); box-shadow: inset 0 0 0 1px var(--ui-agq-grid); }
.ui-agq__empty { display: grid; place-items: center; color: var(--ui-agq-faint); animation: ui-agq-calm 300ms var(--ui-agq-ease) both; }
.ui-agq__well { transition: opacity 300ms var(--ui-agq-ease); }
.ui-agq__well[data-empty] { opacity: 0; }
@keyframes ui-agq-calm { from { opacity: 0; } }
.ui-agq__more { display: grid; place-items: center; border-radius: 3px; background: var(--ui-agq-chip); font-size: 10px; font-weight: 600; line-height: 12px; color: var(--ui-agq-text); font-variant-numeric: tabular-nums; }

/* Worker slots: who it is on the left, the rail its job runs on to the right */
.ui-agq__slot { border-radius: 12px; background: var(--ui-agq-wash); transition: translate ${MOVE}ms var(--ui-agq-ease), width ${MOVE}ms var(--ui-agq-ease), background-color 300ms ease; animation: ui-agq-slot 420ms var(--ui-agq-ease) both; }
.ui-agq__who { position: absolute; top: 0; bottom: 0; left: 8px; display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-agq__logo { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: 7px; background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); font-size: 10px; font-weight: 600; color: var(--ui-agq-text); }
.ui-agq__logo > svg { width: 14px; height: 14px; }
.ui-agq__who-text { display: grid; min-width: 0; }
.ui-agq__who-name { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 16px; color: var(--ui-agq-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-agq__rail { position: absolute; display: flex; align-items: center; padding-left: 10px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--ui-agq-line); background-image: repeating-linear-gradient(-45deg, transparent 0 6px, rgba(0, 0, 0, 0.018) 6px 7px); font-size: 12px; color: var(--ui-agq-faint); }

/* Done and Failed: a tick or a cross, a count, and a soft ring when a job lands */
.ui-agq__bin { z-index: 1; padding: 12px; border-radius: 12px; background: var(--ui-agq-wash); }
.ui-agq__bin-icon { position: absolute; top: 12px; left: 12px; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; }
.ui-agq__bin[data-kind="done"] .ui-agq__bin-icon { background: var(--ui-agq-ok-bg); box-shadow: inset 0 0 0 1px var(--ui-agq-ok-edge); color: var(--ui-agq-ok-fg); }
.ui-agq__bin[data-kind="failed"] .ui-agq__bin-icon { background: var(--ui-agq-error-bg); box-shadow: inset 0 0 0 1px var(--ui-agq-error-edge); color: var(--ui-agq-error-ink); }
.ui-agq__bin-label { position: absolute; top: 14px; left: 40px; font-size: 12px; line-height: 16px; color: var(--ui-agq-muted); }
.ui-agq__bin-count { position: absolute; left: 12px; bottom: 10px; font-size: 20px; font-weight: 600; line-height: 26px; letter-spacing: -0.02em; color: var(--ui-agq-ink); }
.ui-agq__bin[data-kind="failed"] .ui-agq__bin-count { color: var(--ui-agq-error-ink); }
.ui-agq__bin-hit { position: absolute; top: 12px; left: 12px; width: 20px; height: 20px; border-radius: 6px; opacity: 0; pointer-events: none; animation: ui-agq-hit 700ms ease-out 380ms; }
.ui-agq__bin[data-kind="done"] .ui-agq__bin-hit { box-shadow: 0 0 0 1px var(--ui-agq-ok-fg); }
.ui-agq__bin[data-kind="failed"] .ui-agq__bin-hit { box-shadow: 0 0 0 1px var(--ui-agq-error-ink); }
.ui-agq__flow[data-narrow] .ui-agq__who-text { display: none; }
/* Phones: Done and Failed side by side – the mark, the count, the word */
.ui-agq__flow[data-narrow] .ui-agq__bin { display: flex; align-items: center; gap: 6px; padding: 0 10px; }
.ui-agq__flow[data-narrow] :is(.ui-agq__bin-icon, .ui-agq__bin-label, .ui-agq__bin-count) { position: static; }
.ui-agq__flow[data-narrow] .ui-agq__bin-icon { flex: none; }
.ui-agq__flow[data-narrow] .ui-agq__bin-count { order: 1; font-size: 16px; line-height: 22px; }
.ui-agq__flow[data-narrow] .ui-agq__bin-label { order: 2; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-agq__flow[data-narrow] .ui-agq__bin-hit { top: 10px; }

/* ----- One job: a card while it waits up front, a square in the backlog, a bar while it runs ----- */
.ui-agq [data-kind] { --k-bg: var(--ui-agq-agent-bg); --k-edge: var(--ui-agq-agent-edge); --k-ink: var(--ui-agq-agent-ink); --k-sq: var(--ui-agq-agent-sq); }
.ui-agq [data-kind="llm"] { --k-bg: var(--ui-agq-llm-bg); --k-edge: var(--ui-agq-llm-edge); --k-ink: var(--ui-agq-llm-ink); --k-sq: var(--ui-agq-llm-sq); }
.ui-agq [data-kind="tool"] { --k-bg: var(--ui-agq-tool-bg); --k-edge: var(--ui-agq-tool-edge); --k-ink: var(--ui-agq-tool-ink); --k-sq: var(--ui-agq-tool-sq); }
.ui-agq [data-kind="human"] { --k-bg: var(--ui-agq-human-bg); --k-edge: var(--ui-agq-human-edge); --k-ink: var(--ui-agq-human-ink); --k-sq: var(--ui-agq-human-sq); }
.ui-agq .ui-agq__job:is([data-status="failed"], [data-flash]) { --k-bg: var(--ui-agq-error-bg); --k-edge: var(--ui-agq-error-edge); --k-ink: var(--ui-agq-error-ink); --k-sq: var(--ui-agq-error-edge); }
.ui-agq .ui-agq__job[data-status="done"] { --k-bg: var(--ui-agq-ok-bg); --k-edge: var(--ui-agq-ok-edge); --k-ink: var(--ui-agq-ok-fg); --k-sq: var(--ui-agq-ok-edge); }
.ui-agq__jobs { position: absolute; inset: 0; pointer-events: none; }
.ui-agq__job {
  z-index: 1;
  display: block;
  overflow: hidden;
  border-radius: 8px;
  background: var(--ui-agq-card);
  box-shadow: var(--ui-agq-lift);
  pointer-events: auto;
  transition: translate ${MOVE}ms var(--ui-agq-ease), width ${MOVE}ms var(--ui-agq-ease), height ${MOVE}ms var(--ui-agq-ease), border-radius ${MOVE}ms var(--ui-agq-ease), background-color 320ms ease, box-shadow 320ms ease, opacity 240ms ease;
  animation: ui-agq-drop 520ms var(--ui-agq-ease) backwards;
}
.ui-agq__job:hover, .ui-agq__job[data-open] { z-index: 2; box-shadow: 0 0 0 1px var(--k-edge), 0 2px 8px -2px rgba(0, 0, 0, 0.12); }
.ui-agq__job:focus-visible { z-index: 2; outline: 2px solid var(--ui-agq-ring); outline-offset: 1px; }
.ui-agq__job[data-flash] { background: var(--k-bg); box-shadow: 0 0 0 1px var(--k-edge); animation: ui-agq-drop 520ms var(--ui-agq-ease) backwards, ui-agq-shake 420ms ease; }
.ui-agq__job[data-shape="square"] { border-radius: 3px; background: var(--k-sq); box-shadow: inset 0 0 0 1px var(--k-edge); }
.ui-agq__job[data-shape="square"][data-priority="high"] { box-shadow: inset 0 0 0 1.5px var(--ui-agq-warn); }
.ui-agq__job[data-shape="square"]:hover { box-shadow: inset 0 0 0 1.5px var(--k-ink); }
.ui-agq__job[data-shape="bar"] { box-shadow: var(--ui-agq-shadow); }
/* Landing in a bin: it shrinks on its way and fades as it arrives */
.ui-agq__job[data-shape="gone"] { z-index: 0; border-radius: 3px; background: var(--k-sq); box-shadow: none; opacity: 0; pointer-events: none; transition: translate 480ms var(--ui-agq-ease), width 480ms var(--ui-agq-ease), height 480ms var(--ui-agq-ease), border-radius 480ms ease, background-color 200ms ease, opacity 200ms ease 220ms; }

.ui-agq__job-in { position: absolute; inset: 0; display: flex; align-items: center; gap: 6px; padding: 0 9px 0 6px; white-space: nowrap; opacity: 1; transition: opacity 200ms ease 160ms; }
.ui-agq__job:is([data-shape="square"], [data-shape="gone"]) .ui-agq__job-in { opacity: 0; transition: opacity 120ms ease; }
.ui-agq__job-icon { display: grid; flex: none; place-items: center; width: 18px; height: 18px; border-radius: 5px; background: var(--k-bg); color: var(--k-ink); }
.ui-agq__job-icon[data-logo] { background: var(--ui-agq-card); box-shadow: 0 0 0 1px var(--ui-agq-line); }
.ui-agq__job-icon > svg { width: 11px; height: 11px; }
.ui-agq__job-name { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; line-height: 16px; color: var(--ui-agq-ink); text-overflow: ellipsis; }
.ui-agq__badge { display: inline-flex; flex: none; align-items: center; gap: 2px; height: 16px; padding: 0 4px; border-radius: 999px; font-size: 10.5px; font-weight: 600; line-height: 16px; font-variant-numeric: tabular-nums; }
.ui-agq__badge[data-kind="high"] { width: 16px; padding: 0; justify-content: center; background: var(--ui-agq-warn-bg); color: var(--ui-agq-warn-fg); }
.ui-agq__badge[data-kind="retry"] { background: var(--ui-agq-error-bg); color: var(--ui-agq-error-ink); }
.ui-agq__job-meta { flex: none; font-size: 11.5px; line-height: 16px; color: var(--ui-agq-muted); font-variant-numeric: tabular-nums; }
.ui-agq__job[data-status="running"] .ui-agq__job-meta { color: var(--k-ink); }
.ui-agq__job[data-flash] :is(.ui-agq__job-name, .ui-agq__job-meta) { color: var(--ui-agq-error-ink); }

/* The bar: a tint that grows with the progress, a sheen sweeping along and a glowing front edge */
.ui-agq__fill { position: absolute; inset: 0; border-radius: inherit; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); clip-path: inset(0 calc((1 - var(--p)) * 100%) 0 0 round 8px); opacity: 0; transition: clip-path 260ms linear, opacity 300ms var(--ui-agq-ease), background-color 300ms ease, box-shadow 300ms ease; }
.ui-agq__job[data-shape="bar"] .ui-agq__fill { opacity: 1; animation: ui-agq-grow 560ms var(--ui-agq-ease) backwards; }
.ui-agq__job[data-shape="bar"] .ui-agq__fill::before { transition: opacity 300ms var(--ui-agq-ease); content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--ui-agq-card), transparent) -60px 0 / 60px 100% no-repeat; opacity: 0.7; animation: ui-agq-sweep 1500ms linear infinite; }
.ui-agq__job[data-shape="bar"] .ui-agq__fill::after { transition: opacity 300ms var(--ui-agq-ease); content: ""; position: absolute; top: 0; bottom: 0; left: calc(var(--p) * 100% - 28px); width: 28px; background: linear-gradient(90deg, transparent, var(--k-edge)); animation: ui-agq-glow 1100ms ease-in-out infinite alternate; }
.ui-agq__job[data-shape="gone"] .ui-agq__fill { opacity: 0; }

/* ----- The card on a job ----- */
.ui-agq__pop { z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; padding: 12px; border-radius: 16px; background: var(--ui-agq-card); box-shadow: var(--ui-agq-pop); pointer-events: none; transition: translate ${MOVE}ms var(--ui-agq-ease); animation: ui-agq-open 200ms var(--ui-agq-ease) both; }
.ui-agq__pop[data-pinned] { pointer-events: auto; }
.ui-agq__pop-head { display: flex; align-items: center; min-width: 0; }
.ui-agq__pop-icon { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin-right: 10px; border-radius: 8px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); color: var(--k-ink); }
.ui-agq__pop-icon[data-logo] { background: var(--ui-agq-card); box-shadow: var(--ui-agq-shadow); }
.ui-agq__pop-icon > svg { width: 15px; height: 15px; }
.ui-agq__pop-who { display: grid; flex: 1; min-width: 0; }
.ui-agq__pop-name { font-size: 13.5px; font-weight: 600; line-height: 18px; color: var(--ui-agq-strong); overflow-wrap: anywhere; }
.ui-agq__pop-kind { display: -webkit-box; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-agq-muted); overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-agq__pop-head .ui-agq__pill { height: 20px; margin-left: 8px; padding: 0 7px; font-size: 11px; }
.ui-agq__close { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin: -2px -4px 0 4px; border-radius: 8px; color: var(--ui-agq-muted); transition: background-color 140ms ease, color 140ms ease; }
.ui-agq__close:hover { background: var(--ui-agq-chip); color: var(--ui-agq-ink); }
.ui-agq__pop-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 10px 12px; border-radius: 10px; background: var(--ui-agq-wash); }
.ui-agq__pop-stats dt { font-size: 11px; line-height: 14px; color: var(--ui-agq-muted); }
.ui-agq__pop-stats dd { overflow: hidden; font-size: 13px; font-weight: 600; line-height: 18px; color: var(--ui-agq-ink); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-agq__pop-error { display: flex; gap: 8px; min-width: 0; overflow-wrap: anywhere; padding: 8px 10px; border-radius: 10px; background: var(--ui-agq-error-bg); font-size: 12.5px; line-height: 17px; color: var(--ui-agq-error-ink); }
.ui-agq__pop-error > svg { margin-top: 2.5px; }
.ui-agq__pop-actions { display: flex; gap: 6px; }
.ui-agq__pop-actions .ui-agq__btn { height: 26px; padding: 0 10px 0 8px; font-size: 12.5px; }

/* ----- The chart ----- */
.ui-agq__chart { padding: 14px 16px 12px; }
.ui-agq__chart-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 12px; line-height: 16px; white-space: nowrap; }
.ui-agq__chart-title { font-weight: 500; color: var(--ui-agq-ink); }
.ui-agq__plot { position: relative; margin-left: var(--ui-agq-gutter, ${GUTTER}px); }
.ui-agq__grid { position: absolute; left: -6px; right: 0; bottom: calc(var(--v) / var(--ui-agq-ymax) * 100%); height: 1px; background: var(--ui-agq-grid); }
.ui-agq__grid[data-zero] { background: var(--ui-agq-line); }
.ui-agq__grid > span { position: absolute; right: calc(100% + 8px); top: -7px; font-size: 11px; line-height: 14px; color: var(--ui-agq-muted); font-variant-numeric: tabular-nums; }
.ui-agq__svg { position: absolute; inset: 0; overflow: hidden; }
/* Drawn in queue-depth units and scaled by the gliding --ui-agq-ymax, so a rescale never jumps */
.ui-agq__scaled { transform: translateY(calc(var(--h) * 1px)) scaleY(calc(-1 * var(--h) / var(--ui-agq-ymax))); }
.ui-agq__stop[data-at="top"] { stop-color: var(--ui-agq-depth-fade); }
.ui-agq__stop[data-at="bottom"] { stop-color: var(--ui-agq-depth-fill); }
.ui-agq__line { fill: none; stroke: var(--ui-agq-depth); stroke-width: 1.5; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.ui-agq__bp { stroke: var(--ui-agq-faint); stroke-width: 1; stroke-dasharray: 4 4; vector-effect: non-scaling-stroke; opacity: 0.8; }
.ui-agq__band rect { fill: var(--ui-agq-warn); opacity: 0.07; }
.ui-agq__bp-label { position: absolute; right: calc(100% + 8px); bottom: calc(var(--v) / var(--ui-agq-ymax) * 100% - 7px); font-size: 11px; font-weight: 500; line-height: 14px; color: var(--ui-agq-muted); font-variant-numeric: tabular-nums; }
.ui-agq__dot { position: absolute; right: -3.5px; bottom: calc(var(--v) / var(--ui-agq-ymax) * 100% - 3.5px); width: 7px; height: 7px; border-radius: 50%; background: var(--ui-agq-depth); box-shadow: 0 0 0 3px var(--ui-agq-card); }
.ui-agq[data-state="live"] .ui-agq__dot::after, .ui-agq[data-state="limited"] .ui-agq__dot::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: var(--ui-agq-depth); animation: ui-agq-ping 1600ms ease-out infinite; }
.ui-agq__axis { display: flex; justify-content: space-between; margin: 6px 0 0 var(--ui-agq-gutter, ${GUTTER}px); font-size: 11px; line-height: 14px; color: var(--ui-agq-muted); font-variant-numeric: tabular-nums; }

.ui-agq__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ----- Narrow ----- */
@container ui-agq (max-width: 560px) {
  .ui-agq__head { flex-wrap: wrap; row-gap: 6px; padding: 4px 4px 8px 10px; }
  .ui-agq__name { display: none; }
  .ui-agq__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); row-gap: 12px; padding: 12px 0; }
  .ui-agq__stat { padding: 0 12px; }
  .ui-agq__stat:nth-child(odd) { padding-left: 16px; border-left: 0; }
  .ui-agq__stat dd { font-size: 15px; }
  .ui-agq__stat:nth-child(3) { border-left: 0; }
  .ui-agq__chart { padding: 12px 12px 10px; }
}
@container ui-agq (max-width: 440px) {
  /* The controls get a row of their own: Pause on the left, the workers on the right */
  .ui-agq__tools { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-agq__head { padding-right: 8px; }

}

/* Paused by a rate limit: the bar keeps its colors, dims a little and stops – no sheen, no glow */
.ui-agq__job[data-halted] .ui-agq__fill { opacity: 0.55; }
.ui-agq__job[data-halted] .ui-agq__fill::before, .ui-agq__job[data-halted] .ui-agq__fill::after { opacity: 0; animation-play-state: paused; }
.ui-agq__job[data-halted] .ui-agq__job-meta { color: var(--ui-agq-muted); }
@keyframes ui-agq-drop { from { opacity: 0; transform: translateY(-10px) scale(0.6); } }
@keyframes ui-agq-slot { from { opacity: 0; transform: translateX(-8px); } }
@keyframes ui-agq-grow { from { clip-path: inset(0 100% 0 0 round 8px); } }
@keyframes ui-agq-sweep { to { background-position: calc(100% + 60px) 0; } }
@keyframes ui-agq-glow { from { filter: opacity(0.45); } to { filter: opacity(1); } }
@keyframes ui-agq-pulse { 50% { opacity: 0.35; } }
@keyframes ui-agq-pop { from { opacity: 0; transform: scale(0.9); } }
@keyframes ui-agq-open { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }
@keyframes ui-agq-hit { 0% { opacity: 0.45; transform: scale(1); } 100% { opacity: 0; transform: scale(1.45); } }
@keyframes ui-agq-ping { 0% { opacity: 0.5; transform: scale(1); } 100% { opacity: 0; transform: scale(2.8); } }
@keyframes ui-agq-flow { 0%, 100% { opacity: 0.35; } 40% { opacity: 1; } }
@keyframes ui-agq-shake { 20% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(1px); } }

@media (prefers-reduced-motion: reduce) {
  .ui-agq *, .ui-agq *::before, .ui-agq *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-agq {
  --ui-agq-tray: #19191c;
  --ui-agq-card: #232326;
  --ui-agq-strong: #ededed;
  --ui-agq-ink: #ededed;
  --ui-agq-text: #a1a1a6;
  --ui-agq-muted: #7c7c82;
  --ui-agq-faint: #55555b;
  --ui-agq-line: #2e2e33;
  --ui-agq-grid: #2a2a2e;
  --ui-agq-chip: #2c2c30;
  --ui-agq-wash: #1d1d20;
  --ui-agq-well: #1f1f22;
  --ui-agq-accent: #5b9aff;
  --ui-agq-depth: #a395ff;
  --ui-agq-depth-fill: rgba(141, 124, 240, 0.26);
  --ui-agq-depth-fade: rgba(141, 124, 240, 0);
  --ui-agq-agent-bg: #2c2f35;
  --ui-agq-agent-edge: #41464f;
  --ui-agq-agent-ink: #b8c0cc;
  --ui-agq-agent-sq: #3a3e46;
  --ui-agq-llm-bg: #2a2545;
  --ui-agq-llm-edge: #4c3fa0;
  --ui-agq-llm-ink: #b6a9ff;
  --ui-agq-llm-sq: #3b3270;
  --ui-agq-tool-bg: #16302b;
  --ui-agq-tool-edge: #285f54;
  --ui-agq-tool-ink: #62d5bb;
  --ui-agq-tool-sq: #1f4a41;
  --ui-agq-human-bg: #16243f;
  --ui-agq-human-edge: #2c4a85;
  --ui-agq-human-ink: #8ab4ff;
  --ui-agq-human-sq: #223a66;
  --ui-agq-error-bg: #3b1714;
  --ui-agq-error-edge: #74302a;
  --ui-agq-error-ink: #ff977d;
  --ui-agq-ok-bg: #12301f;
  --ui-agq-ok-edge: #22603d;
  --ui-agq-ok-fg: #3dd68c;
  --ui-agq-warn: #ffa057;
  --ui-agq-warn-bg: #3a2410;
  --ui-agq-warn-edge: #6e4318;
  --ui-agq-warn-fg: #ffa057;
  --ui-agq-brand-fg: #8ab4ff;
  --ui-agq-ring: rgba(237, 237, 237, 0.3);
  --ui-agq-shadow: 0 0 0 1px #2e2e33, 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-agq-lift: 0 0 0 1px #36363c, 0 1px 2px rgba(0, 0, 0, 0.35), 0 2px 6px -2px rgba(0, 0, 0, 0.4);
  --ui-agq-pop: 0 0 0 1px #34343a, 0 16px 36px -12px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-agq__pop .ui-agq__pill[data-status="running"] { background: #16243f; }
:where(.dark, [data-theme="dark"]) .ui-agq__rail { background-image: repeating-linear-gradient(-45deg, transparent 0 6px, rgba(255, 255, 255, 0.02) 6px 7px); }
:where(.dark, [data-theme="dark"]) .ui-agq__btn:hover { box-shadow: 0 0 0 1px #3a3a40, 0 1px 3px rgba(0, 0, 0, 0.4); }
`;
