"use client";

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/*
 * Cited Answer (Clean) – an AI answer whose sentences and sources are wired to each other, in one self-contained file.
 * Clean style: no tray – one white card with hairline shadows, gray tab chips and quiet gray type.
 * The answer is a list of text segments (usually one sentence each) that name the sources they rely on. Small
 * numbered markers sit at the end of each cited sentence; the sources wait below the answer as one row of tab chips
 * (whatever doesn't fit goes into "+N").
 *   · point at a marker: its source chip lights up and the sentence gets a soft highlight
 *   · point at a chip: every sentence that cites it lights up and the rest of the answer fades back
 *   · click a marker or chip: a preview unfolds in place – title, domain, date and the quoted passage with the
 *     words that back the answer marked – with Open source and Copy quote. Only one is open at a time
 *   · the last row of the card always says what you are pointing at
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
  /** A button in the last row of the card, e.g. { label: "Follow up", onClick } */
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
    <span className="ui-cac__swap">
      {out && (
        <span key={`out-${out.id}`} className="ui-cac__swap-item" data-out="" data-tone={out.tone} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span key={id} className="ui-cac__swap-item" data-tone={t}>
        {children}
      </span>
    </span>
  );
}

/* ---------- Icons: 16px, thin 1.1px lines with round caps ---------- */

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 16 16" className="ui-cac__icon" aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  close: "M4.75 4.75l6.5 6.5m0-6.5-6.5 6.5",
  out: "M6.5 4.5h5v5M11.25 4.75 4.5 11.5",
  copy: "M6.75 5.5h5c.69 0 1.25.56 1.25 1.25v5c0 .69-.56 1.25-1.25 1.25h-5c-.69 0-1.25-.56-1.25-1.25v-5c0-.69.56-1.25 1.25-1.25ZM10.5 3.5A1.25 1.25 0 0 0 9.25 3h-5C3.56 3 3 3.56 3 4.25v5c0 .54.34 1 .82 1.17",
  done: "M3.75 8.4 6.6 11.2 12.25 5",
  arrow: "M3.5 8h9M8.75 4.25 12.5 8l-3.75 3.75",
};

