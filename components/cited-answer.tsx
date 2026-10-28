"use client";

import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/*
 * Cited Answer – an AI answer whose sentences and sources are wired to each other, in one self-contained file.
 * The answer is a list of text segments (usually one sentence each) that name the sources they rely on. Small
 * numbered markers sit at the end of each cited sentence; the sources wait on the gray tray below as compact chips.
 *   · point at a marker: its source chip lights up and the sentence gets a soft highlight
 *   · point at a chip: every sentence that cites it lights up and the rest of the answer fades back
 *   · click a marker or chip: a preview unfolds in place – title, domain, date and the quoted passage with the
 *     words that back the answer marked – with Open source and Copy quote. Only one is open at a time
 *   · the line on the tray always says what you are pointing at
 * The styles are injected below, so no extra files are needed.
 */

export type CitedSegment = {
  /** A sentence or part of one. Spaces at the start or end are kept outside the highlight */
  text: string;
  /** Ids of the sources this text relies on – one marker each, in this order */
  cite?: string[];
  /** Starts a new paragraph */
  paragraph?: boolean;
};

export type CitedSource = {
  id: string;
  /** Headline of the page or document */
  title: string;
  url?: string;
  /** Short name on the chip, e.g. "Latency Notes" */
  site: string;
  /** Ready-to-show date, e.g. "Sep 12, 2026" */
  date?: string;
  /** The passage the answer relies on */
  quote?: string;
  /** Words or phrases of the quote to mark. Without it, words the quote shares with the citing sentences are marked */
  highlight?: string[];
  /** A favicon or logo, shown at 16px – a letter on a soft color when left out */
  icon?: ReactNode;
};

