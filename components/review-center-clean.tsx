"use client";

import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";

/*
 * Review Center – a focused workspace for what your agents want to do, in a single self-contained file.
 * Human in the loop, one item at a time and fast: the queue sorted by risk, and the item you're on – who proposes
 * it, why, the proposal itself (fields, text, a code diff or a plan) and the spots the agent isn't sure about in amber.
 * One quiet white card with hairlines, and a quiet line on top: how far you are and how long the oldest has waited.
 *   · on the left the queue, sorted by risk; on the right the item you're on
 *   · low-confidence spans are marked – point at one (or press F) for the agent's note and its source
 *   · Approve (A), Edit (E) in place, Reject (R) with a quick reason (1–4), Skip (S) – shortcuts on every button
 *   · a decision is calm: its row closes up with a small check or cross, and the next item rises in
 *   · new items slide into the queue at their sorted spot; the last decision can be undone (Z)
 * Narrow containers stack the queue above the item. The styles are injected below, so no extra files are needed.
 */

export type ReviewRisk = "high" | "medium" | "low";

/** A span the agent isn't sure about – marked in the proposal, its note shows on hover */
export type ReviewFlag = { text: string; note: string; source?: string };
/** Plain text, or text with flagged spans in it */
export type ReviewText = string | (string | ReviewFlag)[];

export type ReviewField = { label: string; value: ReviewText };
/** One file of a code change – its diff in unified form: lines start with "+", "-" or " ", hunks with "@@ -12,6 +12,7 @@" */
export type ReviewFile = {
  path: string;
  added?: number;
  removed?: number;
  diff?: ReviewText;
  /** First line number of the diff (default 1) */ start?: number;
};
/** One step of a plan – flag a step's title or detail to mark it */
export type ReviewStep = {
  title: ReviewText;
  tool?: string;
  icon?: ReactNode;
  detail?: ReviewText;
};
export type ReviewSource = { label: string; icon?: ReactNode; href?: string };

export type ReviewItem = {
  id: string;
  /** What it is, e.g. "Refund order #4821 for Maya Chen" */
  title: string;
  /** Who proposes it, e.g. "Support agent" */
  agent: string;
  /** The model behind the agent – shown after its name */
  model?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the agent's initial */
  icon?: ReactNode;
  /** The kind of task, e.g. "Refund", "Email", "Contract clause", "Code change" */
  type: string;
  risk: ReviewRisk;
  /** How sure the agent is, 0–1 */
  confidence: number;
  /** When it started waiting for you (epoch ms or a Date) */
  createdAt: number | Date;
  /** Why – the agent's short reasoning */
  reasoning?: string;
  /** Key facts of the proposal, e.g. amount, recipient, branch */
  fields?: ReviewField[];
  /** The proposed text – a reply, a clause, a diff */
  body?: ReviewText;
  /** Label above the body, e.g. "Reply" or "checkout/coupon.ts" */
  bodyLabel?: string;
  /** "code" sets the body as a diff – mono, line numbers, + and - lines tinted */
  format?: "text" | "code";
  /** A code change: files with their +/- counts, and a unified diff for the ones that matter */
  files?: ReviewFile[];
  /** A plan: ordered steps, each with the tool it calls */
  steps?: ReviewStep[];
  /** What the agent looked at */
  sources?: ReviewSource[];
};

export type ReviewResult = {
  decision: "approved" | "rejected";
  /** Why it was rejected – one of `reasons` */
  reason?: string;
  /** The edited body, when it was changed before approving */
  text?: string;
  /** Edited field values by label, when they were changed */
  fields?: Record<string, string>;
};

export type ReviewFilter = "all" | "high" | "unsure";

/** Drive it from outside – e.g. your own shortcuts, or a demo */
export type ReviewCenterHandle = {
  approve: () => void;
  /** Opens the reason picker, or rejects right away with a reason */
  reject: (reason?: string) => void;
  edit: () => void;
  /** Replaces the draft of the body (or of a field, by its label) while editing */
  setDraft: (text: string, field?: string) => void;
  /** Approves with the edits */
  save: () => void;
  cancel: () => void;
  skip: () => void;
  next: () => void;
  previous: () => void;
  undo: () => void;
  /** Shows the note of the n-th flagged span of the current item – null hides it */
  peek: (index: number | null) => void;
  select: (id: string) => void;
};

export type ReviewCenterProps = {
  /** Everything waiting for review – decided items hide themselves, new ids slide in */
  items: ReviewItem[];
  onDecide?: (item: ReviewItem, result: ReviewResult) => void;
  /** A decision was taken back – put the item back if you dropped it from `items` */
  onUndo?: (item: ReviewItem, result: ReviewResult) => void;
  onSkip?: (item: ReviewItem) => void;
  /** How many were reviewed before (e.g. today) – the header counts on from here */
  reviewed?: number;
  /** The total for the header – defaults to reviewed + waiting */
  total?: number;
  /** How long an item may wait, in ms – the waiting time turns amber at 75% and red past it (default 30 min) */
  sla?: number;
  /** The clock (epoch ms) – defaults to the real one */
  now?: number;
  /** Below this confidence an item counts as unsure (default 0.7) */
  lowConfidence?: number;
  /** The quick reasons for a rejection, picked with 1–4 */
  reasons?: string[];
  /** "risk" (default): high risk first, then oldest · "oldest" · "given": as passed */
  order?: "risk" | "oldest" | "given";
  filter?: ReviewFilter;
  defaultFilter?: ReviewFilter;
  onFilterChange?: (filter: ReviewFilter) => void;
  title?: string;
  ref?: Ref<ReviewCenterHandle>;
  className?: string;
};

/* ---------- Helpers ---------- */

const RISK: Record<ReviewRisk, { label: string; rank: number }> = {
  high: { label: "High risk", rank: 0 },
  medium: { label: "Medium risk", rank: 1 },
  low: { label: "Low risk", rank: 2 },
};
const REASONS = ["Wrong info", "Tone", "Not allowed", "Other"];
/** Motion: how long a decided row shows its mark, how long leaving takes, how long Undo stays */
const STAMP = 180;
const EXIT = 300;
const UNDO_FOR = 6000;

// An unreadable time counts as "just now" in the order and shows no wait
const toMs = (d: number | Date) => {
  const v = typeof d === "number" ? d : d.getTime();
  return Number.isFinite(v) ? v : Infinity;
};
const waited = (ms: number) => {
  if (!Number.isFinite(ms)) return "";
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
};
const partsOf = (t?: ReviewText): (string | ReviewFlag)[] => (t === undefined ? [] : typeof t === "string" ? [t] : t);
const plain = (t?: ReviewText) =>
  partsOf(t)
    .map((p) => (typeof p === "string" ? p : p.text))
    .join("");
const flagsIn = (t?: ReviewText) => partsOf(t).filter((p) => typeof p !== "string").length;
const pct = (c: number) => (Number.isFinite(c) ? `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%` : "unknown");
/** The first whole letter or digit, as a capital – never half an emoji */
const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
const fmt = new Intl.NumberFormat("en");
/** What changed between two texts: the common start, the new middle, the common end */
const changed = (a: string, b: string): [string, string, string] => {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  return [b.slice(0, s), b.slice(s, b.length - e), b.slice(b.length - e)];
};
/** Splits text parts into lines – for the code format */
const linesOf = (parts: (string | ReviewFlag)[]) => {
  const out: (string | ReviewFlag)[][] = [[]];
  for (const p of parts) {
    if (typeof p !== "string") {
      out[out.length - 1].push(p);
      continue;
    }
    p.split("\n").forEach((seg, i) => {
      if (i) out.push([]);
      if (seg) out[out.length - 1].push(seg);
    });
  }
  return out;
};
/** Every text of an item in the order it's shown – flags are counted along it */
const textsOf = (it: ReviewItem): (ReviewText | undefined)[] => [
  ...(it.fields ?? []).map((f) => f.value),
  it.body,
  ...(it.files ?? []).map((f) => f.diff),
  ...(it.steps ?? []).flatMap((st) => [st.title, st.detail]),
];
/** A light syntax tint, few soft colors: keywords, strings, function names and types – the rest stays ink */
const TOKENS =
  /(\/\/.*|--\s.*|"[^"]*"|'[^']*'|`[^`]*`|\b(?:const|let|var|return|if|else|await|async|function|export|import|from|new|throw|for|of|in|try|catch|null|undefined|true|false|SELECT|FROM|WHERE|UPDATE|SET|ALTER|TABLE|ADD|DROP|COLUMN|CREATE|INDEX|ON|NOT|NULL|DEFAULT|BEGIN|COMMIT|AND|IS)\b|\b[a-z_]\w*(?=\()|\b[A-Z][A-Za-z]+\b)/;
