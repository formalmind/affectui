"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";

/*
 * Comments Panel (Clean) – a comment feed with filters, runnable /edit commands and a composer, in a single self-contained file.
 * Clean style: no tray – one white card with hairline shadows. Heading, filter tabs, the feed and the composer are rows
 * of that card; quiet gray type, thin 16px icons, status as a soft tinted fill.
 * Filter by questions or edits, sort, run an edit and undo it, resolve comments, add new ones.
 * The styles are injected below, so no extra files are needed.
 */

export type CommentAuthor = { name: string; avatar?: string };

export type PanelComment = {
  id: string;
  author: CommentAuthor;
  /** When it was written – a Date or a timestamp */
  createdAt: Date | number;
  text: string;
};

export type CommentsPanelProps = {
  comments: PanelComment[];
  /** Who writes new comments */
  currentUser: CommentAuthor;
  title?: string;
  /** Runs an /edit command – resolve when done; without it the edit is only marked as applied */
  onRunEdit?: (comment: PanelComment) => Promise<void> | void;
  onAdd?: (comment: PanelComment) => void;
  /** Shows a close button in the header */
  onClose?: () => void;
  className?: string;
};

type Tab = "all" | "questions" | "edits";
type EditState = "idle" | "running" | "done";

// An /edit needs something to do – a bare "/edit" stays a plain comment
const isEdit = (c: PanelComment) => /^\/edit\b\s*\S/i.test(c.text.trim());
const isQuestion = (c: PanelComment) => !isEdit(c) && c.text.trim().endsWith("?");

function ago(time: number, now: number) {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.round(d / 30)}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}
const count = new Intl.NumberFormat("en");

