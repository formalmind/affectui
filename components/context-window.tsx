"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Context Window – what fills an AI model's context right now, and what you can do about it, in one self-contained file.
 * The window is drawn as a field of small cells: every cell is a slice of the token limit, colored by what sits in
 * it – system prompt, tools, files, the conversation, memory. Empty cells are the room that is left.
 *   · hover a part and its cells stay lit while the rest fades; the big number rolls to that part
 *   · open a part with items (files, tools) and remove single ones – the cells empty in a sweep and everything moves up
 *   · press Compact on the conversation: its cells shimmer while it works, then most of them clear
 *   · the percentage turns amber before the window is full, and the gray tray says how much is left
 * The styles are injected below, so no extra files are needed.
 */

export type ContextItem = { id: string; label: string; tokens: number };

export type ContextPart = {
  id: string;
  label: string;
  /** Tokens of this part – ignored when `items` are given (then it is their sum) */
  tokens?: number;
  /** Single things inside this part that can be removed, e.g. attached files */
  items?: ContextItem[];
  /** Nothing can be removed or compacted here, e.g. the system prompt */
  locked?: boolean;
  /** Shows a Compact button. A number is the share that stays after compacting (default 0.3) */
  compact?: boolean | number;
  /** Any CSS color – defaults to a fixed palette in the order of the parts */
  color?: string;
};

export type ContextWindowProps = {
  parts: ContextPart[];
  /** Size of the context window in tokens */
  limit: number;
  title?: string;
  /** Small tag in the head, e.g. the model name */
  model?: string;
  /** Logo in front of the model name – any node, sized to 12px */
  modelIcon?: ReactNode;
  /** Called when an item is removed. With it the card shows exactly the parts you pass; without it the removal lives inside the card */
  onRemoveItem?: (partId: string, itemId: string) => void;
  /** Called when Compact is pressed; the cells shimmer until the returned promise settles. Without it the card shrinks the part on its own */
  onCompact?: (partId: string) => void | Promise<void>;
  /** A button on the tray, e.g. { label: "New chat", onClick } */
  action?: { label: string; onClick: () => void };
  /** Share of the limit from which the card warns (0–1) */
  warnAt?: number;
  /** Number of cells and how many sit in one row */
  cells?: number;
  columns?: number;
  className?: string;
};

/* ---------- Helpers ---------- */

