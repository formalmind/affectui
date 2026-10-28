"use client";

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * AI Answer – an assistant's answer with its sources, in a single self-contained file.
 * The sources pop in first, then the answer streams in word by word with citation chips.
 * Hovering a chip previews its source and lights up the matching card above (and the other way round).
 * When it's done: copy, regenerate, thumbs up / down with a reason, and follow-up questions.
 * The answer is plain text: blank lines make paragraphs, "- " makes a list, **bold**, [1] or [1,3] cite sources.
 * The styles are injected below, so no extra files are needed.
 */

export type AnswerSource = {
  /** Headline of the page, message or document */
  title: string;
  /** Short name shown on the citation chip, e.g. "Notion" */
  name: string;
  /** Opens in a new tab */
  href?: string;
  /** A favicon or logo, ideally square */
  icon?: ReactNode;
  /** The passage the answer relies on – shown in the preview */
  snippet?: string;
};

export type AIAnswerProps = {
  /** The question above the answer */
  question?: string;
  sources: AnswerSource[];
  /** The answer text – may grow while `streaming` is true */
  answer: string;
  /** More text is still coming from your model, keep the cursor going */
  streaming?: boolean;
  /** Stream the text in; false shows it at once */
  animate?: boolean;
  /** Words per second while streaming in */
  speed?: number;
  followUps?: string[];
  onFollowUp?: (question: string) => void;
  onRegenerate?: () => void;
  onStop?: () => void;
  onFeedback?: (value: "up" | "down", reason?: string) => void;
  /** Reasons offered after a thumbs down */
  feedbackReasons?: string[];
  onCopy?: (text: string) => void;
  className?: string;
};

type Token = { i: number; kind: "word"; text: string; bold?: boolean } | { i: number; kind: "cite"; ids: number[] };
type Block = { kind: "p"; tokens: Token[] } | { kind: "ul"; items: Token[][] };
type Phase = "reading" | "writing" | "done" | "stopped";

/* ---------- Parsing: paragraphs, lists, **bold** and [1] citations ---------- */

function parse(text: string, sourceCount: number) {
  let i = 0;
  const line = (s: string) => {
    const tokens: Token[] = [];
    for (const part of s.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/)) {
      if (!part) continue;
      const cite = part.match(/^\[([\d,\s]+)\]$/);
      if (cite) {
        const ids = cite[1]
          .split(",")
          .map((n) => Number(n) - 1)
          .filter((n) => n >= 0 && n < sourceCount);
        if (!ids.length) continue;
        const last = tokens[tokens.length - 1];
        // [1][3] right after each other become one chip
        if (last?.kind === "cite") last.ids = [...new Set([...last.ids, ...ids])];
        else tokens.push({ i: i++, kind: "cite", ids });
        continue;
      }
      const bold = part.startsWith("**");
      for (const word of (bold ? part.slice(2, -2) : part).match(/\S+\s*|\s+/g) ?? []) {
        // Spaces before a word stick to the word in front, so only words count as steps
        const last = tokens[tokens.length - 1];
        if (!word.trim()) {
          if (last?.kind === "word") last.text += word;
          continue;
        }
        tokens.push({ i: i++, kind: "word", text: word, bold });
      }
    }
    return tokens;
  };
  const blocks: Block[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    if (lines.every((l) => /^\s*[-*]\s/.test(l))) {
      blocks.push({ kind: "ul", items: lines.map((l) => line(l.replace(/^\s*[-*]\s/, ""))) });
    } else {
      blocks.push({ kind: "p", tokens: line(lines.join(" ")) });
    }
  }
  return { blocks, total: i };
}

/** The answer as plain text with a numbered source list, for the clipboard */
function plain(text: string, sources: AnswerSource[]) {
  const body = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, (_, ids: string) => ` [${ids.replace(/\s/g, "")}]`)
    .trim();
  if (!sources.length) return body;
  return `${body}\n\nSources:\n${sources.map((s, i) => `[${i + 1}] ${s.title}${s.href ? ` – ${s.href}` : ""}`).join("\n")}`;
}

/* ---------- Icons ---------- */

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={["ui-ans__glyph", className].filter(Boolean).join(" ")} aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  copy: "M9 9.5A1.5 1.5 0 0 1 10.5 8h8A1.5 1.5 0 0 1 20 9.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 9 18.5zM15 8V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H9",
  check: "M5 12.5l4.5 4.5L19 7.5",
  redo: "M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 4v4.5h-4.5",
  thumb: "M7 10v10M7 10l3.6-6.3a1.9 1.9 0 0 1 3.5 1.3L13.3 9H18a2 2 0 0 1 2 2.4l-1.4 7A2 2 0 0 1 16.6 20H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

/** The cloud of the Frost Cloud illustration: puffs that melt into one shape through a soft "goo" filter */
const PUFFS = [
  { cx: 115, cy: 93, r: 43 },
  { cx: 163, cy: 111, r: 39 },
  { cx: 156, cy: 155, r: 31 },
  { cx: 107, cy: 155, r: 35 },
  { cx: 72, cy: 126, r: 34 },
];
const CORE = { x: 80, y: 100, width: 80, height: 65 };