const KEYWORD = /^(?:const|let|var|return|if|else|await|async|function|export|import|from|new|throw|for|of|in|try|catch|null|undefined|true|false|[A-Z]{2,})$/;
const tint = (src: string): ReactNode[] =>
  src.split(TOKENS).map((t, i) => {
    if (i % 2 === 0 || !t) return t;
    const kind = /^(\/\/|--)/.test(t) ? "com" : /^["'`]/.test(t) ? "str" : KEYWORD.test(t) ? "kw" : /^[A-Z]/.test(t) ? "type" : "fn";
    return (
      <span key={i} data-tok={kind}>
        {t}
      </span>
    );
  });
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Mode = "view" | "reject" | "edit";
type Enter = "first" | "decide" | "down" | "up" | "fade";
type Done = { item: ReviewItem; result: ReviewResult; delay: number };
type Ghost = {
  item: ReviewItem;
  index: number;
  result?: ReviewResult;
  delay: number;
  key: number;
};
type Out = {
  item: ReviewItem;
  result: ReviewResult;
  draft: Record<string, string>;
  delay: number;
  key: number;
  dir: "approved" | "rejected";
};

/* ---------- Icons ---------- */

/* Tick, cancel, pencil, arrow, alert, undo, link and badge: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const Tick = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Cross = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18 6L6.00081 17.9992M17.9992 18L6 6.00085" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Pencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M16.4249 4.60509L17.4149 3.6151C18.2351 2.79497 19.5648 2.79497 20.3849 3.6151C21.205 4.43524 21.205 5.76493 20.3849 6.58507L19.3949 7.57506M16.4249 4.60509L9.76558 11.2644C9.25807 11.772 8.89804 12.4078 8.72397 13.1041L8 16L10.8959 15.276C11.5922 15.102 12.228 14.7419 12.7356 14.2344L19.3949 7.57506M16.4249 4.60509L19.3949 7.57506"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path
      d="M18.9999 13.5C18.9999 16.7875 18.9999 18.4312 18.092 19.5376C17.9258 19.7401 17.7401 19.9258 17.5375 20.092C16.4312 21 14.7874 21 11.4999 21H11C7.22876 21 5.34316 21 4.17159 19.8284C3.00003 18.6569 3 16.7712 3 13V12.5C3 9.21252 3 7.56879 3.90794 6.46244C4.07417 6.2599 4.2599 6.07417 4.46244 5.90794C5.56879 5 7.21252 5 10.5 5"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
  </svg>
);
const Next = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M9.00005 6C9.00005 6 15 10.4189 15 12C15 13.5812 9 18 9 18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Alert = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <path d="M12 9V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    <path d="M12 16.8V17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
  </svg>
);
const UndoGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M3 12C3 16.9706 7.02944 21 12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C8.79275 3 5.97733 4.67765 4.38341 7.20327M3.29339 3.00076L3.46556 5.05452C3.58958 6.53384 3.65159 7.27349 4.13359 7.68914C4.61559 8.10479 5.32673 8.03185 6.74899 7.88595L8.79339 7.67625"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);
const LinkGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M9.14339 10.691L9.35031 10.4841C11.329 8.50532 14.5372 8.50532 16.5159 10.4841C18.4947 12.4628 18.4947 15.671 16.5159 17.6497L13.6497 20.5159C11.671 22.4947 8.46279 22.4947 6.48405 20.5159C4.50532 18.5372 4.50532 15.329 6.48405 13.3503L6.9484 12.886"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
    <path
      d="M17.0516 11.114L17.5159 10.6497C19.4947 8.67095 19.4947 5.46279 17.5159 3.48405C15.5372 1.50532 12.329 1.50532 10.3503 3.48405L7.48405 6.35031C5.50532 8.32904 5.50532 11.5372 7.48405 13.5159C9.46279 15.4947 12.671 15.4947 14.6497 13.5159L14.8566 13.309"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
    />
  </svg>
);
const Badge = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M18.9905 19H19M18.9905 19C18.3678 19.6175 17.2393 19.4637 16.4479 19.4637C15.4765 19.4637 15.0087 19.6537 14.3154 20.347C13.7251 20.9374 12.9337 22 12 22C11.0663 22 10.2749 20.9374 9.68457 20.347C8.99128 19.6537 8.52349 19.4637 7.55206 19.4637C6.76068 19.4637 5.63218 19.6175 5.00949 19C4.38181 18.3776 4.53628 17.2444 4.53628 16.4479C4.53628 15.4414 4.31616 14.9786 3.59938 14.2618C2.53314 13.1956 2.00002 12.6624 2 12C2.00001 11.3375 2.53312 10.8044 3.59935 9.73817C4.2392 9.09832 4.53628 8.46428 4.53628 7.55206C4.53628 6.76065 4.38249 5.63214 5 5.00944C5.62243 4.38178 6.7556 4.53626 7.55208 4.53626C8.46427 4.53626 9.09832 4.2392 9.73815 3.59937C10.8044 2.53312 11.3375 2 12 2C12.6625 2 13.1956 2.53312 14.2618 3.59937C14.9015 4.23907 15.5355 4.53626 16.4479 4.53626C17.2393 4.53626 18.3679 4.38247 18.9906 5C19.6182 5.62243 19.4637 6.75559 19.4637 7.55206C19.4637 8.55858 19.6839 9.02137 20.4006 9.73817C21.4669 10.8044 22 11.3375 22 12C22 12.6624 21.4669 13.1956 20.4006 14.2618C19.6838 14.9786 19.4637 15.4414 19.4637 16.4479C19.4637 17.2444 19.6182 18.3776 18.9905 19Z"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path d="M9 12.8929C9 12.8929 10.2 13.5447 10.8 14.5C10.8 14.5 12.6 10.75 15 9.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
  </svg>
);
/* ---------- A row of the queue ---------- */

const avatarOf = (it: ReviewItem) => (
  <span className="ui-rvcc__avatar" data-logo={it.icon ? "" : undefined} aria-hidden="true">
    {it.icon ?? initial(it.agent)}
  </span>
);
type RowProps = {
  it: ReviewItem;
  ghost?: Ghost;
  current: boolean;
  focusable: boolean;
  enter?: { kind: "first" | "new" | "in"; delay: number };
  wait: string;
  sla?: string;
  skipped: boolean;
  onPick: (id: string) => void;
  setEl: (id: string, el: HTMLButtonElement | null) => void;
};
const QueueRow = memo(function QueueRow({ it, ghost, current, focusable, enter, wait: w, sla, skipped, onPick, setEl }: RowProps) {
  const d = ghost?.result?.decision;
  return (
    <li
      className="ui-rvcc__item"
      data-enter={enter?.kind}
      data-leaving={ghost ? "" : undefined}
      data-decision={d}
      style={{ "--d": `${ghost ? ghost.delay : (enter?.delay ?? 0)}ms` } as CSSProperties}
    >
      <button
        ref={ghost ? undefined : (el) => setEl(it.id, el)}
        type="button"
        className="ui-rvcc__row"
        data-risk={it.risk}
        aria-current={current ? "true" : undefined}
        aria-label={`${it.title}. ${it.type}, ${RISK[it.risk].label.toLowerCase()}, ${pct(it.confidence)} confidence${w ? (w === "now" ? ", just in" : `, waiting ${w}`) : ""}${skipped ? ", skipped" : ""}`}
        tabIndex={focusable ? 0 : -1}
        onClick={() => !ghost && onPick(it.id)}
      >
        {avatarOf(it)}
        <span className="ui-rvcc__row-main">
          <span className="ui-rvcc__row-top">
            <span className="ui-rvcc__row-title" dir="auto" title={it.title}>
              {it.title}
            </span>
            {d ? (
              <span className="ui-rvcc__row-done" data-decision={d} aria-hidden="true">
                {d === "rejected" ? <Cross /> : <Tick />}
              </span>
            ) : (
              <span className="ui-rvcc__wait" data-sla={sla}>
                {w}
              </span>
            )}
          </span>
          <span className="ui-rvcc__row-meta">
            <span className="ui-rvcc__tag" dir="auto" title={it.type}>
              {it.type}
            </span>
            {skipped && <span className="ui-rvcc__skipped">· skipped</span>}
          </span>
        </span>
      </button>
    </li>
  );
});

export function ReviewCenter({
  items,
  onDecide,
  onUndo,
  onSkip,
  reviewed = 0,
  total: totalProp,
  sla = 30 * 60_000,
  now: nowProp,
  lowConfidence = 0.7,
  reasons = REASONS,
  order = "risk",
  filter: filterProp,
  defaultFilter = "all",
  onFilterChange,
  title = "Review center",
  ref,
  className,
}: ReviewCenterProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const rowEls = useRef(new Map<string, HTMLButtonElement>());
  const flagEls = useRef(new Map<number, HTMLElement>());
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  /* ---------- The clock: waiting times in minutes ---------- */

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return;
    const t = window.setInterval(() => setTick(Date.now()), 10_000);
    return () => window.clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;
  const slaOf = (it: ReviewItem) => {
    const w = now - toMs(it.createdAt);
    return w >= sla ? "over" : w >= sla * 0.75 ? "near" : undefined;
  };

  /* ---------- State ---------- */

  const [innerFilter, setInnerFilter] = useState<ReviewFilter>(defaultFilter);
  const filter = filterProp ?? innerFilter;
  const [decided, setDecided] = useState<Record<string, Done>>({});
  const [history, setHistory] = useState<string[][]>([]);
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("view");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [peek, setPeek] = useState<number | null>(null);
  const [hoverFlag, setHoverFlag] = useState<number | null>(null);
  const [out, setOut] = useState<Out | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [chip, setChip] = useState<{
    text: string;
    decision: ReviewResult["decision"];
    key: number;
  } | null>(null);
  const [said, setSaid] = useState("");

  /* ---------- The queue: sorted, minus what's decided, through the filter ---------- */

  const sorted = order === "given" ? items : [...items].sort((a, b) => (order === "risk" ? RISK[a.risk].rank - RISK[b.risk].rank : 0) || toMs(a.createdAt) - toMs(b.createdAt));
  const pending = sorted.filter((i) => !decided[i.id]);
  const matches = (i: ReviewItem, f: ReviewFilter) => f === "all" || (f === "high" ? i.risk === "high" : i.confidence < lowConfidence);
  const list = pending.filter((i) => matches(i, filter));
  const ids = new Set(list.map((i) => i.id));
  const counts: Record<ReviewFilter, number> = {
    all: pending.length,
    high: pending.filter((i) => matches(i, "high")).length,
    unsure: pending.filter((i) => matches(i, "unsure")).length,
  };
  const done = reviewed + Object.keys(decided).length;
  const total = Math.max(totalProp ?? done + pending.length, done);
  const oldest = pending.reduce<ReviewItem | undefined>((o, i) => (!o || toMs(i.createdAt) < toMs(o.createdAt) ? i : o), undefined);

  // The current item: the one picked, or whatever now sits where it was
  const lastIndex = useRef(0);
  const found = list.findIndex((i) => i.id === currentId);
  const index = found >= 0 ? found : Math.min(lastIndex.current, list.length - 1);
  const current = index >= 0 ? list[index] : undefined;
  const flagCount = current ? textsOf(current).reduce((n, t) => n + flagsIn(t), 0) : 0;

  // How the item comes in: a beat after a decision, or slid up or down when you move
  const nextEnter = useRef<Enter | null>("first");
  const entered = useRef<{ id?: string; mode: Enter }>({ mode: "first" });
  if (current?.id !== entered.current.id) {
    entered.current = { id: current?.id, mode: nextEnter.current ?? "down" };
    nextEnter.current = null;
  }

  // A fresh item starts clean: no picker, no draft, no note open
  useLayoutEffect(() => {
    lastIndex.current = Math.max(0, index);
    if (current && current.id !== currentId) setCurrentId(current.id);
  });
  useLayoutEffect(() => {
    setMode("view");
    setPeek(null);
    setHoverFlag(null);
    setDraft({});
    if (stageRef.current) stageRef.current.scrollTop = 0;
  }, [current?.id]);

  /* ---------- Rows that come and go ---------- */

  // Rows that leave – decided, filtered out, removed – stay a moment in place: marked, then they close up
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const prevList = useRef<ReviewItem[]>([]);
  useLayoutEffect(() => {
    const prev = prevList.current;
    prevList.current = list;
    const gone = prev.map((item, i) => ({ item, i })).filter((g) => !ids.has(g.item.id));
    if (!gone.length || reduced()) return;
    const key = performance.now();
    const add: Ghost[] = gone.map((g) => ({
      item: g.item,
      index: g.i,
      result: decided[g.item.id]?.result,
      delay: decided[g.item.id]?.delay ?? 0,
      key,
    }));
    setGhosts((gs) => [...gs.filter((x) => !add.some((a) => a.item.id === x.item.id)), ...add]);
    const longest = Math.max(...add.map((a) => a.delay + (a.result ? STAMP : 0) + EXIT));
    later(() => setGhosts((gs) => gs.filter((x) => x.key !== key)), longest + 80);
  });
  const rows: { item: ReviewItem; ghost?: Ghost }[] = list.map((item) => ({
    item,
  }));
  for (const g of [...ghosts].filter((x) => !ids.has(x.item.id)).sort((a, b) => a.index - b.index)) rows.splice(Math.min(g.index, rows.length), 0, { item: g.item, ghost: g });

  // Rows that come in: the first picture row by row, new items with a soft highlight, returning ones simply open
  const seen = useRef(new Set<string>());
  const mounted = useRef(false);
  const enterOf = useRef(new Map<string, { kind: "first" | "new" | "in"; delay: number }>());
  let fresh = 0;
  for (const it of list) {
    if (enterOf.current.has(it.id)) continue;
    const kind = !mounted.current ? "first" : seen.current.has(it.id) ? "in" : "new";
    enterOf.current.set(it.id, {
      kind,
      delay: Math.min(420, kind === "first" ? 80 + fresh++ * 50 : fresh++ * 30),
    });
  }
  useLayoutEffect(() => {
    mounted.current = true;
    for (const it of items) seen.current.add(it.id);
    for (const id of [...enterOf.current.keys()]) if (!ids.has(id)) enterOf.current.delete(id);
  });

  /* ---------- Focus: keys keep working when the thing you were on goes away ---------- */

  const keep = useRef<"row" | "root" | null>(null);
  const holdFocus = () => {
    const a = document.activeElement;
    keep.current = listRef.current?.contains(a) ? "row" : rootRef.current?.contains(a) ? "root" : null;
  };
  useLayoutEffect(() => {
    const how = keep.current;
    if (!how) return;
    keep.current = null;
    const root = rootRef.current;
    const a = document.activeElement;
    if (how === "row" && current) rowEls.current.get(current.id)?.focus({ preventScroll: true });
    else if (!root?.contains(a) || a === document.body) root?.focus({ preventScroll: true });
  });
  // The current row stays in view in the queue
  useLayoutEffect(() => {
    const l = listRef.current;
    const li = current ? rowEls.current.get(current.id)?.parentElement : undefined;
    if (!l || !li || l.scrollHeight <= l.clientHeight) return;
    const top = li.offsetTop - 6;
    const bottom = li.offsetTop + li.offsetHeight + 6;
    if (top < l.scrollTop) l.scrollTo({ top, behavior: reduced() ? "auto" : "smooth" });
    else if (bottom > l.scrollTop + l.clientHeight)
      l.scrollTo({
        top: bottom - l.clientHeight,
        behavior: reduced() ? "auto" : "smooth",
      });
  }, [current?.id]);

  /* ---------- Actions ---------- */

  const flash = (name: string) => {
    setPressed(name);
    later(() => setPressed((p) => (p === name ? null : p)), 220);
  };
  const say = (text: string) => setSaid(text);

  const decideRef = useRef<((targets: ReviewItem[], result: ReviewResult) => void) | null>(null);
  const decide = (targets: ReviewItem[], result: ReviewResult) => {
    if (!targets.length) return;
    holdFocus();
    const add: Record<string, Done> = {};
    targets.forEach((it) => (add[it.id] = { item: it, result, delay: 0 }));
    setDecided((d) => ({ ...d, ...add }));
    setHistory((h) => [...h.slice(-19), targets.map((t) => t.id)]);
    if (current && add[current.id] && !reduced()) {
      const key = performance.now();
      const delay = add[current.id].delay;
      nextEnter.current = "decide";
      setOut({
        item: current,
        result,
        draft: { ...draft },
        delay,
        key,
        dir: result.decision,
      });
      later(() => setOut((o) => (o?.key === key ? null : o)), delay + STAMP + EXIT + 100);
    } else if (current && add[current.id]) nextEnter.current = "fade";
    setMode("view");
    setPeek(null);
    const word = result.decision === "approved" ? "Approved" : "Rejected";
    const edited = result.text !== undefined || result.fields !== undefined;
    const text = targets.length > 1 ? `${targets.length} approved` : `${word}${edited ? " with edits" : result.reason ? ` · ${result.reason}` : ""}`;
    const key = performance.now();
    setChip({ text, decision: result.decision, key });
    later(() => setChip((c) => (c?.key === key ? null : c)), UNDO_FOR);
    say(`${targets.length > 1 ? `${targets.length} items approved` : `${word}: ${targets[0].title}${result.reason ? `, ${result.reason}` : ""}`}. ${done + targets.length} of ${total} reviewed.`);
    for (const t of targets) onDecide?.(t, result);
  };

  decideRef.current = decide;
  const approve = () => {
    if (!current) return;
    if (mode === "edit") return save();
    flash("approve");
    decide([current], { decision: "approved" });
  };
  const openReject = () => {
    if (!current) return;
    flash("reject");
    setMode(mode === "reject" ? "view" : "reject");
  };
  const reject = (reason: string) => {
    if (!current) return;
    flash(`reason:${reason}`);
    decide([current], { decision: "rejected", reason });
  };
  const draftOf = (it: ReviewItem) => {
    const d: Record<string, string> = {};
    for (const f of it.fields ?? []) d[`field:${f.label}`] = plain(f.value);
    if (it.body !== undefined) d.body = plain(it.body);
    return d;
  };
  const edit = (focus = true) => {
    if (!current) return;
    flash("edit");
    if (mode === "edit") return;
    setDraft(draftOf(current));
    setMode("edit");
    setPeek(null);
    if (focus) requestAnimationFrame(() => (editorRef.current ?? rootRef.current?.querySelector<HTMLInputElement>(".ui-rvcc__input"))?.focus({ preventScroll: true }));
  };
  const save = () => {
    if (!current || mode !== "edit") return;
    flash("save");
    const base = draftOf(current);
    const result: ReviewResult = { decision: "approved" };
    if (draft.body !== undefined && draft.body !== base.body) result.text = draft.body;
    const fields: Record<string, string> = {};
    for (const f of current.fields ?? []) {
      const k = `field:${f.label}`;
      if (draft[k] !== undefined && draft[k] !== base[k]) fields[f.label] = draft[k];
    }
    if (Object.keys(fields).length) result.fields = fields;
    decide([current], result);
  };
  const cancel = () => {
    if (mode === "view") return;
    holdFocus();
    setMode("view");
    setDraft({});
  };
  const move = (step: number) => {
    if (list.length < 2 || !current) return;
    holdFocus();
    const i = (index + step + list.length) % list.length;
    nextEnter.current = step > 0 ? "down" : "up";
    setCurrentId(list[i].id);
  };
  const skip = () => {
    if (!current) return;
    flash("skip");
    setSkipped((s) => ({ ...s, [current.id]: true }));
    onSkip?.(current);
    say(`Skipped: ${current.title}`);
    move(1);
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    holdFocus();
    flash("undo");
    const back = last.map((id) => decided[id]).filter(Boolean);
    setDecided((d) => {
      const n = { ...d };
      for (const id of last) delete n[id];
      return n;
    });
    setHistory((h) => h.slice(0, -1));
    setChip(null);
    if (back[0]) {
      nextEnter.current = "up";
      setCurrentId(back[0].item.id);
      if (!matches(back[0].item, filter)) changeFilter("all");
    }
    say(`Undone – ${back.length > 1 ? `${back.length} items are` : `${back[0]?.item.title} is`} back in the queue.`);
    for (const b of back) onUndo?.(b.item, b.result);
  };
  const cycleFlag = () => {
    if (!flagCount) return;
    setPeek((p) => (p === null ? 0 : p + 1 >= flagCount ? null : p + 1));
  };
  const changeFilter = (f: ReviewFilter) => {
    nextEnter.current = "fade";
    setInnerFilter(f);
    onFilterChange?.(f);
  };
  const select = (id: string) => {
    const i = list.findIndex((x) => x.id === id);
    if (i < 0 || i === index) return;
    nextEnter.current = i > index ? "down" : "up";
    setCurrentId(id);
  };

  // Stable handlers for the memoized rows
  const selectRef = useRef(select);
  selectRef.current = select;
  const pickRow = useCallback((id: string) => selectRef.current(id), []);
  const setRowEl = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowEls.current.set(id, el);
    else rowEls.current.delete(id);
  }, []);

  useImperativeHandle(ref, () => ({
    approve,
    reject: (reason?: string) => (reason ? reject(reason) : openReject()),
    edit: () => edit(false),
    setDraft: (text: string, field?: string) => setDraft((d) => ({ ...d, [field ? `field:${field}` : "body"]: text })),
    save,
    cancel,
    skip,
    next: () => move(1),
    previous: () => move(-1),
    undo,
    peek: (i: number | null) => setPeek(i),
    select,
  }));

  /* ---------- Keyboard: single keys while the focus is anywhere inside ---------- */

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing) return;
    const typing = (e.target as HTMLElement).closest("textarea, input, select, [contenteditable='true']");
    const mod = e.metaKey || e.ctrlKey;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    if (mode === "edit" && mod && e.key === "Enter") return run(save);
    if (e.key === "Escape") {
      if (mode !== "view") return run(cancel);
      if (peek !== null) return run(() => setPeek(null));
      return;
    }
    if (typing || e.altKey) return;
    if (mod) {
      if (e.key.toLowerCase() === "z" && !e.shiftKey) run(undo);
      return;
    }
    if (mode === "reject") {
      const n = Number(e.key);
      if (n >= 1 && n <= reasons.length) return run(() => reject(reasons[n - 1]));
    }
    const keys: Record<string, () => void> = {
      a: approve,
      e: () => edit(),
      r: openReject,
      s: skip,
      j: () => move(1),
      arrowdown: () => move(1),
      k: () => move(-1),
      arrowup: () => move(-1),
      f: cycleFlag,
      z: undo,
      u: undo,
    };
    const fn = keys[e.key.toLowerCase()];
    if (fn) run(fn);
  };

  /* ---------- The agent's note on a flagged span ---------- */

  const tipIndex = hoverFlag ?? peek;
  const tipFlag = (() => {
    if (!current || tipIndex === null) return undefined;
    const all = textsOf(current)
      .flatMap((t) => partsOf(t))
      .filter((p): p is ReviewFlag => typeof p !== "string");
    return all[tipIndex];
  })();
  const tipId = `${uid}-tip`;
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const stage = stageRef.current;
    const el = tipIndex !== null ? flagEls.current.get(tipIndex) : undefined;
    if (!tip || !stage || !el) return;
    const s = stage.getBoundingClientRect();
    const scale = stage.offsetWidth ? s.width / stage.offsetWidth : 1;
    // A span that wraps: the note sits under its last line (or over its first)
    const lines = el.getClientRects();
    const r = lines[0] ?? el.getBoundingClientRect();
    const rEnd = lines[lines.length - 1] ?? r;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const top = (r.top - s.top) / scale + stage.scrollTop;
    const bottom = (rEnd.bottom - s.top) / scale + stage.scrollTop;
    const center = (r.left + r.width / 2 - s.left) / scale;
    // Below the span by default – above only when the pane has no room under it
    const fitsBelow = bottom + 8 + h <= stage.scrollTop + stage.clientHeight - 4;
    const above = !fitsBelow && top - h - 8 >= stage.scrollTop + 4;
    tip.style.top = `${above ? top - h - 8 : bottom + 8}px`;
    tip.style.left = `${Math.max(10, Math.min(center - w / 2, stage.offsetWidth - w - 10))}px`;
    tip.style.setProperty("--x", `${center - Math.max(10, Math.min(center - w / 2, stage.offsetWidth - w - 10))}px`);
    tip.dataset.side = above ? "above" : "below";
  });

  /* ---------- Narrow: the item's box glides to its new height instead of jumping ---------- */

  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (!narrow) {
      stage.style.height = "";
      return;
    }
    // For a moment the box keeps the old item's height; then it glides to the new one
    const fit = () => {
      const c = curRef.current?.offsetHeight ?? 0;
      const hold = out && performance.now() - out.key < out.delay + STAMP;
      const g = hold ? (ghostRef.current?.offsetHeight ?? 0) : 0;
      stage.style.height = `${Math.max(c, g)}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (curRef.current) ro.observe(curRef.current);
    const t = out ? window.setTimeout(fit, Math.max(0, out.key + out.delay + STAMP - performance.now()) + 10) : 0;
    return () => {
      ro.disconnect();
      window.clearTimeout(t);
    };
  });
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => setNarrow(root.clientWidth - 8 < 640));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  /* ---------- Pieces ---------- */

  const avatar = avatarOf;
  // The proposal's text: flagged spans marked; in a ghost the edits show as a green mark instead
  const text = (t: ReviewText | undefined, live: boolean, counter: { n: number }, format?: "text" | "code", start = 1) => {
    const parts = partsOf(t);
    const flag = (p: ReviewFlag, k: number) => {
      const i = counter.n++;
      const on = live && tipIndex === i;
      return (
        <mark
          key={k}
          ref={
            live
              ? (el) => {
                  if (el) flagEls.current.set(i, el);
                  else flagEls.current.delete(i);
                }
              : undefined
          }
          className="ui-rvcc__flag"
          data-on={on ? "" : undefined}
          tabIndex={live ? 0 : -1}
          aria-describedby={on ? tipId : undefined}
          aria-label={`${p.text} – the agent is unsure`}
          onMouseEnter={live ? () => setHoverFlag(i) : undefined}
          onMouseLeave={live ? () => setHoverFlag((h) => (h === i ? null : h)) : undefined}
          onFocus={live ? () => setPeek(i) : undefined}
          onBlur={live ? () => setPeek((p2) => (p2 === i ? null : p2)) : undefined}
        >
          {p.text}
        </mark>
      );
    };
    const inline = (ps: (string | ReviewFlag)[], code = false) => ps.map((p, k) => (typeof p === "string" ? <span key={k}>{code ? tint(p) : p}</span> : flag(p, k)));
    if (format !== "code") return inline(parts);
    // A unified diff: old and new line numbers, the sign in its own column, a light syntax tint
    let o = start;
    let n = start;
    return linesOf(parts).map((line, k) => {
      const first = line[0];
      const lead = typeof first === "string" ? first : "";
      if (lead.startsWith("@@")) {
        const m = /-(\d+)(?:,\d+)? \+(\d+)/.exec(lead);
        if (m) {
          o = Number(m[1]);
          n = Number(m[2]);
        }
        return (
          <span key={k} className="ui-rvcc__hunk">
            {lead}
          </span>
        );
      }
      const sign = lead.startsWith("+") ? "add" : lead.startsWith("-") ? "del" : "ctx";
      const rest = typeof first === "string" ? [first.slice(1), ...line.slice(1)] : line;
      // One number column: the new line's number, or the old one for a removed line, with a tiny sign before it
      const no = sign === "add" ? n++ : sign === "del" ? o++ : (o++, n++);
      return (
        <span key={k} className="ui-rvcc__line" data-diff={sign}>
          <span className="ui-rvcc__ln">
            {sign !== "ctx" && <span className="ui-rvcc__sign">{sign === "add" ? "+" : "−"}</span>}
            {no}
          </span>
          <span className="ui-rvcc__src">{rest.length ? inline(rest, true) : "​"}</span>
        </span>
      );
    });
  };
  const editedText = (before: string, after: string) => {
    const [a, b, c] = changed(before, after);
    return (
      <>
        {a}
        {b && <ins className="ui-rvcc__ins">{b}</ins>}
        {c}
      </>
    );
  };

  const detail = (it: ReviewItem, ghost?: Out) => {
    const live = !ghost;
    const counter = { n: 0 };
    const editing = live && mode === "edit";
    const edits = ghost?.draft ?? {};
    const base = ghost ? draftOf(it) : {};
    const d = ghost?.result.decision;
    return (
      <div
        ref={ghost ? ghostRef : curRef}
        key={ghost ? `out-${ghost.key}` : it.id}
        className="ui-rvcc__detail"
        data-ghost={ghost ? "" : undefined}
        data-decision={d}
        data-enter={ghost ? undefined : entered.current.mode}
        aria-hidden={ghost ? true : undefined}
        style={{ "--d": `${ghost?.delay ?? out?.delay ?? 0}ms` } as CSSProperties}
      >
        {/* Who proposes it: the agent with a small risk tag, the model under it */}
        <div className="ui-rvcc__who">
          {avatar(it)}
          <div className="ui-rvcc__meta">
            <span className="ui-rvcc__name">
              <span className="ui-rvcc__agent" dir="auto" title={it.agent}>
                {it.agent}
              </span>
              {it.risk !== "low" && (
                <span className="ui-rvcc__risk" data-risk={it.risk}>
                  {RISK[it.risk].label}
                </span>
              )}
            </span>
            {it.model && (
              <span className="ui-rvcc__model" title={it.model}>
                {it.model}
              </span>
            )}
          </div>
        </div>
        <div className="ui-rvcc__ask">
          <h3 className="ui-rvcc__title" dir="auto">
            {it.title}
          </h3>
        </div>
        {it.reasoning && (
          <p className="ui-rvcc__why" dir="auto">
            <b>Why </b>
            {it.reasoning}
          </p>
        )}
        <section className="ui-rvcc__proposal" data-editing={editing ? "" : undefined} aria-label={`Proposal: ${it.type}`}>
          {!!it.fields?.length && (
            <dl className="ui-rvcc__fields">
              {it.fields.map((f, fi) => {
                const k = `field:${f.label}`;
                return (
                  <div key={`${f.label}-${fi}`}>
                    <dt>{f.label}</dt>
                    <dd dir="auto" title={editing ? undefined : plain(f.value)}>
                      {editing ? (
                        <input className="ui-rvcc__input" value={draft[k] ?? ""} aria-label={f.label} onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))} />
                      ) : ghost && edits[k] !== undefined && edits[k] !== base[k] ? (
                        editedText(base[k], edits[k])
                      ) : (
                        text(f.value, live, counter)
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {it.body !== undefined && (
            <div className="ui-rvcc__body" data-format={it.format}>
              {it.bodyLabel && <span className="ui-rvcc__body-label">{it.bodyLabel}</span>}
              {editing ? (
                <div className="ui-rvcc__editor">
                  {/* The mirror under the field marks what you changed */}
                  <div className="ui-rvcc__mirror" aria-hidden="true">
                    {editedText(plain(it.body), draft.body ?? "")}
                    {"\u200b"}
                  </div>
                  <textarea ref={editorRef} value={draft.body ?? ""} aria-label={it.bodyLabel ?? "Proposal"} spellCheck={false} onChange={(e) => setDraft((x) => ({ ...x, body: e.target.value }))} />
                </div>
              ) : it.format === "code" && !(ghost && edits.body !== undefined && edits.body !== base.body) ? (
                <div className="ui-rvcc__code">
                  <div className="ui-rvcc__diff">{text(it.body, live, counter, "code")}</div>
                </div>
              ) : (
                <p className="ui-rvcc__text" dir="auto">{ghost && edits.body !== undefined && edits.body !== base.body ? editedText(base.body, edits.body) : text(it.body, live, counter)}</p>
              )}
            </div>
          )}
          {!!it.files?.length && (
            // A code change: one row per file, the diff right under the files that matter
            <div className="ui-rvcc__code">
              {it.files.map((f, fi) => (
                <div key={`${f.path}-${fi}`} className="ui-rvcc__file">
                  <div className="ui-rvcc__file-head">
                    <span className="ui-rvcc__path" title={f.path}>
                      {f.path.includes("/") && <span className="ui-rvcc__dir">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span>}
                      {f.path.slice(f.path.lastIndexOf("/") + 1)}
                    </span>
                    {f.added !== undefined && <span className="ui-rvcc__count-add">+{fmt.format(f.added)}</span>}
                    {f.removed !== undefined && <span className="ui-rvcc__count-del">−{fmt.format(f.removed)}</span>}
                  </div>
                  {f.diff !== undefined && <div className="ui-rvcc__diff">{text(f.diff, live, counter, "code", f.start ?? 1)}</div>}
                </div>
              ))}
            </div>
          )}
          {!!it.steps?.length && (
            <ol className="ui-rvcc__steps">
              {it.steps.map((st, i) => (
                <li key={i} className="ui-rvcc__step" data-flagged={flagsIn(st.title) + flagsIn(st.detail) ? "" : undefined}>
                  <span className="ui-rvcc__step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ui-rvcc__step-main">
                    <span className="ui-rvcc__step-title" dir="auto">
                      {text(st.title, live, counter)}
                    </span>
                    {st.tool && (
                      <span className="ui-rvcc__step-tool" title={st.tool}>
                        {st.icon && <span className="ui-rvcc__source-icon">{st.icon}</span>}
                        <span className="ui-rvcc__source-label">{st.tool}</span>
                      </span>
                    )}
                    {st.detail !== undefined && (
                      <span className="ui-rvcc__step-detail" dir="auto">
                        {text(st.detail, live, counter)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {!!it.sources?.length && (
          <div className="ui-rvcc__foot">
            <ul className="ui-rvcc__sources" aria-label="Sources">
              {it.sources.map((s, si) => {
                const inner = (
                  <>
                    <span className="ui-rvcc__source-icon">{s.icon ?? <LinkGlyph />}</span>
                    <span className="ui-rvcc__source-label" dir="auto">
                      {s.label}
                    </span>
                  </>
                );
                return (
                  <li key={`${s.label}-${si}`} title={s.label}>
                    {s.href && live ? (
                      <a className="ui-rvcc__source" href={s.href} target="_blank" rel="noreferrer">
                        {inner}
                      </a>
                    ) : (
                      <span className="ui-rvcc__source">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const btn = (name: string, label: string, icon: ReactNode, key: string, onClick: () => void, opts: { primary?: boolean; disabled?: boolean; danger?: boolean } = {}) => (
    <button
      type="button"
      className="ui-rvcc__btn"
      data-primary={opts.primary ? "" : undefined}
      data-danger={opts.danger ? "" : undefined}
      data-pressed={pressed === name ? "" : undefined}
      data-tone={opts.danger ? "rejected" : opts.primary ? "approved" : undefined}
      disabled={opts.disabled}
      aria-keyshortcuts={key.length === 1 ? key.toUpperCase() : undefined}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      <kbd className="ui-rvcc__kbd">{key}</kbd>
    </button>
  );

  const shownTip = !!tipFlag && mode !== "edit";
  const filters: { id: ReviewFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "high", label: "High risk" },
    { id: "unsure", label: "Unsure" },
  ];
  const filterTabs = (
    <div className="ui-rvcc__filters" role="group" aria-label="Filter the queue">
      {filters.map((f) => (
        <button key={f.id} type="button" className="ui-rvcc__filter" aria-pressed={filter === f.id} onClick={() => changeFilter(f.id)}>
          {f.label}
          <span className="ui-rvcc__filter-count">{fmt.format(counts[f.id])}</span>
        </button>
      ))}
    </div>
  );
  const progress = total ? done / total : 0;
  const empty = !current;

  return (
    <div
      ref={rootRef}
      className={["ui-rvcc", className].filter(Boolean).join(" ")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // A click on plain content keeps the keys working
        if (!(e.target as HTMLElement).closest("button, a, input, textarea, mark")) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
      }}
    >
      <style href="ui-review-center-clean" precedence="default">
        {css}
      </style>

      <header className="ui-rvcc__head">
        <span className="ui-rvcc__mark">
          <Badge />
        </span>
        <span className="ui-rvcc__heading" title={title}>
          {title}
        </span>
        <span className="ui-rvcc__progress">
          <span className="ui-rvcc__track" data-live={pending.length ? "" : undefined} aria-hidden="true">
            <span className="ui-rvcc__fill" style={{ width: `${progress * 100}%` }} />
          </span>
          <span className="ui-rvcc__count">
            <b key={done}>{fmt.format(done)}</b> of {fmt.format(total)} reviewed
          </span>
        </span>
        {oldest && (
          <span className="ui-rvcc__oldest">
            oldest <b data-sla={slaOf(oldest)}>{waited(now - toMs(oldest.createdAt))}</b>
          </span>
        )}
        {chip && (
          <div className="ui-rvcc__undo" key={chip.key} data-decision={chip.decision}>
            <span className="ui-rvcc__undo-text">
              {chip.decision === "rejected" ? <Cross /> : <Tick />}
              {chip.text}
            </span>
            <button type="button" className="ui-rvcc__undo-btn" data-pressed={pressed === "undo" ? "" : undefined} onClick={undo} aria-keyshortcuts="Z">
              <UndoGlyph />
              Undo
              <kbd className="ui-rvcc__kbd">Z</kbd>
            </button>
          </div>
        )}
      </header>

      <div className="ui-rvcc__card" data-narrow={narrow ? "" : undefined}>
        <div className="ui-rvcc__queue">
          <div className="ui-rvcc__queue-head">{filterTabs}</div>
          <ul ref={listRef} className="ui-rvcc__list" aria-label="Queue">
            {rows.map(({ item: it, ghost }) => (
              <QueueRow
                key={ghost ? `${it.id}~out` : it.id}
                it={it}
                ghost={ghost}
                current={!ghost && current?.id === it.id}
                focusable={!ghost && (current?.id === it.id || (!current && it === list[0]))}
                enter={ghost ? undefined : enterOf.current.get(it.id)}
                wait={waited(now - toMs(it.createdAt))}
                sla={slaOf(it)}
                skipped={!!skipped[it.id]}
                onPick={pickRow}
                setEl={setRowEl}
              />
            ))}
            {!rows.length && <li className="ui-rvcc__none">{pending.length ? "Nothing matches this filter" : "Nothing waiting"}</li>}
          </ul>
        </div>

        <div className="ui-rvcc__main">
          <div ref={stageRef} className="ui-rvcc__stage">
            {out && detail(out.item, out)}
            {current ? (
              detail(current)
            ) : (
              <div ref={curRef} className="ui-rvcc__empty" data-after={out ? "" : undefined} style={{ "--d": `${out?.delay ?? 0}ms` } as CSSProperties}>
                <span className="ui-rvcc__empty-mark">
                  <Badge size={22} />
                </span>
                <b>{pending.length ? "Nothing matches this filter" : "All caught up"}</b>
                <span>{pending.length ? `${fmt.format(pending.length)} more in the queue under All` : `${fmt.format(done)} of ${fmt.format(total)} reviewed – new items from your agents show up here`}</span>
              </div>
            )}
            {shownTip && tipFlag && (
              <div ref={tipRef} id={tipId} role="tooltip" className="ui-rvcc__tip" key={tipIndex}>
                <span className="ui-rvcc__tip-head">
                  <Alert />
                  Agent's note
                </span>
                <p>{tipFlag.note}</p>
                {tipFlag.source && <span className="ui-rvcc__tip-source">{tipFlag.source}</span>}
              </div>
            )}
          </div>

          <div className="ui-rvcc__actions" data-mode={mode}>
            {mode === "view" && (
              <div className="ui-rvcc__btns" key="view">
                {btn("approve", "Approve", <Tick />, "A", approve, {
                  primary: true,
                  disabled: empty,
                })}
                {btn("edit", "Edit", <Pencil />, "E", () => edit(), {
                  disabled: empty || (!current?.body && !current?.fields?.length),
                })}
                {btn("reject", "Reject", <Cross />, "R", openReject, {
                  disabled: empty,
                  danger: true,
                })}
                {btn("skip", "Skip", <Next />, "S", skip, {
                  disabled: list.length < 2,
                })}
              </div>
            )}
            {mode === "reject" && (
              <div className="ui-rvcc__btns" key="reject" role="group" aria-label="Why reject it?">
                <span className="ui-rvcc__why-label">Why?</span>
                {reasons.map((r, i) => (
                  <button key={r} type="button" className="ui-rvcc__reason" data-pressed={pressed === `reason:${r}` ? "" : undefined} onClick={() => reject(r)} aria-keyshortcuts={String(i + 1)}>
                    <kbd className="ui-rvcc__kbd">{i + 1}</kbd>
                    {r}
                  </button>
                ))}
                <button type="button" className="ui-rvcc__cancel" onClick={cancel} aria-label="Cancel">
                  Esc
                </button>
              </div>
            )}
            {mode === "edit" && (
              <div className="ui-rvcc__btns" key="edit">
                {btn("save", "Approve with edits", <Tick />, "⌘↵", save, {
                  primary: true,
                })}
                {btn("cancel", "Cancel", <Cross />, "Esc", cancel)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ui-rvcc__sr" aria-live="polite" aria-atomic="true">
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-rvcc */
.ui-rvcc {
  --ui-rvcc-card: #ffffff;
  --ui-rvcc-strong: #000000;
  --ui-rvcc-ink: rgba(0, 0, 0, 0.88);
  --ui-rvcc-text: rgba(0, 0, 0, 0.61);
  --ui-rvcc-muted: rgba(0, 0, 0, 0.45);
  --ui-rvcc-faint: rgba(0, 0, 0, 0.27);
  --ui-rvcc-line: rgba(0, 0, 0, 0.06);
  --ui-rvcc-queue-bg: rgba(0, 0, 0, 0.015);
  --ui-rvcc-line-strong: rgba(0, 0, 0, 0.12);
  --ui-rvcc-code-ink: rgba(0, 0, 0, 0.88);
  --ui-rvcc-code-num: rgba(0, 0, 0, 0.45);
  --ui-rvcc-diff-add: rgba(0, 160, 80, 0.06);
  --ui-rvcc-diff-del: rgba(215, 36, 0, 0.05);
  --ui-rvcc-diff-add-fg: #2f8a4c;
  --ui-rvcc-diff-del-fg: #c4472e;
  --ui-rvcc-tok-kw: color(display-p3 0.843 0.298 0.507);
  --ui-rvcc-tok-str: color(display-p3 0.38 0.647 0.378);
  --ui-rvcc-tok-type: color(display-p3 0.247 0.556 0.969);
  --ui-rvcc-tok-fn: color(display-p3 0.587 0.29 0.667);
  --ui-rvcc-ring-soft: rgba(0, 96, 226, 0.1);
  --ui-rvcc-hover: rgba(0, 0, 0, 0.025);
  --ui-rvcc-fill: rgba(0, 0, 0, 0.06);
  --ui-rvcc-wash: rgba(0, 0, 0, 0.025);
  --ui-rvcc-accent: rgba(0, 96, 226, 0.765);
  --ui-rvcc-new: rgba(0, 96, 226, 0.07);
  --ui-rvcc-primary: rgba(0, 0, 0, 0.88);
  --ui-rvcc-primary-fg: #fcfcfc;
  /* Bars: a tint, its edge and the mark at its leading edge */
  --ui-rvcc-bar-bg: rgba(0, 96, 226, 0.1);
  --ui-rvcc-bar-edge: rgba(0, 96, 226, 0.32);
  --ui-rvcc-bar-mark: rgba(0, 96, 226, 0.7);
  --ui-rvcc-track: rgba(0, 0, 0, 0.05);
  /* Risk and state */
  --ui-rvcc-high-bg: #f52b0018;
  --ui-rvcc-high-edge: rgba(215, 36, 0, 0.34);
  --ui-rvcc-high-fg: #d72400da;
  --ui-rvcc-mid-bg: #ff9c0024;
  --ui-rvcc-mid-edge: rgba(204, 110, 0, 0.4);
  --ui-rvcc-mid-fg: #cc4e00;
  --ui-rvcc-low-bg: #00a43319;
  --ui-rvcc-low-edge: rgba(0, 140, 50, 0.3);
  --ui-rvcc-low-fg: #007d2ee0;
  /* Flagged spans: the agent isn't sure */
  --ui-rvcc-flag-bg: rgba(255, 166, 0, 0.16);
  --ui-rvcc-flag-edge: rgba(214, 130, 0, 0.55);
  --ui-rvcc-flag-hot: rgba(255, 166, 0, 0.28);
  --ui-rvcc-flag-ink: #8a4600;
  --ui-rvcc-ins-bg: rgba(0, 164, 51, 0.13);
  --ui-rvcc-ins-ink: #006b27;
  --ui-rvcc-add-bg: rgba(0, 164, 51, 0.06);
  --ui-rvcc-del-bg: rgba(245, 43, 0, 0.05);
  --ui-rvcc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-rvcc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-rvcc-raised: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 1px -1px rgba(0, 0, 0, 0.12), 0 2px 4px 0 rgba(0, 0, 0, 0.05);
  --ui-rvcc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-rvcc-height: 552px;
  --ui-rvcc-queue: 296px;
  --ui-rvcc-row: 56px;
  --ui-rvcc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  --ui-rvcc-ease-in: cubic-bezier(0.55, 0, 0.75, 0.3);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  border-radius: 12px;
  background: var(--ui-rvcc-card);
  box-shadow: var(--ui-rvcc-shadow);
  outline: none;
  container: ui-rvcc / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-rvcc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-rvcc *, .ui-rvcc *::before, .ui-rvcc *::after { box-sizing: border-box; }
:where(.ui-rvcc) :is(button, input, textarea) { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; -webkit-tap-highlight-color: transparent; }
:where(.ui-rvcc) button { cursor: pointer; }
:where(.ui-rvcc) button:disabled { cursor: default; }
.ui-rvcc :is(button, a, mark, input, textarea):focus-visible { outline: 2px solid var(--ui-rvcc-focus); outline-offset: 1px; }
:where(.ui-rvcc) :is(p, dl, dd, h3, ul, ol) { margin: 0; padding: 0; }
.ui-rvcc svg { display: block; flex: none; }
.ui-rvcc__kbd { display: inline-grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; background: var(--ui-rvcc-fill); font-family: inherit; font-size: 10px; font-weight: 500; line-height: 1; color: var(--ui-rvcc-muted); letter-spacing: 0; }
.ui-rvcc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- The bar on top: how far you are, how long the oldest waits ----- */
.ui-rvcc__head { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; min-height: 48px; padding: 10px 12px 10px 16px; border-bottom: 0.5px solid var(--ui-rvcc-line); }
.ui-rvcc__mark { display: grid; flex: none; place-items: center; width: 16px; margin-right: -4px; color: var(--ui-rvcc-accent); }
.ui-rvcc__heading { flex: none; font-weight: 500; color: var(--ui-rvcc-strong); }
.ui-rvcc__progress { display: flex; flex: none; align-items: center; gap: 8px; font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); white-space: nowrap; }
.ui-rvcc__count { font-variant-numeric: tabular-nums; }
.ui-rvcc__count b { display: inline-block; font-weight: 500; color: var(--ui-rvcc-ink); animation: ui-rvcc-tick 420ms var(--ui-rvcc-ease) both; }
/* The progress bar: a light tint with a hairline edge, a sheen sweeping while items wait */
.ui-rvcc__track { position: relative; width: 80px; height: 6px; overflow: hidden; border-radius: 3px; background: var(--ui-rvcc-track); }
.ui-rvcc__fill { position: absolute; inset: 0 auto 0 0; overflow: hidden; border-radius: 3px; background: var(--ui-rvcc-bar-bg); box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-bar-edge); transition: width 700ms var(--ui-rvcc-ease); }
.ui-rvcc__track[data-live] .ui-rvcc__fill::before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--ui-rvcc-card), transparent) -40px 0 / 40px 100% no-repeat; opacity: 0.7; animation: ui-rvcc-sweep 1800ms linear infinite; }
.ui-rvcc__fill::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: min(18px, 100%); background: linear-gradient(90deg, transparent, var(--ui-rvcc-bar-mark)); opacity: 0.55; animation: ui-rvcc-glow 1100ms ease-in-out infinite alternate; }
.ui-rvcc__oldest { flex: none; margin-left: -4px; font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); white-space: nowrap; }
.ui-rvcc__oldest::before { content: "·"; margin-right: 8px; color: var(--ui-rvcc-faint); }
.ui-rvcc__oldest b { font-weight: 500; color: var(--ui-rvcc-text); font-variant-numeric: tabular-nums; }
.ui-rvcc__oldest b[data-sla="near"] { color: var(--ui-rvcc-mid-fg); }
.ui-rvcc__oldest b[data-sla="over"] { color: var(--ui-rvcc-high-fg); }
/* The filter: a gray track, the picked one white */
/* The filter: on white – the picked tab a white pill with the card's shadow, the others just quieter text */
.ui-rvcc__filters { display: flex; flex: 1; gap: 4px; min-width: 0; }
.ui-rvcc__filter { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-rvcc-muted); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }
.ui-rvcc__filter:hover { color: var(--ui-rvcc-ink); }
.ui-rvcc__filter[aria-pressed="true"] { background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); color: var(--ui-rvcc-ink); }
.ui-rvcc__filter-count { font-size: 11.5px; color: var(--ui-rvcc-faint); font-variant-numeric: tabular-nums; }
.ui-rvcc__filter[aria-pressed="true"] .ui-rvcc__filter-count { color: var(--ui-rvcc-muted); }

/* ----- Under the bar: the queue on the left, the item on the right ----- */
.ui-rvcc__card { position: relative; display: grid; grid-template-columns: var(--ui-rvcc-queue) minmax(0, 1fr); height: var(--ui-rvcc-height); overflow: hidden; border-radius: 0 0 12px 12px; }

/* ----- The queue ----- */
.ui-rvcc__queue { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 0.5px solid var(--ui-rvcc-line); background: var(--ui-rvcc-queue-bg); }
.ui-rvcc__queue-head { display: flex; flex: none; align-items: center; padding: 8px; background: var(--ui-rvcc-card); border-bottom: 0.5px solid var(--ui-rvcc-line); }
.ui-rvcc__list { position: relative; flex: 1; min-height: 0; padding: 8px; overflow: hidden auto; overscroll-behavior: contain; list-style: none; scrollbar-width: thin; }
.ui-rvcc__item { height: calc(var(--ui-rvcc-row) + 2px); padding: 1px 0; overflow: hidden; }
.ui-rvcc__item[data-enter="first"] { animation: ui-rvcc-row-in 460ms var(--ui-rvcc-ease) var(--d) backwards; }
.ui-rvcc__item:is([data-enter="new"], [data-enter="in"]) { animation: ui-rvcc-open 520ms var(--ui-rvcc-ease) var(--d) backwards; }
.ui-rvcc__item[data-enter="new"] .ui-rvcc__row { animation: ui-rvcc-arrive 2600ms ease-out backwards; }
.ui-rvcc__item[data-leaving] { pointer-events: none; animation: ui-rvcc-close ${EXIT}ms var(--ui-rvcc-ease) var(--d) forwards; }
.ui-rvcc__item[data-leaving][data-decision] { animation-delay: calc(var(--d) + ${STAMP}ms); }
.ui-rvcc__row { position: relative; display: grid; grid-template-columns: 24px minmax(0, 1fr); align-items: center; column-gap: 10px; width: 100%; height: var(--ui-rvcc-row); padding: 0 10px; border-radius: 8px; transition: background-color 160ms ease, box-shadow 200ms ease; }
.ui-rvcc__row:hover { background: var(--ui-rvcc-hover); }
.ui-rvcc__row[aria-current] { background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); }
.ui-rvcc__row:focus-visible { outline-offset: -2px; }
.ui-rvcc__avatar { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); font-size: 11px; font-weight: 500; color: var(--ui-rvcc-text); }
.ui-rvcc__avatar > svg { width: 13px; height: 13px; }
.ui-rvcc__row-main { display: grid; gap: 2px; min-width: 0; transition: opacity 200ms ease; }
.ui-rvcc__row-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-rvcc__row-title { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-rvcc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvcc__wait { flex: none; font-size: 12px; line-height: 16px; color: var(--ui-rvcc-faint); font-variant-numeric: tabular-nums; }
.ui-rvcc__wait[data-sla="near"] { color: var(--ui-rvcc-mid-fg); }
.ui-rvcc__wait[data-sla="over"] { color: var(--ui-rvcc-high-fg); }
.ui-rvcc__row-meta { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); white-space: nowrap; }
.ui-rvcc__tag { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-rvcc [data-risk="high"] { --k-bg: var(--ui-rvcc-high-bg); --k-edge: var(--ui-rvcc-high-edge); --k-fg: var(--ui-rvcc-high-fg); }
.ui-rvcc [data-risk="medium"] { --k-bg: var(--ui-rvcc-mid-bg); --k-edge: var(--ui-rvcc-mid-edge); --k-fg: var(--ui-rvcc-mid-fg); }
.ui-rvcc [data-risk="low"] { --k-bg: var(--ui-rvcc-low-bg); --k-edge: var(--ui-rvcc-low-edge); --k-fg: var(--ui-rvcc-low-fg); }
.ui-rvcc__skipped { flex: none; color: var(--ui-rvcc-faint); }
/* A decided row: a small check or cross where the time was, then it fades and closes up */
.ui-rvcc__item[data-decision] .ui-rvcc__row-main { opacity: 0.5; transition-delay: var(--d); }
.ui-rvcc__row-done { display: grid; flex: none; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: var(--k-bg); color: var(--k-fg); animation: ui-rvcc-fade 160ms ease var(--d) backwards; }
.ui-rvcc__row-done > svg { width: 12px; height: 12px; }
:is(.ui-rvcc__row-done, .ui-rvcc__undo, .ui-rvcc__btn)[data-decision="approved"], .ui-rvcc__btn[data-tone="approved"] { --k-bg: var(--ui-rvcc-low-bg); --k-edge: var(--ui-rvcc-low-edge); --k-fg: var(--ui-rvcc-low-fg); }
:is(.ui-rvcc__row-done, .ui-rvcc__undo, .ui-rvcc__btn)[data-decision="rejected"], .ui-rvcc__btn[data-tone="rejected"] { --k-bg: var(--ui-rvcc-high-bg); --k-edge: var(--ui-rvcc-high-edge); --k-fg: var(--ui-rvcc-high-fg); }
.ui-rvcc__none { display: grid; place-items: center; height: 120px; font-size: 12px; color: var(--ui-rvcc-faint); list-style: none; animation: ui-rvcc-fade 300ms ease 300ms backwards; }


/* ----- The item ----- */
.ui-rvcc__main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ui-rvcc__stage { position: relative; flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; scrollbar-width: thin; transition: height 420ms var(--ui-rvcc-ease); }
.ui-rvcc__detail { position: relative; display: grid; gap: 16px; padding: 22px 24px 24px; background: var(--ui-rvcc-card); }
.ui-rvcc__detail[data-enter="first"] > * { animation: ui-rvcc-in 420ms var(--ui-rvcc-ease) calc(120ms + var(--i, 0) * 40ms) backwards; }
/* After a decision: the old item fades up and away, the next one follows a beat later from just below */
.ui-rvcc__detail[data-enter="decide"] { animation: ui-rvcc-in 320ms var(--ui-rvcc-ease) calc(var(--d) + 90ms) backwards; }
.ui-rvcc__detail[data-enter="down"] { animation: ui-rvcc-in 280ms var(--ui-rvcc-ease) backwards; }
.ui-rvcc__detail[data-enter="up"] { animation: ui-rvcc-in-up 280ms var(--ui-rvcc-ease) backwards; }
.ui-rvcc__detail[data-enter="fade"] { animation: ui-rvcc-fade 240ms ease backwards; }
.ui-rvcc__detail[data-ghost] { position: absolute; inset: 0 0 auto; z-index: 2; min-height: 100%; pointer-events: none; animation: ui-rvcc-away 240ms var(--ui-rvcc-ease) var(--d) forwards; }

.ui-rvcc__who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ui-rvcc__who .ui-rvcc__avatar { width: 32px; height: 32px; border-radius: 8px; }
.ui-rvcc__who .ui-rvcc__avatar > svg { width: 16px; height: 16px; }
.ui-rvcc__meta { display: grid; flex: 1; gap: 0; min-width: 0; }
.ui-rvcc__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-rvcc__agent { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-rvcc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvcc__model { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* The risk tag: a tint with its color, like the Live tag in Trace Waterfall – low risk needs none */
.ui-rvcc__risk { display: inline-flex; flex: none; align-items: center; height: 20px; padding: 0 7px; border-radius: 5px; background: var(--k-bg); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--k-fg); white-space: nowrap; }
.ui-rvcc__ask { display: grid; gap: 4px; }
.ui-rvcc__title { font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-rvcc-strong); text-wrap: balance; }
.ui-rvcc__why { margin-top: -6px; font-size: 13px; line-height: 20px; color: var(--ui-rvcc-muted); text-wrap: pretty; }
.ui-rvcc__why b { font-weight: 500; color: var(--ui-rvcc-text); }

/* The proposal: no box around it – the content is the focus */
.ui-rvcc__proposal { display: grid; gap: 16px; min-width: 0; padding-top: 2px; }
/* Facts in a light row: a small label over each value, no lines between them */
.ui-rvcc__fields { display: flex; flex-wrap: wrap; gap: 12px 36px; }
.ui-rvcc__fields > div { display: grid; gap: 1px; min-width: 0; max-width: 100%; }
.ui-rvcc__fields dt { font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); }
.ui-rvcc__fields dd { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 22px; color: var(--ui-rvcc-ink); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-rvcc__body { display: grid; gap: 6px; min-width: 0; }
.ui-rvcc__body-label { font-size: 12px; line-height: 16px; color: var(--ui-rvcc-muted); }
/* Prose sits on a thin line at its left, like a quote of what goes out */
.ui-rvcc__text { padding-left: 14px; box-shadow: inset 0.5px 0 0 var(--ui-rvcc-line-strong); font-size: 13px; line-height: 22px; color: var(--ui-rvcc-ink); white-space: pre-wrap; overflow-wrap: anywhere; text-wrap: pretty; }

/* Code: a white block on the card's shadow – a row per file, the diff under a hairline. Numbers soft, no gutter, few colors */
.ui-rvcc__code { overflow: hidden; border-radius: 10px; background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); }
.ui-rvcc__file + .ui-rvcc__file { border-top: 0.5px solid var(--ui-rvcc-line); }
.ui-rvcc__file-head { display: flex; align-items: center; gap: 8px; min-width: 0; height: 36px; padding: 0 12px 0 15.6px; font-size: 13px; line-height: 20px; }
.ui-rvcc__path { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-rvcc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvcc__dir { color: var(--ui-rvcc-muted); }
:is(.ui-rvcc__count-add, .ui-rvcc__count-del) { flex: none; font-size: 12px; font-variant-numeric: tabular-nums; }
.ui-rvcc__count-add { color: var(--ui-rvcc-diff-add-fg); }
.ui-rvcc__count-del { color: var(--ui-rvcc-diff-del-fg); }
.ui-rvcc__diff { padding: 8px 0 2px; overflow-x: auto; border-top: 0.5px solid var(--ui-rvcc-line); font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 400; line-height: 20px; letter-spacing: normal; white-space: pre; scrollbar-width: thin; }
.ui-rvcc__line { display: flex; min-width: max-content; color: var(--ui-rvcc-code-ink); }
.ui-rvcc__line[data-diff="add"] { background: var(--ui-rvcc-diff-add); }
.ui-rvcc__line[data-diff="del"] { background: var(--ui-rvcc-diff-del); }
.ui-rvcc__ln { position: relative; flex: none; min-width: calc(2ch + 23.4px); padding: 0 7.8px 0 15.6px; color: var(--ui-rvcc-code-num); text-align: right; font-variant-numeric: tabular-nums; user-select: none; }
.ui-rvcc__sign { position: absolute; left: 4px; font-size: 11px; }
.ui-rvcc__line[data-diff="add"] .ui-rvcc__sign { color: var(--ui-rvcc-diff-add-fg); }
.ui-rvcc__line[data-diff="del"] .ui-rvcc__sign { color: var(--ui-rvcc-diff-del-fg); }
.ui-rvcc__src { padding: 0 7.8px; }
.ui-rvcc__hunk { display: block; padding: 0 7.8px 0 calc(2ch + 31.2px); color: var(--ui-rvcc-code-num); }
.ui-rvcc [data-tok="kw"] { color: var(--ui-rvcc-tok-kw); }
.ui-rvcc [data-tok="str"] { color: var(--ui-rvcc-tok-str); }
.ui-rvcc [data-tok="fn"] { color: var(--ui-rvcc-tok-fn); }
.ui-rvcc [data-tok="type"] { color: var(--ui-rvcc-tok-type); }
.ui-rvcc [data-tok="com"] { color: var(--ui-rvcc-code-num); }
.ui-rvcc__line .ui-rvcc__flag { padding: 1px 1px; margin: 0; }
.ui-rvcc__line .ui-rvcc__flag [data-tok] { color: inherit; }

/* A plan: numbered steps with the tool each one calls; a flagged step's number turns amber */
.ui-rvcc__steps { display: grid; gap: 12px; list-style: none; }
.ui-rvcc__step { display: grid; grid-template-columns: 22px minmax(0, 1fr); column-gap: 12px; }
.ui-rvcc__step-n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-line-strong); font-size: 11.5px; font-weight: 500; color: var(--ui-rvcc-muted); font-variant-numeric: tabular-nums; }
.ui-rvcc__step[data-flagged] .ui-rvcc__step-n { background: var(--ui-rvcc-flag-bg); box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-flag-edge); color: var(--ui-rvcc-flag-ink); }
.ui-rvcc__step-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; padding-top: 1px; }
.ui-rvcc__step-title { font-size: 13px; line-height: 20px; color: var(--ui-rvcc-ink); }
.ui-rvcc__step-tool { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 20px; color: var(--ui-rvcc-muted); white-space: nowrap; }
.ui-rvcc__step-detail { width: 100%; font-size: 12.5px; line-height: 19px; color: var(--ui-rvcc-muted); }

/* A span the agent isn't sure about: a warm tint with a hairline underline – brighter while its note shows */
.ui-rvcc__flag { padding: 1px 2px; margin: 0 -1px; border-radius: 3px; background: var(--ui-rvcc-flag-bg); box-shadow: inset 0 -1px 0 var(--ui-rvcc-flag-edge); color: var(--ui-rvcc-flag-ink); cursor: help; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 160ms ease, box-shadow 160ms ease; }
.ui-rvcc__flag:is(:hover, [data-on]) { background: var(--ui-rvcc-flag-hot); box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-flag-edge); }
.ui-rvcc__ins { padding: 1px 2px; margin: 0 -1px; border-radius: 3px; background: var(--ui-rvcc-ins-bg); color: var(--ui-rvcc-ins-ink); text-decoration: none; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
/* Editing: the text field sits on a mirror that marks what changed; the ring is the only frame */
.ui-rvcc__editor { display: grid; margin: -6px -8px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--ui-rvcc-accent), 0 0 0 3px var(--ui-rvcc-ring-soft); }
.ui-rvcc__editor > * { grid-area: 1 / 1; padding: 6px 8px; font-size: 13px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-rvcc__body[data-format="code"] .ui-rvcc__editor > * { font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; font-size: 12px; line-height: 20px; letter-spacing: 0; }
.ui-rvcc__mirror { color: transparent; }
/* No padding here – the mirror has to wrap exactly like the field; the tint reaches out with a shadow */
.ui-rvcc__mirror .ui-rvcc__ins { padding: 0; margin: 0; color: transparent; box-shadow: 0 0 0 2px var(--ui-rvcc-ins-bg); }
.ui-rvcc__editor textarea { width: 100%; height: 100%; overflow: hidden; resize: none; color: var(--ui-rvcc-ink); caret-color: var(--ui-rvcc-accent); outline: none; }
.ui-rvcc__editor textarea:focus-visible { outline: none; }
.ui-rvcc__input { width: 100%; min-width: 120px; height: 24px; margin: 0 -6px; padding: 0 6px; border-radius: 5px; background: var(--ui-rvcc-wash); box-shadow: inset 0 0 0 1px var(--ui-rvcc-line); font-weight: 500; color: var(--ui-rvcc-ink); outline: none; }
.ui-rvcc__input:focus { box-shadow: inset 0 0 0 1px var(--ui-rvcc-accent); }

.ui-rvcc__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
/* Sources: plain words with their marks – no chips */
.ui-rvcc__sources { display: flex; flex-wrap: wrap; gap: 4px 14px; min-width: 0; list-style: none; }
.ui-rvcc__source { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 20px; color: var(--ui-rvcc-muted); white-space: nowrap; text-decoration: none; transition: color 160ms ease; }
a.ui-rvcc__source:hover { color: var(--ui-rvcc-ink); }
.ui-rvcc__source-icon { display: grid; place-items: center; width: 14px; height: 14px; color: var(--ui-rvcc-muted); }
.ui-rvcc__source-icon > svg { width: 12px; height: 12px; }

.ui-rvcc__empty { display: grid; place-content: center; justify-items: center; gap: 2px; min-height: 100%; padding: 48px 24px; text-align: center; animation: ui-rvcc-in 360ms var(--ui-rvcc-ease) 120ms backwards; }
.ui-rvcc__empty[data-after] { animation-delay: calc(var(--d) + 120ms); }
.ui-rvcc__empty-mark { display: grid; place-items: center; width: 40px; height: 40px; margin-bottom: 10px; border-radius: 10px; background: var(--ui-rvcc-card); color: var(--ui-rvcc-low-fg); box-shadow: var(--ui-rvcc-shadow), 0 0 0 4px var(--ui-rvcc-low-bg); }
.ui-rvcc__empty b { font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-rvcc-strong); }
.ui-rvcc__empty > span:last-child { max-width: 280px; font-size: 13px; line-height: 20px; color: var(--ui-rvcc-muted); text-wrap: balance; }

/* The agent's note on a flagged span */
.ui-rvcc__tip { position: absolute; top: 0; left: 0; z-index: 6; display: grid; gap: 2px; width: min(300px, calc(100% - 20px)); padding: 10px 12px; border-radius: 10px; background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-pop); pointer-events: none; transform-origin: var(--x, 50%) bottom; animation: ui-rvcc-tip 200ms var(--ui-rvcc-ease) both; }
.ui-rvcc__tip[data-side="below"] { transform-origin: var(--x, 50%) top; }
.ui-rvcc__tip-head { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 500; line-height: 16px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ui-rvcc-mid-fg); }
.ui-rvcc__tip-head > svg { width: 12px; height: 12px; }
.ui-rvcc__tip p { font-size: 13px; line-height: 20px; color: var(--ui-rvcc-ink); text-wrap: pretty; }
.ui-rvcc__tip-source { justify-self: start; margin-top: 4px; padding: 0 6px; border-radius: 5px; background: var(--ui-rvcc-fill); font-size: 12px; line-height: 20px; color: var(--ui-rvcc-text); }

/* ----- The actions ----- */
.ui-rvcc__actions { position: relative; display: flex; flex: none; align-items: center; gap: 12px; min-height: 52px; padding: 12px 16px; border-top: 0.5px solid var(--ui-rvcc-line); background: var(--ui-rvcc-card); }
.ui-rvcc__btns { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; animation: ui-rvcc-swap 220ms var(--ui-rvcc-ease) both; }
.ui-rvcc__btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 6px 0 6px; border-radius: 6px; background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); font-size: 13px; font-weight: 500; color: var(--ui-rvcc-strong); white-space: nowrap; transition: transform 140ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease, opacity 200ms ease; }
.ui-rvcc__btn > svg { color: rgba(0, 0, 0, 0.447); }
.ui-rvcc__btn > span { margin-right: 2px; }
.ui-rvcc__btn:hover:not(:disabled) { box-shadow: var(--ui-rvcc-raised); }
.ui-rvcc__btn[data-primary] { background: var(--ui-rvcc-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16); color: var(--ui-rvcc-primary-fg); }
.ui-rvcc__btn[data-primary] > svg { color: inherit; }
.ui-rvcc__btn[data-primary] .ui-rvcc__kbd { background: rgba(255, 255, 255, 0.16); color: rgba(255, 255, 255, 0.72); }
.ui-rvcc__btn[data-primary]:hover:not(:disabled) { background: #000000; }
.ui-rvcc__btn:disabled { opacity: 0.45; }
:is(.ui-rvcc__btn, .ui-rvcc__reason, .ui-rvcc__undo-btn)[data-pressed] { transform: scale(0.97); }
/* The pressed button flashes its decision's tint for a moment – the only color a decision adds */
.ui-rvcc__btn[data-pressed] { background: var(--k-bg, var(--ui-rvcc-wash)); box-shadow: inset 0 0 0 0.5px var(--k-edge, var(--ui-rvcc-line)); color: var(--k-fg, var(--ui-rvcc-strong)); }
.ui-rvcc__btn[data-pressed] > svg { color: inherit; }
.ui-rvcc__why-label { margin-right: 2px; font-size: 13px; font-weight: 500; color: var(--ui-rvcc-strong); }
.ui-rvcc__reason { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 6px; border-radius: 6px; background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); font-size: 13px; font-weight: 500; color: var(--ui-rvcc-strong); white-space: nowrap; transition: transform 140ms ease, box-shadow 160ms ease, background-color 160ms ease, color 160ms ease; }
.ui-rvcc__reason:hover { box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-high-edge), 0 1px 2px rgba(0, 0, 0, 0.05); }
.ui-rvcc__reason[data-pressed] { background: var(--ui-rvcc-high-bg); box-shadow: inset 0 0 0 0.5px var(--ui-rvcc-high-edge); color: var(--ui-rvcc-high-fg); }
.ui-rvcc__cancel { height: 28px; padding: 0 8px; border-radius: 6px; font-size: 12px; color: var(--ui-rvcc-muted); }
.ui-rvcc__cancel:hover { color: var(--ui-rvcc-ink); }
/* Undo: a small chip in the bar for a few seconds, right of how far you are */
.ui-rvcc__undo { display: flex; flex: 0 1 auto; align-items: center; gap: 2px; min-width: 0; height: 28px; margin-left: auto; padding: 0 0 0 4px; border-radius: 6px; background: var(--ui-rvcc-card); animation: ui-rvcc-chip-in 360ms var(--ui-rvcc-ease) both, ui-rvcc-chip-out 300ms ease ${UNDO_FOR - 300}ms forwards; }
.ui-rvcc__undo-text { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; font-size: 12px; color: var(--ui-rvcc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvcc__undo-text > svg { width: 14px; height: 14px; color: var(--k-fg); }
.ui-rvcc__undo-btn { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 24px; margin-left: 4px; padding: 0 4px 0 6px; border-radius: 5px; font-size: 12px; font-weight: 500; color: var(--ui-rvcc-strong); transition: background-color 140ms ease, transform 140ms ease; }
.ui-rvcc__undo-btn:hover { background: var(--ui-rvcc-card); box-shadow: var(--ui-rvcc-shadow); }
.ui-rvcc__undo-btn > svg { color: rgba(0, 0, 0, 0.447); }

/* Worst-case data: the item never grows wider than its pane, long words wrap, one-liners shorten */
.ui-rvcc__detail { grid-template-columns: minmax(0, 1fr); }
.ui-rvcc__heading { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-rvcc__title, .ui-rvcc__why, .ui-rvcc__row-title { text-align: start; }
.ui-rvcc__title, .ui-rvcc__why, .ui-rvcc__step-title, .ui-rvcc__tip p, .ui-rvcc__tip-source { overflow-wrap: anywhere; }
.ui-rvcc__step-detail { overflow-wrap: anywhere; white-space: pre-line; }
.ui-rvcc__sources > li { min-width: 0; max-width: 100%; }
.ui-rvcc__source { max-width: 100%; }
.ui-rvcc__source-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-rvcc__source-icon { flex: none; }
.ui-rvcc__step-tool { min-width: 0; max-width: 100%; }
/* ----- Medium: a slimmer queue ----- */
@container ui-rvcc (max-width: 820px) {
  .ui-rvcc__card { --ui-rvcc-queue: 268px; }
  .ui-rvcc__detail { padding: 18px 20px 20px; }
}
@container ui-rvcc (max-width: 740px) {
  .ui-rvcc__btn .ui-rvcc__kbd { display: none; }
  .ui-rvcc__btn { padding-right: 10px; }
  .ui-rvcc__filter-count { font-size: 11.5px; color: var(--ui-rvcc-faint); font-variant-numeric: tabular-nums; }
}
/* ----- Narrow: the queue on top, three rows high, the item under it ----- */
@container ui-rvcc (max-width: 639px) {
  .ui-rvcc__head { padding: 10px 10px 10px 14px; }
  .ui-rvcc__oldest { margin-left: auto; padding-right: 4px; }
  .ui-rvcc__oldest::before { content: none; }
  .ui-rvcc__progress { order: 5; width: 100%; padding-right: 4px; }
  .ui-rvcc__progress .ui-rvcc__track { flex: 1; }
  .ui-rvcc__filter-count { font-size: 11.5px; color: var(--ui-rvcc-faint); font-variant-numeric: tabular-nums; }
  /* Undo sits over the right end of the bar, in front of "Oldest" */
  .ui-rvcc__undo { position: absolute; top: auto; right: 10px; bottom: 8px; z-index: 2; max-width: calc(100% - 20px); }
  .ui-rvcc__card { display: flex; flex-direction: column; height: auto; }
  .ui-rvcc__queue { border-right: 0; border-bottom: 0.5px solid var(--ui-rvcc-line); }
  .ui-rvcc__list { flex: none; height: calc(3 * (var(--ui-rvcc-row) + 2px) + 16px); }
  .ui-rvcc__stage { flex: none; overflow: hidden; }
  .ui-rvcc__detail { gap: 14px; padding: 16px 14px 18px; }
  .ui-rvcc__actions { flex-wrap: wrap; padding: 10px 12px 12px; }
  .ui-rvcc__btns { flex: 1; flex-wrap: nowrap; }
  .ui-rvcc__btns > .ui-rvcc__btn { flex: 1; justify-content: center; padding: 0 8px; }
  .ui-rvcc__btns[role="group"] { flex-wrap: wrap; }
  .ui-rvcc__reason { flex: 1 1 40%; justify-content: center; }
  .ui-rvcc__why-label { width: 100%; }
  .ui-rvcc__empty { min-height: 220px; padding: 36px 20px; }
}
/* Phones: the type tag steps aside in the item, the button labels get the room */
@container ui-rvcc (max-width: 420px) {
  .ui-rvcc__btn > svg { display: none; }
  .ui-rvcc__filter { gap: 4px; }
  .ui-rvcc__undo-btn .ui-rvcc__kbd { display: none; }
  .ui-rvcc__sources { width: 100%; }
}
@container ui-rvcc (max-width: 360px) {
  .ui-rvcc__filter-count { font-size: 11.5px; color: var(--ui-rvcc-faint); font-variant-numeric: tabular-nums; }
}

@keyframes ui-rvcc-row-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-rvcc-open { from { height: 0; padding: 0; opacity: 0; } }
@keyframes ui-rvcc-close { from { height: calc(var(--ui-rvcc-row) + 2px); } to { height: 0; padding: 0; opacity: 0; } }
@keyframes ui-rvcc-arrive { 0%, 40% { background: var(--ui-rvcc-new); } }
@keyframes ui-rvcc-fade { from { opacity: 0; } }
@keyframes ui-rvcc-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes ui-rvcc-in-up { from { opacity: 0; transform: translateY(-8px); } }
@keyframes ui-rvcc-away { to { opacity: 0; transform: translateY(-6px); } }
@keyframes ui-rvcc-tip { from { opacity: 0; transform: translateY(4px) scale(0.96); } }
@keyframes ui-rvcc-swap { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-rvcc-chip-in { from { opacity: 0; transform: translateX(8px); } }
@keyframes ui-rvcc-chip-out { to { opacity: 0; transform: translateX(6px); } }
@keyframes ui-rvcc-tick { from { opacity: 0; transform: translateY(-6px); } }
@keyframes ui-rvcc-sweep { to { background-position: calc(100% + 40px) 0; } }
@keyframes ui-rvcc-glow { from { opacity: 0.25; } to { opacity: 0.7; } }

@media (pointer: coarse) {
  .ui-rvcc .ui-rvcc__kbd { display: none; }
  .ui-rvcc__btn { padding-right: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-rvcc *, .ui-rvcc *::before, .ui-rvcc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-rvcc {
  --ui-rvcc-card: #1c1c1f;
  --ui-rvcc-strong: #ffffff;
  --ui-rvcc-ink: rgba(255, 255, 255, 0.9);
  --ui-rvcc-text: rgba(255, 255, 255, 0.62);
  --ui-rvcc-muted: rgba(255, 255, 255, 0.45);
  --ui-rvcc-faint: rgba(255, 255, 255, 0.28);
  --ui-rvcc-line: rgba(255, 255, 255, 0.08);
  --ui-rvcc-queue-bg: rgba(255, 255, 255, 0.015);
  --ui-rvcc-line-strong: rgba(255, 255, 255, 0.16);
  --ui-rvcc-code-ink: rgba(255, 255, 255, 0.88);
  --ui-rvcc-code-num: rgba(255, 255, 255, 0.42);
  --ui-rvcc-diff-add: rgba(60, 220, 130, 0.07);
  --ui-rvcc-diff-del: rgba(255, 90, 70, 0.07);
  --ui-rvcc-diff-add-fg: #5fd38d;
  --ui-rvcc-diff-del-fg: #ff8a73;
  --ui-rvcc-tok-kw: color(display-p3 0.98 0.52 0.68);
  --ui-rvcc-tok-str: color(display-p3 0.56 0.82 0.54);
  --ui-rvcc-tok-type: color(display-p3 0.48 0.7 1);
  --ui-rvcc-tok-fn: color(display-p3 0.78 0.56 0.88);
  --ui-rvcc-ring-soft: rgba(91, 154, 255, 0.16);
  --ui-rvcc-hover: rgba(255, 255, 255, 0.03);
  --ui-rvcc-fill: rgba(255, 255, 255, 0.08);
  --ui-rvcc-wash: rgba(255, 255, 255, 0.03);
  --ui-rvcc-accent: #5b9aff;
  --ui-rvcc-new: rgba(91, 154, 255, 0.1);
  --ui-rvcc-primary: rgba(255, 255, 255, 0.92);
  --ui-rvcc-primary-fg: #111113;
  --ui-rvcc-bar-bg: rgba(91, 154, 255, 0.16);
  --ui-rvcc-bar-edge: rgba(91, 154, 255, 0.42);
  --ui-rvcc-bar-mark: rgba(112, 170, 255, 0.85);
  --ui-rvcc-track: rgba(255, 255, 255, 0.07);
  --ui-rvcc-high-bg: #ff35232b;
  --ui-rvcc-high-edge: rgba(255, 90, 70, 0.4);
  --ui-rvcc-high-fg: #ff977d;
  --ui-rvcc-mid-bg: #fb6a0025;
  --ui-rvcc-mid-edge: rgba(255, 150, 60, 0.42);
  --ui-rvcc-mid-fg: #ffa057;
  --ui-rvcc-low-bg: #00f04a1f;
  --ui-rvcc-low-edge: rgba(60, 220, 130, 0.36);
  --ui-rvcc-low-fg: #3dd68c;
  --ui-rvcc-flag-bg: rgba(255, 170, 40, 0.16);
  --ui-rvcc-flag-edge: rgba(255, 180, 70, 0.55);
  --ui-rvcc-flag-hot: rgba(255, 170, 40, 0.28);
  --ui-rvcc-flag-ink: #ffcf8a;
  --ui-rvcc-ins-bg: rgba(60, 220, 130, 0.18);
  --ui-rvcc-ins-ink: #7deaa9;
  --ui-rvcc-add-bg: rgba(60, 220, 130, 0.07);
  --ui-rvcc-del-bg: rgba(255, 90, 70, 0.08);
  --ui-rvcc-focus: rgba(91, 154, 255, 0.45);
  --ui-rvcc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-rvcc-raised: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 3px 0 rgba(0, 0, 0, 0.5);
  --ui-rvcc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-rvcc__row[aria-current] { background: rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) :is(.ui-rvcc__btn, .ui-rvcc__undo-btn, :where(.dark, [data-theme="dark"]) .ui-rvcc__btn[data-primary] > svg { color: inherit; }
:where(.dark, [data-theme="dark"]) .ui-rvcc__btn[data-primary] .ui-rvcc__kbd { background: rgba(0, 0, 0, 0.1); color: rgba(0, 0, 0, 0.55); }
:where(.dark, [data-theme="dark"]) .ui-rvcc__btn[data-primary]:hover:not(:disabled) { background: #ffffff; }
:where(.dark, [data-theme="dark"]) .ui-rvcc__btn:is(:not([data-primary])), :where(.dark, [data-theme="dark"]) :is(.ui-rvcc__reason) { background: #26262a; }
`;