export function CommentsPanel({
  comments: initial,
  currentUser,
  title = "Comments",
  onRunEdit,
  onAdd,
  onClose,
  className,
}: CommentsPanelProps) {
  const [comments, setComments] = useState(initial);
  const [tab, setTab] = useState<Tab>("all");
  const [newest, setNewest] = useState(true);
  const [menu, setMenu] = useState(false);
  const [edits, setEdits] = useState<Record<string, EditState>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const morphRef = useSmoothHeight(listRef);

  // Keep "2min ago" honest while the panel is open
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [menu]);

  const open = comments.filter((c) => !resolved.has(c.id));
  const pendingEdits = open.filter((c) => isEdit(c) && edits[c.id] !== "done").length;
  const counts = { all: open.length, questions: open.filter(isQuestion).length, edits: pendingEdits };

  const shown = useMemo(() => {
    const list = comments.filter((c) => tab === "all" || (tab === "questions" ? isQuestion(c) : isEdit(c)));
    return [...list].sort((a, b) => (+b.createdAt - +a.createdAt) * (newest ? 1 : -1));
  }, [comments, tab, newest]);

  const run = async (c: PanelComment) => {
    setEdits((e) => ({ ...e, [c.id]: "running" }));
    try {
      await (onRunEdit ? onRunEdit(c) : new Promise((r) => setTimeout(r, 1100)));
      setEdits((e) => ({ ...e, [c.id]: "done" }));
    } catch {
      setEdits((e) => ({ ...e, [c.id]: "idle" }));
    }
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const comment: PanelComment = { id: `c-${Date.now()}`, author: currentUser, createdAt: Date.now(), text };
    setComments((list) => [comment, ...list]);
    setDraft("");
    setTab("all");
    setNewest(true);
    setNow(Date.now());
    onAdd?.(comment);
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
  };

  return (
    <>
      <style href="ui-comments-panel-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-cpc", className].filter(Boolean).join(" ")} aria-label={title}>
        {/* First row: heading and close */}
        <header className="ui-cpc__head">
          <h3 className="ui-cpc__title" title={title} dir="auto">
            {title}
          </h3>
          {onClose && (
            <button type="button" className="ui-cpc__icon-btn" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
              <Icon d={icons.close} />
            </button>
          )}
        </header>

        {/* Filter tabs in the button-switch look, sorting on the right */}
        <div className="ui-cpc__bar">
          <div className="ui-cpc__tabs" role="tablist" aria-label="Filter comments">
            {(["all", "questions", "edits"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                className="ui-cpc__tab"
                onClick={() => setTab(t)}
              >
                {{ all: "All", questions: "Questions", edits: "Edits" }[t]}
                {t === "edits" && counts.edits > 0 && (
                  <span className="ui-cpc__count" key={counts.edits}>
                    {count.format(counts.edits)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="ui-cpc__sort" ref={menuRef}>
            <button
              type="button"
              className="ui-cpc__icon-btn"
              aria-label="Sort comments"
              aria-haspopup="menu"
              aria-expanded={menu}
              onClick={() => setMenu((m) => !m)}
            >
              <Icon d={icons.sort} />
            </button>
            {menu && (
              <div className="ui-cpc__menu" role="menu">
                {[
                  { label: "Newest first", value: true },
                  { label: "Oldest first", value: false },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={newest === o.value}
                    className="ui-cpc__menu-item"
                    onClick={() => {
                      setNewest(o.value);
                      setMenu(false);
                    }}
                  >
                    {o.label}
                    {newest === o.value && <Icon d={icons.check} className="ui-cpc__menu-check" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Only the feed glides to its new height – the composer below always stays in view */}
        <div className="ui-cpc__morph" ref={morphRef}>
          <ul className="ui-cpc__list" ref={listRef} aria-live="polite">
            {shown.length === 0 && (
              <li className="ui-cpc__empty">{tab === "questions" ? "No open questions." : tab === "edits" ? "No edits to run." : "No comments yet."}</li>
            )}
            {shown.map((c) => {
              const edit = isEdit(c);
              const state = edits[c.id] ?? "idle";
              const isResolved = resolved.has(c.id);
              return (
                <li key={c.id} className="ui-cpc__item" data-resolved={isResolved || undefined}>
                  <div className="ui-cpc__meta">
                    <Avatar author={c.author} />
                    <span className="ui-cpc__name" title={c.author.name} dir="auto">
                      {c.author.name}
                    </span>
                    <time className="ui-cpc__time" dateTime={new Date(c.createdAt).toISOString()}>
                      {ago(+c.createdAt, now)}
                    </time>
                    <button
                      type="button"
                      className="ui-cpc__resolve"
                      aria-pressed={isResolved}
                      aria-label={isResolved ? "Reopen comment" : "Resolve comment"}
                      title={isResolved ? "Reopen" : "Resolve"}
                      onClick={() =>
                        setResolved((r) => {
                          const next = new Set(r);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                    >
                      <Icon d={icons.resolve} />
                    </button>
                  </div>
                  <p className="ui-cpc__text" dir="auto">
                    {edit ? (
                      <>
                        <span className="ui-cpc__command">/Edit</span> {c.text.trim().replace(/^\/edit\s*/i, "")}
                      </>
                    ) : (
                      c.text
                    )}
                  </p>
                  {edit && !isResolved && (
                    <div className="ui-cpc__actions">
                      {state === "done" ? (
                        <>
                          <span className="ui-cpc__done" role="status">
                            <Icon d={icons.checkSolid} solid />
                            Edit applied
                          </span>
                          <button type="button" className="ui-cpc__link" onClick={() => setEdits((e) => ({ ...e, [c.id]: "idle" }))}>
                            Undo
                          </button>
                        </>
                      ) : (
                        <button type="button" className="ui-cpc__btn" disabled={state === "running"} onClick={() => run(c)}>
                          {state === "running" ? (
                            <>
                              <span className="ui-cpc__spinner" aria-hidden="true" />
                              <span className="ui-cpc__shimmer" data-text="Running…">
                                Running…
                              </span>
                            </>
                          ) : (
                            <>
                              <Icon d={icons.play} solid />
                              Run edit
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* The last row: the composer under a hairline */}
        <form
          className="ui-cpc__composer"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Avatar author={currentUser} />
          <input
            className="ui-cpc__input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment or /edit…"
            aria-label="Add a comment"
          />
          <button type="submit" className="ui-cpc__send" aria-label="Send comment" disabled={!draft.trim()}>
            <Icon d={icons.up} />
          </button>
        </form>
      </section>
    </>
  );
}

function Avatar({ author }: { author: CommentAuthor }) {
  // A picture that fails to load falls back to the initials
  const [broken, setBroken] = useState(false);
  // Initials from whole letters: emoji and extra spaces are skipped, so "🦊 Fox" gives "F" and "  Sam   Lee " gives "SL"
  const initials = author.name
    .trim()
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return author.avatar && !broken ? (
    <img className="ui-cpc__avatar" src={author.avatar} alt="" width={20} height={20} loading="lazy" onError={() => setBroken(true)} />
  ) : (
    <span className="ui-cpc__avatar ui-cpc__avatar--initials" aria-hidden="true">
      {initials}
    </span>
  );
}

/* ---------- Icons: 16px, thin lines with round caps or solid glyphs ---------- */

const icons = {
  close: "M4.5 4.5l7 7M11.5 4.5l-7 7",
  sort: "M2.5 4.5h11M4.5 8h7M6.5 11.5h3",
  check: "m3.5 8.5 3 3 6-7",
  resolve: "M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM5.5 8.2l1.7 1.7 3.3-3.8",
  checkSolid:
    "M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm8.9-1.2a.5.5 0 0 0-.8-.6L7.44 9.23 6.35 8.15a.5.5 0 1 0-.7.7l1.5 1.5a.5.5 0 0 0 .76-.06l2.5-3.5Z",
  play: "M5 3.6a.8.8 0 0 1 1.2-.7l6.3 3.9a1.4 1.4 0 0 1 0 2.4l-6.3 3.9a.8.8 0 0 1-1.2-.7V3.6Z",
  up: "M8 12.5v-9M4 7.5l4-4 4 4",
};

const Icon = ({ d, solid, className }: { d: string; solid?: boolean; className?: string }) => (
  <svg viewBox="0 0 16 16" className={["ui-cpc__glyph", className].filter(Boolean).join(" ")} data-solid={solid || undefined} aria-hidden="true">
    <path d={d} />
  </svg>
);

/**
 * Lets a box glide to the height of its content instead of jumping: the outer box follows the inner one
 * with a height transition whenever the content grows or shrinks.
 */
function useSmoothHeight(inner: RefObject<HTMLElement | null>) {
  const outer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const sync = () => {
      o.style.height = `${i.offsetHeight}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(i);
    // Transitions switch on after the first measurement, so the first render doesn't animate
    const frame = requestAnimationFrame(() => o.setAttribute("data-smooth", ""));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [inner]);
  return outer;
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-cpc */
.ui-cpc {
  --ui-cpc-card: #ffffff;
  --ui-cpc-ink: rgba(0, 0, 0, 0.88);
  --ui-cpc-strong: #000000;
  --ui-cpc-text: rgba(0, 0, 0, 0.61);
  --ui-cpc-muted: rgba(0, 0, 0, 0.45);
  --ui-cpc-faint: rgba(0, 0, 0, 0.27);
  --ui-cpc-icon: rgba(0, 0, 0, 0.447);
  --ui-cpc-line: rgba(0, 0, 0, 0.06);
  --ui-cpc-wash: rgba(0, 0, 0, 0.03);
  --ui-cpc-fill: rgba(0, 0, 0, 0.06);
  --ui-cpc-fill-strong: rgba(0, 0, 0, 0.1);
  --ui-cpc-accent: rgba(0, 96, 226, 0.765);
  --ui-cpc-focus: rgba(0, 96, 226, 0.35);
  --ui-cpc-ok: #1a9a52;
  --ui-cpc-ok-soft: rgba(26, 154, 82, 0.08);
  --ui-cpc-solid: rgba(0, 0, 0, 0.88);
  --ui-cpc-on-solid: #fcfcfc;
  --ui-cpc-shine: rgba(255, 255, 255, 0.82);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-cpc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cpc-shadow-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cpc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 400px;
  /* One white card – the edge is a shadow, not a border */
  border-radius: 10px;
  background: var(--ui-cpc-card);
  box-shadow: var(--ui-cpc-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-cpc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-cpc *, .ui-cpc *::before, .ui-cpc *::after { box-sizing: border-box; }
:where(.ui-cpc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-cpc) svg { display: block; flex: none; }
.ui-cpc button:focus-visible { outline: 2px solid var(--ui-cpc-focus); outline-offset: 1px; }

.ui-cpc__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.1; stroke-linecap: round; stroke-linejoin: round; }
.ui-cpc__glyph[data-solid] { fill: currentColor; stroke: none; }

/* Heading row */
.ui-cpc__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 12px 0 16px;
}
/* A long title keeps to two lines – the whole one on hover */
.ui-cpc__title { display: -webkit-box; min-width: 0; margin: 0; overflow: hidden; font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-cpc-strong); overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

/* Ghost icon button */
.ui-cpc__icon-btn {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--ui-cpc-icon);
  transition: background-color 120ms ease, color 120ms ease;
}
.ui-cpc__icon-btn:hover,
.ui-cpc__icon-btn[aria-expanded="true"] { background: var(--ui-cpc-wash); color: var(--ui-cpc-ink); }

/* Filter tabs: the button-switch look */
.ui-cpc__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px 12px 16px;
  border-bottom: 0.5px solid var(--ui-cpc-line);
}
.ui-cpc__tabs { display: flex; gap: 8px; min-width: 0; }
.ui-cpc__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: none;
  padding: 4px 10px;
  border-radius: 6px;
  box-shadow: inset 0 0 0 0.5px var(--ui-cpc-line);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-cpc-text);
  white-space: nowrap;
  transition: background-color 90ms ease, color 90ms ease;
}
.ui-cpc__tab:hover { background: var(--ui-cpc-wash); }
.ui-cpc__tab[aria-selected="true"] { background: var(--ui-cpc-fill); color: var(--ui-cpc-ink); }
.ui-cpc__count {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  margin-right: -4px;
  padding: 0 4px;
  border-radius: 5px;
  background: var(--ui-cpc-fill);
  font-size: 11px;
  font-weight: 500;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-cpc-text);
  animation: ui-cpc-pop 220ms var(--ui-cpc-ease) both;
}
.ui-cpc__tab[aria-selected="true"] .ui-cpc__count { background: var(--ui-cpc-card); box-shadow: 0 0 0 0.5px var(--ui-cpc-line); color: var(--ui-cpc-ink); }

/* Sort menu: the popover */
.ui-cpc__sort { position: relative; flex: none; }
.ui-cpc__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 5;
  display: grid;
  gap: 2px;
  min-width: 160px;
  padding: 4px;
  border-radius: 10px;
  background: var(--ui-cpc-card);
  box-shadow: var(--ui-cpc-shadow-pop);
  transform-origin: top right;
  animation: ui-cpc-drop 180ms var(--ui-cpc-ease);
}
.ui-cpc__menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 28px;
  padding: 0 8px 0 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 20px;
  text-align: left;
  color: var(--ui-cpc-ink);
  transition: background-color 90ms ease;
}
.ui-cpc__menu-item:hover { background: var(--ui-cpc-fill); }
.ui-cpc__menu-check { color: var(--ui-cpc-accent); stroke-width: 1.4; }

/* The feed */
.ui-cpc__list {
  max-height: var(--ui-cpc-max-height, 360px);
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
  scrollbar-color: var(--ui-cpc-fill-strong) transparent;
}
.ui-cpc__item {
  padding: 12px 16px 14px;
  border-top: 0.5px solid var(--ui-cpc-line);
  animation: ui-cpc-in 360ms var(--ui-cpc-ease) both;
  transition: opacity 220ms ease;
}
.ui-cpc__item:first-child { border-top: 0; }
.ui-cpc__item[data-resolved] { opacity: 0.5; }
.ui-cpc__meta { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-cpc__avatar {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1);
}
.ui-cpc__avatar--initials {
  display: grid;
  place-items: center;
  background: var(--ui-cpc-fill);
  font-size: 9px;
  font-weight: 500;
  line-height: 1;
  color: var(--ui-cpc-text);
}
.ui-cpc__name {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-cpc-strong);
}
.ui-cpc__time {
  flex: none;
  margin-left: auto;
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--ui-cpc-faint);
}
/* Resolve: a ghost icon button that shows on hover, a soft green fill when resolved */
.ui-cpc__resolve {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  margin: -2px -4px -2px 0;
  border-radius: 6px;
  color: var(--ui-cpc-icon);
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease, color 120ms ease;
}
.ui-cpc__item:hover .ui-cpc__resolve,
.ui-cpc__resolve:focus-visible,
.ui-cpc__resolve[aria-pressed="true"] { opacity: 1; }
.ui-cpc__resolve:hover { background: var(--ui-cpc-wash); color: var(--ui-cpc-ink); }
.ui-cpc__resolve[aria-pressed="true"] { background: var(--ui-cpc-ok-soft); color: var(--ui-cpc-ok); }
.ui-cpc__text {
  margin: 6px 0 0 28px;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-cpc-ink);
  text-align: start;
  overflow-wrap: anywhere;
  /* Line breaks in a comment stay */
  white-space: pre-line;
}
.ui-cpc__item[data-resolved] .ui-cpc__text { text-decoration: line-through; text-decoration-color: var(--ui-cpc-faint); }
.ui-cpc__command { font-weight: 500; color: var(--ui-cpc-muted); }
.ui-cpc__actions { display: flex; align-items: center; gap: 10px; margin: 10px 0 0 28px; }

/* Run edit: the white button with the hairline shadow */
.ui-cpc__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: 6px;
  background: var(--ui-cpc-card);
  box-shadow: var(--ui-cpc-shadow);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-cpc-strong);
  transition: background-color 120ms ease, color 120ms ease;
}
.ui-cpc__btn .ui-cpc__glyph { color: var(--ui-cpc-icon); }
.ui-cpc__btn:hover:not(:disabled) { background: #fafafa; }
.ui-cpc__btn:disabled { color: var(--ui-cpc-muted); cursor: progress; }
.ui-cpc__spinner {
  flex: none;
  width: 12px;
  height: 12px;
  margin: 0 2px;
  border: 1.2px solid var(--ui-cpc-fill-strong);
  border-top-color: var(--ui-cpc-accent);
  border-radius: 50%;
  animation: ui-cpc-spin 700ms linear infinite;
}
/* "Running…": a lighter band sweeps across the gray text */
.ui-cpc__shimmer { position: relative; display: inline-block; }
.ui-cpc__shimmer::after {
  content: attr(data-text);
  content: attr(data-text) / "";
  position: absolute;
  inset: 0;
  white-space: nowrap;
  color: transparent;
  background: linear-gradient(90deg, transparent 38%, var(--ui-cpc-shine) 50%, transparent 62%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ui-cpc-sweep 1.3s linear infinite;
  pointer-events: none;
}
/* Applied: a soft green fill, no stroke */
.ui-cpc__done {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 8px;
  border-radius: 6px;
  background: var(--ui-cpc-ok-soft);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-cpc-ok);
  animation: ui-cpc-in 300ms var(--ui-cpc-ease);
}
.ui-cpc__link {
  height: 28px;
  padding: 0 4px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-cpc-muted);
  transition: color 120ms ease, background-color 120ms ease;
}
.ui-cpc__link:hover { background: var(--ui-cpc-wash); color: var(--ui-cpc-ink); }
.ui-cpc__empty { padding: 28px 16px; font-size: 13px; line-height: 20px; text-align: center; color: var(--ui-cpc-muted); }

/* The last row: composer under a hairline */
.ui-cpc__composer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 16px;
  border-top: 0.5px solid var(--ui-cpc-line);
}
.ui-cpc__input {
  flex: 1;
  min-width: 0;
  height: 28px;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-cpc-strong);
  caret-color: var(--ui-cpc-accent);
}
.ui-cpc__input::placeholder { color: var(--ui-cpc-faint); opacity: 1; }
/* Send: the dark chip */
.ui-cpc__send {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--ui-cpc-solid);
  color: var(--ui-cpc-on-solid);
  transition: opacity 160ms ease, transform 160ms ease;
}
.ui-cpc__send .ui-cpc__glyph { stroke-width: 1.5; }
.ui-cpc__send:disabled { opacity: 0.3; cursor: default; }
.ui-cpc__send:not(:disabled):active { transform: scale(0.94); }

@keyframes ui-cpc-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-cpc-drop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-cpc-pop { from { opacity: 0; transform: scale(0.8); } }
@keyframes ui-cpc-spin { to { transform: rotate(360deg); } }
@keyframes ui-cpc-sweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }

/* Height changes glide instead of jumping */
.ui-cpc__morph { overflow: hidden; }
.ui-cpc__morph[data-smooth] { transition: height 380ms var(--ui-cpc-ease); }

/* Narrow: tighter edges, smaller tab gaps */
@container (max-width: 360px) {
  .ui-cpc__head { padding-left: 14px; }
  .ui-cpc__bar { padding-left: 14px; padding-right: 10px; }
  .ui-cpc__tabs { gap: 4px; }
  .ui-cpc__tab { padding: 4px 8px; }
  .ui-cpc__item { padding-left: 14px; padding-right: 14px; }
  .ui-cpc__composer { padding-left: 14px; }
}
@container (max-width: 300px) {
  .ui-cpc__text, .ui-cpc__actions { margin-left: 0; }
}
/* Touch screens: taller targets, resolve always visible */
@media (hover: none) and (pointer: coarse) {
  .ui-cpc__icon-btn, .ui-cpc__send { width: 36px; height: 36px; }
  .ui-cpc__tab { padding: 6px 12px; }
  .ui-cpc__menu-item { height: 36px; }
  .ui-cpc__btn, .ui-cpc__done, .ui-cpc__link { height: 34px; }
  .ui-cpc__input { height: 36px; }
  .ui-cpc__resolve { width: 32px; height: 32px; margin: -6px -6px -6px 0; opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-cpc *, .ui-cpc *::before, .ui-cpc *::after { animation: none !important; transition: none !important; }
}

/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-cpc input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-cpc textarea:focus-visible,
.ui-cpc [contenteditable]:focus-visible { outline: none; }

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cpc {
  --ui-cpc-card: #1c1c1e;
  --ui-cpc-ink: rgba(255, 255, 255, 0.9);
  --ui-cpc-strong: #ffffff;
  --ui-cpc-text: rgba(255, 255, 255, 0.62);
  --ui-cpc-muted: rgba(255, 255, 255, 0.46);
  --ui-cpc-faint: rgba(255, 255, 255, 0.3);
  --ui-cpc-icon: rgba(255, 255, 255, 0.5);
  --ui-cpc-line: rgba(255, 255, 255, 0.08);
  --ui-cpc-wash: rgba(255, 255, 255, 0.04);
  --ui-cpc-fill: rgba(255, 255, 255, 0.08);
  --ui-cpc-fill-strong: rgba(255, 255, 255, 0.14);
  --ui-cpc-accent: #4d8dff;
  --ui-cpc-focus: rgba(77, 141, 255, 0.5);
  --ui-cpc-ok: #3ec27a;
  --ui-cpc-ok-soft: rgba(62, 194, 122, 0.14);
  --ui-cpc-solid: rgba(255, 255, 255, 0.9);
  --ui-cpc-on-solid: #1c1c1e;
  --ui-cpc-shine: #ffffff;
  --ui-cpc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-cpc-shadow-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-cpc__btn:hover:not(:disabled) { background: #232326; }
:where(.dark, [data-theme="dark"]) .ui-cpc__menu { background: #232326; }
:where(.dark, [data-theme="dark"]) .ui-cpc__avatar { box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.14); }
`;
