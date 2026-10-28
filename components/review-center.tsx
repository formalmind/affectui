"use client";

import { memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";

/*
 * Review Center – a focused workspace for what your agents want to do, in a single self-contained file.
 * Human in the loop, one item at a time and fast: the queue sorted by risk, and the item you're on – who proposes
 * it, why, the proposal itself (fields, text, a code diff or a plan) and the spots the agent isn't sure about in amber.
 * A white card on a soft gray tray, and a quiet line on top: how far you are and how long the oldest has waited.
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
  <span className="ui-rvc__avatar" data-logo={it.icon ? "" : undefined} aria-hidden="true">
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
      className="ui-rvc__item"
      data-enter={enter?.kind}
      data-leaving={ghost ? "" : undefined}
      data-decision={d}
      style={{ "--d": `${ghost ? ghost.delay : (enter?.delay ?? 0)}ms` } as CSSProperties}
    >
      <button
        ref={ghost ? undefined : (el) => setEl(it.id, el)}
        type="button"
        className="ui-rvc__row"
        data-risk={it.risk}
        aria-current={current ? "true" : undefined}
        aria-label={`${it.title}. ${it.type}, ${RISK[it.risk].label.toLowerCase()}, ${pct(it.confidence)} confidence${w ? (w === "now" ? ", just in" : `, waiting ${w}`) : ""}${skipped ? ", skipped" : ""}`}
        tabIndex={focusable ? 0 : -1}
        onClick={() => !ghost && onPick(it.id)}
      >
        {avatarOf(it)}
        <span className="ui-rvc__row-main">
          <span className="ui-rvc__row-top">
            <span className="ui-rvc__row-title" dir="auto" title={it.title}>
              {it.title}
            </span>
            {d ? (
              <span className="ui-rvc__row-done" data-decision={d} aria-hidden="true">
                {d === "rejected" ? <Cross /> : <Tick />}
              </span>
            ) : (
              <span className="ui-rvc__wait" data-sla={sla}>
                {w}
              </span>
            )}
          </span>
          <span className="ui-rvc__row-meta">
            <span className="ui-rvc__tag" dir="auto" title={it.type}>
              {it.type}
            </span>
            {skipped && <span className="ui-rvc__skipped">· skipped</span>}
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
    if (focus) requestAnimationFrame(() => (editorRef.current ?? rootRef.current?.querySelector<HTMLInputElement>(".ui-rvc__input"))?.focus({ preventScroll: true }));
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
          className="ui-rvc__flag"
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
          <span key={k} className="ui-rvc__hunk">
            {lead}
          </span>
        );
      }
      const sign = lead.startsWith("+") ? "add" : lead.startsWith("-") ? "del" : "ctx";
      const rest = typeof first === "string" ? [first.slice(1), ...line.slice(1)] : line;
      // One number column: the new line's number, or the old one for a removed line, with a tiny sign before it
      const no = sign === "add" ? n++ : sign === "del" ? o++ : (o++, n++);
      return (
        <span key={k} className="ui-rvc__line" data-diff={sign}>
          <span className="ui-rvc__ln">
            {sign !== "ctx" && <span className="ui-rvc__sign">{sign === "add" ? "+" : "−"}</span>}
            {no}
          </span>
          <span className="ui-rvc__src">{rest.length ? inline(rest, true) : "​"}</span>
        </span>
      );
    });
  };
  const editedText = (before: string, after: string) => {
    const [a, b, c] = changed(before, after);
    return (
      <>
        {a}
        {b && <ins className="ui-rvc__ins">{b}</ins>}
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
        className="ui-rvc__detail"
        data-ghost={ghost ? "" : undefined}
        data-decision={d}
        data-enter={ghost ? undefined : entered.current.mode}
        aria-hidden={ghost ? true : undefined}
        style={{ "--d": `${ghost?.delay ?? out?.delay ?? 0}ms` } as CSSProperties}
      >
        {/* Who proposes it: the agent with a small risk tag, the model under it */}
        <div className="ui-rvc__who">
          {avatar(it)}
          <div className="ui-rvc__meta">
            <span className="ui-rvc__name">
              <span className="ui-rvc__agent" dir="auto" title={it.agent}>
                {it.agent}
              </span>
              {it.risk !== "low" && (
                <span className="ui-rvc__risk" data-risk={it.risk}>
                  {RISK[it.risk].label}
                </span>
              )}
            </span>
            {it.model && (
              <span className="ui-rvc__model" title={it.model}>
                {it.model}
              </span>
            )}
          </div>
        </div>
        <div className="ui-rvc__ask">
          <h3 className="ui-rvc__title" dir="auto">
            {it.title}
          </h3>
        </div>
        {it.reasoning && (
          <p className="ui-rvc__why" dir="auto">
            <b>Why </b>
            {it.reasoning}
          </p>
        )}
        <section className="ui-rvc__proposal" data-editing={editing ? "" : undefined} aria-label={`Proposal: ${it.type}`}>
          {!!it.fields?.length && (
            <dl className="ui-rvc__fields">
              {it.fields.map((f, fi) => {
                const k = `field:${f.label}`;
                return (
                  <div key={`${f.label}-${fi}`}>
                    <dt>{f.label}</dt>
                    <dd dir="auto" title={editing ? undefined : plain(f.value)}>
                      {editing ? (
                        <input className="ui-rvc__input" value={draft[k] ?? ""} aria-label={f.label} onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))} />
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
            <div className="ui-rvc__body" data-format={it.format}>
              {it.bodyLabel && <span className="ui-rvc__body-label">{it.bodyLabel}</span>}
              {editing ? (
                <div className="ui-rvc__editor">
                  {/* The mirror under the field marks what you changed */}
                  <div className="ui-rvc__mirror" aria-hidden="true">
                    {editedText(plain(it.body), draft.body ?? "")}
                    {"\u200b"}
                  </div>
                  <textarea ref={editorRef} value={draft.body ?? ""} aria-label={it.bodyLabel ?? "Proposal"} spellCheck={false} onChange={(e) => setDraft((x) => ({ ...x, body: e.target.value }))} />
                </div>
              ) : it.format === "code" && !(ghost && edits.body !== undefined && edits.body !== base.body) ? (
                <div className="ui-rvc__code">
                  <div className="ui-rvc__diff">{text(it.body, live, counter, "code")}</div>
                </div>
              ) : (
                <p className="ui-rvc__text" dir="auto">{ghost && edits.body !== undefined && edits.body !== base.body ? editedText(base.body, edits.body) : text(it.body, live, counter)}</p>
              )}
            </div>
          )}
          {!!it.files?.length && (
            // A code change: one row per file, the diff right under the files that matter
            <div className="ui-rvc__code">
              {it.files.map((f, fi) => (
                <div key={`${f.path}-${fi}`} className="ui-rvc__file">
                  <div className="ui-rvc__file-head">
                    <span className="ui-rvc__path" title={f.path}>
                      {f.path.includes("/") && <span className="ui-rvc__dir">{f.path.slice(0, f.path.lastIndexOf("/") + 1)}</span>}
                      {f.path.slice(f.path.lastIndexOf("/") + 1)}
                    </span>
                    {f.added !== undefined && <span className="ui-rvc__count-add">+{fmt.format(f.added)}</span>}
                    {f.removed !== undefined && <span className="ui-rvc__count-del">−{fmt.format(f.removed)}</span>}
                  </div>
                  {f.diff !== undefined && <div className="ui-rvc__diff">{text(f.diff, live, counter, "code", f.start ?? 1)}</div>}
                </div>
              ))}
            </div>
          )}
          {!!it.steps?.length && (
            <ol className="ui-rvc__steps">
              {it.steps.map((st, i) => (
                <li key={i} className="ui-rvc__step" data-flagged={flagsIn(st.title) + flagsIn(st.detail) ? "" : undefined}>
                  <span className="ui-rvc__step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span className="ui-rvc__step-main">
                    <span className="ui-rvc__step-title" dir="auto">
                      {text(st.title, live, counter)}
                    </span>
                    {st.tool && (
                      <span className="ui-rvc__step-tool" title={st.tool}>
                        {st.icon && <span className="ui-rvc__source-icon">{st.icon}</span>}
                        <span className="ui-rvc__source-label">{st.tool}</span>
                      </span>
                    )}
                    {st.detail !== undefined && (
                      <span className="ui-rvc__step-detail" dir="auto">
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
          <div className="ui-rvc__foot">
            <ul className="ui-rvc__sources" aria-label="Sources">
              {it.sources.map((s, si) => {
                const inner = (
                  <>
                    <span className="ui-rvc__source-icon">{s.icon ?? <LinkGlyph />}</span>
                    <span className="ui-rvc__source-label" dir="auto">
                      {s.label}
                    </span>
                  </>
                );
                return (
                  <li key={`${s.label}-${si}`} title={s.label}>
                    {s.href && live ? (
                      <a className="ui-rvc__source" href={s.href} target="_blank" rel="noreferrer">
                        {inner}
                      </a>
                    ) : (
                      <span className="ui-rvc__source">{inner}</span>
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
      className="ui-rvc__btn"
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
      <kbd className="ui-rvc__kbd">{key}</kbd>
    </button>
  );

  const shownTip = !!tipFlag && mode !== "edit";
  const filters: { id: ReviewFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "high", label: "High risk" },
    { id: "unsure", label: "Unsure" },
  ];
  const filterTabs = (
    <div className="ui-rvc__filters" role="group" aria-label="Filter the queue">
      {filters.map((f) => (
        <button key={f.id} type="button" className="ui-rvc__filter" aria-pressed={filter === f.id} onClick={() => changeFilter(f.id)}>
          {f.label}
          <span className="ui-rvc__filter-count">{fmt.format(counts[f.id])}</span>
        </button>
      ))}
    </div>
  );
  const progress = total ? done / total : 0;
  const empty = !current;

  return (
    <div
      ref={rootRef}
      className={["ui-rvc", className].filter(Boolean).join(" ")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // A click on plain content keeps the keys working
        if (!(e.target as HTMLElement).closest("button, a, input, textarea, mark")) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
      }}
    >
      <style href="ui-review-center" precedence="default">
        {css}
      </style>

      <header className="ui-rvc__head">
        <span className="ui-rvc__mark">
          <Badge />
        </span>
        <span className="ui-rvc__heading" title={title}>
          {title}
        </span>
        <span className="ui-rvc__progress">
          <span className="ui-rvc__track" data-live={pending.length ? "" : undefined} aria-hidden="true">
            <span className="ui-rvc__fill" style={{ width: `${progress * 100}%` }} />
          </span>
          <span className="ui-rvc__count">
            <b key={done}>{fmt.format(done)}</b> of {fmt.format(total)} reviewed
          </span>
        </span>
        {oldest && (
          <span className="ui-rvc__oldest">
            oldest <b data-sla={slaOf(oldest)}>{waited(now - toMs(oldest.createdAt))}</b>
          </span>
        )}
        {chip && (
          <div className="ui-rvc__undo" key={chip.key} data-decision={chip.decision}>
            <span className="ui-rvc__undo-text">
              {chip.decision === "rejected" ? <Cross /> : <Tick />}
              {chip.text}
            </span>
            <button type="button" className="ui-rvc__undo-btn" data-pressed={pressed === "undo" ? "" : undefined} onClick={undo} aria-keyshortcuts="Z">
              <UndoGlyph />
              Undo
              <kbd className="ui-rvc__kbd">Z</kbd>
            </button>
          </div>
        )}
      </header>

      <div className="ui-rvc__card" data-narrow={narrow ? "" : undefined}>
        <div className="ui-rvc__queue">
          <div className="ui-rvc__queue-head">{filterTabs}</div>
          <ul ref={listRef} className="ui-rvc__list" aria-label="Queue">
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
            {!rows.length && <li className="ui-rvc__none">{pending.length ? "Nothing matches this filter" : "Nothing waiting"}</li>}
          </ul>
        </div>

        <div className="ui-rvc__main">
          <div ref={stageRef} className="ui-rvc__stage">
            {out && detail(out.item, out)}
            {current ? (
              detail(current)
            ) : (
              <div ref={curRef} className="ui-rvc__empty" data-after={out ? "" : undefined} style={{ "--d": `${out?.delay ?? 0}ms` } as CSSProperties}>
                <span className="ui-rvc__empty-mark">
                  <Badge size={22} />
                </span>
                <b>{pending.length ? "Nothing matches this filter" : "All caught up"}</b>
                <span>{pending.length ? `${fmt.format(pending.length)} more in the queue under All` : `${fmt.format(done)} of ${fmt.format(total)} reviewed – new items from your agents show up here`}</span>
              </div>
            )}
            {shownTip && tipFlag && (
              <div ref={tipRef} id={tipId} role="tooltip" className="ui-rvc__tip" key={tipIndex}>
                <span className="ui-rvc__tip-head">
                  <Alert />
                  Agent's note
                </span>
                <p>{tipFlag.note}</p>
                {tipFlag.source && <span className="ui-rvc__tip-source">{tipFlag.source}</span>}
              </div>
            )}
          </div>

          <div className="ui-rvc__actions" data-mode={mode}>
            {mode === "view" && (
              <div className="ui-rvc__btns" key="view">
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
              <div className="ui-rvc__btns" key="reject" role="group" aria-label="Why reject it?">
                <span className="ui-rvc__why-label">Why?</span>
                {reasons.map((r, i) => (
                  <button key={r} type="button" className="ui-rvc__reason" data-pressed={pressed === `reason:${r}` ? "" : undefined} onClick={() => reject(r)} aria-keyshortcuts={String(i + 1)}>
                    <kbd className="ui-rvc__kbd">{i + 1}</kbd>
                    {r}
                  </button>
                ))}
                <button type="button" className="ui-rvc__cancel" onClick={cancel} aria-label="Cancel">
                  Esc
                </button>
              </div>
            )}
            {mode === "edit" && (
              <div className="ui-rvc__btns" key="edit">
                {btn("save", "Approve with edits", <Tick />, "⌘↵", save, {
                  primary: true,
                })}
                {btn("cancel", "Cancel", <Cross />, "Esc", cancel)}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="ui-rvc__sr" aria-live="polite" aria-atomic="true">
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-rvc */
.ui-rvc {
  --ui-rvc-tray: #f0f0f0;
  --ui-rvc-card: #ffffff;
  --ui-rvc-strong: #171717;
  --ui-rvc-ink: #171717;
  --ui-rvc-text: #5f5f5f;
  --ui-rvc-muted: #8a8a8a;
  --ui-rvc-faint: #b8b8b8;
  --ui-rvc-line: #ececec;
  --ui-rvc-queue-bg: #fafafa;
  --ui-rvc-line-strong: #dedede;
  --ui-rvc-code-ink: rgba(0, 0, 0, 0.88);
  --ui-rvc-code-num: rgba(0, 0, 0, 0.45);
  --ui-rvc-diff-add: rgba(0, 160, 80, 0.06);
  --ui-rvc-diff-del: rgba(215, 36, 0, 0.05);
  --ui-rvc-diff-add-fg: #2f8a4c;
  --ui-rvc-diff-del-fg: #c4472e;
  --ui-rvc-tok-kw: color(display-p3 0.843 0.298 0.507);
  --ui-rvc-tok-str: color(display-p3 0.38 0.647 0.378);
  --ui-rvc-tok-type: color(display-p3 0.247 0.556 0.969);
  --ui-rvc-tok-fn: color(display-p3 0.587 0.29 0.667);
  --ui-rvc-ring-soft: rgba(47, 107, 255, 0.12);
  --ui-rvc-hover: rgba(0, 0, 0, 0.03);
  --ui-rvc-chip: #f3f3f3;
  --ui-rvc-wash: #f7f7f7;
  --ui-rvc-accent: #2f6bff;
  --ui-rvc-new: rgba(47, 107, 255, 0.09);
  --ui-rvc-primary: #171717;
  --ui-rvc-primary-fg: #ffffff;
  /* Bars: a tint, its edge and the mark on it – progress blue, confidence by level */
  --ui-rvc-bar-bg: #e9efff;
  --ui-rvc-bar-edge: #bccdfb;
  --ui-rvc-bar-mark: #5b86f5;
  --ui-rvc-track: #f1f1f1;
  /* Risk and state */
  --ui-rvc-high-bg: #fde8e5;
  --ui-rvc-high-edge: #f1a397;
  --ui-rvc-high-fg: #c2331f;
  --ui-rvc-mid-bg: #fff3e0;
  --ui-rvc-mid-edge: #f3c98d;
  --ui-rvc-mid-fg: #b85c00;
  --ui-rvc-low-bg: #e6f6ec;
  --ui-rvc-low-edge: #a9dcbc;
  --ui-rvc-low-fg: #1a7f45;
  /* Flagged spans: the agent isn't sure */
  --ui-rvc-flag-bg: #fff2d4;
  --ui-rvc-flag-edge: #f0b44c;
  --ui-rvc-flag-hot: #ffe2a6;
  --ui-rvc-flag-ink: #6e4300;
  --ui-rvc-ins-bg: #dcf5e5;
  --ui-rvc-ins-ink: #11673a;
  --ui-rvc-add-bg: #effaf3;
  --ui-rvc-del-bg: #fdf0ee;
  --ui-rvc-ring: rgba(23, 23, 23, 0.22);
  --ui-rvc-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-rvc-raised: 0 0 0 1px #e8e8e8, 0 1px 3px rgba(0, 0, 0, 0.07);
  --ui-rvc-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-rvc-height: 560px;
  --ui-rvc-queue: 300px;
  --ui-rvc-row: 60px;
  --ui-rvc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-rvc-ease-in: cubic-bezier(0.55, 0, 0.75, 0.3);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-rvc-tray);
  outline: none;
  container: ui-rvc / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-rvc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-rvc *, .ui-rvc *::before, .ui-rvc *::after { box-sizing: border-box; }
:where(.ui-rvc) :is(button, input, textarea) { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; -webkit-tap-highlight-color: transparent; }
:where(.ui-rvc) button { cursor: pointer; }
:where(.ui-rvc) button:disabled { cursor: default; }
.ui-rvc :is(button, a, mark, input, textarea):focus-visible { outline: 2px solid var(--ui-rvc-ring); outline-offset: 1px; }
:where(.ui-rvc) :is(p, dl, dd, h3, ul, ol) { margin: 0; padding: 0; }
.ui-rvc svg { display: block; flex: none; }
.ui-rvc__kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px; background: var(--ui-rvc-chip); font-size: 10.5px; font-weight: 500; line-height: 1; color: var(--ui-rvc-muted); letter-spacing: 0; }
.ui-rvc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- On the tray: how far you are, how long the oldest waits, the filter ----- */
.ui-rvc__head { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; min-width: 0; min-height: 44px; padding: 4px 6px 8px 12px; }
.ui-rvc__mark { display: grid; flex: none; place-items: center; width: 16px; margin-right: -4px; color: var(--ui-rvc-accent); }
.ui-rvc__heading { flex: none; font-weight: 600; color: var(--ui-rvc-strong); }
.ui-rvc__progress { display: flex; flex: none; align-items: center; gap: 8px; font-size: 13px; color: var(--ui-rvc-muted); white-space: nowrap; }
.ui-rvc__count { font-variant-numeric: tabular-nums; }
.ui-rvc__count b { display: inline-block; font-weight: 500; color: var(--ui-rvc-ink); animation: ui-rvc-tick 420ms var(--ui-rvc-ease) both; }
/* The progress bar: a light tint with a hairline edge, a sheen sweeping while items wait */
.ui-rvc__track { position: relative; width: 84px; height: 8px; overflow: hidden; border-radius: 4px; background: var(--ui-rvc-card); box-shadow: inset 0 0 0 1px var(--ui-rvc-line); }
.ui-rvc__fill { position: absolute; inset: 0 auto 0 0; overflow: hidden; border-radius: 4px; background: var(--ui-rvc-bar-bg); box-shadow: inset 0 0 0 1px var(--ui-rvc-bar-edge); transition: width 700ms var(--ui-rvc-ease); }
.ui-rvc__track[data-live] .ui-rvc__fill::before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--ui-rvc-card), transparent) -40px 0 / 40px 100% no-repeat; opacity: 0.7; animation: ui-rvc-sweep 1800ms linear infinite; }
.ui-rvc__fill::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: min(18px, 100%); background: linear-gradient(90deg, transparent, var(--ui-rvc-bar-mark)); opacity: 0.55; animation: ui-rvc-glow 1100ms ease-in-out infinite alternate; }
.ui-rvc__oldest { flex: none; margin-left: -4px; font-size: 13px; color: var(--ui-rvc-muted); white-space: nowrap; }
.ui-rvc__oldest::before { content: "·"; margin-right: 8px; color: var(--ui-rvc-faint); }
.ui-rvc__oldest b { font-weight: 500; color: var(--ui-rvc-text); font-variant-numeric: tabular-nums; }
.ui-rvc__oldest b[data-sla="near"] { color: var(--ui-rvc-mid-fg); }
.ui-rvc__oldest b[data-sla="over"] { color: var(--ui-rvc-high-fg); }
/* The filter: a small segmented control on top of the queue */
/* The filter: on white – the picked tab a white pill with a soft shadow, the others just quieter text */
.ui-rvc__filters { display: flex; flex: 1; gap: 4px; min-width: 0; }
.ui-rvc__filter { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; font-size: 12.5px; font-weight: 500; line-height: 18px; color: var(--ui-rvc-muted); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }
.ui-rvc__filter:hover { color: var(--ui-rvc-ink); }
.ui-rvc__filter[aria-pressed="true"] { background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-raised); color: var(--ui-rvc-ink); }
.ui-rvc__filter-count { font-size: 11.5px; color: var(--ui-rvc-faint); font-variant-numeric: tabular-nums; }
.ui-rvc__filter[aria-pressed="true"] .ui-rvc__filter-count { color: var(--ui-rvc-muted); }

/* ----- The white card: the queue on the left, the item on the right ----- */
.ui-rvc__card { position: relative; display: grid; grid-template-columns: var(--ui-rvc-queue) minmax(0, 1fr); height: var(--ui-rvc-height); overflow: hidden; border-radius: 16px; background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-shadow); }

/* ----- The queue ----- */
.ui-rvc__queue { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--ui-rvc-line); background: var(--ui-rvc-queue-bg); }
.ui-rvc__queue-head { display: flex; flex: none; align-items: center; padding: 8px; background: var(--ui-rvc-card); border-bottom: 1px solid var(--ui-rvc-line); }
.ui-rvc__list { position: relative; flex: 1; min-height: 0; padding: 8px; overflow: hidden auto; overscroll-behavior: contain; list-style: none; scrollbar-width: thin; }
.ui-rvc__item { height: calc(var(--ui-rvc-row) + 4px); padding: 2px 0; overflow: hidden; }
.ui-rvc__item[data-enter="first"] { animation: ui-rvc-row-in 460ms var(--ui-rvc-ease) var(--d) backwards; }
.ui-rvc__item:is([data-enter="new"], [data-enter="in"]) { animation: ui-rvc-open 520ms var(--ui-rvc-ease) var(--d) backwards; }
.ui-rvc__item[data-enter="new"] .ui-rvc__row { animation: ui-rvc-arrive 2200ms ease-out backwards; }
.ui-rvc__item[data-leaving] { pointer-events: none; animation: ui-rvc-close ${EXIT}ms var(--ui-rvc-ease) var(--d) forwards; }
.ui-rvc__item[data-leaving][data-decision] { animation-delay: calc(var(--d) + ${STAMP}ms); }
.ui-rvc__row { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; column-gap: 10px; width: 100%; height: var(--ui-rvc-row); padding: 0 10px; border-radius: 10px; transition: background-color 160ms ease, box-shadow 200ms ease; }
.ui-rvc__row:hover { background: var(--ui-rvc-hover); }
.ui-rvc__row[aria-current] { background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-raised); }
.ui-rvc__row:focus-visible { outline-offset: -2px; }
.ui-rvc__avatar { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--ui-rvc-card); box-shadow: 0 0 0 1px var(--ui-rvc-line), 0 1px 2px rgba(0, 0, 0, 0.06); font-size: 12px; font-weight: 600; color: var(--ui-rvc-text); }
.ui-rvc__avatar > svg { width: 15px; height: 15px; }
.ui-rvc__row-main { display: grid; gap: 3px; min-width: 0; transition: opacity 200ms ease; }
.ui-rvc__row-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-rvc__row-title { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-rvc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvc__wait { flex: none; font-size: 11.5px; line-height: 16px; color: var(--ui-rvc-muted); font-variant-numeric: tabular-nums; }
.ui-rvc__wait[data-sla="near"] { color: var(--ui-rvc-mid-fg); }
.ui-rvc__wait[data-sla="over"] { color: var(--ui-rvc-high-fg); }
.ui-rvc__row-meta { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 11.5px; line-height: 16px; color: var(--ui-rvc-muted); white-space: nowrap; }
.ui-rvc__tag { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-rvc [data-risk="high"] { --k-bg: var(--ui-rvc-high-bg); --k-edge: var(--ui-rvc-high-edge); --k-fg: var(--ui-rvc-high-fg); }
.ui-rvc [data-risk="medium"] { --k-bg: var(--ui-rvc-mid-bg); --k-edge: var(--ui-rvc-mid-edge); --k-fg: var(--ui-rvc-mid-fg); }
.ui-rvc [data-risk="low"] { --k-bg: var(--ui-rvc-low-bg); --k-edge: var(--ui-rvc-low-edge); --k-fg: var(--ui-rvc-low-fg); }
.ui-rvc__skipped { flex: none; color: var(--ui-rvc-faint); }
/* A decided row: a small check or cross where the time was, then it fades and closes up */
.ui-rvc__item[data-decision] .ui-rvc__row-main { opacity: 0.5; transition-delay: var(--d); }
.ui-rvc__row-done { display: grid; flex: none; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--k-bg); color: var(--k-fg); animation: ui-rvc-fade 160ms ease var(--d) backwards; }
.ui-rvc__row-done > svg { width: 12px; height: 12px; }
:is(.ui-rvc__row-done, .ui-rvc__undo, .ui-rvc__btn)[data-decision="approved"], .ui-rvc__btn[data-tone="approved"] { --k-bg: var(--ui-rvc-low-bg); --k-edge: var(--ui-rvc-low-edge); --k-fg: var(--ui-rvc-low-fg); }
:is(.ui-rvc__row-done, .ui-rvc__undo, .ui-rvc__btn)[data-decision="rejected"], .ui-rvc__btn[data-tone="rejected"] { --k-bg: var(--ui-rvc-high-bg); --k-edge: var(--ui-rvc-high-edge); --k-fg: var(--ui-rvc-high-fg); }
.ui-rvc__none { display: grid; place-items: center; height: 120px; font-size: 12.5px; color: var(--ui-rvc-faint); list-style: none; animation: ui-rvc-fade 300ms ease 300ms backwards; }


/* ----- The item ----- */
.ui-rvc__main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ui-rvc__stage { position: relative; flex: 1; min-height: 0; overflow: hidden auto; overscroll-behavior: contain; scrollbar-width: thin; transition: height 420ms var(--ui-rvc-ease); }
.ui-rvc__detail { position: relative; display: grid; gap: 16px; padding: 22px 26px 24px; background: var(--ui-rvc-card); }
.ui-rvc__detail[data-enter="first"] > * { animation: ui-rvc-in 420ms var(--ui-rvc-ease) calc(120ms + var(--i, 0) * 40ms) backwards; }
/* After a decision: the old item fades up and away, the next one follows a beat later from just below */
.ui-rvc__detail[data-enter="decide"] { animation: ui-rvc-in 320ms var(--ui-rvc-ease) calc(var(--d) + 90ms) backwards; }
.ui-rvc__detail[data-enter="down"] { animation: ui-rvc-in 280ms var(--ui-rvc-ease) backwards; }
.ui-rvc__detail[data-enter="up"] { animation: ui-rvc-in-up 280ms var(--ui-rvc-ease) backwards; }
.ui-rvc__detail[data-enter="fade"] { animation: ui-rvc-fade 240ms ease backwards; }
.ui-rvc__detail[data-ghost] { position: absolute; inset: 0 0 auto; z-index: 2; min-height: 100%; pointer-events: none; animation: ui-rvc-away 240ms var(--ui-rvc-ease) var(--d) forwards; }

.ui-rvc__who { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ui-rvc__who .ui-rvc__avatar { width: 34px; height: 34px; border-radius: 9px; }
.ui-rvc__who .ui-rvc__avatar > svg { width: 17px; height: 17px; }
.ui-rvc__meta { display: grid; flex: 1; gap: 1px; min-width: 0; }
.ui-rvc__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-rvc__agent { min-width: 0; overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 18px; color: var(--ui-rvc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvc__model { overflow: hidden; font-size: 12.5px; line-height: 16px; color: var(--ui-rvc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* The risk tag: a tint with its color, like the Live tag in Trace Waterfall – low risk needs none */
.ui-rvc__risk { display: inline-flex; flex: none; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--k-bg); font-size: 11.5px; font-weight: 500; line-height: 16px; color: var(--k-fg); white-space: nowrap; }
.ui-rvc__ask { display: grid; gap: 4px; }
.ui-rvc__title { font-size: 18px; font-weight: 600; line-height: 24px; letter-spacing: -0.012em; color: var(--ui-rvc-strong); text-wrap: balance; }
.ui-rvc__why { margin-top: -6px; font-size: 13px; line-height: 20px; color: var(--ui-rvc-muted); text-wrap: pretty; }
.ui-rvc__why b { font-weight: 500; color: var(--ui-rvc-text); }

/* The proposal: no box around it – the content is the focus */
.ui-rvc__proposal { display: grid; gap: 16px; min-width: 0; padding-top: 2px; }
/* Facts in a light row: a small label over each value, no lines between them */
.ui-rvc__fields { display: flex; flex-wrap: wrap; gap: 12px 36px; }
.ui-rvc__fields > div { display: grid; gap: 1px; min-width: 0; max-width: 100%; }
.ui-rvc__fields dt { font-size: 12px; line-height: 16px; color: var(--ui-rvc-muted); }
.ui-rvc__fields dd { min-width: 0; overflow: hidden; font-size: 13.5px; font-weight: 500; line-height: 22px; color: var(--ui-rvc-ink); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-rvc__body { display: grid; gap: 6px; min-width: 0; }
.ui-rvc__body-label { font-size: 12px; line-height: 16px; color: var(--ui-rvc-muted); }
/* Prose sits on a thin line at its left, like a quote of what goes out */
.ui-rvc__text { padding-left: 14px; box-shadow: inset 1px 0 0 var(--ui-rvc-line-strong); font-size: 13.5px; line-height: 22px; color: var(--ui-rvc-ink); white-space: pre-wrap; overflow-wrap: anywhere; text-wrap: pretty; }

/* Code: a white block on the card's shadow – a row per file, the diff under a hairline. Numbers soft, no gutter, few colors */
.ui-rvc__code { overflow: hidden; border-radius: 12px; background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-shadow); }
.ui-rvc__file + .ui-rvc__file { border-top: 1px solid var(--ui-rvc-line); }
.ui-rvc__file-head { display: flex; align-items: center; gap: 8px; min-width: 0; height: 36px; padding: 0 12px 0 15.6px; font-size: 13px; line-height: 20px; }
.ui-rvc__path { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-rvc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvc__dir { color: var(--ui-rvc-muted); }
:is(.ui-rvc__count-add, .ui-rvc__count-del) { flex: none; font-size: 12px; font-variant-numeric: tabular-nums; }
.ui-rvc__count-add { color: var(--ui-rvc-diff-add-fg); }
.ui-rvc__count-del { color: var(--ui-rvc-diff-del-fg); }
.ui-rvc__diff { padding: 8px 0 2px; overflow-x: auto; border-top: 1px solid var(--ui-rvc-line); font-family: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 400; line-height: 20px; letter-spacing: normal; white-space: pre; scrollbar-width: thin; }
.ui-rvc__line { display: flex; min-width: max-content; color: var(--ui-rvc-code-ink); }
.ui-rvc__line[data-diff="add"] { background: var(--ui-rvc-diff-add); }
.ui-rvc__line[data-diff="del"] { background: var(--ui-rvc-diff-del); }
.ui-rvc__ln { position: relative; flex: none; min-width: calc(2ch + 23.4px); padding: 0 7.8px 0 15.6px; color: var(--ui-rvc-code-num); text-align: right; font-variant-numeric: tabular-nums; user-select: none; }
.ui-rvc__sign { position: absolute; left: 4px; font-size: 11px; }
.ui-rvc__line[data-diff="add"] .ui-rvc__sign { color: var(--ui-rvc-diff-add-fg); }
.ui-rvc__line[data-diff="del"] .ui-rvc__sign { color: var(--ui-rvc-diff-del-fg); }
.ui-rvc__src { padding: 0 7.8px; }
.ui-rvc__hunk { display: block; padding: 0 7.8px 0 calc(2ch + 31.2px); color: var(--ui-rvc-code-num); }
.ui-rvc [data-tok="kw"] { color: var(--ui-rvc-tok-kw); }
.ui-rvc [data-tok="str"] { color: var(--ui-rvc-tok-str); }
.ui-rvc [data-tok="fn"] { color: var(--ui-rvc-tok-fn); }
.ui-rvc [data-tok="type"] { color: var(--ui-rvc-tok-type); }
.ui-rvc [data-tok="com"] { color: var(--ui-rvc-code-num); }
.ui-rvc__line .ui-rvc__flag { padding: 1px 1px; margin: 0; }
.ui-rvc__line .ui-rvc__flag [data-tok] { color: inherit; }

/* A plan: numbered steps with the tool each one calls; a flagged step's number turns amber */
.ui-rvc__steps { display: grid; gap: 12px; list-style: none; }
.ui-rvc__step { display: grid; grid-template-columns: 22px minmax(0, 1fr); column-gap: 12px; }
.ui-rvc__step-n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--ui-rvc-line-strong); font-size: 11.5px; font-weight: 500; color: var(--ui-rvc-muted); font-variant-numeric: tabular-nums; }
.ui-rvc__step[data-flagged] .ui-rvc__step-n { background: var(--ui-rvc-flag-bg); box-shadow: inset 0 0 0 1px var(--ui-rvc-flag-edge); color: var(--ui-rvc-flag-ink); }
.ui-rvc__step-main { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; min-width: 0; padding-top: 1px; }
.ui-rvc__step-title { font-size: 13.5px; line-height: 20px; color: var(--ui-rvc-ink); }
.ui-rvc__step-tool { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; line-height: 20px; color: var(--ui-rvc-muted); white-space: nowrap; }
.ui-rvc__step-detail { width: 100%; font-size: 12.5px; line-height: 19px; color: var(--ui-rvc-muted); }

/* A span the agent isn't sure about: a warm tint with a hairline underline – brighter while its note shows */
.ui-rvc__flag { padding: 1px 2px; margin: 0 -1px; border-radius: 4px; background: var(--ui-rvc-flag-bg); box-shadow: inset 0 -1.5px 0 var(--ui-rvc-flag-edge); color: var(--ui-rvc-flag-ink); cursor: help; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 160ms ease, box-shadow 160ms ease; }
.ui-rvc__flag:is(:hover, [data-on]) { background: var(--ui-rvc-flag-hot); box-shadow: inset 0 0 0 1px var(--ui-rvc-flag-edge); }
.ui-rvc__ins { padding: 1px 2px; margin: 0 -1px; border-radius: 4px; background: var(--ui-rvc-ins-bg); color: var(--ui-rvc-ins-ink); text-decoration: none; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
/* Editing: the text field sits on a mirror that marks what changed; the ring is the only frame */
.ui-rvc__editor { display: grid; margin: -6px -8px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--ui-rvc-accent), 0 0 0 3px var(--ui-rvc-ring-soft); }
.ui-rvc__editor > * { grid-area: 1 / 1; padding: 6px 8px; font-size: 13.5px; line-height: 22px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-rvc__body[data-format="code"] .ui-rvc__editor > * { font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace; font-size: 12px; line-height: 20px; letter-spacing: 0; }
.ui-rvc__mirror { color: transparent; }
/* No padding here – the mirror has to wrap exactly like the field; the tint reaches out with a shadow */
.ui-rvc__mirror .ui-rvc__ins { padding: 0; margin: 0; color: transparent; box-shadow: 0 0 0 2px var(--ui-rvc-ins-bg); }
.ui-rvc__editor textarea { width: 100%; height: 100%; overflow: hidden; resize: none; color: var(--ui-rvc-ink); caret-color: var(--ui-rvc-accent); outline: none; }
.ui-rvc__editor textarea:focus-visible { outline: none; }
.ui-rvc__input { width: 100%; min-width: 120px; height: 24px; margin: 0 -6px; padding: 0 6px; border-radius: 6px; background: var(--ui-rvc-wash); box-shadow: inset 0 0 0 1px var(--ui-rvc-line); font-weight: 500; color: var(--ui-rvc-ink); outline: none; }
.ui-rvc__input:focus { box-shadow: inset 0 0 0 1px var(--ui-rvc-accent); }

.ui-rvc__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
/* Sources: plain words with their marks – no chips */
.ui-rvc__sources { display: flex; flex-wrap: wrap; gap: 4px 14px; min-width: 0; list-style: none; }
.ui-rvc__source { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; line-height: 20px; color: var(--ui-rvc-muted); white-space: nowrap; text-decoration: none; transition: color 160ms ease; }
a.ui-rvc__source:hover { color: var(--ui-rvc-ink); }
.ui-rvc__source-icon { display: grid; place-items: center; width: 14px; height: 14px; color: var(--ui-rvc-muted); }
.ui-rvc__source-icon > svg { width: 13px; height: 13px; }

.ui-rvc__empty { display: grid; place-content: center; justify-items: center; gap: 4px; min-height: 100%; padding: 48px 24px; text-align: center; animation: ui-rvc-in 360ms var(--ui-rvc-ease) 120ms backwards; }
.ui-rvc__empty[data-after] { animation-delay: calc(var(--d) + 120ms); }
.ui-rvc__empty-mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; border-radius: 14px; background: var(--ui-rvc-low-bg); color: var(--ui-rvc-low-fg); box-shadow: inset 0 0 0 1px var(--ui-rvc-low-edge); }
.ui-rvc__empty b { font-size: 15px; font-weight: 600; line-height: 22px; color: var(--ui-rvc-strong); }
.ui-rvc__empty > span:last-child { max-width: 280px; font-size: 13px; line-height: 19px; color: var(--ui-rvc-muted); text-wrap: balance; }

/* The agent's note on a flagged span */
.ui-rvc__tip { position: absolute; top: 0; left: 0; z-index: 6; display: grid; gap: 4px; width: min(300px, calc(100% - 20px)); padding: 10px 12px 11px; border-radius: 12px; background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-pop); pointer-events: none; transform-origin: var(--x, 50%) bottom; animation: ui-rvc-tip 200ms var(--ui-rvc-ease) both; }
.ui-rvc__tip[data-side="below"] { transform-origin: var(--x, 50%) top; }
.ui-rvc__tip-head { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; line-height: 16px; color: var(--ui-rvc-mid-fg); }
.ui-rvc__tip p { font-size: 12.5px; line-height: 18px; color: var(--ui-rvc-ink); text-wrap: pretty; }
.ui-rvc__tip-source { justify-self: start; margin-top: 2px; padding: 1px 7px; border-radius: 6px; background: var(--ui-rvc-chip); font-size: 11.5px; line-height: 16px; color: var(--ui-rvc-text); }

/* ----- The actions ----- */
.ui-rvc__actions { position: relative; display: flex; flex: none; align-items: center; gap: 12px; min-height: 60px; padding: 12px 16px; border-top: 1px solid var(--ui-rvc-line); background: var(--ui-rvc-card); }
.ui-rvc__btns { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; animation: ui-rvc-swap 220ms var(--ui-rvc-ease) both; }
.ui-rvc__btn { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 7px 0 10px; border-radius: 10px; background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-shadow); font-size: 13px; font-weight: 500; color: var(--ui-rvc-ink); white-space: nowrap; transition: transform 140ms ease, box-shadow 200ms ease, background-color 200ms ease, color 200ms ease, opacity 200ms ease; }
.ui-rvc__btn > svg { color: var(--ui-rvc-muted); }
.ui-rvc__btn:hover:not(:disabled) { box-shadow: var(--ui-rvc-raised); }
.ui-rvc__btn[data-primary] { padding-left: 11px; background: var(--ui-rvc-primary); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.08); color: var(--ui-rvc-primary-fg); }
.ui-rvc__btn[data-primary] > svg { color: inherit; }
.ui-rvc__btn[data-primary] .ui-rvc__kbd { background: rgba(255, 255, 255, 0.14); color: rgba(255, 255, 255, 0.75); }
.ui-rvc__btn[data-primary]:hover:not(:disabled) { background: #2a2a2a; }
.ui-rvc__btn:disabled { opacity: 0.45; }
:is(.ui-rvc__btn, .ui-rvc__reason, .ui-rvc__undo-btn)[data-pressed] { transform: scale(0.97); }
/* The pressed button flashes its decision's tint for a moment – the only color a decision adds */
.ui-rvc__btn[data-pressed] { background: var(--k-bg, var(--ui-rvc-wash)); box-shadow: inset 0 0 0 1px var(--k-edge, var(--ui-rvc-line)); color: var(--k-fg, var(--ui-rvc-ink)); }
.ui-rvc__btn[data-pressed] > svg { color: inherit; }
.ui-rvc__why-label { margin-right: 2px; font-size: 13px; font-weight: 500; color: var(--ui-rvc-ink); }
.ui-rvc__reason { display: inline-flex; align-items: center; gap: 7px; height: 34px; padding: 0 11px 0 7px; border-radius: 10px; background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-shadow); font-size: 13px; font-weight: 500; color: var(--ui-rvc-ink); white-space: nowrap; transition: transform 140ms ease, box-shadow 160ms ease, background-color 160ms ease, color 160ms ease; }
.ui-rvc__reason:hover { box-shadow: inset 0 0 0 1px var(--ui-rvc-high-edge); }
.ui-rvc__reason[data-pressed] { background: var(--ui-rvc-high-bg); box-shadow: inset 0 0 0 1px var(--ui-rvc-high-edge); color: var(--ui-rvc-high-fg); }
.ui-rvc__cancel { height: 34px; padding: 0 8px; border-radius: 8px; font-size: 12px; color: var(--ui-rvc-muted); }
.ui-rvc__cancel:hover { color: var(--ui-rvc-ink); }
/* Undo: a small chip on the tray for a few seconds, right of how far you are */
.ui-rvc__undo { display: flex; flex: 0 1 auto; align-items: center; gap: 2px; min-width: 0; height: 30px; margin-left: auto; padding: 0 2px 0 4px; border-radius: 999px; background: var(--ui-rvc-tray); animation: ui-rvc-chip-in 360ms var(--ui-rvc-ease) both, ui-rvc-chip-out 300ms ease ${UNDO_FOR - 300}ms forwards; }
.ui-rvc__undo-text { display: inline-flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-rvc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-rvc__undo-text > svg { width: 14px; height: 14px; color: var(--k-fg); }
.ui-rvc__undo-btn { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 26px; margin-left: 6px; padding: 0 4px 0 8px; border-radius: 999px; font-size: 12.5px; font-weight: 500; color: var(--ui-rvc-ink); transition: background-color 140ms ease, transform 140ms ease; }
.ui-rvc__undo-btn:hover { background: var(--ui-rvc-card); box-shadow: var(--ui-rvc-shadow); }
.ui-rvc__undo-btn > svg { color: var(--ui-rvc-muted); }
.ui-rvc__undo-btn .ui-rvc__kbd { min-width: 18px; border-radius: 999px; }

/* Worst-case data: the item never grows wider than its pane, long words wrap, one-liners shorten */
.ui-rvc__detail { grid-template-columns: minmax(0, 1fr); }
.ui-rvc__heading { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-rvc__title, .ui-rvc__why, .ui-rvc__row-title { text-align: start; }
.ui-rvc__title, .ui-rvc__why, .ui-rvc__step-title, .ui-rvc__tip p, .ui-rvc__tip-source { overflow-wrap: anywhere; }
.ui-rvc__step-detail { overflow-wrap: anywhere; white-space: pre-line; }
.ui-rvc__sources > li { min-width: 0; max-width: 100%; }
.ui-rvc__source { max-width: 100%; }
.ui-rvc__source-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-rvc__source-icon { flex: none; }
.ui-rvc__step-tool { min-width: 0; max-width: 100%; }
/* ----- Medium: a slimmer queue ----- */
@container ui-rvc (max-width: 820px) {
  .ui-rvc__card { --ui-rvc-queue: 272px; }
  .ui-rvc__detail { padding: 18px 20px 20px; }
}
@container ui-rvc (max-width: 740px) {
  .ui-rvc__btn .ui-rvc__kbd { display: none; }
  .ui-rvc__btn { padding-right: 11px; }
  .ui-rvc__filter-count { font-size: 11.5px; color: var(--ui-rvc-faint); font-variant-numeric: tabular-nums; }
}
/* ----- Narrow: the queue on top, three rows high, the item under it ----- */
@container ui-rvc (max-width: 639px) {
  .ui-rvc__head { padding: 4px 4px 8px 10px; }
  .ui-rvc__oldest { margin-left: auto; padding-right: 6px; }
  .ui-rvc__oldest::before { content: none; }
  .ui-rvc__progress { order: 5; width: 100%; padding-right: 8px; }
  .ui-rvc__progress .ui-rvc__track { flex: 1; }
  .ui-rvc__filter-count { font-size: 11.5px; color: var(--ui-rvc-faint); font-variant-numeric: tabular-nums; }
  /* Undo sits over the right end of the bar, in front of "Oldest" */
  .ui-rvc__undo { position: absolute; top: auto; right: 4px; bottom: 6px; z-index: 2; max-width: calc(100% - 8px); }
  .ui-rvc__card { display: flex; flex-direction: column; height: auto; }
  .ui-rvc__queue { border-right: 0; border-bottom: 1px solid var(--ui-rvc-line); }
  .ui-rvc__list { flex: none; height: calc(3 * (var(--ui-rvc-row) + 4px) + 16px); }
  .ui-rvc__stage { flex: none; overflow: hidden; }
  .ui-rvc__detail { gap: 14px; padding: 16px 16px 18px; }
  .ui-rvc__title { font-size: 16px; line-height: 22px; }
  .ui-rvc__actions { flex-wrap: wrap; padding: 10px 12px 12px; }
  .ui-rvc__btns { flex: 1; flex-wrap: nowrap; }
  .ui-rvc__btns > .ui-rvc__btn { flex: 1; justify-content: center; padding: 0 8px; }
  .ui-rvc__btns[role="group"] { flex-wrap: wrap; }
  .ui-rvc__reason { flex: 1 1 40%; justify-content: center; }
  .ui-rvc__why-label { width: 100%; }
  .ui-rvc__empty { min-height: 220px; padding: 36px 20px; }
}
/* Phones: the type tag steps aside in the item, the button labels get the room */
@container ui-rvc (max-width: 420px) {
  .ui-rvc__btn > svg { display: none; }
  .ui-rvc__filter { gap: 4px; font-size: 12px; }
  .ui-rvc__undo-btn .ui-rvc__kbd { display: none; }
  .ui-rvc__sources { width: 100%; }
}
@container ui-rvc (max-width: 360px) {
  .ui-rvc__filter-count { font-size: 11.5px; color: var(--ui-rvc-faint); font-variant-numeric: tabular-nums; }
}

@keyframes ui-rvc-row-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-rvc-open { from { height: 0; padding: 0; opacity: 0; } }
@keyframes ui-rvc-close { from { height: calc(var(--ui-rvc-row) + 4px); } to { height: 0; padding: 0; opacity: 0; } }
@keyframes ui-rvc-arrive { 0%, 40% { background: var(--ui-rvc-new); } }
@keyframes ui-rvc-fade { from { opacity: 0; } }
@keyframes ui-rvc-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes ui-rvc-in-up { from { opacity: 0; transform: translateY(-8px); } }
@keyframes ui-rvc-away { to { opacity: 0; transform: translateY(-6px); } }
@keyframes ui-rvc-tip { from { opacity: 0; transform: translateY(4px) scale(0.96); } }
@keyframes ui-rvc-swap { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-rvc-chip-in { from { opacity: 0; transform: translateX(8px); } }
@keyframes ui-rvc-chip-out { to { opacity: 0; transform: translateX(6px); } }
@keyframes ui-rvc-tick { from { opacity: 0; transform: translateY(-6px); } }
@keyframes ui-rvc-sweep { to { background-position: calc(100% + 40px) 0; } }
@keyframes ui-rvc-glow { from { opacity: 0.25; } to { opacity: 0.7; } }

@media (pointer: coarse) {
  .ui-rvc .ui-rvc__kbd { display: none; }
  .ui-rvc__btn { padding-right: 11px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-rvc *, .ui-rvc *::before, .ui-rvc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-rvc {
  --ui-rvc-tray: #19191c;
  --ui-rvc-card: #232326;
  --ui-rvc-strong: #ededed;
  --ui-rvc-ink: #ededed;
  --ui-rvc-text: #a8a8ad;
  --ui-rvc-muted: #7c7c82;
  --ui-rvc-faint: #55555b;
  --ui-rvc-line: #2e2e33;
  --ui-rvc-queue-bg: #1f1f22;
  --ui-rvc-line-strong: #3a3a40;
  --ui-rvc-code-ink: rgba(255, 255, 255, 0.88);
  --ui-rvc-code-num: rgba(255, 255, 255, 0.42);
  --ui-rvc-diff-add: rgba(60, 220, 130, 0.07);
  --ui-rvc-diff-del: rgba(255, 90, 70, 0.07);
  --ui-rvc-diff-add-fg: #5fd38d;
  --ui-rvc-diff-del-fg: #ff8a73;
  --ui-rvc-tok-kw: color(display-p3 0.98 0.52 0.68);
  --ui-rvc-tok-str: color(display-p3 0.56 0.82 0.54);
  --ui-rvc-tok-type: color(display-p3 0.48 0.7 1);
  --ui-rvc-tok-fn: color(display-p3 0.78 0.56 0.88);
  --ui-rvc-ring-soft: rgba(91, 154, 255, 0.16);
  --ui-rvc-hover: rgba(255, 255, 255, 0.03);
  --ui-rvc-chip: #2e2e32;
  --ui-rvc-wash: #29292d;
  --ui-rvc-accent: #5b9aff;
  --ui-rvc-new: rgba(91, 154, 255, 0.12);
  --ui-rvc-primary: #ededed;
  --ui-rvc-primary-fg: #171717;
  --ui-rvc-bar-bg: #1d2a4a;
  --ui-rvc-bar-edge: #34508f;
  --ui-rvc-bar-mark: #5b9aff;
  --ui-rvc-track: #2c2c30;
  --ui-rvc-high-bg: #3b1714;
  --ui-rvc-high-edge: #74302a;
  --ui-rvc-high-fg: #ff977d;
  --ui-rvc-mid-bg: #3a2610;
  --ui-rvc-mid-edge: #74491c;
  --ui-rvc-mid-fg: #ffb068;
  --ui-rvc-low-bg: #12301f;
  --ui-rvc-low-edge: #23593a;
  --ui-rvc-low-fg: #4fd890;
  --ui-rvc-flag-bg: #3d2b0c;
  --ui-rvc-flag-edge: #a8741f;
  --ui-rvc-flag-hot: #54390c;
  --ui-rvc-flag-ink: #ffd28a;
  --ui-rvc-ins-bg: #173d27;
  --ui-rvc-ins-ink: #7deaa9;
  --ui-rvc-add-bg: #15291e;
  --ui-rvc-del-bg: #2e1916;
  --ui-rvc-ring: rgba(237, 237, 237, 0.3);
  --ui-rvc-shadow: 0 0 0 1px #2e2e33, 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-rvc-raised: 0 0 0 1px #38383e, 0 1px 3px rgba(0, 0, 0, 0.4);
  --ui-rvc-pop: 0 0 0 1px #34343a, 0 16px 36px -12px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-rvc__btn[data-primary] .ui-rvc__kbd { background: rgba(0, 0, 0, 0.1); color: rgba(0, 0, 0, 0.55); }
:where(.dark, [data-theme="dark"]) .ui-rvc__btn[data-primary]:hover:not(:disabled) { background: #ffffff; }
:where(.dark, [data-theme="dark"]) .ui-rvc__row[aria-current] { background: #2a2a2e; }
`;