function SourceGlyph({ source }: { source: CitedSource }) {
  // An icon that fails to load falls back to the letter
  const [failed, setFailed] = useState(false);
  return (
    <span className="ui-cac__glyph" data-tone={tone(source.site)} aria-hidden="true" onErrorCapture={() => setFailed(true)}>
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
      className="ui-cac__marker"
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
      <span className="ui-cac__seg" data-hl={state === "hl" ? "" : undefined} data-dim={state === "dim" ? "" : undefined}>
        {body.slice(0, cut)}
        <span className="ui-cac__keep">
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

const CHIP_GAP = 4;

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
  const measureRef = useRef<HTMLDivElement>(null);
  // How many chips fit on one line – the rest goes into "+N" (which shows them all)
  const [fit, setFit] = useState(sources.length);
  const [allChips, setAllChips] = useState(false);

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

  // Measure the chips at their natural width (in a hidden copy) against the width of the row
  useLayoutEffect(() => {
    const row = chipsRef.current;
    const ruler = measureRef.current;
    if (!row || !ruler) return;
    const measure = () => {
      const widths = [...ruler.querySelectorAll<HTMLElement>("[data-chip]")].map((el) => el.offsetWidth);
      const more = ruler.querySelector<HTMLElement>("[data-more]")?.offsetWidth ?? 36;
      const width = row.clientWidth;
      const total = widths.reduce((a, w) => a + w, 0) + CHIP_GAP * Math.max(0, widths.length - 1);
      if (total <= width + 0.5) return setFit(widths.length);
      let used = 0;
      let k = 0;
      for (; k < widths.length; k++) {
        const next = used + (k ? CHIP_GAP : 0) + widths[k];
        if (next + CHIP_GAP + more > width) break;
        used = next;
      }
      setFit(Math.max(1, k));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    // Web fonts change the widths once they arrive
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [sources]);
  const visible = allChips ? sources.length : Math.min(fit, sources.length);
  const hidden = sources.length - visible;

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
  // Arrow keys walk along the chips (and the "+N" at the end)
  const onChipKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const items = [...(chipsRef.current?.querySelectorAll<HTMLElement>(".ui-cac__chip, .ui-cac__more") ?? [])];
    const i = items.indexOf(e.currentTarget);
    const last = items.length - 1;
    const to =
      e.key === "ArrowRight" ? Math.min(last, i + 1)
      : e.key === "ArrowLeft" ? Math.max(0, i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (to === null || i < 0) return;
    e.preventDefault();
    items[to]?.focus();
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

  /* ---------- What the last row says ---------- */

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
        <b>{hotSource.site}</b> <span className="ui-cac__dot">·</span> {hotSource.title}
      </>
    );
    captionKey = `mark-${hot.segment}-${hotSource.id}`;
  } else if (hotSource) {
    const n = citing(hotSource.id).length;
    caption = n ? (
      <>
        <b>{hotSource.site}</b> <span className="ui-cac__dot">·</span> cited in {fmt.format(n)} {n === 1 ? "sentence" : "sentences"}
      </>
    ) : (
      <>
        <b>{hotSource.site}</b> <span className="ui-cac__dot">·</span> read, not cited
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
  ].filter(Boolean) as string[];

  return (
    <div
      className={["ui-cac", className].filter(Boolean).join(" ")}
      role="group"
      aria-label="Answer with sources"
      data-hot={hot ? (hot.segment !== undefined ? "mark" : "source") : undefined}
      onKeyDown={onKeyDown}
    >
      <style href="ui-cited-answer-clean" precedence="default">
        {css}
      </style>

      <div className="ui-cac__body">
        <div className="ui-cac__head">
          <span className="ui-cac__stack" aria-hidden="true">
            {sources.slice(0, 3).map((s) => (
              <SourceGlyph key={s.id} source={s} />
            ))}
          </span>
          <span className="ui-cac__meta">
            {meta.map((m, i) => (
              <span key={m}>
                {i > 0 && <span className="ui-cac__dot"> · </span>}
                {m}
              </span>
            ))}
          </span>
        </div>

        <div className="ui-cac__text" onPointerLeave={() => setHot(null)}>
          {paragraphs.map((para, p) => (
            <p key={p} className="ui-cac__p" dir="auto">
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

        {/* The sources: one row of tab chips – whatever doesn't fit goes into "+N" */}
        <div
          className="ui-cac__chips"
          data-all={allChips ? "" : undefined}
          ref={chipsRef}
          role="list"
          aria-label="Sources"
          onPointerLeave={() => setHot(null)}
        >
          {sources.slice(0, visible).map((s, i) => {
            const lit = focusSource === s.id;
            return (
              <span role="listitem" key={s.id} className="ui-cac__chip-item">
                <button
                  type="button"
                  className="ui-cac__chip"
                  data-source={s.id}
                  data-lit={lit ? "" : undefined}
                  data-dim={focusSource && !lit ? "" : undefined}
                  aria-expanded={open === s.id}
                  aria-controls={previewId}
                  aria-label={`Source ${i + 1}: ${s.site} – ${s.title}`}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setHot({ source: s.id })}
                  onFocus={() => setHot({ source: s.id })}
                  onBlur={() => setHot(null)}
                  onKeyDown={onChipKey}
                  onClick={() => toggle(s.id)}
                >
                  <SourceGlyph source={s} />
                  <span className="ui-cac__chip-name" dir="auto" title={s.site}>
                    {s.site}
                  </span>
                  <span className="ui-cac__chip-num">{fmt.format(i + 1)}</span>
                </button>
              </span>
            );
          })}
          {hidden > 0 && (
            <span role="listitem" className="ui-cac__chip-item">
              <button
                type="button"
                className="ui-cac__more"
                aria-label={`Show ${hidden} more ${hidden === 1 ? "source" : "sources"}`}
                onKeyDown={onChipKey}
                onClick={() => setAllChips(true)}
              >
                +{hidden}
              </button>
            </span>
          )}
        </div>
        {/* A hidden copy of the chips at their natural width – measured to know how many fit */}
        <div className="ui-cac__ruler" ref={measureRef} aria-hidden="true">
          {sources.map((s, i) => (
            <span key={s.id} className="ui-cac__chip" data-chip="">
              <SourceGlyph source={s} />
              <span className="ui-cac__chip-name">{s.site}</span>
              <span className="ui-cac__chip-num">{i + 1}</span>
            </span>
          ))}
          <span className="ui-cac__more" data-more="">
            +{sources.length}
          </span>
        </div>

        {/* The preview unfolds below the sources; switching sources crossfades its content */}
        <div
          id={previewId}
          className="ui-cac__fold"
          data-open={open ? "" : undefined}
          inert={!open}
          role="region"
          aria-label={shown ? `Source ${number(shown.id)}: ${shown.site}` : "Source"}
        >
          <div className="ui-cac__clip">
            {shown && (
              <div className="ui-cac__preview" key={shown.id}>
                <div className="ui-cac__pv-head">
                  <SourceGlyph source={shown} />
                  <span className="ui-cac__pv-meta">
                    <span className="ui-cac__pv-domain" title={shown.url || shown.site}>
                      {domain(shown.url) || shown.site}
                    </span>
                    {shown.date && (
                      <span className="ui-cac__pv-date">
                        <span className="ui-cac__dot"> · </span>
                        {shown.date}
                      </span>
                    )}
                  </span>
                  <span className="ui-cac__pv-num">{fmt.format(number(shown.id))}</span>
                  <button type="button" className="ui-cac__close" aria-label="Close source" onClick={close}>
                    <Icon d={icons.close} />
                  </button>
                </div>
                <div className="ui-cac__pv-title" dir="auto" title={shown.title}>
                  {shown.title}
                </div>
                {shown.quote && (
                  <blockquote className="ui-cac__quote" dir="auto">
                    {marked(
                      shown.quote,
                      shown.highlight,
                      citing(shown.id)
                        .map((s) => s.text)
                        .join(" "),
                    )}
                  </blockquote>
                )}
                <div className="ui-cac__pv-actions">
                  {shown.url ? (
                    <a
                      className="ui-cac__btn ui-cac__btn--main"
                      href={shown.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => {
                        if (!onOpenSource) return;
                        e.preventDefault();
                        onOpenSource(shown);
                      }}
                    >
                      <Icon d={icons.out} />
                      Open source
                    </a>
                  ) : (
                    onOpenSource && (
                      <button type="button" className="ui-cac__btn ui-cac__btn--main" onClick={() => onOpenSource(shown)}>
                        <Icon d={icons.out} />
                        Open source
                      </button>
                    )
                  )}
                  {shown.quote && (
                    <button
                      type="button"
                      className="ui-cac__btn"
                      data-done={copied?.source === shown.id ? "" : undefined}
                      aria-label="Copy quote"
                      onClick={() => copyQuote(shown)}
                    >
                      <span className="ui-cac__btn-icon" key={copied?.source === shown.id ? "done" : "idle"}>
                        <Icon d={copied?.source === shown.id ? icons.done : icons.copy} />
                      </span>
                      <span className="ui-cac__btn-text">{copied?.source === shown.id ? "Copied" : "Copy quote"}</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* The last row of the card: what you are pointing at, and the action */}
      <div className="ui-cac__foot">
        <span className="ui-cac__caption" aria-live="polite">
          <Swap id={captionKey} tone={captionTone}>
            {caption}
          </Swap>
        </span>
        {action && (
          <button type="button" className="ui-cac__action" title={action.label} onClick={action.onClick}>
            <span className="ui-cac__action-label">{action.label}</span>
            <Icon d={icons.arrow} />
          </button>
        )}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-cac */
.ui-cac {
  --ui-cac-card: #ffffff;
  --ui-cac-ink: rgba(0, 0, 0, 0.88);
  --ui-cac-strong: #000000;
  --ui-cac-text: rgba(0, 0, 0, 0.61);
  --ui-cac-muted: rgba(0, 0, 0, 0.45);
  --ui-cac-faint: rgba(0, 0, 0, 0.27);
  --ui-cac-icon: rgba(0, 0, 0, 0.447);
  --ui-cac-line: rgba(0, 0, 0, 0.06);
  --ui-cac-fill: rgba(0, 0, 0, 0.06);
  --ui-cac-fill-strong: rgba(0, 0, 0, 0.1);
  --ui-cac-wash: rgba(0, 0, 0, 0.03);
  --ui-cac-hl: rgba(0, 96, 226, 0.07);
  --ui-cac-mark: rgba(0, 96, 226, 0.1);
  --ui-cac-ok: #1a9a52;
  --ui-cac-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cac-focus: rgba(0, 96, 226, 0.35);
  --ui-cac-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 460px;
  min-width: 0;
  container-type: inline-size;
  border-radius: 10px;
  background: var(--ui-cac-card);
  box-shadow: var(--ui-cac-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-cac-ink);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-cac *, .ui-cac *::before, .ui-cac *::after { box-sizing: border-box; }
:where(.ui-cac) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-cac :is(button, a):focus-visible { outline: 2px solid var(--ui-cac-focus); outline-offset: 1px; }
.ui-cac svg { display: block; flex: none; }
.ui-cac b { font-weight: 500; color: var(--ui-cac-ink); }
.ui-cac__dot { color: var(--ui-cac-faint); }
.ui-cac__icon { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.1; stroke-linecap: round; stroke-linejoin: round; }

/* Letter glyphs on a light tint – stand-ins for favicons */
.ui-cac [data-tone="blue"] { --ui-cac-g: #1f5fd1; --ui-cac-g-bg: rgba(0, 96, 226, 0.08); }
.ui-cac [data-tone="violet"] { --ui-cac-g: #6a4fd0; --ui-cac-g-bg: rgba(110, 86, 230, 0.09); }
.ui-cac [data-tone="green"] { --ui-cac-g: #1a8a4a; --ui-cac-g-bg: rgba(26, 154, 82, 0.09); }
.ui-cac [data-tone="amber"] { --ui-cac-g: #a46a06; --ui-cac-g-bg: rgba(232, 162, 12, 0.12); }
.ui-cac [data-tone="gray"] { --ui-cac-g: rgba(0, 0, 0, 0.55); --ui-cac-g-bg: rgba(0, 0, 0, 0.06); }
.ui-cac__glyph { display: grid; flex: none; place-items: center; width: 16px; height: 16px; overflow: hidden; border-radius: 4px; background: var(--ui-cac-g-bg); font-size: 9.5px; font-weight: 500; line-height: 1; color: var(--ui-cac-g); }
.ui-cac__glyph > :is(img, svg) { width: 100%; height: 100%; object-fit: cover; }

/* Everything above the last row */
.ui-cac__body { padding: 16px 20px 16px; }

/* ----- Head ----- */
.ui-cac__head { display: flex; align-items: center; gap: 8px; height: 16px; }
.ui-cac__stack { display: flex; flex: none; }
.ui-cac__stack .ui-cac__glyph { box-shadow: 0 0 0 1.5px var(--ui-cac-card); }
.ui-cac__stack .ui-cac__glyph + .ui-cac__glyph { margin-left: -4px; }
.ui-cac__meta { min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cac-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

/* ----- Answer ----- */
.ui-cac__text { margin-top: 12px; color: var(--ui-cac-ink); }
.ui-cac__p { margin: 0; overflow-wrap: anywhere; white-space: pre-line; text-align: start; font-size: 13px; line-height: 22px; }
.ui-cac__p + .ui-cac__p { margin-top: 10px; }
.ui-cac__seg { margin: 0 -2px; padding: 2px 2px; border-radius: 4px; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 200ms ease, color 200ms ease; }
.ui-cac__seg[data-hl] { background: var(--ui-cac-hl); color: var(--ui-cac-strong); }
.ui-cac__seg[data-dim] { color: var(--ui-cac-faint); }

.ui-cac__keep { white-space: nowrap; }
/* Every marker that isn't lit fades back while something is pointed at */
.ui-cac[data-hot] .ui-cac__marker:not([data-lit]):not([aria-expanded="true"]) { opacity: 0.5; }
/* Citation markers: the gray tab look; the linked one gets a touch darker */
.ui-cac__marker { position: relative; display: inline-grid; place-items: center; min-width: 16px; height: 16px; margin-left: 3px; padding: 0 4px; border-radius: 4px; background: var(--ui-cac-fill); box-shadow: inset 0 0 0 0.5px var(--ui-cac-line); font-size: 10px; font-weight: 500; line-height: 16px; color: var(--ui-cac-text); vertical-align: 1px; font-variant-numeric: tabular-nums; transition: background-color 160ms ease, color 160ms ease, opacity 200ms ease; }
.ui-cac__marker + .ui-cac__marker { margin-left: 2px; }
.ui-cac__marker::after { content: ""; position: absolute; inset: -4px -2px; }
.ui-cac__marker:hover, .ui-cac__marker[data-lit], .ui-cac__marker[aria-expanded="true"] { background: var(--ui-cac-fill-strong); color: var(--ui-cac-ink); }

/* ----- Sources: one row of tab chips ----- */
.ui-cac__chips { display: flex; gap: ${CHIP_GAP}px; margin-top: 16px; min-width: 0; }
.ui-cac__chips[data-all] { flex-wrap: wrap; }
.ui-cac__chip-item { display: flex; flex: none; min-width: 0; max-width: 100%; }
.ui-cac__chip-item:only-child, .ui-cac__chips:not([data-all]) .ui-cac__chip-item:first-child:nth-last-child(2) { flex: 0 1 auto; }
.ui-cac__chip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; height: 28px; padding: 0 8px 0 6px; border-radius: 6px; box-shadow: inset 0 0 0 0.5px var(--ui-cac-line); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-cac-text); white-space: nowrap; transition: background-color 140ms ease, color 140ms ease, opacity 200ms ease; }
.ui-cac__chip:hover, .ui-cac__chip[data-lit] { background: var(--ui-cac-wash); color: var(--ui-cac-ink); }
.ui-cac__chip[aria-expanded="true"] { background: var(--ui-cac-fill); color: var(--ui-cac-ink); }
.ui-cac__chip[data-dim]:not([aria-expanded="true"]) { opacity: 0.5; }
.ui-cac__chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cac__chip-num { flex: none; margin-left: -1px; font-size: 11px; font-weight: 400; color: var(--ui-cac-faint); font-variant-numeric: tabular-nums; }
.ui-cac__more { display: inline-grid; flex: none; place-items: center; height: 28px; padding: 0 8px; border-radius: 6px; box-shadow: inset 0 0 0 0.5px var(--ui-cac-line); font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-cac-text); font-variant-numeric: tabular-nums; transition: background-color 140ms ease, color 140ms ease; }
.ui-cac__more:hover { background: var(--ui-cac-wash); color: var(--ui-cac-ink); }
.ui-cac__ruler { position: absolute; top: 0; left: 0; display: flex; gap: ${CHIP_GAP}px; height: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
.ui-cac__ruler > * { flex: none; }

/* ----- Preview: unfolds in place, nothing travels ----- */
.ui-cac__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 420ms var(--ui-cac-ease), opacity 220ms ease; }
.ui-cac__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 420ms var(--ui-cac-ease), opacity 320ms ease 80ms; }
/* A few pixels of room so the preview's shadow isn't cut off */
.ui-cac__clip { min-height: 0; overflow: hidden; margin: 0 -4px -4px; padding: 0 4px 4px; }
.ui-cac__preview { margin-top: 12px; padding: 10px 12px 12px; border-radius: 8px; background: var(--ui-cac-card); box-shadow: var(--ui-cac-shadow); animation: ui-cac-swap-in 320ms ease both; }
.ui-cac__pv-head { display: flex; align-items: center; gap: 8px; height: 24px; }
.ui-cac__pv-date { flex: none; white-space: pre; }
.ui-cac__pv-meta { display: flex; flex: 1; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cac-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-cac__pv-domain { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--ui-cac-text); }
.ui-cac__pv-num { display: grid; flex: none; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; background: var(--ui-cac-fill); font-size: 10px; font-weight: 500; line-height: 16px; color: var(--ui-cac-text); font-variant-numeric: tabular-nums; }
.ui-cac__close { display: grid; flex: none; place-items: center; width: 24px; height: 24px; margin-right: -6px; border-radius: 6px; color: var(--ui-cac-icon); transition: background-color 140ms ease, color 140ms ease; }
.ui-cac__close:hover { background: var(--ui-cac-wash); color: var(--ui-cac-ink); }
.ui-cac__pv-title { display: -webkit-box; overflow-wrap: anywhere; text-align: start; margin-top: 6px; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-cac-strong); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-cac__quote { margin: 8px 0 0; max-height: 200px; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; white-space: pre-line; text-align: start; padding: 0 0 0 10px; border-left: 2px solid var(--ui-cac-fill); font-size: 12px; line-height: 20px; color: var(--ui-cac-text); }
.ui-cac__quote mark { margin: 0 -1px; padding: 1px 1px; border-radius: 3px; background: var(--ui-cac-mark); color: var(--ui-cac-ink); -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.ui-cac__pv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
/* Copy quote: a ghost button; Open source: the white secondary button */
.ui-cac__btn { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 8px; border-radius: 6px; font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-cac-text); text-decoration: none; white-space: nowrap; transition: background-color 140ms ease, color 140ms ease; }
.ui-cac__btn .ui-cac__icon { color: var(--ui-cac-icon); transition: color 140ms ease, transform 220ms var(--ui-cac-ease); }
.ui-cac__btn:hover { background: var(--ui-cac-wash); color: var(--ui-cac-ink); }
.ui-cac__btn:hover .ui-cac__icon { color: var(--ui-cac-ink); }
.ui-cac__btn--main { background: var(--ui-cac-card); box-shadow: var(--ui-cac-shadow); color: var(--ui-cac-strong); }
.ui-cac__btn--main:hover { background: #fafafa; color: var(--ui-cac-strong); }
.ui-cac__btn--main:hover .ui-cac__icon { transform: translate(1px, -1px); }
.ui-cac__btn[data-done], .ui-cac__btn[data-done] .ui-cac__icon { color: var(--ui-cac-ok); }
.ui-cac__btn-icon { display: grid; place-items: center; width: 16px; height: 16px; animation: ui-cac-swap-in 280ms ease both; }

/* ----- The last row ----- */
.ui-cac__foot { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 8px 0 20px; border-top: 0.5px solid var(--ui-cac-line); }
.ui-cac__foot:not(:has(.ui-cac__action)) { padding-right: 20px; }
.ui-cac__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cac-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-cac__swap { display: grid; min-width: 0; }
.ui-cac__swap-item { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-cac-swap-in 320ms ease both; }
.ui-cac__swap-item[data-out] { animation: ui-cac-swap-out 220ms ease both; }
.ui-cac__swap-item[data-tone="ok"] { color: var(--ui-cac-ok); }
/* Follow up: the white secondary button */
.ui-cac__action { display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 60%; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 10px; border-radius: 6px; background: var(--ui-cac-card); box-shadow: var(--ui-cac-shadow); font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-cac-strong); white-space: nowrap; transition: background-color 140ms ease; }
.ui-cac__action .ui-cac__icon { color: var(--ui-cac-icon); transition: transform 220ms var(--ui-cac-ease), color 140ms ease; }
.ui-cac__action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cac__action:hover { background: #fafafa; }
.ui-cac__action:hover .ui-cac__icon { color: var(--ui-cac-ink); transform: translateX(2px); }

@keyframes ui-cac-swap-in { from { opacity: 0; filter: blur(2px); } }
@keyframes ui-cac-swap-out { from { opacity: 1; } to { opacity: 0; filter: blur(2px); } }

/* Narrow cards: tighter padding, the preview drops its number tag, Copy quote keeps only its icon */
@container (max-width: 400px) {
  .ui-cac__body { padding: 14px 16px 16px; }
  .ui-cac__foot { padding-left: 16px; }
}
@container (max-width: 360px) {
  .ui-cac__pv-num { display: none; }
}
@container (max-width: 280px) {
  .ui-cac__btn-text { display: none; }
}

@media (pointer: coarse) {
  .ui-cac__marker::after { inset: -8px -5px; }
  .ui-cac__chip, .ui-cac__more { height: 34px; }
  .ui-cac__btn { height: 34px; }
  .ui-cac__close { width: 32px; height: 32px; margin-right: -8px; }
  .ui-cac__action { height: 34px; }
  .ui-cac__foot { height: 52px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-cac *, .ui-cac *::before, .ui-cac *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cac {
  --ui-cac-card: #1c1c1e;
  --ui-cac-ink: rgba(255, 255, 255, 0.9);
  --ui-cac-strong: #ffffff;
  --ui-cac-text: rgba(255, 255, 255, 0.62);
  --ui-cac-muted: rgba(255, 255, 255, 0.46);
  --ui-cac-faint: rgba(255, 255, 255, 0.3);
  --ui-cac-icon: rgba(255, 255, 255, 0.5);
  --ui-cac-line: rgba(255, 255, 255, 0.08);
  --ui-cac-fill: rgba(255, 255, 255, 0.08);
  --ui-cac-fill-strong: rgba(255, 255, 255, 0.14);
  --ui-cac-wash: rgba(255, 255, 255, 0.04);
  --ui-cac-hl: rgba(77, 141, 255, 0.14);
  --ui-cac-mark: rgba(77, 141, 255, 0.24);
  --ui-cac-ok: #3ec27a;
  --ui-cac-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-cac-focus: rgba(77, 141, 255, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-cac__btn--main:hover,
:where(.dark, [data-theme="dark"]) .ui-cac__action:hover { background: #232326; }
:where(.dark, [data-theme="dark"]) .ui-cac [data-tone="blue"] { --ui-cac-g: #9bbcff; --ui-cac-g-bg: rgba(77, 141, 255, 0.16); }
:where(.dark, [data-theme="dark"]) .ui-cac [data-tone="violet"] { --ui-cac-g: #c3b4ff; --ui-cac-g-bg: rgba(124, 92, 255, 0.18); }
:where(.dark, [data-theme="dark"]) .ui-cac [data-tone="green"] { --ui-cac-g: #6ee7a8; --ui-cac-g-bg: rgba(34, 160, 90, 0.16); }
:where(.dark, [data-theme="dark"]) .ui-cac [data-tone="amber"] { --ui-cac-g: #f5c264; --ui-cac-g-bg: rgba(240, 160, 32, 0.16); }
:where(.dark, [data-theme="dark"]) .ui-cac [data-tone="gray"] { --ui-cac-g: rgba(255, 255, 255, 0.62); --ui-cac-g-bg: rgba(255, 255, 255, 0.08); }
`;