export type CitedAnswerProps = {
  segments: CitedSegment[];
  sources: CitedSource[];
  /** Pages the model read while searching – shown in the head next to the source count */
  pagesRead?: number;
  /** Id of the source whose preview is open at first */
  defaultOpen?: string;
  /** Called by Open source. With it the link doesn't navigate on its own – open the page yourself */
  onOpenSource?: (source: CitedSource) => void;
  /** Called when the open preview changes (null = closed) */
  onPreviewChange?: (id: string | null) => void;
  /** A button on the tray, e.g. { label: "Follow up", onClick } */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/* ---------- Helpers ---------- */

const TONES = ["blue", "violet", "green", "amber", "gray"] as const;
const tone = (name: string) =>
  TONES[[...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7) % TONES.length];
const domain = (url?: string) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
const fmt = new Intl.NumberFormat("en");
/** First whole letter or digit – never half an emoji */
const letter = (...names: string[]) => {
  for (const n of names) {
    const m = n.match(/[\p{L}\p{N}]/u);
    if (m) return m[0].toUpperCase();
  }
  return "";
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STOP = new Set([
  "about", "after", "again", "their", "there", "these", "those", "which", "while", "would", "could", "should",
  "every", "other", "being", "still", "where", "until", "since", "under", "first", "people", "thing", "things",
]);

/** The quote with the phrases (or, without them, the words shared with the answer) wrapped in <mark> */
function marked(quote: string, phrases: string[] | undefined, answer: string) {
  let pattern: RegExp | null = null;
  if (phrases?.length) {
    const list = phrases.filter((p) => p.trim()).map(escape);
    if (list.length) pattern = new RegExp(`(${list.join("|")})`, "gi");
  } else {
    const words = [
      ...new Set(
        (answer.toLowerCase().match(/[a-z0-9%]+/g) ?? []).filter(
          (w) => (w.length >= 5 || /\d/.test(w)) && !STOP.has(w),
        ),
      ),
    ];
    if (words.length) pattern = new RegExp(`\\b(${words.map(escape).join("|")})\\b`, "gi");
  }
  if (!pattern) return quote;
  return quote.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

/**
 * Text that changes without a jump: the old line stays for a moment and fades out underneath while the new one fades in.
 */
function Swap({ id, tone: t, children }: { id: string; tone?: string; children: ReactNode }) {
  type Line = { id: string; tone?: string; node: ReactNode };
  const last = useRef<Line>({ id, tone: t, node: children });
  const [shownId, setShownId] = useState(id);
  const [out, setOut] = useState<Line | null>(null);
  if (shownId !== id) {
    setShownId(id);
    setOut(last.current);
  }
  last.current = { id, tone: t, node: children };
  useEffect(() => {
    if (!out) return;
    const timer = window.setTimeout(() => setOut(null), 260);
    return () => window.clearTimeout(timer);
  }, [out]);
  return (
    <span className="ui-ca__swap">
      {out && (
        <span key={`out-${out.id}`} className="ui-ca__swap-item" data-out="" data-tone={out.tone} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span key={id} className="ui-ca__swap-item" data-tone={t}>
        {children}
      </span>
    </span>
  );
}

/* ---------- Icons ---------- */

const line = { stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const CloseIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="m2.5 2.5 5 5m0-5-5 5" {...line} />
  </svg>
);
const OutIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M4.5 3h4.5v4.5M8.8 3.2 3 9" {...line} />
  </svg>
);
const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <rect x="4.2" y="4.2" width="5.8" height="5.8" rx="1.4" {...line} />
    <path d="M7.8 2.6A1.2 1.2 0 0 0 6.6 2H3.2A1.2 1.2 0 0 0 2 3.2v3.4a1.2 1.2 0 0 0 .6 1" {...line} />
  </svg>
);
const DoneIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.6 6.3 2.2 2.2 4.6-5" {...line} strokeWidth={1.6} />
  </svg>
);
const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" {...line} />
  </svg>
);

function SourceGlyph({ source }: { source: CitedSource }) {
  // An icon that fails to load falls back to the letter
  const [failed, setFailed] = useState(false);
  return (
    <span className="ui-ca__glyph" data-tone={tone(source.site)} aria-hidden="true" onErrorCapture={() => setFailed(true)}>
      {source.icon && !failed ? source.icon : letter(source.site, source.title)}
    </span>
  );
}

type Mark = { id: string; n: number; label: string };
type SegmentApi = { setHot: (hot: Hot) => void; toggle: (id: string) => void };

/** One sentence with its markers – only re-renders when its own light, open marker or text changes */
const Segment = memo(function Segment({
  seg,
  index,
  marks,
  state,
  lit,
  openHere,
  previewId,
  api,
}: {
  seg: CitedSegment;
  index: number;
  marks: Mark[];
  state?: "hl" | "dim";
  lit?: string;
  openHere: string | null;
  previewId: string;
  api: { current: SegmentApi };
}) {
  const [, lead, body, trail] = seg.text.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? ["", "", seg.text, ""];
  // The last word travels with the first marker, so a marker never starts a line on its own – unless the word is
  // too long to keep on one line (a URL, a path), then only the marker is kept together
  const word = marks.length ? Math.max(0, body.search(/\S+$/)) : body.length;
  const cut = body.length - word > 24 ? body.length : word;
  const marker = (m: Mark) => (
    <button
      key={m.id}
      type="button"
      className="ui-ca__marker"
      data-source={m.id}
      data-lit={lit === m.id ? "" : undefined}
      aria-expanded={openHere === m.id}
      aria-controls={previewId}
      aria-label={`Source ${m.n}: ${m.label}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && api.current.setHot({ source: m.id, segment: index })}
      onPointerLeave={(e) => e.pointerType === "mouse" && api.current.setHot(null)}
      onFocus={() => api.current.setHot({ source: m.id, segment: index })}
      onBlur={() => api.current.setHot(null)}
      onClick={() => api.current.toggle(m.id)}
    >
      {fmt.format(m.n)}
    </button>
  );
  return (
    <span>
      {lead}
      <span className="ui-ca__seg" data-hl={state === "hl" ? "" : undefined} data-dim={state === "dim" ? "" : undefined}>
        {body.slice(0, cut)}
        <span className="ui-ca__keep">
          {body.slice(cut)}
          {marks.slice(0, 1).map(marker)}
        </span>
        {marks.slice(1).map(marker)}
      </span>
      {trail}
    </span>
  );
});

/** What the pointer (or focus) is on: one marker in one sentence, or a whole source */
type Hot = { source: string; segment?: number } | null;

export function CitedAnswer({
  segments,
  sources,
  pagesRead,
  defaultOpen,
  onOpenSource,
  onPreviewChange,
  action,
  className,
}: CitedAnswerProps) {
  const uid = useId();
  const [hot, setHot] = useState<Hot>(null);
  const [open, setOpen] = useState<string | null>(
    defaultOpen && sources.some((s) => s.id === defaultOpen) ? defaultOpen : null,
  );
  // While the preview folds away it keeps showing the last source
  const lastOpen = useRef<string | null>(open);
  if (open) lastOpen.current = open;
  const [copied, setCopied] = useState<{ id: number; source: string } | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);

  const at = useMemo(() => new Map(sources.map((s, i) => [s.id, i])), [sources]);
  const number = (id: string) => (at.get(id) ?? -1) + 1;
  const byId = (id: string | null | undefined) => (id != null && at.has(id) ? sources[at.get(id)!] : null);
  const known = (id: string) => at.has(id);
  // Each sentence's markers, worked out once per answer
  const marksOf = useMemo(
    () =>
      segments.map((seg) =>
        [...new Set(seg.cite ?? [])]
          .filter((id) => at.has(id))
          .map((id) => {
            const s = sources[at.get(id)!];
            return { id, n: at.get(id)! + 1, label: `${s.site} – ${s.title}` };
          }),
      ),
    [segments, sources, at],
  );

  // Group the segments into paragraphs, remembering each one's index
  const paragraphs: { seg: CitedSegment; index: number }[][] = [];
  segments.forEach((seg, index) => {
    if (seg.paragraph || paragraphs.length === 0) paragraphs.push([]);
    paragraphs[paragraphs.length - 1].push({ seg, index });
  });
  const sentences = segments.filter((s) => s.text.trim()).length;
  const cited = segments.filter((s) => s.text.trim() && s.cite?.some(known)).length;
  const citing = (id: string) => segments.filter((s) => s.cite?.includes(id));

  const toggle = (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    onPreviewChange?.(next);
  };
  const api = useRef<SegmentApi>({ setHot, toggle });
  api.current = { setHot, toggle };
  const close = () => {
    if (!open) return;
    const was = open;
    setOpen(null);
    onPreviewChange?.(null);
    chipsRef.current?.querySelector<HTMLElement>(`[data-source="${CSS.escape(was)}"]`)?.focus({ preventScroll: true });
  };

  const copyQuote = (s: CitedSource) => {
    const text = `“${s.quote ?? s.title}” – ${s.title}, ${s.site}${s.url ? ` (${s.url})` : ""}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied({ id: Date.now(), source: s.id });
  };
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      close();
    }
  };
  // Arrow keys walk along the chips
  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = sources.length - 1;
    const to =
      e.key === "ArrowRight" ? Math.min(last, i + 1)
      : e.key === "ArrowLeft" ? Math.max(0, i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null) return;
    e.preventDefault();
    chipsRef.current?.querySelectorAll<HTMLElement>(".ui-ca__chip")[to]?.focus();
  };

  /* ---------- Who lights up ---------- */

  const focusSource = hot?.source ?? null;
  const segState = (seg: CitedSegment, index: number): "hl" | "dim" | undefined => {
    if (hot) {
      if (hot.segment !== undefined) return hot.segment === index ? "hl" : undefined;
      return seg.cite?.includes(hot.source) ? "hl" : "dim";
    }
    if (open && seg.cite?.includes(open)) return "hl";
    return undefined;
  };

  /* ---------- What the tray says ---------- */

  const hotSource = byId(focusSource);
  const openSource = byId(open);
  let caption: ReactNode = (
    <>
      <b>{fmt.format(cited)}</b> of {fmt.format(sentences)} {sentences === 1 ? "sentence" : "sentences"} backed by a source
    </>
  );
  let captionKey = "rest";
  let captionTone: string | undefined;
  if (copied) {
    caption = "Quote copied";
    captionKey = `copied-${copied.id}`;
    captionTone = "ok";
  } else if (hotSource && hot?.segment !== undefined) {
    caption = (
      <>
        <b>{hotSource.site}</b> · {hotSource.title}
      </>
    );
    captionKey = `mark-${hot.segment}-${hotSource.id}`;
  } else if (hotSource) {
    const n = citing(hotSource.id).length;
    caption = n ? (
      <>
        <b>{hotSource.site}</b> · cited in {fmt.format(n)} {n === 1 ? "sentence" : "sentences"}
      </>
    ) : (
      <>
        <b>{hotSource.site}</b> · read, not cited
      </>
    );
    captionKey = `src-${hotSource.id}`;
  } else if (openSource) {
    caption = (
      <>
        Quote from <b>{openSource.site}</b>
      </>
    );
    captionKey = `open-${openSource.id}`;
  }

  const shown = byId(open ?? lastOpen.current);
  const previewId = `${uid}-preview`;
  const meta = [
    `${fmt.format(sources.length)} ${sources.length === 1 ? "source" : "sources"}`,
    Number.isFinite(pagesRead) ? `${fmt.format(pagesRead!)} ${pagesRead === 1 ? "page" : "pages"} read` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={["ui-ca", className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Answer with sources"
      data-hot={hot ? (hot.segment !== undefined ? "mark" : "source") : undefined}
      onKeyDown={onKeyDown}
    >
      <style href="ui-cited-answer" precedence="default">
        {css}
      </style>

      <div className="ui-ca__card">
        <div className="ui-ca__head">
          <span className="ui-ca__stack" aria-hidden="true">
            {sources.slice(0, 3).map((s) => (
              <SourceGlyph key={s.id} source={s} />
            ))}
          </span>
          <span className="ui-ca__meta">{meta}</span>
        </div>

        <div className="ui-ca__text" onPointerLeave={() => setHot(null)}>
          {paragraphs.map((para, p) => (
            <p key={p} className="ui-ca__p" dir="auto">
              {para.map(({ seg, index }) => {
                const marks = marksOf[index];
                const lit =
                  hot && (hot.segment === index || (hot.segment === undefined && marks.some((m) => m.id === hot.source)))
                    ? hot.source
                    : undefined;
                return (
                  <Segment
                    key={index}
                    seg={seg}
                    index={index}
                    marks={marks}
                    state={segState(seg, index)}
                    lit={lit}
                    openHere={open && marks.some((m) => m.id === open) ? open : null}
                    previewId={previewId}
                    api={api}
                  />
                );
              })}
            </p>
          ))}
        </div>

        {/* The preview unfolds below the answer; switching sources crossfades its content */}
        <div
          id={previewId}
          className="ui-ca__fold"
          data-open={open ? "" : undefined}
          inert={!open}
          role="region"
          aria-label={shown ? `Source ${number(shown.id)}: ${shown.site}` : "Source"}
        >
          <div className="ui-ca__clip">
            {shown && (
              <div className="ui-ca__preview" key={shown.id}>
                <div className="ui-ca__pv-head">
                  <SourceGlyph source={shown} />
                  <span className="ui-ca__pv-meta">
                    <span className="ui-ca__pv-domain" title={shown.url || shown.site}>
                      {domain(shown.url) || shown.site}
                    </span>
                    {shown.date && <span className="ui-ca__pv-date"> · {shown.date}</span>}
                  </span>
                  <span className="ui-ca__pv-num">{fmt.format(number(shown.id))}</span>
                  <button type="button" className="ui-ca__close" aria-label="Close source" onClick={close}>
                    <CloseIcon />
                  </button>
                </div>
                <div className="ui-ca__pv-title" dir="auto" title={shown.title}>
                  {shown.title}
                </div>
                {shown.quote && (
                  <blockquote className="ui-ca__quote" dir="auto">
                    {marked(
                      shown.quote,
                      shown.highlight,
                      citing(shown.id)
                        .map((s) => s.text)
                        .join(" "),
                    )}
                  </blockquote>
                )}
                <div className="ui-ca__pv-actions">
                  {shown.url ? (
                    <a
                      className="ui-ca__btn ui-ca__btn--main"
                      href={shown.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => {
                        if (!onOpenSource) return;
                        e.preventDefault();
                        onOpenSource(shown);
                      }}
                    >
                      Open source
                      <OutIcon />
                    </a>
                  ) : (
                    onOpenSource && (
                      <button type="button" className="ui-ca__btn ui-ca__btn--main" onClick={() => onOpenSource(shown)}>
                        Open source
                        <OutIcon />
                      </button>
                    )
                  )}
                  {shown.quote && (
                    <button
                      type="button"
                      className="ui-ca__btn"
                      data-done={copied?.source === shown.id ? "" : undefined}
                      aria-label="Copy quote"
                      onClick={() => copyQuote(shown)}
                    >
                      <span className="ui-ca__btn-icon" key={copied?.source === shown.id ? "done" : "idle"}>
                        {copied?.source === shown.id ? <DoneIcon /> : <CopyIcon />}
                      </span>
                      <span className="ui-ca__btn-text">{copied?.source === shown.id ? "Copied" : "Copy quote"}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The tray: the sources as chips, then a line that says what you are pointing at */}
      <div className="ui-ca__chips" ref={chipsRef} role="list" aria-label="Sources" onPointerLeave={() => setHot(null)}>
        {sources.map((s, i) => {
          const lit = focusSource === s.id;
          return (
            <span role="listitem" key={s.id} className="ui-ca__chip-item">
              <button
                type="button"
                className="ui-ca__chip"
                data-source={s.id}
                data-lit={lit ? "" : undefined}
                data-dim={focusSource && !lit ? "" : undefined}
                aria-expanded={open === s.id}
                aria-controls={previewId}
                aria-label={`Source ${i + 1}: ${s.site} – ${s.title}`}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHot({ source: s.id })}
                onFocus={() => setHot({ source: s.id })}
                onBlur={() => setHot(null)}
                onKeyDown={(e) => onChipKey(e, i)}
                onClick={() => toggle(s.id)}
              >
                <SourceGlyph source={s} />
                <span className="ui-ca__chip-name" dir="auto" title={s.site}>{s.site}</span>
                <span className="ui-ca__chip-num">{fmt.format(i + 1)}</span>
              </button>
            </span>
          );
        })}
      </div>

      <div className="ui-ca__foot">
        <span className="ui-ca__caption" aria-live="polite">
          <Swap id={captionKey} tone={captionTone}>
            {caption}
          </Swap>
        </span>
        {action && (
          <button type="button" className="ui-ca__action" title={action.label} onClick={action.onClick}>
            <span className="ui-ca__action-label">{action.label}</span>
            <ArrowIcon />
          </button>
        )}
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-ca {
  --ui-ca-tray: #f0f0f0;
  --ui-ca-card: #ffffff;
  --ui-ca-line: #ececec;
  --ui-ca-ink: #171717;
  --ui-ca-text: #404040;
  --ui-ca-muted: #8f8f8f;
  --ui-ca-faded: #b4b4b8;
  --ui-ca-well: #f4f4f5;
  --ui-ca-accent: #2f6bff;
  --ui-ca-hl: rgba(47, 107, 255, 0.1);
  --ui-ca-mark: rgba(47, 107, 255, 0.16);
  --ui-ca-ok: #18794e;
  --ui-ca-focus: rgba(23, 23, 23, 0.22);
  --ui-ca-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  max-width: 460px;
  min-width: 0;
  container-type: inline-size;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-ca-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-ca-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-ca *, .ui-ca *::before, .ui-ca *::after { box-sizing: border-box; }
:where(.ui-ca) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-ca :is(button, a):focus-visible { outline: 2px solid var(--ui-ca-focus); outline-offset: 2px; }
.ui-ca svg { display: block; flex: none; }
.ui-ca b { font-weight: 500; color: var(--ui-ca-ink); }

/* Letter glyphs on a soft tint – stand-ins for favicons */
.ui-ca [data-tone="blue"] { --ui-ca-g: #1f55d6; --ui-ca-g-bg: rgba(47, 107, 255, 0.12); }
.ui-ca [data-tone="violet"] { --ui-ca-g: #6941c6; --ui-ca-g-bg: rgba(124, 92, 255, 0.13); }
.ui-ca [data-tone="green"] { --ui-ca-g: #18794e; --ui-ca-g-bg: rgba(34, 160, 90, 0.13); }
.ui-ca [data-tone="amber"] { --ui-ca-g: #96590a; --ui-ca-g-bg: rgba(240, 160, 32, 0.18); }
.ui-ca [data-tone="gray"] { --ui-ca-g: #5f5f66; --ui-ca-g-bg: rgba(110, 110, 120, 0.12); }
.ui-ca__glyph { display: grid; flex: none; place-items: center; width: 16px; height: 16px; overflow: hidden; border-radius: 5px; background: var(--ui-ca-g-bg); font-size: 9.5px; font-weight: 600; line-height: 1; color: var(--ui-ca-g); }
.ui-ca__glyph > :is(img, svg) { width: 100%; height: 100%; object-fit: cover; }

.ui-ca__card { padding: 12px 16px 14px; border-radius: 16px; background: var(--ui-ca-card); box-shadow: 0 0 0 1px var(--ui-ca-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* ----- Head ----- */
.ui-ca__head { display: flex; align-items: center; gap: 8px; min-height: 22px; }
.ui-ca__stack { display: flex; flex: none; }
.ui-ca__stack .ui-ca__glyph { box-shadow: 0 0 0 1.5px var(--ui-ca-card); }
.ui-ca__stack .ui-ca__glyph + .ui-ca__glyph { margin-left: -4px; }
.ui-ca__meta { min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-ca-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

/* ----- Answer ----- */
.ui-ca__text { margin-top: 8px; color: var(--ui-ca-text); }
.ui-ca__p { margin: 0; overflow-wrap: anywhere; white-space: pre-line; text-align: start; font-size: 13.5px; line-height: 23px; }
.ui-ca__p + .ui-ca__p { margin-top: 10px; }
.ui-ca__seg { margin: 0 -2px; padding: 2px 2px; border-radius: 5px; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 220ms ease, color 220ms ease; }
.ui-ca__seg[data-hl] { background: var(--ui-ca-hl); color: var(--ui-ca-ink); }
.ui-ca__seg[data-dim] { color: var(--ui-ca-faded); }

.ui-ca__keep { white-space: nowrap; }
/* Every marker that isn't lit fades back while something is pointed at */
.ui-ca[data-hot] .ui-ca__marker:not([data-lit]):not([aria-expanded="true"]) { opacity: 0.5; }
.ui-ca__marker { position: relative; display: inline-grid; place-items: center; min-width: 16px; height: 16px; margin-left: 3px; padding: 0 4px; border-radius: 5px; background: var(--ui-ca-well); box-shadow: inset 0 0 0 1px var(--ui-ca-line); font-size: 10.5px; font-weight: 600; line-height: 16px; color: var(--ui-ca-text); vertical-align: 1px; font-variant-numeric: tabular-nums; transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease, opacity 220ms ease; }
.ui-ca__marker + .ui-ca__marker { margin-left: 2px; }
.ui-ca__marker::after { content: ""; position: absolute; inset: -4px -2px; }
.ui-ca__marker:hover, .ui-ca__marker[data-lit] { background: var(--ui-ca-accent); box-shadow: inset 0 0 0 1px var(--ui-ca-accent); color: #fff; }
.ui-ca__marker[aria-expanded="true"] { background: var(--ui-ca-ink); box-shadow: inset 0 0 0 1px var(--ui-ca-ink); color: var(--ui-ca-card); }

/* ----- Preview: unfolds in place, nothing travels ----- */
.ui-ca__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 420ms var(--ui-ca-ease), opacity 220ms ease; }
.ui-ca__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 420ms var(--ui-ca-ease), opacity 320ms ease 80ms; }
.ui-ca__clip { min-height: 0; overflow: hidden; }
.ui-ca__preview { margin-top: 12px; padding: 10px 12px 12px; border-radius: 12px; background: var(--ui-ca-well); animation: ui-ca-swap-in 320ms ease both; }
.ui-ca__pv-head { display: flex; align-items: center; gap: 8px; height: 22px; }
.ui-ca__pv-meta { display: flex; flex: 1; min-width: 0; overflow: hidden; font-size: 12px; color: var(--ui-ca-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-ca__pv-date { flex: none; white-space: pre; }
.ui-ca__pv-domain { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ui-ca-text); }
.ui-ca__pv-num { display: grid; flex: none; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 5px; background: var(--ui-ca-card); box-shadow: inset 0 0 0 1px var(--ui-ca-line); font-size: 10.5px; font-weight: 600; color: var(--ui-ca-text); font-variant-numeric: tabular-nums; }
.ui-ca__close { display: grid; flex: none; place-items: center; width: 22px; height: 22px; margin-right: -4px; border-radius: 7px; color: var(--ui-ca-muted); transition: background-color 160ms ease, color 160ms ease; }
.ui-ca__close:hover { background: var(--ui-ca-line); color: var(--ui-ca-ink); }
.ui-ca__pv-title { display: -webkit-box; overflow-wrap: anywhere; text-align: start; margin-top: 6px; overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 20px; color: var(--ui-ca-ink); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-ca__quote { margin: 8px 0 0; max-height: 200px; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; white-space: pre-line; text-align: start; padding: 0 0 0 10px; border-left: 2px solid var(--ui-ca-line); font-size: 12.5px; line-height: 20px; color: var(--ui-ca-text); }
.ui-ca__quote mark { margin: 0 -1px; padding: 1px 1px; border-radius: 3px; background: var(--ui-ca-mark); color: var(--ui-ca-ink); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.ui-ca__pv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
.ui-ca__btn { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; font-weight: 500; color: var(--ui-ca-text); text-decoration: none; white-space: nowrap; transition: background-color 160ms ease, color 160ms ease; }
.ui-ca__btn:hover { background: var(--ui-ca-line); color: var(--ui-ca-ink); }
.ui-ca__btn--main { padding: 0 8px 0 10px; background: var(--ui-ca-card); box-shadow: 0 0 0 1px var(--ui-ca-line), 0 1px 2px rgba(0, 0, 0, 0.04); color: var(--ui-ca-ink); }
.ui-ca__btn--main:hover { background: var(--ui-ca-card); }
.ui-ca__btn--main svg { transition: transform 220ms var(--ui-ca-ease); }
.ui-ca__btn--main:hover svg { transform: translate(1px, -1px); }
.ui-ca__btn[data-done] { color: var(--ui-ca-ok); }
.ui-ca__btn-icon { display: grid; place-items: center; width: 12px; height: 12px; animation: ui-ca-swap-in 280ms ease both; }

/* ----- Tray ----- */
.ui-ca__chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 4px 0; }
.ui-ca__chip-item { display: flex; min-width: 0; max-width: 100%; }
.ui-ca__chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; height: 28px; padding: 0 8px 0 6px; border-radius: 8px; font-size: 12.5px; color: var(--ui-ca-text); transition: background-color 160ms ease, box-shadow 160ms ease, opacity 220ms ease, color 160ms ease; }
.ui-ca__chip:hover, .ui-ca__chip[data-lit] { background: var(--ui-ca-card); box-shadow: 0 0 0 1px var(--ui-ca-line), 0 1px 2px rgba(0, 0, 0, 0.04); color: var(--ui-ca-ink); }
.ui-ca__chip[aria-expanded="true"] { background: var(--ui-ca-card); box-shadow: 0 0 0 1px var(--ui-ca-line), 0 1px 2px rgba(0, 0, 0, 0.04), inset 0 0 0 1px color-mix(in srgb, var(--ui-ca-ink) 45%, transparent); color: var(--ui-ca-ink); }
.ui-ca__chip[data-dim] { opacity: 0.45; }
.ui-ca__chip-name { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-ca__chip-num { flex: none; font-size: 11.5px; color: var(--ui-ca-muted); font-variant-numeric: tabular-nums; }

.ui-ca__foot { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 2px 4px 0 10px; }
.ui-ca__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-ca-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-ca__swap { display: grid; min-width: 0; }
.ui-ca__swap-item { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-ca-swap-in 320ms ease both; }
.ui-ca__swap-item[data-out] { animation: ui-ca-swap-out 220ms ease both; }
.ui-ca__swap-item[data-tone="ok"] { color: var(--ui-ca-ok); }
.ui-ca__action { display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 60%; align-items: center; gap: 4px; height: 26px; padding: 0 6px 0 8px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: var(--ui-ca-text); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease; }
.ui-ca__action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-ca__action:hover { background: var(--ui-ca-card); color: var(--ui-ca-ink); }
.ui-ca__action svg { transition: transform 220ms var(--ui-ca-ease); }
.ui-ca__action:hover svg { transform: translateX(2px); }

@keyframes ui-ca-swap-in { from { opacity: 0; filter: blur(2px); } }
@keyframes ui-ca-swap-out { from { opacity: 1; } to { opacity: 0; filter: blur(2px); } }

/* Narrow cards: tighter padding, chip names shorten, Copy quote keeps only its icon */
@container (max-width: 360px) {
  .ui-ca__card { padding: 12px 14px 12px; }
  .ui-ca__pv-num { display: none; }
}
@container (max-width: 280px) {
  .ui-ca__btn-text { display: none; }
}

@media (pointer: coarse) {
  .ui-ca__marker::after { inset: -8px -5px; }
  .ui-ca__chip { height: 34px; }
  .ui-ca__btn { height: 34px; }
  .ui-ca__close { width: 30px; height: 30px; margin-right: -7px; }
  .ui-ca__action { height: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-ca *, .ui-ca *::before, .ui-ca *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ca {
  --ui-ca-tray: #111113;
  --ui-ca-card: #19191b;
  --ui-ca-line: #2a2a2e;
  --ui-ca-ink: #ededed;
  --ui-ca-text: #c8c8cc;
  --ui-ca-muted: #8b8b92;
  --ui-ca-faded: #5c5c63;
  --ui-ca-well: #222225;
  --ui-ca-accent: #4f82ff;
  --ui-ca-hl: rgba(79, 130, 255, 0.16);
  --ui-ca-mark: rgba(79, 130, 255, 0.28);
  --ui-ca-ok: #6ee7a8;
  --ui-ca-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-ca [data-tone="blue"] { --ui-ca-g: #9bb8ff; --ui-ca-g-bg: rgba(79, 130, 255, 0.2); }
:where(.dark, [data-theme="dark"]) .ui-ca [data-tone="violet"] { --ui-ca-g: #c3b1ff; --ui-ca-g-bg: rgba(124, 92, 255, 0.22); }
:where(.dark, [data-theme="dark"]) .ui-ca [data-tone="green"] { --ui-ca-g: #6ee7a8; --ui-ca-g-bg: rgba(34, 160, 90, 0.2); }
:where(.dark, [data-theme="dark"]) .ui-ca [data-tone="amber"] { --ui-ca-g: #f5c264; --ui-ca-g-bg: rgba(240, 160, 32, 0.2); }
:where(.dark, [data-theme="dark"]) .ui-ca [data-tone="gray"] { --ui-ca-g: #b4b4bb; --ui-ca-g-bg: rgba(110, 110, 120, 0.22); }
`;