const PALETTE = [
  "var(--ui-cw-c1)",
  "var(--ui-cw-c2)",
  "var(--ui-cw-c3)",
  "var(--ui-cw-c4)",
  "var(--ui-cw-c5)",
  "var(--ui-cw-c6)",
];
/** A count we can trust: NaN, Infinity and negatives read as 0 */
const count = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0);
const tokens = (n: number) => {
  const v = count(n);
  if (v >= 999_950_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 999_950) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return `${Math.round(v)}`;
};
/** For numbers that stand still: 200K instead of 200.0K */
const plain = (n: number) => tokens(n).replace(/\.0(?=[KMB]$)/, "");
/** The exact number for tooltips, e.g. 1,284,903 */
const exact = (n: number) => Math.round(count(n)).toLocaleString("en-US");
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Rolls a set of named numbers from where they are to their targets, in one animation frame loop */
function useRolling(target: Record<string, number>, duration: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const signature = JSON.stringify(target);
  useEffect(() => {
    const to = JSON.parse(signature) as Record<string, number>;
    const from = { ...current.current };
    if (reduced() || Object.keys(to).every((k) => from[k] === to[k])) {
      current.current = to;
      setShown(to);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      const next: Record<string, number> = {};
      for (const k in to)
        next[k] = (from[k] ?? to[k]) + (to[k] - (from[k] ?? to[k])) * e;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [signature, duration]);
  return shown;
}

/**
 * Text that changes without a jump: the old line stays for a moment and fades out underneath while the new one fades in.
 * Quick changes (moving across rows) just retarget – nothing piles up.
 */
function Swap({ id, tone, children }: { id: string; tone?: string; children: ReactNode }) {
  type Line = { id: string; tone?: string; node: ReactNode };
  const last = useRef<Line>({ id, tone, node: children });
  const [shownId, setShownId] = useState(id);
  const [out, setOut] = useState<Line | null>(null);
  if (shownId !== id) {
    // A new line: what was on screen until now becomes the one that fades out
    setShownId(id);
    setOut(last.current);
  }
  last.current = { id, tone, node: children };
  useEffect(() => {
    if (!out) return;
    const timer = window.setTimeout(() => setOut(null), 260);
    return () => window.clearTimeout(timer);
  }, [out]);
  return (
    <span className="ui-cw__swap">
      {out && (
        <span key={`out-${out.id}`} className="ui-cw__swap-item" data-out="" data-tone={out.tone} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span key={id} className="ui-cw__swap-item" data-tone={tone}>
        {children}
      </span>
    </span>
  );
}

/* ---------- Icons ---------- */

const line = {
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const ChevronIcon = () => (
  <svg
    className="ui-cw__chevron"
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path d="m3 4.5 3 3 3-3" {...line} />
  </svg>
);
const CloseIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    aria-hidden="true"
  >
    <path d="m2.5 2.5 5 5m0-5-5 5" {...line} />
  </svg>
);
const DoneIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.6 6.3 2.2 2.2 4.6-5" {...line} strokeWidth={1.6} />
  </svg>
);
const CompactIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M6 1.5v3m0 0L4.6 3.1M6 4.5l1.4-1.4M6 10.5v-3m0 0L4.6 8.9M6 7.5l1.4 1.4M2 6h8"
      {...line}
    />
  </svg>
);
const ArrowIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path d="M2.5 6h7M6.5 3l3 3-3 3" {...line} />
  </svg>
);

/** The removable items of one part – drawn again only when they change */
const Items = memo(function Items({
  partId,
  items,
  leaving,
  onRemove,
}: {
  partId: string;
  items: ContextItem[];
  leaving: Record<string, true>;
  onRemove: (partId: string, itemId: string) => void;
}) {
  return (
    <ul className="ui-cw__items">
      {items.length === 0 && <li className="ui-cw__empty">Nothing attached</li>}
      {items.map((it) => (
        <li key={it.id} className="ui-cw__fold ui-cw__fold--item" data-open={leaving[`${partId}/${it.id}`] ? undefined : ""}>
          <div className="ui-cw__clip">
            <div className="ui-cw__item">
              <span className="ui-cw__item-label" title={it.label} dir="auto">
                {it.label}
              </span>
              <span className="ui-cw__item-value" title={`${exact(it.tokens)} tokens`}>
                {tokens(it.tokens)}
              </span>
              <button type="button" className="ui-cw__remove" aria-label={`Remove ${it.label}`} onClick={() => onRemove(partId, it.id)}>
                <CloseIcon />
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
});

export function ContextWindow({
  parts,
  limit,
  title = "Context window",
  model,
  modelIcon,
  onRemoveItem,
  onCompact,
  action,
  warnAt = 0.8,
  cells = 216,
  columns = 36,
  className,
}: ContextWindowProps) {
  const uid = useId();
  // Without callbacks the card keeps its own record of what was removed and compacted
  const [removed, setRemoved] = useState<Record<string, true>>({});
  const [shrunk, setShrunk] = useState<Record<string, number>>({});
  /** Items that are folding away before they go */
  const [leaving, setLeaving] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: number; amount: number } | null>(
    null,
  );
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // The items of each part keep their identity between renders, so a long list isn't drawn again on every hover
  const itemsOf = useMemo(
    () =>
      Object.fromEntries(
        parts.map((p) => [p.id, p.items?.filter((it) => onRemoveItem || !removed[`${p.id}/${it.id}`])]),
      ),
    [parts, removed, onRemoveItem],
  );
  const list = parts.map((p, i) => {
    const items = itemsOf[p.id];
    const raw = items
      ? items.reduce((sum, it) => sum + count(it.tokens), 0)
      : count(p.tokens);
    return {
      ...p,
      items,
      tokens:
        shrunk[p.id] !== undefined && !onCompact
          ? Math.min(raw, shrunk[p.id])
          : raw,
      color: p.color ?? PALETTE[i % PALETTE.length],
    };
  });
  const used = list.reduce((sum, p) => sum + p.tokens, 0);
  // Without a usable limit there is no window to fill
  const cap = count(limit);
  const share = cap > 0 ? used / cap : 0;
  const level = share >= 0.95 ? "full" : share >= warnAt ? "warn" : "ok";
  const hotPart = list.find((p) => p.id === hot) ?? null;

  // One tween for the total, the big figure (total or hovered part) and every row
  const target: Record<string, number> = {
    "#used": used,
    "#figure": hotPart ? hotPart.tokens : used,
  };
  for (const p of list) target[p.id] = p.tokens;
  const shown = useRolling(target, 640);

  // Which part each cell belongs to: the parts fill the field in order, the rest stays empty
  const perCell = cap / cells;
  const owner: (number | null)[] = new Array(cells).fill(null);
  let sum = 0;
  let from = 0;
  if (cap > 0) list.forEach((p, index) => {
    sum += p.tokens;
    const to = Math.min(
      cells,
      Math.max(p.tokens > 0 ? from + 1 : from, Math.round(sum / perCell)),
    );
    for (let i = from; i < to; i++) owner[i] = index;
    from = to;
  });

  /* ---------- Actions ---------- */

  const remove = async (partId: string, itemId: string) => {
    const key = `${partId}/${itemId}`;
    setLeaving((l) => ({ ...l, [key]: true }));
    if (!reduced()) await wait(240);
    if (!alive.current) return;
    setLeaving(({ [key]: _gone, ...rest }) => rest);
    if (onRemoveItem) onRemoveItem(partId, itemId);
    else setRemoved((r) => ({ ...r, [key]: true }));
  };

  const removeRef = useRef(remove);
  removeRef.current = remove;
  const onRemove = useCallback((partId: string, itemId: string) => removeRef.current(partId, itemId), []);

  const compact = async (part: (typeof list)[number]) => {
    if (busy) return;
    setBusy(part.id);
    const before = part.tokens;
    // The shimmer runs at least long enough to be seen
    await Promise.all([
      Promise.resolve(onCompact?.(part.id)).catch(() => {}),
      wait(reduced() ? 0 : 1300),
    ]);
    if (!alive.current) return;
    setBusy(null);
    // Compacted parts can't be compacted again – until they have grown past this size
    setCompacted((c) => ({ ...c, [part.id]: before }));
    setFarewell({ id: part.id, leaving: false });
    if (!onCompact) {
      const keep = typeof part.compact === "number" ? part.compact : 0.3;
      const after = Math.round(before * keep);
      setShrunk((s) => ({ ...s, [part.id]: after }));
      setCompacted((c) => ({ ...c, [part.id]: after }));
      setSaved({ id: Date.now(), amount: before - after });
    } else {
      // The parent passes the smaller part in a moment – note what it was, to say how much was saved
      watch.current = { id: part.id, before };
    }
  };
  const watch = useRef<{ id: string; before: number } | null>(null);
  const watched = watch.current
    ? (list.find((p) => p.id === watch.current?.id)?.tokens ?? 0)
    : 0;
  useEffect(() => {
    const w = watch.current;
    if (!w || watched >= w.before) return;
    watch.current = null;
    setCompacted((c) => ({ ...c, [w.id]: watched }));
    setSaved({ id: Date.now(), amount: w.before - watched });
  }, [watched]);
  // "Saved …" stays on the tray for a moment
  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(null), 3200);
    return () => window.clearTimeout(id);
  }, [saved]);

  /* ---------- What the tray says ---------- */

  const free = Math.max(0, cap - used);
  let caption: ReactNode = <>{plain(free)} free</>;
  let captionKey = "rest";
  let captionTone: string | undefined;
  if (busy) {
    caption = "Compacting…";
    captionKey = "busy";
  } else if (hotPart) {
    caption = (
      // The name may shorten, the share never does
      <span className="ui-cw__hot">
        <b dir="auto">{hotPart.label}</b>
        <span>
          {" "}·{" "}
          {cap > 0 ? ((hotPart.tokens / cap) * 100).toFixed(hotPart.tokens / cap < 0.1 ? 1 : 0) : 0}% of the window
        </span>
      </span>
    );
    captionKey = `hot-${hotPart.id}`;
  } else if (saved) {
    caption = (
      <>
        Saved <b>{plain(saved.amount)}</b> tokens
      </>
    );
    captionKey = `saved-${saved.id}`;
    captionTone = "ok";
  } else if (level !== "ok") {
    caption = level !== "full" ? `${plain(free)} left` : used > cap ? `${plain(used - cap)} over the limit` : "Window is full";
    captionKey = level;
  }

  /** Size of each part right after it was compacted; the button comes back once the part has grown again */
  const [compacted, setCompacted] = useState<Record<string, number>>({});
  const isCompacted = (p: { id: string; tokens: number }) => compacted[p.id] !== undefined && p.tokens <= compacted[p.id];

  // After compacting, the button says "Compacted" for a moment, then folds away
  const [farewell, setFarewell] = useState<{ id: string; leaving: boolean } | null>(null);
  useEffect(() => {
    if (!farewell) return;
    const timer = window.setTimeout(() => setFarewell(farewell.leaving ? null : { ...farewell, leaving: true }), farewell.leaving ? 420 : 1500);
    return () => window.clearTimeout(timer);
  }, [farewell]);

  const compactButton = (p: (typeof list)[number]) => (
    <button
      type="button"
      className="ui-cw__compact"
      aria-label={isCompacted(p) ? `${p.label} is compacted` : `Compact ${p.label}`}
      disabled={Boolean(busy) || p.tokens === 0 || isCompacted(p)}
      data-busy={busy === p.id ? "" : undefined}
      data-done={isCompacted(p) ? "" : undefined}
      data-leaving={farewell?.id === p.id && farewell.leaving ? "" : undefined}
      onClick={() => compact(p)}
      onFocus={() => setHot(p.id)}
      onBlur={() => setHot(null)}
    >
      {/* Icon and word swap in place: Compact → working → Compacted */}
      <span className="ui-cw__compact-icon" key={busy === p.id ? "icon-busy" : isCompacted(p) ? "icon-done" : "icon-idle"}>
        {busy === p.id ? <span className="ui-cw__spinner" /> : isCompacted(p) ? <DoneIcon /> : <CompactIcon />}
      </span>
      <span className="ui-cw__compact-text" key={isCompacted(p) ? "text-done" : "text-idle"}>
        {isCompacted(p) ? "Compacted" : "Compact"}
      </span>
    </button>
  );

  return (
    <div
      className={["ui-cw", className].filter(Boolean).join(" ")}
      role="group"
      aria-labelledby={`${uid}-title`}
      data-level={level}
      onPointerLeave={() => setHot(null)}
    >
      <style href="ui-context-window" precedence="default">
        {css}
      </style>

      <div className="ui-cw__card">
        <div className="ui-cw__head">
          <span id={`${uid}-title`} className="ui-cw__title" title={title} dir="auto">
            {title}
          </span>
          {model && (
            <span className="ui-cw__model" title={model}>
              {modelIcon && <span className="ui-cw__model-icon">{modelIcon}</span>}
              <span>{model}</span>
            </span>
          )}
        </div>

        <div className="ui-cw__figure">
          <span className="ui-cw__big" aria-hidden="true">
            {tokens(shown["#figure"] ?? used)}
          </span>
          <span className="ui-cw__of" aria-hidden="true">
            <Swap id={hotPart ? hotPart.id : "total"}>{hotPart ? hotPart.label : `of ${plain(cap)} tokens`}</Swap>
          </span>
          <span className="ui-cw__pill" aria-hidden="true">
            {cap > 0 ? Math.round(((shown["#used"] ?? used) / cap) * 100) : 0}%
          </span>
          <span className="ui-cw__sr">
            {plain(used)} of {plain(cap)} tokens used,{" "}
            {Math.round(share * 100)} percent
          </span>
        </div>

        {/* The window as a field of cells – decorative, everything it shows is in the list */}
        <div
          className="ui-cw__field"
          aria-hidden="true"
          data-hot={hotPart ? "" : undefined}
          style={{ ["--ui-cw-cols" as string]: columns, ["--ui-cw-cols-narrow" as string]: Math.max(8, Math.round((columns * 2) / 3)) }}
        >
          {owner.map((index, i) => {
            const part = index === null ? null : list[index];
            return (
              <span
                key={i}
                className="ui-cw__cell"
                data-on={part && hot === part.id ? "" : undefined}
                data-busy={part && busy === part.id ? "" : undefined}
                data-free={part ? undefined : ""}
                style={{
                  ["--i" as string]: i,
                  ...(part ? { ["--ui-cw-color" as string]: part.color } : {}),
                }}
                onPointerEnter={(e) =>
                  e.pointerType === "mouse" && setHot(part ? part.id : null)
                }
              />
            );
          })}
        </div>

        <ul className="ui-cw__parts">
          {list.map((p) => {
            const canOpen = Boolean(p.items);
            const isOpen = opened === p.id;
            const main = (
              <>
                <span
                  className="ui-cw__swatch"
                  style={{ background: p.color }}
                />
                <span className="ui-cw__label" title={p.label}>
                  <span className="ui-cw__label-text" dir="auto">{p.label}</span>
                  {canOpen && (
                    <span className="ui-cw__open" data-open={isOpen ? "" : undefined}>
                      <ChevronIcon />
                    </span>
                  )}
                </span>
                {p.compact && !p.locked && (!isCompacted(p) || farewell?.id === p.id) && compactButton(p)}
                <span className="ui-cw__value" title={`${exact(p.tokens)} tokens`}>
                  {tokens(shown[p.id] ?? p.tokens)}
                </span>
              </>
            );
            return (
              <li
                key={p.id}
                className="ui-cw__part"
                data-hot={hot === p.id ? "" : undefined}
                data-dim={hot && hot !== p.id ? "" : undefined}
                onPointerEnter={(e) =>
                  e.pointerType === "mouse" && setHot(p.id)
                }
              >
                <div className="ui-cw__row">
                  {canOpen ? (
                    <button
                      type="button"
                      className="ui-cw__main"
                      aria-expanded={isOpen}
                      aria-controls={`${uid}-${p.id}`}
                      onClick={() => setOpened(isOpen ? null : p.id)}
                      onFocus={() => setHot(p.id)}
                      onBlur={() => setHot(null)}
                    >
                      {main}
                    </button>
                  ) : (
                    <div className="ui-cw__main">{main}</div>
                  )}
                </div>

                {p.items && (
                  <div
                    id={`${uid}-${p.id}`}
                    className="ui-cw__fold"
                    data-open={isOpen ? "" : undefined}
                    inert={!isOpen}
                  >
                    <div className="ui-cw__clip">
                      <Items partId={p.id} items={p.items} leaving={leaving} onRemove={onRemove} />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="ui-cw__foot">
        <span
          className="ui-cw__caption"
          aria-live="polite"
        >
          <Swap id={captionKey} tone={captionTone}>
            {caption}
          </Swap>
        </span>
        {action && (
          <button
            type="button"
            className="ui-cw__action"
            onClick={action.onClick}
            title={action.label}
          >
            <span className="ui-cw__action-label">{action.label}</span>
            <ArrowIcon />
          </button>
        )}
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-cw {
  --ui-cw-tray: #f0f0f0;
  --ui-cw-card: #ffffff;
  --ui-cw-line: #ececec;
  --ui-cw-ink: #171717;
  --ui-cw-text: #404040;
  --ui-cw-muted: #8f8f8f;
  --ui-cw-well: #f4f4f5;
  --ui-cw-free: #ededf0;
  --ui-cw-c1: #26262b;
  --ui-cw-c2: #8d8d95;
  --ui-cw-c3: #c4c4ca;
  --ui-cw-c4: #2f6bff;
  --ui-cw-c5: #a9c4ff;
  --ui-cw-c6: #5f5f66;
  --ui-cw-warn: #c2710c;
  --ui-cw-warn-bg: rgba(240, 160, 32, 0.14);
  --ui-cw-full: #b42318;
  --ui-cw-full-bg: rgba(229, 72, 77, 0.1);
  --ui-cw-ok: #18794e;
  --ui-cw-ok-bg: rgba(34, 160, 90, 0.11);
  --ui-cw-focus: rgba(23, 23, 23, 0.22);
  --ui-cw-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  max-width: 360px;
  min-width: 0;
  container-type: inline-size;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-cw-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-cw-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-cw *, .ui-cw *::before, .ui-cw *::after { box-sizing: border-box; }
:where(.ui-cw) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-cw button:focus-visible { outline: 2px solid var(--ui-cw-focus); outline-offset: 2px; }
.ui-cw svg { display: block; flex: none; }
.ui-cw b { font-weight: 500; color: var(--ui-cw-ink); }
.ui-cw ul { margin: 0; padding: 0; list-style: none; }
.ui-cw__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.ui-cw__card { position: relative; padding: 12px 14px 8px; border-radius: 16px; background: var(--ui-cw-card); box-shadow: 0 0 0 1px var(--ui-cw-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-cw__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 22px; }
.ui-cw__title { overflow: hidden; font-size: 13px; font-weight: 500; color: var(--ui-cw-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-cw__model { display: inline-flex; flex: none; align-items: center; gap: 5px; max-width: 62%; height: 20px; padding: 0 7px 0 6px; border-radius: 5px; background: var(--ui-cw-well); font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; line-height: 20px; color: var(--ui-cw-muted); white-space: nowrap; }
.ui-cw__model > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cw__model-icon { display: grid; flex: none; place-items: center; width: 12px; height: 12px; }
.ui-cw__model-icon > * { width: 12px; height: 12px; }

.ui-cw__figure { display: flex; align-items: baseline; gap: 7px; margin-top: 8px; }
.ui-cw__big { font-size: 24px; font-weight: 600; line-height: 30px; letter-spacing: -0.02em; color: var(--ui-cw-ink); font-variant-numeric: tabular-nums; }
.ui-cw__of { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-cw-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-cw__pill { align-self: baseline; flex: none; font-size: 12.5px; color: var(--ui-cw-muted); font-variant-numeric: tabular-nums; transition: color 300ms ease; }
.ui-cw[data-level="warn"] .ui-cw__pill { color: var(--ui-cw-warn); }
.ui-cw[data-level="full"] .ui-cw__pill { color: var(--ui-cw-full); }

/* The field: one cell per slice of the window. Changes sweep through it cell by cell */
.ui-cw__field { display: grid; grid-template-columns: repeat(var(--ui-cw-cols), minmax(0, 1fr)); gap: 2px; margin-top: 10px; }
.ui-cw__cell { aspect-ratio: 1; border-radius: 26%; background: var(--ui-cw-color); transition: background-color 380ms ease, opacity 220ms ease, transform 300ms var(--ui-cw-ease); transition-delay: calc(var(--i) * 2ms), 0ms, 0ms; }
.ui-cw__cell[data-free] { background: var(--ui-cw-free); }
.ui-cw__field[data-hot] .ui-cw__cell:not([data-on], [data-free]) { opacity: 0.22; }
.ui-cw__cell[data-on] { transform: scale(1.12); }
.ui-cw__cell[data-busy] { animation: ui-cw-wave 900ms ease-in-out infinite; animation-delay: calc(var(--i) * 15ms); }

/* ----- Parts ----- */
.ui-cw__parts { margin-top: 8px !important; }
.ui-cw__part { margin: 0 -8px; padding: 0 8px; border-radius: 10px; transition: background-color 160ms ease, opacity 220ms ease; }
.ui-cw__part[data-hot] { background: var(--ui-cw-well); }
.ui-cw__part[data-dim] { opacity: 0.55; }
.ui-cw__row { display: flex; align-items: center; gap: 8px; min-height: 30px; }
.ui-cw__main { display: flex; flex: 1; align-items: center; gap: 9px; min-width: 0; height: 30px; border-radius: 8px; }
.ui-cw__swatch { flex: none; width: 7px; height: 7px; border-radius: 26%; }
.ui-cw__label { display: flex; flex: 1; align-items: center; gap: 3px; min-width: 0; overflow: hidden; color: var(--ui-cw-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-cw__label-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cw__value { flex: none; min-width: 52px; text-align: right; color: var(--ui-cw-ink); font-variant-numeric: tabular-nums; }
.ui-cw__open { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: var(--ui-cw-muted); }
.ui-cw__chevron { transition: transform 300ms var(--ui-cw-ease); }
.ui-cw__open[data-open] .ui-cw__chevron { transform: rotate(180deg); }
.ui-cw__compact { display: inline-flex; align-items: center; gap: 5px; height: 22px; margin-right: -10px; padding: 0 6px 0 5px; border-radius: 7px; font-size: 12px; color: var(--ui-cw-muted); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease, opacity 200ms ease; }
.ui-cw__compact:hover:not(:disabled) { background: var(--ui-cw-line); color: var(--ui-cw-ink); }
.ui-cw__compact:disabled { cursor: default; opacity: 0.5; }
.ui-cw__compact[data-busy] { opacity: 1; color: var(--ui-cw-ink); }
.ui-cw__compact[data-done] { opacity: 1; color: var(--ui-cw-ok); }
.ui-cw__compact[data-leaving] { animation: ui-cw-leave 400ms var(--ui-cw-ease) both; }
.ui-cw__compact-icon { display: grid; place-items: center; width: 12px; height: 12px; animation: ui-cw-swap-in 300ms ease both; }
.ui-cw__compact-text { animation: ui-cw-swap-in 300ms ease both; }
.ui-cw__spinner { width: 12px; height: 12px; border: 1.5px solid var(--ui-cw-line); border-top-color: var(--ui-cw-ink); border-radius: 50%; animation: ui-cw-spin 700ms linear infinite; }

/* Items of a part unfold in place; a removed one folds away before it goes */
.ui-cw__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 420ms var(--ui-cw-ease), opacity 240ms ease; }
.ui-cw__fold[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 420ms var(--ui-cw-ease), opacity 320ms ease 80ms; }
.ui-cw__fold--item { transition-duration: 240ms, 180ms; }
.ui-cw__clip { min-height: 0; overflow: hidden; }
.ui-cw__items { padding: 0 0 8px 17px !important; }
.ui-cw__item { display: flex; align-items: center; gap: 8px; height: 28px; font-size: 12.5px; }
.ui-cw__item-label { flex: 1; min-width: 0; overflow: hidden; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11.5px; color: var(--ui-cw-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-cw__item-value { flex: none; color: var(--ui-cw-muted); font-variant-numeric: tabular-nums; }
.ui-cw__remove { display: grid; flex: none; place-items: center; width: 22px; height: 22px; border-radius: 7px; color: var(--ui-cw-muted); transition: background-color 160ms ease, color 160ms ease; }
.ui-cw__remove:hover { background: var(--ui-cw-full-bg); color: var(--ui-cw-full); }
.ui-cw__empty { height: 28px; font-size: 12.5px; line-height: 28px; color: var(--ui-cw-muted); }

/* ----- Tray ----- */
.ui-cw__foot { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 4px 4px 0 10px; }
.ui-cw__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-cw-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
/* Hovering a part: its name may shorten, its share of the window stays */
.ui-cw__hot { display: flex; min-width: 0; }
.ui-cw__hot > b { min-width: 32px; overflow: hidden; text-overflow: ellipsis; }
.ui-cw__hot > span { flex: none; white-space: pre; }
/* A long action label shortens, so the caption keeps its room */
.ui-cw__action-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cw__swap { display: grid; min-width: 0; }
.ui-cw__swap-item { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-cw-swap-in 320ms ease both; }
.ui-cw__swap-item[data-out] { animation: ui-cw-swap-out 220ms ease both; }
.ui-cw__swap-item[data-tone="ok"] { color: var(--ui-cw-ok); }
.ui-cw__swap-item[data-tone="ok"] b { color: inherit; }
.ui-cw__action { display: inline-flex; flex: 0 1 auto; align-items: center; min-width: 0; max-width: 50%; gap: 4px; height: 26px; padding: 0 6px 0 8px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: var(--ui-cw-text); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease; }
.ui-cw__action:hover { background: var(--ui-cw-card); color: var(--ui-cw-ink); }
.ui-cw__action svg { transition: transform 220ms var(--ui-cw-ease); }
.ui-cw__action:hover svg { transform: translateX(2px); }

@keyframes ui-cw-leave { to { opacity: 0; filter: blur(3px); transform: scale(0.92); } }
@keyframes ui-cw-swap-in { from { opacity: 0; filter: blur(2px); } }
@keyframes ui-cw-swap-out { from { opacity: 1; } to { opacity: 0; filter: blur(2px); } }
@keyframes ui-cw-wave { 0%, 100% { opacity: 1; transform: none; } 50% { opacity: 0.28; transform: scale(0.72); } }
@keyframes ui-cw-spin { to { transform: rotate(360deg); } }

/* Narrow cards: fewer cells per row so they stay readable, the model tag gives way and Compact keeps only its icon */
@container (max-width: 310px) {
  .ui-cw__model { max-width: 42%; }
  .ui-cw__field { grid-template-columns: repeat(var(--ui-cw-cols-narrow), minmax(0, 1fr)); }
  .ui-cw__compact { padding: 0 6px; }
  .ui-cw__compact-text { display: none; }
}

@media (pointer: coarse) {
  .ui-cw__row { min-height: 38px; }
  .ui-cw__main { height: 38px; }
  .ui-cw__compact { height: 30px; padding: 0 9px 0 7px; }
  .ui-cw__item { height: 34px; }
  .ui-cw__remove { width: 30px; height: 30px; }
  .ui-cw__action { height: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-cw *, .ui-cw *::before, .ui-cw *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cw {
  --ui-cw-tray: #111113;
  --ui-cw-card: #19191b;
  --ui-cw-line: #2a2a2e;
  --ui-cw-ink: #ededed;
  --ui-cw-text: #c8c8cc;
  --ui-cw-muted: #8b8b92;
  --ui-cw-well: #222225;
  --ui-cw-free: #2a2a2e;
  --ui-cw-c1: #e4e4e7;
  --ui-cw-c2: #8a8a92;
  --ui-cw-c3: #55555c;
  --ui-cw-c4: #4f82ff;
  --ui-cw-c5: #8fb1ff;
  --ui-cw-warn: #f5c264;
  --ui-cw-full: #ff9b93;
  --ui-cw-ok: #6ee7a8;
  --ui-cw-focus: rgba(255, 255, 255, 0.3);
}
`;