/**
 * The assistant: a small blue cloud with a soft white glow along the inside of its edge, a thin light blue outline and two white eyes.
 * The eyes scan the sources while reading, follow the text while writing, and look around, blink and wink once done.
 */
function AssistantMark() {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `ans${id}-${name}`;
  const shape = (
    <>
      {PUFFS.map((p, i) => (
        <circle key={i} {...p} />
      ))}
      <rect {...CORE} />
    </>
  );
  const eye = (x: number, right?: boolean) => (
    <g className={right ? "ui-ans__eye ui-ans__eye-r" : "ui-ans__eye"}>
      <rect x={x} y="106" width="18" height="31" rx="9" fill={`url(#${ref("eye")})`} />
      <rect x={x} y="108.5" width="18" height="31" rx="9" fill="none" className="ui-ans__mark-eye-shade" strokeWidth="5" filter={`url(#${ref("blur-s")})`} clipPath={`url(#${ref(right ? "clip-r" : "clip-l")})`} />
    </g>
  );
  return (
    <svg viewBox="30 40 180 160" className="ui-ans__mark" aria-hidden="true">
      <defs>
        <filter id={ref("goo")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="3.5" />
          <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 28 -12" />
        </filter>
        {/* Inner glow: white where the shape is close to its edge, fading towards the middle */}
        <filter id={ref("inner")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
          <feGaussianBlur in="SourceAlpha" stdDeviation="15" result="soft" />
          <feComposite in="SourceAlpha" in2="soft" operator="out" result="rim" />
          <feFlood style={{ floodColor: "var(--ui-ans-mark-glow)" }} />
          <feComposite in2="rim" operator="in" />
        </filter>
        <filter id={ref("blur-s")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation="2" />
        </filter>
        {/* Grows the shape by about a pixel: a thin outline, so the cloud doesn't melt into a white card */}
        <filter id={ref("outline")} x="0" y="0" width="240" height="240" filterUnits="userSpaceOnUse">
          <feMorphology operator="dilate" radius="6" />
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <g id={ref("shape")} filter={`url(#${ref("goo")})`}>
          {shape}
        </g>
        <mask id={ref("mask")} maskUnits="userSpaceOnUse" x="0" y="0" width="240" height="240">
          <use href={`#${ref("shape")}`} fill="#fff" />
        </mask>
        <linearGradient id={ref("body")} x1="0" y1="50" x2="0" y2="192" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: "var(--ui-ans-mark-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--ui-ans-mark-bottom)" }} />
        </linearGradient>
        <linearGradient id={ref("eye")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--ui-ans-mark-eye-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--ui-ans-mark-eye-bottom)" }} />
        </linearGradient>
        <clipPath id={ref("clip-l")}>
          <rect x="96.5" y="106" width="18" height="31" rx="9" />
        </clipPath>
        <clipPath id={ref("clip-r")}>
          <rect x="127.5" y="106" width="18" height="31" rx="9" />
        </clipPath>
      </defs>
      <use href={`#${ref("shape")}`} className="ui-ans__mark-edge" filter={`url(#${ref("outline")})`} />
      <g mask={`url(#${ref("mask")})`}>
        {/* Light blue at the top, deeper blue at the bottom, a white glow just inside the edge */}
        <rect x="0" y="0" width="240" height="240" fill={`url(#${ref("body")})`} />
        <use href={`#${ref("shape")}`} filter={`url(#${ref("inner")})`} />
      </g>
      <g className="ui-ans__eyes">
        {eye(96.5)}
        {eye(127.5, true)}
      </g>
    </svg>
  );
}

const READ_MS = 700;
const CARD_MS = 90;
/** Long source lists stop staggering after this many cards – the rest arrive together */
const STAGGER = 12;
const count = new Intl.NumberFormat("en");
/** "4.2s", then "5m 12s", then "1h 04m" */
const took = (s: number) => {
  if (s < 60) return `${s}s`;
  const t = Math.round(s);
  if (t < 3600) return `${Math.floor(t / 60)}m ${String(t % 60).padStart(2, "0")}s`;
  return `${Math.floor(t / 3600)}h ${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}m`;
};

export function AIAnswer({
  question,
  sources,
  answer,
  streaming = false,
  animate = true,
  speed = 38,
  followUps = [],
  onFollowUp,
  onRegenerate,
  onStop,
  onFeedback,
  feedbackReasons = ["Not accurate", "Wrong source", "Too long", "Out of date"],
  onCopy,
  className,
}: AIAnswerProps) {
  const { blocks, total } = useMemo(() => parse(answer, sources.length), [answer, sources.length]);
  const [run, setRun] = useState(0);
  const [phase, setPhase] = useState<Phase>("reading");
  const [shown, setShown] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pop, setPop] = useState<{ ids: number[]; left: number; top: number; width: number } | null>(null);
  const [hoverSource, setHoverSource] = useState<number | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const started = useRef(0);
  const prevAnswer = useRef(answer);
  const closeTimer = useRef(0);
  const popId = useId();

  const finished = phase === "done" || phase === "stopped";
  const instant = !animate || reducedMotion();
  // A broken speed (NaN, 0, negative) would never finish – fall back to the default
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 38;

  // A new answer (not just more of the same one) starts over
  useEffect(() => {
    if (!answer.startsWith(prevAnswer.current)) setRun((r) => r + 1);
    prevAnswer.current = answer;
  }, [answer]);

  // Each run: read the sources, then write
  useEffect(() => {
    started.current = performance.now();
    progress.current = 0;
    setShown(0);
    setVote(null);
    setReason(null);
    setCopied(false);
    setPop(null);
    if (instant) {
      progress.current = Infinity;
      setPhase("writing");
      return;
    }
    setPhase("reading");
    const t = window.setTimeout(() => setPhase("writing"), sources.length ? READ_MS + Math.min(sources.length, STAGGER) * CARD_MS : 0);
    return () => clearTimeout(t);
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  // Writing: words appear at `speed`; waits for more text while `streaming`
  useEffect(() => {
    if (phase !== "writing") return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      progress.current = Math.min(total, progress.current + ((now - last) / 1000) * rate);
      last = now;
      setShown(Math.floor(progress.current));
      if (progress.current >= total && !streaming) {
        setSeconds(Math.max(0.1, Math.round((performance.now() - started.current) / 100) / 10));
        setPhase("done");
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, total, streaming, rate]);

  // The card glides to its new height instead of jumping
  useLayoutEffect(() => {
    const card = cardRef.current;
    const inner = innerRef.current;
    if (!card || !inner) return;
    const set = () => (card.style.height = `${inner.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const openPop = (ids: number[], el: HTMLElement) => {
    clearTimeout(closeTimer.current);
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const width = Math.min(300, box.width - 16);
    const left = Math.max(8, Math.min(box.width - width - 8, r.left - box.left + r.width / 2 - width / 2));
    setPop({ ids, left, top: r.bottom - box.top + 6, width });
  };
  const closePop = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPop(null), 140);
  };

  const lit = new Set(pop ? pop.ids : hoverSource !== null ? [hoverSource] : []);

  const copy = () => {
    const text = plain(answer, sources);
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    onCopy?.(text);
  };
  const stop = () => {
    setSeconds(Math.max(0.1, Math.round((performance.now() - started.current) / 100) / 10));
    setPhase("stopped");
    onStop?.();
  };
  const regenerate = () => {
    setRun((r) => r + 1);
    onRegenerate?.();
  };
  const voteFor = (value: "up" | "down") => {
    const next = vote === value ? null : value;
    setVote(next);
    setReason(null);
    if (next === "up") onFeedback?.("up");
  };

  const status = copied
    ? "Copied"
    : vote === "up" || reason
      ? "Thanks for the feedback"
      : vote === "down"
        ? "What went wrong?"
        : phase === "stopped"
          ? "Stopped"
          : `Answered in ${took(seconds)}`;

  const label =
    phase === "reading" ? `Reading ${count.format(sources.length)} ${sources.length === 1 ? "source" : "sources"}` : phase === "writing" ? "Writing" : "Answer";

  // Handlers for the chips stay the same object across renders, so finished paragraphs don't render again on every word
  const latest = useRef({ openPop, closePop, setPop, pop });
  latest.current = { openPop, closePop, setPop, pop };
  const chip = useMemo<ChipHandlers>(
    () => ({
      open: (ids, el) => latest.current.openPop(ids, el),
      close: () => latest.current.closePop(),
      toggle: (ids, el) => (latest.current.pop?.ids === ids ? latest.current.setPop(null) : latest.current.openPop(ids, el)),
      dismiss: () => latest.current.setPop(null),
    }),
    [],
  );
  const litKey = [...lit].sort((a, b) => a - b).join(",");


  return (
    <div
      ref={rootRef}
      className={["ui-ans", className].filter(Boolean).join(" ")}
      data-phase={phase}
      onMouseLeave={() => setHoverSource(null)}
    >
      {/* React 19 hoists this into <head> once, no matter how many answers render */}
      <style href="ui-ai-answer" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-ans__card">
        <div ref={innerRef} className="ui-ans__inner">
          {question && <h3 className="ui-ans__question" dir="auto">
              {question}
            </h3>}

          {sources.length > 0 && (
            <div className="ui-ans__sources" key={`s${run}`} aria-label="Sources" role="list">
              {sources.map((s, i) => {
                const inner = (
                  <>
                    <span className="ui-ans__site">
                      {s.icon && <span className="ui-ans__favicon" onErrorCapture={hideBroken}>
                    {s.icon}
                  </span>}
                      <span className="ui-ans__site-name" title={s.name}>
                        {s.name}
                      </span>
                      <span className="ui-ans__num">{i + 1}</span>
                    </span>
                    <span className="ui-ans__title" dir="auto" title={s.title}>
                        {s.title}
                      </span>
                  </>
                );
                const props = {
                  className: "ui-ans__source",
                  "data-lit": lit.has(i) || undefined,
                  style: { animationDelay: instant ? "0ms" : `${120 + Math.min(i, STAGGER) * CARD_MS}ms` },
                  onMouseEnter: () => setHoverSource(i),
                  onMouseLeave: () => setHoverSource(null),
                };
                return (
                  <div key={i} role="listitem" className="ui-ans__source-wrap">
                    {s.href ? (
                      <a {...props} href={s.href} target="_blank" rel="noreferrer">
                        {inner}
                      </a>
                    ) : (
                      <div {...props}>{inner}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="ui-ans__label">
            <AssistantMark />
            <span key={label} className={finished ? "ui-ans__label-text" : "ui-ans__label-text ui-ans__shimmer"} data-text={label}>
              {label}
            </span>
          </div>

          <div className="ui-ans__answer" aria-busy={!finished}>
            {phase === "writing" && shown === 0 && (
              <p>
                <span className="ui-ans__caret" aria-hidden="true" />
              </p>
            )}
            {phase === "stopped" && shown === 0 && <p className="ui-ans__empty">Stopped before answering.</p>}
            {blocks.map((b, bi) => {
              const [first, end] = span(b);
              if (first >= shown) return null;
              return (
                <AnswerBlock
                  key={`${run}-${bi}`}
                  block={b}
                  shown={Math.min(shown, end)}
                  caret={phase === "writing" && shown <= end}
                  lit={litKey}
                  popIds={pop?.ids ?? null}
                  popId={popId}
                  sources={sources}
                  chip={chip}
                />
              );
            })}
          </div>

          {phase === "done" && followUps.length > 0 && (
            <div className="ui-ans__follow">
              <span className="ui-ans__follow-label">Related</span>
              {followUps.map((q, i) => (
                <button
                  key={i}
                  type="button"
                  className="ui-ans__follow-item"
                  style={{ animationDelay: `${instant ? 0 : 80 + i * 60}ms` }}
                  onClick={() => onFollowUp?.(q)}
                >
                  <span dir="auto">{q}</span>
                  <Glyph d={icons.arrow} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The tray below the card: stop while writing, actions once done */}
      <div className="ui-ans__foot">
        {finished ? (
          <div className="ui-ans__actions" key="actions">
            <button type="button" className="ui-ans__action" aria-label={copied ? "Copied" : "Copy answer"} onClick={copy}>
              <Glyph d={copied ? icons.check : icons.copy} className={copied ? "ui-ans__ok" : undefined} />
            </button>
            <button type="button" className="ui-ans__action ui-ans__redo" aria-label="Regenerate" onClick={regenerate}>
              <Glyph d={icons.redo} />
            </button>
            <button type="button" className="ui-ans__action" aria-label="Good answer" aria-pressed={vote === "up"} onClick={() => voteFor("up")}>
              <Glyph d={icons.thumb} />
            </button>
            <button
              type="button"
              className="ui-ans__action ui-ans__down"
              aria-label="Bad answer"
              aria-pressed={vote === "down"}
              onClick={() => voteFor("down")}
            >
              <Glyph d={icons.thumb} />
            </button>
          </div>
        ) : (
          <button type="button" className="ui-ans__stop" key="stop" onClick={stop}>
            <span className="ui-ans__stop-icon" aria-hidden="true" />
            Stop
          </button>
        )}
        {finished && (
          <span className="ui-ans__status" key={status} aria-live="polite" title={status}>
            {status.startsWith("Answered in ") ? (
              <>
                {/* Very narrow screens show just the time */}
                <span className="ui-ans__status-lead">Answered in </span>
                {status.slice("Answered in ".length)}
              </>
            ) : (
              status
            )}
          </span>
        )}
      </div>

      <div className="ui-ans__reasons" data-open={vote === "down" && !reason}>
        <div>
          {feedbackReasons.map((r, i) => (
            <button
              key={i}
                dir="auto"
              type="button"
              tabIndex={vote === "down" && !reason ? 0 : -1}
              onClick={() => {
                setReason(r);
                onFeedback?.("down", r);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* One preview for whichever chip is hovered or focused */}
      {pop && (
        <div
          id={popId}
          role="tooltip"
          className="ui-ans__pop"
          style={{ left: pop.left, top: pop.top, width: pop.width }}
          onMouseEnter={() => clearTimeout(closeTimer.current)}
          onMouseLeave={closePop}
        >
          {pop.ids.map((id) => {
            const s = sources[id];
            return (
              <a key={id} className="ui-ans__pop-item" href={s.href} target="_blank" rel="noreferrer" tabIndex={-1}>
                <span className="ui-ans__site">
                  {s.icon && <span className="ui-ans__favicon" onErrorCapture={hideBroken}>
                    {s.icon}
                  </span>}
                  <span className="ui-ans__site-name">{s.href ? s.href.replace(/^https?:\/\/(www\.)?/, "").split("/")[0] : s.name}</span>
                  <span className="ui-ans__num">{id + 1}</span>
                </span>
                <span className="ui-ans__pop-title" dir="auto">
                  {s.title}
                </span>
                {s.snippet && pop.ids.length === 1 && <span className="ui-ans__snippet" dir="auto">
                    {s.snippet}
                  </span>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- One paragraph or list of the answer – renders again only when its own words change ---------- */

type ChipHandlers = {
  open: (ids: number[], el: HTMLElement) => void;
  close: () => void;
  toggle: (ids: number[], el: HTMLElement) => void;
  dismiss: () => void;
};

/** The first token of a block and the one after its last */
const span = (b: Block): [number, number] => {
  const tokens = b.kind === "p" ? b.tokens : b.items.flat();
  return tokens.length ? [tokens[0].i, tokens[tokens.length - 1].i + 1] : [Infinity, Infinity];
};

const AnswerBlock = memo(function AnswerBlock({
  block,
  shown,
  caret,
  lit,
  popIds,
  popId,
  sources,
  chip,
}: {
  block: Block;
  shown: number;
  caret: boolean;
  lit: string;
  popIds: number[] | null;
  popId: string;
  sources: AnswerSource[];
  chip: ChipHandlers;
}) {
  const litSet = new Set(lit ? lit.split(",").map(Number) : []);
  const tokens = (list: Token[]) =>
    list.map((t) => {
      if (t.i >= shown) return null;
      const mark = caret && t.i === shown - 1 ? <span className="ui-ans__caret" aria-hidden="true" /> : null;
      if (t.kind === "word") {
        return (
          <span key={t.i} className="ui-ans__w" data-bold={t.bold || undefined}>
            {t.text}
            {mark}
          </span>
        );
      }
      const first = sources[t.ids[0]];
      const names = t.ids.map((id) => sources[id].title).join(", ");
      return (
        <span key={t.i} className="ui-ans__w">
          <button
            type="button"
            className="ui-ans__cite"
            title={names}
            data-lit={t.ids.some((id) => litSet.has(id)) || undefined}
            aria-label={`Source: ${names}`}
            aria-describedby={popIds === t.ids ? popId : undefined}
            onMouseEnter={(e) => chip.open(t.ids, e.currentTarget)}
            onMouseLeave={chip.close}
            onFocus={(e) => chip.open(t.ids, e.currentTarget)}
            onBlur={chip.close}
            onClick={(e) => chip.toggle(t.ids, e.currentTarget)}
            onKeyDown={(e) => e.key === "Escape" && chip.dismiss()}
          >
            <span className="ui-ans__cite-name">{first.name}</span>
            {t.ids.length > 1 && <span className="ui-ans__more">+{t.ids.length - 1}</span>}
          </button>
          {mark}
        </span>
      );
    });
  return block.kind === "p" ? (
    <p dir="auto">{tokens(block.tokens)}</p>
  ) : (
    <ul>
      {block.items.map((item, ii) =>
        item[0] && item[0].i < shown ? (
          <li key={ii} dir="auto">
            {tokens(item)}
          </li>
        ) : null,
      )}
    </ul>
  );
});

/** A favicon that fails to load leaves its tile – the name stays */
const hideBroken = (e: { currentTarget: HTMLElement }) => (e.currentTarget.hidden = true);

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-ans */
.ui-ans {
  --ui-ans-tray: #f0f0f0;
  --ui-ans-card: #ffffff;
  --ui-ans-line: #ececec;
  --ui-ans-ink: #171717;
  --ui-ans-text: #404040;
  --ui-ans-muted: #8f8f8f;
  --ui-ans-faint: #b5b5b5;
  --ui-ans-chip: #f4f4f5;
  --ui-ans-chip-hover: #ebebec;
  --ui-ans-hover: #e4e4e5;
  --ui-ans-lit: #171717;
  --ui-ans-lit-text: #ffffff;
  --ui-ans-lit-ring: #cfcfd3;
  --ui-ans-shine: rgba(255, 255, 255, 0.82);
  --ui-ans-ok: #1f8a4c;
  --ui-ans-focus: rgba(23, 23, 23, 0.22);
  --ui-ans-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 640px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-ans-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ui-ans-text);
  -webkit-font-smoothing: antialiased;
}
.ui-ans *, .ui-ans *::before, .ui-ans *::after { box-sizing: border-box; }
:where(.ui-ans) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-ans) svg { display: block; flex: none; }
.ui-ans button:focus-visible, .ui-ans a:focus-visible { outline: 2px solid var(--ui-ans-focus); outline-offset: 2px; }

/* The white card */
.ui-ans__card {
  overflow: hidden;
  border-radius: 16px;
  background: var(--ui-ans-card);
  box-shadow: 0 0 0 1px var(--ui-ans-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  transition: height 360ms var(--ui-ans-ease);
}
.ui-ans__inner { display: flow-root; padding: 22px 24px 20px; }
.ui-ans__question { margin: 0 0 16px; font-size: 18px; font-weight: 600; line-height: 1.35; letter-spacing: -0.012em; color: var(--ui-ans-ink); overflow-wrap: anywhere; }

/* Sources: a row of small cards that scrolls sideways */
.ui-ans__sources {
  display: flex;
  gap: 8px;
  margin: 0 -24px;
  padding: 0 24px 2px;
  overflow-x: auto;
  scroll-padding: 0 24px;
  scrollbar-width: none;
  -webkit-mask: linear-gradient(90deg, transparent, #000 16px, #000 calc(100% - 24px), transparent);
  mask: linear-gradient(90deg, transparent, #000 16px, #000 calc(100% - 24px), transparent);
}
.ui-ans__sources::-webkit-scrollbar { display: none; }
.ui-ans__source-wrap { flex: none; display: flex; }
.ui-ans__source {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 172px;
  padding: 10px 12px 11px;
  border-radius: 12px;
  background: var(--ui-ans-chip);
  color: inherit;
  text-decoration: none;
  transition: background-color 160ms ease, box-shadow 200ms ease;
  animation: ui-ans-card 460ms var(--ui-ans-ease) both;
}
a.ui-ans__source:hover { background: var(--ui-ans-chip-hover); }
.ui-ans__source[data-lit] { box-shadow: inset 0 0 0 1.5px var(--ui-ans-lit-ring); }
.ui-ans__site { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px; color: var(--ui-ans-muted); }
.ui-ans__site-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-ans__num { flex: none; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--ui-ans-faint); }
.ui-ans__favicon {
  display: grid;
  flex: none;
  width: 16px;
  height: 16px;
  overflow: hidden;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06);
}
.ui-ans__favicon[hidden] { display: none; }
.ui-ans__favicon > * { width: 100%; height: 100%; object-fit: contain; }
.ui-ans__title {
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--ui-ans-ink);
}

/* "Reading 6 sources" → "Writing" → "Answer" */
.ui-ans__label { display: flex; align-items: center; gap: 8px; margin: 20px 0 10px; font-size: 13px; font-weight: 500; color: var(--ui-ans-ink); }
.ui-ans__mark { width: 27px; height: 24px; margin: -3px -1px -3px -2px; overflow: visible; }
.ui-ans__mark {
  --ui-ans-mark-top: #7ccbff;
  --ui-ans-mark-bottom: #2f8fea;
  --ui-ans-mark-glow: #ffffff;
  --ui-ans-mark-edge: #b3dcff;
  --ui-ans-mark-eye-top: #ffffff;
  --ui-ans-mark-eye-bottom: #d6f0ff;
  --ui-ans-mark-eye-shade: rgba(30, 140, 230, 0.3);
}
.ui-ans__mark-edge { fill: var(--ui-ans-mark-edge); }
.ui-ans__mark-eye-shade { stroke: var(--ui-ans-mark-eye-shade); }

/* The eyes: look around, blink and wink once done; scan while reading; follow the lines while writing */
.ui-ans__eyes { animation: ui-ans-look 7s ease-in-out infinite; }
.ui-ans__eye { transform-box: fill-box; transform-origin: center; animation: ui-ans-blink 7s ease-in-out infinite; }
.ui-ans__eye-r { animation-name: ui-ans-blink-r; }
.ui-ans[data-phase="reading"] .ui-ans__eyes { animation: ui-ans-scan 1.4s ease-in-out infinite; }
.ui-ans[data-phase="writing"] .ui-ans__eyes { animation: ui-ans-follow 1.9s cubic-bezier(0.45, 0, 0.55, 1) infinite; }
@keyframes ui-ans-look {
  0%, 26% { transform: none; }
  32%, 44% { transform: translate(-12px, 1px); }
  50%, 62% { transform: translate(12px, -2px); }
  68%, 100% { transform: none; }
}
@keyframes ui-ans-blink {
  0%, 16%, 21%, 100% { transform: none; }
  18.5% { transform: scaleY(0.1); }
}
@keyframes ui-ans-blink-r {
  0%, 16%, 21%, 84%, 93%, 100% { transform: none; }
  18.5% { transform: scaleY(0.1); }
  87%, 90% { transform: scaleY(0.1); }
}
@keyframes ui-ans-scan {
  0%, 100% { transform: translate(-11px, 1px); }
  50% { transform: translate(11px, 1px); }
}
@keyframes ui-ans-follow {
  0% { transform: translate(-10px, 5px); }
  82% { transform: translate(10px, 5px); }
  100% { transform: translate(-10px, 5px); }
}
.ui-ans__label-text { position: relative; animation: ui-ans-fade 320ms var(--ui-ans-ease) both; }
.ui-ans[data-phase="reading"] .ui-ans__label-text,
.ui-ans[data-phase="writing"] .ui-ans__label-text { color: var(--ui-ans-muted); }

/* The answer */
.ui-ans__answer { font-size: 15px; line-height: 1.65; color: var(--ui-ans-text); overflow-wrap: anywhere; }
.ui-ans__answer p { margin: 0 0 12px; }
.ui-ans__answer ul { margin: 0 0 12px; padding: 0 0 0 20px; }
.ui-ans__answer li { margin: 0 0 6px; padding-left: 2px; }
.ui-ans__answer li::marker { color: var(--ui-ans-faint); }
.ui-ans__answer > :last-child { margin-bottom: 0; }
.ui-ans__empty { color: var(--ui-ans-muted); }
.ui-ans__w { animation: ui-ans-word 420ms var(--ui-ans-ease) both; }
.ui-ans__w[data-bold] { font-weight: 600; color: var(--ui-ans-ink); }
.ui-ans__caret {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 4px;
  border-radius: 50%;
  background: var(--ui-ans-ink);
  vertical-align: 0.05em;
  animation: ui-ans-pulse 1s ease-in-out infinite;
}

/* Citation chips */
.ui-ans__cite {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 3px;
  height: 20px;
  margin: 0 1px 0 3px;
  padding: 0 7px;
  border-radius: 6px;
  background: var(--ui-ans-chip);
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-ans-muted);
  vertical-align: 0.12em;
  transition: background-color 160ms ease, color 160ms ease;
  animation: ui-ans-chip 380ms var(--ui-ans-ease) both;
}
.ui-ans__cite:hover { background: var(--ui-ans-chip-hover); color: var(--ui-ans-ink); }
.ui-ans__cite[data-lit] { background: var(--ui-ans-lit); color: var(--ui-ans-lit-text); }
.ui-ans__cite-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-ans__more { flex: none; opacity: 0.7; }

/* Preview of the cited source */
.ui-ans__pop {
  position: absolute;
  z-index: 5;
  display: grid;
  gap: 2px;
  padding: 6px;
  border-radius: 14px;
  background: var(--ui-ans-card);
  box-shadow: 0 0 0 1px var(--ui-ans-line), 0 12px 32px -10px rgba(0, 0, 0, 0.2), 0 2px 6px rgba(0, 0, 0, 0.04);
  animation: ui-ans-pop 200ms var(--ui-ans-ease) both;
}
.ui-ans__pop-item { display: grid; gap: 4px; padding: 8px 10px 10px; border-radius: 9px; color: inherit; text-decoration: none; transition: background-color 140ms ease; }
.ui-ans__pop-item[href]:hover { background: var(--ui-ans-chip); }
.ui-ans__pop-title { font-size: 13px; font-weight: 500; line-height: 1.4; color: var(--ui-ans-ink); overflow-wrap: anywhere; }
.ui-ans__snippet {
  overflow-wrap: anywhere;
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ui-ans-muted);
}

/* Follow-up questions */
.ui-ans__follow { display: grid; grid-template-columns: minmax(0, 1fr); margin-top: 20px; padding-top: 14px; border-top: 1px solid var(--ui-ans-line); }
.ui-ans__follow-label { padding-bottom: 4px; font-size: 12px; font-weight: 500; color: var(--ui-ans-faint); animation: ui-ans-fade 320ms var(--ui-ans-ease) both; }
.ui-ans__follow-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ui-ans-line);
  text-align: left;
  color: var(--ui-ans-ink);
  animation: ui-ans-fade 380ms var(--ui-ans-ease) both;
}
.ui-ans__follow-item:last-child { border-bottom: 0; padding-bottom: 0; }
.ui-ans__follow-item > span { min-width: 0; overflow-wrap: anywhere; }
.ui-ans__follow-item .ui-ans__glyph { color: var(--ui-ans-faint); transition: transform 220ms var(--ui-ans-ease), color 160ms ease; }
.ui-ans__follow-item:hover .ui-ans__glyph { color: var(--ui-ans-ink); transform: translateX(3px); }

/* The tray below the card */
.ui-ans__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 42px; padding: 0 8px 0 6px; }
.ui-ans__actions { display: flex; flex: none; gap: 2px; }
.ui-ans__action {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  color: var(--ui-ans-muted);
  transition: background-color 160ms ease, color 160ms ease;
  animation: ui-ans-fade 320ms var(--ui-ans-ease) both;
}
.ui-ans__action:nth-child(2) { animation-delay: 40ms; }
.ui-ans__action:nth-child(3) { animation-delay: 80ms; }
.ui-ans__action:nth-child(4) { animation-delay: 120ms; }
.ui-ans__action:hover { background: var(--ui-ans-hover); color: var(--ui-ans-ink); }
.ui-ans__action[aria-pressed="true"] { color: var(--ui-ans-ink); }
.ui-ans__action[aria-pressed="true"] .ui-ans__glyph { fill: currentColor; fill-opacity: 0.12; }
.ui-ans__glyph { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ui-ans__down .ui-ans__glyph { transform: scaleY(-1); }
.ui-ans__redo:active .ui-ans__glyph { transform: rotate(120deg); transition: transform 300ms var(--ui-ans-ease); }
.ui-ans__ok { stroke: var(--ui-ans-ok) !important; stroke-width: 2.2 !important; animation: ui-ans-chip 260ms var(--ui-ans-ease) both; }
.ui-ans__status { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: 12.5px; white-space: nowrap; color: var(--ui-ans-muted); animation: ui-ans-fade 260ms var(--ui-ans-ease) both; }
@container (max-width: 330px) {
  .ui-ans__status-lead { display: none; }
}
.ui-ans__stop {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 12px 0 10px;
  border-radius: 9px;
  font-size: 13px;
  color: var(--ui-ans-text);
  transition: background-color 160ms ease;
  animation: ui-ans-fade 260ms var(--ui-ans-ease) both;
}
.ui-ans__stop:hover { background: var(--ui-ans-hover); }
.ui-ans__stop-icon { width: 9px; height: 9px; border-radius: 2px; background: var(--ui-ans-ink); }

/* Reasons after a thumbs down fold out below */
.ui-ans__reasons { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 320ms var(--ui-ans-ease), opacity 200ms ease; }
.ui-ans__reasons[data-open="true"] { grid-template-rows: 1fr; opacity: 1; }
/* 4px of room above (taken back with the margin) so the outline and focus ring of the chips aren't cut off */
.ui-ans__reasons > div { display: flex; flex-wrap: wrap; gap: 6px; min-height: 0; overflow: hidden; margin-top: -4px; padding: 4px 6px 0; }
.ui-ans__reasons[data-open="true"] > div { padding-bottom: 8px; }
.ui-ans__reasons button {
  min-height: 30px;
  max-width: 100%;
  padding: 4px 11px;
  overflow-wrap: anywhere;
  text-align: start;
  border-radius: 9px;
  background: var(--ui-ans-card);
  box-shadow: 0 0 0 1px var(--ui-ans-line);
  font-size: 12.5px;
  color: var(--ui-ans-text);
  transition: color 140ms ease, box-shadow 140ms ease;
}
.ui-ans__reasons button:hover { color: var(--ui-ans-ink); box-shadow: 0 0 0 1px var(--ui-ans-faint); }

/* Shimmer over the working label */
.ui-ans__shimmer::after {
  content: attr(data-text);
  content: attr(data-text) / "";
  position: absolute;
  inset: 0;
  white-space: nowrap;
  color: transparent;
  background: linear-gradient(90deg, transparent 38%, var(--ui-ans-shine) 50%, transparent 62%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ui-ans-sweep 1.6s linear infinite;
  pointer-events: none;
}

@keyframes ui-ans-word { from { opacity: 0; filter: blur(3px); } to { opacity: 1; filter: none; } }
@keyframes ui-ans-card { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes ui-ans-chip { from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: none; } }
@keyframes ui-ans-fade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes ui-ans-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ui-ans-pulse { 50% { transform: scale(0.6); opacity: 0.45; } }
@keyframes ui-ans-sweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }

/* Narrow (phones) */
@container (max-width: 480px) {
  .ui-ans__inner { padding: 18px 18px 16px; }
  .ui-ans__sources { margin: 0 -18px; padding: 0 18px 2px; scroll-padding: 0 18px; }
  .ui-ans__question { font-size: 16.5px; }
  .ui-ans__source { width: 152px; }
  .ui-ans__answer { font-size: 14.5px; }
}
/* Touch screens: bigger tap targets – the citation chips keep their size but get a larger invisible hit area */
@media (hover: none) and (pointer: coarse) {
  .ui-ans__action { width: 40px; height: 40px; border-radius: 10px; }
  .ui-ans__foot { height: 48px; }
  .ui-ans__stop { height: 36px; }
  .ui-ans__reasons button { min-height: 36px; padding: 4px 13px; }
  .ui-ans__follow-item { min-height: 46px; }
  .ui-ans__cite { position: relative; }
  .ui-ans__cite::after { content: ""; position: absolute; inset: -10px -4px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-ans *, .ui-ans *::before, .ui-ans *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ans {
  --ui-ans-tray: #111113;
  --ui-ans-card: #19191b;
  --ui-ans-line: #2a2a2e;
  --ui-ans-ink: #ededed;
  --ui-ans-text: #c8c8cc;
  --ui-ans-muted: #8b8b92;
  --ui-ans-faint: #5c5c63;
  --ui-ans-chip: #232326;
  --ui-ans-chip-hover: #2b2b2f;
  --ui-ans-hover: #222225;
  --ui-ans-lit: #ededed;
  --ui-ans-lit-text: #19191b;
  --ui-ans-lit-ring: #4a4a50;
  --ui-ans-shine: rgba(255, 255, 255, 0.95);
  --ui-ans-ok: #3ec27a;
  --ui-ans-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-ans__mark {
  /* Reversed for dark mode: deep at the top, brighter at the bottom, a dark glow inside the edge and a dark outline; the eyes stay white */
  --ui-ans-mark-top: #1a4f9e;
  --ui-ans-mark-bottom: #3d9cf0;
  --ui-ans-mark-glow: #081a36;
  --ui-ans-mark-edge: #173866;
}
:where(.dark, [data-theme="dark"]) .ui-ans__favicon { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); }
`;
