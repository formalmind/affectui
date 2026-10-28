"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Context Map – what fills an agent's context window, as a treemap, in a single self-contained file.
 * A bar on top with the model and how full it is, one area of a fixed height below: every part of the context –
 * the system prompt, tools, memory, each file, the chat, tool results – a tile as large as its share of the tokens,
 * and what's left as a dashed free space.
 *   · tiles keep their order and glide as the context grows – sizes ease toward their new value and the whole map is
 *     laid out again every frame, so tiles never overlap; a new file grows in where it belongs, a removed one shrinks away
 *   · tinted by kind, with the Trace Waterfall recipe: a light tint and a hairline edge
 *   · point at a tile for its name, tokens, share and a line about it; small tiles show only their color
 *   · with agents, the name in the bar is a menu – switch to another agent and its window, e.g. one with 500k
 *   · after a compaction, Before and After in the bar: Before shows the map as it was, each block marked kept,
 *     summarized or dropped, After the map now with the summary they went into – switching glides between the two,
 *     and a line under the map adds it up
 *   · a status in the bar – e.g. "Compacting" – while the agent squeezes old turns into a summary
 * The styles are injected below, so no extra files are needed.
 */

export type ContextKind = "system" | "tools" | "memory" | "file" | "chat" | "result" | "summary";

export type ContextBlock = {
  id: string;
  /** What it is – e.g. "checkout.spec.ts" */
  label: string;
  kind: ContextKind;
  tokens: number;
  /** One line about it, shown on hover – e.g. "Read at 0:42" */
  detail?: string;
  /** A small mark, e.g. a file type icon or a company's logo – before the label */
  icon?: ReactNode;
  /** What's inside, listed on hover – e.g. the tools, each with its logo */
  items?: { label: string; icon?: ReactNode }[];
};

/** What a compaction did with a block */
export type ContextFate = "kept" | "summarized" | "dropped";

export type ContextCompaction = {
  /** The blocks just before it compacted */
  before: ContextBlock[];
  /** Ids folded into the summary */
  summarized?: string[];
  /** Ids left out altogether – every other block was kept */
  dropped?: string[];
  /** The id of the summary they went into (in blocks) */
  summary?: string;
};

export type ContextAgent = {
  id: string;
  /** e.g. "Checkout fixer" */
  name: string;
  /** The model it runs on – shown in the menu */
  model?: string;
  /** The model maker's logo */
  icon?: ReactNode;
  /** Its context window in tokens */
  limit: number;
};

export type ContextMapProps = {
  /** In the order they should sit – the free space always comes last */
  blocks: ContextBlock[];
  /** The context window's size in tokens – e.g. 200000 */
  limit: number;
  /** The model, next to the title */
  model?: string;
  /** The model maker's logo – on a small white tile before the model */
  modelIcon?: ReactNode;
  /** Agents to switch between – the bar shows the current one's name as a menu */
  agents?: ContextAgent[];
  /** The current agent's id */
  agent?: string;
  onAgentChange?: (id: string) => void;
  /**
   * The last compaction, to compare before and after – null shows the line for it while there's none yet, so the
   * component keeps its height when one happens
   */
  compaction?: ContextCompaction | null;
  /** Controlled: which side of the compaction shows */
  view?: "before" | "after";
  onViewChange?: (view: "before" | "after") => void;
  /** A short status in the bar – e.g. "Compacting" */
  status?: string;
  onSelect?: (block: ContextBlock | null) => void;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

/** The nearest box around an element that cuts off what sticks out – e.g. a card – else the viewport */
const clipRect = (el: Element) => {
  let clip = el.parentElement;
  while (clip && clip !== document.body && getComputedStyle(clip).overflow === "visible") clip = clip.parentElement;
  return clip && clip !== document.body ? clip.getBoundingClientRect() : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
};

/** The word on a tile, before a compaction */
const TILE_FATE: Record<ContextFate, string> = { kept: "· kept", summarized: "· summarized", dropped: "· dropped" };

/* Kept as it was: a tick */
const Kept = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.5 6.3 2.3 2.2 4.7-5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
/* Dropped: a cross */
const Dropped = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m3.2 3.2 5.6 5.6M8.8 3.2 3.2 8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
/* Folded into the summary: two arrows pressing together */
const Folded = () => (
  <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M6 1.5v3.2M4.4 3.3 6 4.9l1.6-1.6M6 10.5V7.3M4.4 8.7 6 7.1l1.6 1.6M2 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const FATE_ICON = { kept: Kept, summarized: Folded, dropped: Dropped } as const;
const KIND: Record<ContextKind, string> = { system: "System prompt", tools: "Tools", memory: "Memory", file: "File", chat: "Chat", result: "Tool result", summary: "Summary" };
const FREE = "__free";
const tokens = (n: number) => (n >= 100_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)));

type Rect = { x: number; y: number; w: number; h: number };
type Item = { id: string; value: number };

/**
 * An ordered treemap: split the list where its weight halves, along the longer side, and again in each half.
 * It keeps the order, so tiles stay where they are as they grow – a squarified layout would shuffle them.
 */
const layout = (items: Item[], r: Rect, out: Map<string, Rect>) => {
  if (!items.length) return;
  if (items.length === 1) {
    out.set(items[0].id, r);
    return;
  }
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  let acc = 0;
  let cut = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].value;
    cut = i + 1;
    if (acc >= total / 2) break;
  }
  const share = items.slice(0, cut).reduce((s, i) => s + i.value, 0) / total;
  if (r.w >= r.h) {
    const w = r.w * share;
    layout(items.slice(0, cut), { x: r.x, y: r.y, w, h: r.h }, out);
    layout(items.slice(cut), { x: r.x + w, y: r.y, w: r.w - w, h: r.h }, out);
  } else {
    const h = r.h * share;
    layout(items.slice(0, cut), { x: r.x, y: r.y, w: r.w, h }, out);
    layout(items.slice(cut), { x: r.x, y: r.y + h, w: r.w, h: r.h - h }, out);
  }
};

/* ---------- Icons ---------- */

/* A small map mark for the title (drawn for affectUI) */
/* A spinner of eight spokes pointing to the center, each fainter than the one before */
const Spinner = () => (
  <svg className="ui-cmc__spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    {Array.from({ length: 8 }, (_, i) => (
      <line key={i} x1="8" y1="1.75" x2="8" y2="4.75" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity={1 - i * 0.11} transform={`rotate(${-i * 45} 8 8)`} />
    ))}
  </svg>
);

const MapMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="1.8" y="1.8" width="7" height="12.4" rx="1.6" fill="currentColor" />
    <rect x="10" y="1.8" width="4.2" height="6" rx="1.4" fill="currentColor" opacity="0.6" />
    <rect x="10" y="9" width="4.2" height="5.2" rx="1.4" fill="currentColor" opacity="0.3" />
  </svg>
);

export function ContextMap({ blocks: live, limit: windowSize, model, modelIcon, agents, agent, onAgentChange, compaction, view: viewProp, onViewChange, status, onSelect, title = "Context", className }: ContextMapProps) {
  const label = useId();
  const current = agents?.find((a) => a.id === agent) ?? agents?.[0];
  const limit = current?.limit ?? windowSize;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLSpanElement>(null);

  // The agent menu opens under its button, moved left as far as it takes to stay inside the box around it
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!menu || !list) return;
    list.style.left = "0px";
    // Measured without the opening animation's scale
    const over = list.parentElement!.getBoundingClientRect().left + list.offsetWidth - (clipRect(list).right - 8);
    if (over > 0) list.style.left = `${-over}px`;
  }, [menu]);

  // The agent menu closes on a click outside or Escape
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  const areaRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<string | null>(null);
  // A card pinned with a click – it stays until it's clicked again, Escape, or its block leaves the map
  const [pinned, setPinned] = useState<string | null>(null);
  useEffect(() => {
    if (!pinned) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPinned(null);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [pinned]);

  // Before or after the last compaction – before, the map shows the blocks as they were
  const [ownView, setOwnView] = useState<"before" | "after">("after");
  const view = compaction ? (viewProp ?? ownView) : "after";
  const setView = (v: "before" | "after") => {
    setOwnView(v);
    onViewChange?.(v);
  };
  // A new compaction (or none) shows what's there now
  useEffect(() => setOwnView("after"), [compaction]);
  const fateOf = (id: string): ContextFate => (compaction?.summarized?.includes(id) ? "summarized" : compaction?.dropped?.includes(id) ? "dropped" : "kept");
  const blocks = view === "before" && compaction ? compaction.before : live;
  const tipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const used = blocks.reduce((s, b) => s + Math.max(0, b.tokens), 0);
  const free = Math.max(0, limit - used);
  const share = used / limit;
  const level = share >= 0.95 ? "full" : share >= 0.8 ? "high" : undefined;

  /* ---------- Motion: the sizes ease toward their targets, the map is laid out again every frame ---------- */

  // Every block seen so far – a removed one keeps its looks while it shrinks away
  const known = useRef(new Map<string, ContextBlock>());
  for (const b of blocks) known.current.set(b.id, b);
  // The order tiles sit in: new ones join where the list puts them, removed ones keep their place until they're gone
  const order = useRef<string[]>([]);
  const ids = blocks.filter((b) => b.tokens > 0).map((b) => b.id);
  {
    const next = [...order.current];
    ids.forEach((id, i) => {
      if (next.includes(id)) return;
      // A new one goes right after the one before it in your list
      const before = ids.slice(0, i).reverse().find((x) => next.includes(x));
      next.splice(before ? next.indexOf(before) + 1 : 0, 0, id);
    });
    order.current = next;
  }
  const target = new Map<string, number>([...order.current.map((id): [string, number] => [id, Math.max(0, blocks.find((b) => b.id === id)?.tokens ?? 0)]), [FREE, free]]);
  const shown = useRef(new Map<string, number>());
  const [, setFrame] = useState(0);
  // The last frame's time – kept across renders, so every step eases by the real time since the one before
  const lastFrame = useRef(0);
  useEffect(() => {
    let raf = 0;
    const step = (now: number) => {
      const dt = lastFrame.current ? Math.min(64, Math.max(0, now - lastFrame.current)) : 16;
      lastFrame.current = now;
      const k = 1 - Math.exp(-dt / 110);
      let moving = false;
      for (const [id, to] of target) {
        const from = shown.current.get(id) ?? 0;
        const v = Math.abs(to - from) < 1 ? to : from + (to - from) * k;
        if (v !== to) moving = true;
        shown.current.set(id, v);
      }
      // Gone and shrunk to nothing: out of the map
      for (const id of [...shown.current.keys()]) {
        if (!target.has(id)) shown.current.delete(id);
        else if (id !== FREE && (target.get(id) ?? 0) === 0 && (shown.current.get(id) ?? 0) === 0) order.current = order.current.filter((x) => x !== id);
      }
      setFrame((f) => f + 1);
      if (moving) raf = requestAnimationFrame(step);
      else lastFrame.current = 0;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });

  // The tiles in their order, the free space last
  const items: Item[] = [...order.current, FREE].map((id) => ({ id, value: shown.current.get(id) ?? 0 })).filter((i) => i.value > 0.5);
  const rects = new Map<string, Rect>();
  // A small inset, so the tiles keep the same gap to the area's edge as to each other
  if (size.w && size.h) layout(items, { x: 3, y: 3, w: size.w - 6, h: size.h - 6 }, rects);
  // The pinned card goes once its block has left the map
  if (pinned && !order.current.includes(pinned)) setPinned(null);
  // Pointing shows a card; without that, the pinned one shows
  const showing = hover && hover !== FREE ? hover : pinned;
  const hovered = showing ? (known.current.get(showing) ?? null) : null;

  // The window over a tile: above it, else below it, else over the tile itself. It may leave the map, but never the
  // nearest box that clips – e.g. a card the map sits in – so it's never cut off
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const area = areaRef.current;
    const r = showing ? rects.get(showing) : undefined;
    if (!tip || !area || !r) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const a = area.getBoundingClientRect();
    const c = clipRect(area);
    const box = { l: c.left - a.left + 8, t: c.top - a.top + 8, r: c.right - a.left - 8, b: c.bottom - a.top - 8 };
    const x = Math.max(box.l, Math.min(r.x + r.w / 2 - w / 2, box.r - w));
    const above = r.y - h - 8;
    const below = r.y + r.h + 8;
    const top = above >= box.t ? above : below + h <= box.b ? below : Math.max(box.t, Math.min(r.y + 8, box.b - h));
    tip.style.left = `${x}px`;
    tip.style.top = `${top}px`;
  });

  return (
    <div className={["ui-cmc", className].filter(Boolean).join(" ")}>
      <style href="ui-context-map-clean" precedence="default">
        {css}
      </style>

      <header className="ui-cmc__bar">
        <span className="ui-cmc__mark">
          <MapMark />
        </span>
        <span className="ui-cmc__title" id={label}>
          {title}
        </span>
        {current ? (
          <span className="ui-cmc__pick" ref={menuRef}>
            <button type="button" className="ui-cmc__who ui-cmc__agent" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {current.icon && (
                <span className="ui-cmc__logo" aria-hidden="true">
                  {current.icon}
                </span>
              )}
              <span className="ui-cmc__model">{current.name}</span>
              <span className="ui-cmc__limit">{tokens(limit)}</span>
              <svg className="ui-cmc__chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="m3.5 4.75 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menu && (
              <span ref={listRef} className="ui-cmc__menu" role="menu">
                {agents!.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={a.id === current.id}
                    className="ui-cmc__option"
                    onClick={() => {
                      setMenu(false);
                      if (a.id !== current.id) onAgentChange?.(a.id);
                    }}
                  >
                    <span className="ui-cmc__logo" aria-hidden="true">
                      {a.icon}
                    </span>
                    <span className="ui-cmc__option-text">
                      <span className="ui-cmc__option-name">{a.name}</span>
                      {a.model && <span className="ui-cmc__option-model">{a.model}</span>}
                    </span>
                    <span className="ui-cmc__limit">{tokens(a.limit)}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
        ) : (model || modelIcon) && (
          <span className="ui-cmc__who">
            {modelIcon && (
              <span className="ui-cmc__logo" aria-hidden="true">
                {modelIcon}
              </span>
            )}
            {model && <span className="ui-cmc__model">{model}</span>}
            {/* The window's size as a small tag */}
            <span className="ui-cmc__limit">{tokens(limit)}</span>
          </span>
        )}
        {status && (
          <span className="ui-cmc__status" key={status}>
            <Spinner />
            {status}
          </span>
        )}
        <span className="ui-cmc__sum">
          {/* In the count's row – so on phones, where that row is the whole width, it never adds a line */}
          {compaction && (
            <span className="ui-cmc__compare" role="group" aria-label="Compaction">
              {(["before", "after"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "before" ? "Before" : "After"}
                </button>
              ))}
            </span>
          )}
          <span>
            {/* What's used, with a shine running over it */}
            <b className="ui-cmc__used">{tokens(used)}</b> / {tokens(limit)}
          </span>
          <span className="ui-cmc__pct" data-level={level}>
            {Math.round(share * 100)}%
          </span>
        </span>
      </header>

      <div ref={areaRef} className="ui-cmc__area" role="list" aria-labelledby={label} onMouseLeave={() => setHover(null)}>
        {items.map((it) => {
          const r = rects.get(it.id);
          if (!r) return null;
          const b = known.current.get(it.id);
          const isFree = it.id === FREE;
          // Each line shows only while there's room for it – it fades out before the tile would cut it
          const name = r.w >= 54 && r.h >= 28;
          const second = name && r.h >= 44;
          const kind = second && r.w >= 120;
          return (
            <div
              key={it.id}
              role="listitem"
              className="ui-cmc__tile"
              data-kind={isFree ? "free" : b?.kind}
              data-fate={
                isFree || !compaction
                  ? undefined
                  : view === "before"
                    ? compaction.before.some((x) => x.id === it.id)
                      ? fateOf(it.id)
                      : undefined
                    : it.id === compaction.summary
                      ? "summary"
                      : undefined
              }
              data-dim={hover && hover !== it.id ? "" : undefined}

              style={{ "--x": `${r.x}px`, "--y": `${r.y}px`, "--w": `${r.w}px`, "--h": `${r.h}px` } as CSSProperties}
              aria-label={isFree ? `Free – ${tokens(it.value)} tokens` : `${b?.label}, ${KIND[b!.kind]} – ${tokens(it.value)} tokens`}
              onMouseEnter={() => setHover(it.id)}
              data-pinned={pinned === it.id ? "" : undefined}
              onClick={() => {
                if (isFree) return onSelect?.(null);
                // A click pins its card – a second one lets it go
                setPinned((p) => (p === it.id ? null : it.id));
                onSelect?.(b ?? null);
              }}
            >
              {view === "before" && compaction?.before.some((x) => x.id === it.id) && fateOf(it.id) === "summarized" && r.w >= 40 && r.h >= 28 && (
                <span className="ui-cmc__badge" title="Summarized – click for more" aria-hidden="true">
                  <Folded />
                </span>
              )}
              <span className="ui-cmc__label" aria-hidden="true">
                <span className="ui-cmc__name" data-show={name ? "" : undefined}>
                  {b?.icon && !isFree && <span className="ui-cmc__icon">{b.icon}</span>}
                  {isFree ? "Free" : b?.label}
                </span>
                <span className="ui-cmc__tokens" data-show={second ? "" : undefined}>
                  {tokens(target.get(it.id) || it.value)}
                  {!isFree && b && (
                    <span className="ui-cmc__kind" data-show={kind ? "" : undefined}>
                      {" "}
                      {view === "before" && compaction?.before.some((x) => x.id === it.id) ? (
                        <Roll k={fateOf(it.id)}>
                          <span data-fate={fateOf(it.id)}>{TILE_FATE[fateOf(it.id)]}</span>
                        </Roll>
                      ) : (
                        <Roll k="kind">· {KIND[b.kind]}</Roll>
                      )}
                    </span>
                  )}
                </span>
              </span>
            </div>
          );
        })}

        {hovered && (
          <div ref={tipRef} className="ui-cmc__tip" key={hovered.id} role="tooltip">
            <span className="ui-cmc__tip-head">
              {hovered.icon ? (
                <span className="ui-cmc__logo" aria-hidden="true">
                  {hovered.icon}
                </span>
              ) : (
                <span className="ui-cmc__swatch" data-kind={hovered.kind} aria-hidden="true" />
              )}
              <span className="ui-cmc__tip-name">{hovered.label}</span>
            </span>
            <span className="ui-cmc__tip-meta">
              {KIND[hovered.kind]} · {tokens(hovered.tokens)} tokens · {Math.round((hovered.tokens / limit) * 1000) / 10}%
            </span>
            {hovered.detail && <span className="ui-cmc__tip-detail">{hovered.detail}</span>}
            {compaction && view === "before" && compaction.before.some((x) => x.id === hovered.id) && (
              <span className="ui-cmc__tip-fate" data-fate={fateOf(hovered.id)}>
                {(() => {
                  const FateIcon = FATE_ICON[fateOf(hovered.id)];
                  return <FateIcon />;
                })()}
                {fateOf(hovered.id) === "summarized" ? "Folded into the summary" : fateOf(hovered.id) === "dropped" ? "Dropped when it compacted" : "Kept as it was"}
              </span>
            )}
            {compaction && view === "after" && hovered.id === compaction.summary && (
              <span className="ui-cmc__tip-fate" data-fate="summary">
                <Folded />
                From {compaction.summarized?.length ?? 0} blocks, {tokens(compaction.before.filter((b) => compaction.summarized?.includes(b.id)).reduce((t, b) => t + b.tokens, 0))} before
              </span>
            )}
            {hovered.items && hovered.items.length > 0 && (
              <ul className="ui-cmc__tip-items">
                {hovered.items.map((item) => (
                  <li key={item.label}>
                    {item.icon && (
                      <span className="ui-cmc__logo" aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* What the last compaction did, added up – the same line on both sides, so nothing moves when you switch */}
      {compaction !== undefined && <Fates compaction={compaction} after={live} />}
    </div>
  );
}

/** Text that rolls when it changes: the old one slides up and fades out, the new one comes in from below */
function Roll({ k, children }: { k: string; children: ReactNode }) {
  const last = useRef({ k, node: children });
  const [out, setOut] = useState<{ k: string; node: ReactNode } | null>(null);
  if (last.current.k !== k) {
    const gone = last.current;
    last.current = { k, node: children };
    setOut(gone);
  } else last.current.node = children;
  useEffect(() => {
    if (!out) return;
    const id = window.setTimeout(() => setOut(null), 360);
    return () => clearTimeout(id);
  }, [out]);
  return (
    <span className="ui-cmc__roll">
      {out && (
        <span className="ui-cmc__roll-out" key={`out-${out.k}`} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span className="ui-cmc__roll-in" key={k} data-rolling={out ? "" : undefined}>
        {children}
      </span>
    </span>
  );
}

/** "186k → 54k · 7 kept 112k · 3 summarized 66k into 8.6k · 1 dropped 15.6k" */
function Fates({ compaction, after }: { compaction: ContextCompaction | null; after: ContextBlock[] }) {
  if (!compaction)
    return (
      <div className="ui-cmc__fates-row">
        <Roll k="none">
          <p className="ui-cmc__fates ui-cmc__fates--none">Not compacted yet – once it is, compare before and after here.</p>
        </Roll>
      </div>
    );
  const sum = (list: ContextBlock[]) => list.reduce((t, b) => t + Math.max(0, b.tokens), 0);
  const of = (fate: ContextFate) =>
    compaction.before.filter((b) => (compaction.summarized?.includes(b.id) ? "summarized" : compaction.dropped?.includes(b.id) ? "dropped" : "kept") === fate);
  const kept = of("kept");
  const summarized = of("summarized");
  const dropped = of("dropped");
  const summary = after.find((b) => b.id === compaction.summary);
  return (
    <div className="ui-cmc__fates-row">
      <Roll k="done">
    <p className="ui-cmc__fates">
      <b>
        {tokens(sum(compaction.before))} → {tokens(sum(after))}
      </b>
      <span className="ui-cmc__fate" data-fate="kept">
        {kept.length} kept · {tokens(sum(kept))}
      </span>
      {summarized.length > 0 && (
        <span className="ui-cmc__fate" data-fate="summarized">
          {summarized.length} summarized · {tokens(sum(summarized))}
          {summary && <> into {tokens(summary.tokens)}</>}
        </span>
      )}
      {dropped.length > 0 && (
        <span className="ui-cmc__fate" data-fate="dropped">
          {dropped.length} dropped · {tokens(sum(dropped))}
        </span>
      )}
    </p>
      </Roll>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-cmc */
.ui-cmc {
  --ui-cmc-panel: #ffffff;
  --ui-cmc-card: #ffffff;
  --ui-cmc-strong: #000000;
  --ui-cmc-ink: rgba(0, 0, 0, 0.88);
  --ui-cmc-text: rgba(0, 0, 0, 0.61);
  --ui-cmc-muted: rgba(0, 0, 0, 0.45);
  --ui-cmc-faint: rgba(0, 0, 0, 0.27);
  --ui-cmc-line: rgba(0, 0, 0, 0.06);
  --ui-cmc-accent: rgba(0, 96, 226, 0.765);
  --ui-cmc-shine: rgba(0, 0, 0, 0.22);
  --ui-cmc-hover: rgba(0, 0, 0, 0.045);
  --ui-cmc-high: #cc4e00;
  --ui-cmc-high-bg: #ff9c0024;
  --ui-cmc-full: #d72400da;
  --ui-cmc-full-bg: #f52b0018;
  /* Tiles by kind: a tint, its hairline edge and the ink on it – the Trace Waterfall recipe */
  --ui-cmc-system-bg: rgba(0, 0, 0, 0.05);
  --ui-cmc-system-edge: rgba(0, 0, 0, 0.11);
  --ui-cmc-system-ink: rgba(0, 0, 0, 0.61);
  --ui-cmc-tools-bg: rgba(0, 123, 172, 0.085);
  --ui-cmc-tools-edge: rgba(0, 123, 172, 0.28);
  --ui-cmc-tools-ink: #006a94;
  --ui-cmc-memory-bg: rgba(91, 91, 214, 0.1);
  --ui-cmc-memory-edge: rgba(91, 91, 214, 0.3);
  --ui-cmc-memory-ink: #4a4ac2;
  --ui-cmc-file-bg: rgba(0, 96, 226, 0.08);
  --ui-cmc-file-edge: rgba(0, 96, 226, 0.26);
  --ui-cmc-file-ink: #0058cf;
  --ui-cmc-chat-bg: rgba(142, 78, 198, 0.09);
  --ui-cmc-chat-edge: rgba(142, 78, 198, 0.28);
  --ui-cmc-chat-ink: #7b3fb0;
  --ui-cmc-result-bg: rgba(255, 156, 0, 0.13);
  --ui-cmc-result-edge: rgba(214, 120, 0, 0.36);
  --ui-cmc-result-ink: #b35400;
  --ui-cmc-summary-bg: rgba(0, 164, 51, 0.13);
  --ui-cmc-summary-edge: rgba(0, 140, 50, 0.34);
  --ui-cmc-summary-ink: #007d2e;
  --ui-cmc-free-edge: rgba(0, 0, 0, 0.14);
  --ui-cmc-free-hatch: rgba(0, 0, 0, 0.035);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-cmc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cmc-button: var(--ui-cmc-shadow);
  --ui-cmc-button-hover: 0 0 0 0.5px rgba(0, 0, 0, 0.09), 0 1px 1px -1px rgba(0, 0, 0, 0.12), 0 1px 3px 0 rgba(0, 0, 0, 0.07);
  --ui-cmc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-cmc-height: 280px;
  --ui-cmc-gap: 3px;
  --ui-cmc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  container: ui-cmc / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-cmc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-cmc *, .ui-cmc *::before, .ui-cmc *::after { box-sizing: border-box; }

/* ----- The bar: the model, the status, how full it is ----- */
.ui-cmc__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin-bottom: 16px; }
.ui-cmc__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-cmc-accent); }
.ui-cmc__title { flex: none; font-weight: 500; color: var(--ui-cmc-strong); }
.ui-cmc__who { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
/* The model maker's logo on a small white tile */
.ui-cmc__logo { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border-radius: 5px; background: var(--ui-cmc-card); box-shadow: var(--ui-cmc-shadow); }
.ui-cmc__logo > svg { width: 11px; height: 11px; }
.ui-cmc__model { min-width: 0; overflow: hidden; color: var(--ui-cmc-text); white-space: nowrap; text-overflow: ellipsis; }
/* The agent menu */
.ui-cmc__pick { position: relative; display: inline-flex; min-width: 0; }
.ui-cmc__agent { min-width: 0; height: 28px; margin: -4px 0; padding: 0 6px 0 8px; border: 0; border-radius: 8px; background: var(--ui-cmc-card); box-shadow: var(--ui-cmc-button); font: inherit; color: inherit; cursor: pointer; transition: box-shadow 160ms ease; }
.ui-cmc__agent:hover, .ui-cmc__agent[aria-expanded="true"] { box-shadow: var(--ui-cmc-button-hover); }
.ui-cmc__agent .ui-cmc__logo { width: 14px; height: 14px; border-radius: 0; background: none; box-shadow: none; }
.ui-cmc__agent .ui-cmc__logo > svg { width: 14px; height: 14px; }
.ui-cmc__agent:focus-visible, .ui-cmc__option:focus-visible { outline: 2px solid var(--ui-cmc-accent); outline-offset: 1px; }
.ui-cmc__chev { flex: none; width: 12px; height: 12px; margin-left: -2px; color: var(--ui-cmc-muted); transition: transform 180ms var(--ui-cmc-ease); }
.ui-cmc__agent[aria-expanded="true"] .ui-cmc__chev { transform: rotate(180deg); }
.ui-cmc__menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 6; display: grid; gap: 1px; width: 250px; padding: 4px; border-radius: 10px; background: var(--ui-cmc-card); box-shadow: var(--ui-cmc-shadow); animation: ui-cmc-tip 160ms var(--ui-cmc-ease) both; }
.ui-cmc__option { display: flex; align-items: center; gap: 9px; width: 100%; padding: 6px 8px 6px 6px; border: 0; border-radius: 7px; background: none; font: inherit; text-align: left; color: inherit; cursor: pointer; }
.ui-cmc__option:hover { background: var(--ui-cmc-hover); }
.ui-cmc__option[aria-checked="true"] { background: var(--ui-cmc-hover); }
.ui-cmc__option-text { display: grid; flex: 1; min-width: 0; }
.ui-cmc__option-name { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 17px; color: var(--ui-cmc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cmc__option-model { font-size: 11.5px; line-height: 15px; color: var(--ui-cmc-muted); }
.ui-cmc__option .ui-cmc__logo { width: 24px; height: 24px; border-radius: 6px; }
.ui-cmc__option .ui-cmc__logo > svg { width: 13px; height: 13px; }
.ui-cmc__limit { flex: none; height: 18px; padding: 0 6px; border-radius: 4px; background: var(--ui-cmc-hover); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-cmc-text); font-variant-numeric: tabular-nums; }
.ui-cmc__status { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 20px; padding: 0 7px 0 6px; border-radius: 5px; background: var(--ui-cmc-summary-bg); font-size: 11.5px; font-weight: 500; color: var(--ui-cmc-summary-ink); animation: ui-cmc-fade 240ms ease both; }
.ui-cmc__sum { display: flex; align-items: center; gap: 10px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-cmc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-cmc__sum b { font-weight: 500; color: var(--ui-cmc-ink); }
/* The used count: a shine sweeping over it, all the time */
.ui-cmc__used { background: linear-gradient(90deg, var(--ui-cmc-ink) 0%, var(--ui-cmc-ink) 38%, var(--ui-cmc-shine) 50%, var(--ui-cmc-ink) 62%, var(--ui-cmc-ink) 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent !important; animation: ui-cmc-shine 1100ms linear infinite; }
.ui-cmc__pct { min-width: 36px; height: 20px; padding: 0 6px; border-radius: 5px; background: rgba(0, 0, 0, 0.05); font-size: 11.5px; font-weight: 500; line-height: 20px; color: var(--ui-cmc-text); text-align: center; transition: background-color 300ms ease, color 300ms ease; }
.ui-cmc__pct[data-level="high"] { background: var(--ui-cmc-high-bg); color: var(--ui-cmc-high); }
.ui-cmc__pct[data-level="full"] { background: var(--ui-cmc-full-bg); color: var(--ui-cmc-full); }
/* Before | After a compaction */
.ui-cmc__compare { display: inline-flex; flex: none; gap: 1px; padding: 2px; border-radius: 7px; background: var(--ui-cmc-hover); }
.ui-cmc__compare { margin: -2px 0; animation: ui-cmc-fade 280ms ease both; }
/* Rolling text: both sit in one cell, the old one leaves upward as the new one rises in */
.ui-cmc__roll { display: inline-grid; vertical-align: top; overflow: hidden; }
.ui-cmc__roll > * { grid-area: 1 / 1; }
.ui-cmc__roll-in[data-rolling] { animation: ui-cmc-roll-in 340ms var(--ui-cmc-ease) both; }
.ui-cmc__roll-out { animation: ui-cmc-roll-out 300ms var(--ui-cmc-ease) both; pointer-events: none; }
.ui-cmc__fates-row { display: grid; }
.ui-cmc__fates-row > .ui-cmc__roll { display: grid; }
@keyframes ui-cmc-roll-in { from { opacity: 0; transform: translateY(80%); } }
@keyframes ui-cmc-roll-out { to { opacity: 0; transform: translateY(-80%); } }
.ui-cmc__compare button { height: 20px; padding: 0 9px; border: 0; border-radius: 5px; background: none; font: inherit; font-size: 11.5px; font-weight: 500; color: var(--ui-cmc-muted); cursor: pointer; transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }
.ui-cmc__compare button:hover { color: var(--ui-cmc-ink); }
.ui-cmc__compare button[aria-pressed="true"] { background: var(--ui-cmc-card); color: var(--ui-cmc-ink); box-shadow: var(--ui-cmc-shadow); }
.ui-cmc__compare button:focus-visible { outline: 2px solid var(--ui-cmc-accent); outline-offset: 1px; }

/* ----- The area: one tile per part, placed by the layout, gliding when it changes ----- */
.ui-cmc__area { position: relative; height: var(--ui-cmc-height); padding: 0; border-radius: 10px; background: var(--ui-cmc-panel); box-shadow: var(--ui-cmc-shadow); }
.ui-cmc__tile { position: absolute; left: 0; top: 0; width: max(0px, calc(var(--w) - var(--ui-cmc-gap))); height: max(0px, calc(var(--h) - var(--ui-cmc-gap))); border-radius: 6px; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); overflow: hidden; transform: translate(calc(var(--x) + var(--ui-cmc-gap) / 2), calc(var(--y) + var(--ui-cmc-gap) / 2)); transition: opacity 200ms ease, background-color 300ms ease; cursor: default; }
/* The free space: dashed, with a faint hatch */
.ui-cmc__tile[data-kind="free"] { background: repeating-linear-gradient(135deg, transparent 0 6px, var(--ui-cmc-free-hatch) 6px 7px); box-shadow: inset 0 0 0 0.5px var(--ui-cmc-free-edge); outline: 1px dashed var(--ui-cmc-free-edge); outline-offset: -3px; }
.ui-cmc__tile[data-dim] { opacity: 0.55; }
/* The label: no ellipsis – a line that runs into the edge fades out, and a line without room fades away before it's cut */
.ui-cmc__label { position: absolute; top: 7px; right: 0; left: 9px; display: grid; min-width: 0; pointer-events: none; }
.ui-cmc__name, .ui-cmc__tokens { overflow: hidden; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent calc(100% - 4px)); mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent calc(100% - 4px)); opacity: 0; transition: opacity 220ms ease; }
.ui-cmc__name { font-size: 12px; font-weight: 500; line-height: 16px; color: var(--k-ink); }
.ui-cmc__tokens { font-size: 11.5px; line-height: 15px; color: var(--k-ink); font-variant-numeric: tabular-nums; }
.ui-cmc__name[data-show] { opacity: 1; }
.ui-cmc__tokens[data-show] { opacity: 0.7; }
.ui-cmc__kind { opacity: 0; transition: opacity 220ms ease; }
.ui-cmc__kind[data-show] { opacity: 1; }
.ui-cmc__tile[data-kind="free"] :is(.ui-cmc__name, .ui-cmc__tokens) { color: var(--ui-cmc-muted); }

/* Every kind's colors in one place */
.ui-cmc [data-kind="system"] { --k-bg: var(--ui-cmc-system-bg); --k-edge: var(--ui-cmc-system-edge); --k-ink: var(--ui-cmc-system-ink); }
.ui-cmc [data-kind="tools"] { --k-bg: var(--ui-cmc-tools-bg); --k-edge: var(--ui-cmc-tools-edge); --k-ink: var(--ui-cmc-tools-ink); }
.ui-cmc [data-kind="memory"] { --k-bg: var(--ui-cmc-memory-bg); --k-edge: var(--ui-cmc-memory-edge); --k-ink: var(--ui-cmc-memory-ink); }
.ui-cmc [data-kind="file"] { --k-bg: var(--ui-cmc-file-bg); --k-edge: var(--ui-cmc-file-edge); --k-ink: var(--ui-cmc-file-ink); }
.ui-cmc [data-kind="chat"] { --k-bg: var(--ui-cmc-chat-bg); --k-edge: var(--ui-cmc-chat-edge); --k-ink: var(--ui-cmc-chat-ink); }
.ui-cmc [data-kind="result"] { --k-bg: var(--ui-cmc-result-bg); --k-edge: var(--ui-cmc-result-edge); --k-ink: var(--ui-cmc-result-ink); }
.ui-cmc [data-kind="summary"] { --k-bg: var(--ui-cmc-summary-bg); --k-edge: var(--ui-cmc-summary-edge); --k-ink: var(--ui-cmc-summary-ink); }

/* ----- The window over a tile ----- */
.ui-cmc__tip { position: absolute; top: 0; left: 0; z-index: 5; display: grid; gap: 2px; width: max-content; max-width: 300px; padding: 9px 12px 10px; border-radius: 10px; background: var(--ui-cmc-card); box-shadow: var(--ui-cmc-pop); pointer-events: none; animation: ui-cmc-tip 160ms var(--ui-cmc-ease) both; }
.ui-cmc__tip-head { display: flex; align-items: center; gap: 7px; min-width: 0; }
.ui-cmc__swatch { flex: none; width: 9px; height: 9px; border-radius: 2.5px; background: var(--k-bg); box-shadow: inset 0 0 0 0.5px var(--k-edge); }
.ui-cmc__tip-name { overflow: hidden; font-weight: 500; color: var(--ui-cmc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cmc__tip-meta { font-size: 12px; line-height: 16px; color: var(--ui-cmc-muted); font-variant-numeric: tabular-nums; }
/* What's inside: each with its logo, in two columns */
.ui-cmc__tip-items { display: grid; grid-template-columns: repeat(2, max-content); gap: 6px 16px; margin: 7px 0 0; padding: 8px 0 0; border-top: 0.5px solid var(--ui-cmc-line); list-style: none; }
.ui-cmc__tip-items li { display: flex; align-items: center; gap: 7px; font-size: 12px; line-height: 18px; color: var(--ui-cmc-text); white-space: nowrap; }
.ui-cmc__tip-items .ui-cmc__logo, .ui-cmc__tip-head .ui-cmc__logo { width: 18px; height: 18px; color: var(--ui-cmc-ink); }
.ui-cmc__tip-items .ui-cmc__logo > svg, .ui-cmc__tip-head .ui-cmc__logo > svg { width: 10px; height: 10px; }
.ui-cmc__icon { display: inline-flex; vertical-align: -2px; margin-right: 5px; }
.ui-cmc__icon > svg { width: 12px; height: 12px; border-radius: 3px; }
.ui-cmc__tip-detail { font-size: 12.5px; line-height: 18px; color: var(--ui-cmc-text); }
/* What the compaction did with the block, in the window */
.ui-cmc__tip-fate { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-cmc-text); }
.ui-cmc__tip-fate > svg { flex: none; width: 12px; height: 12px; }
.ui-cmc__tip-fate:is([data-fate="summarized"], [data-fate="summary"]) { color: var(--ui-cmc-summary-ink); }
.ui-cmc__tip-fate[data-fate="dropped"] { color: var(--ui-cmc-muted); }

/* ----- Before a compaction: each block marked by what happened to it ----- */
/* Summarized: its own tint, a dashed edge in its own color, and "→ summary" in green */
.ui-cmc__tile[data-fate="summarized"] { box-shadow: none; outline: 1.5px dashed color-mix(in srgb, var(--k-ink) 55%, transparent); outline-offset: -1.5px; }
/* Dropped: greyed out, its name struck through */
.ui-cmc__tile[data-fate="dropped"] { opacity: 0.42; filter: grayscale(1); }
.ui-cmc__tile[data-fate="dropped"] .ui-cmc__name { text-decoration: line-through; }
/* After: the summary they went into carries a ring */
.ui-cmc__tile[data-fate="summary"] { box-shadow: inset 0 0 0 1px var(--ui-cmc-summary-edge); }

/* Summarized: a small grey mark in the top right corner */
.ui-cmc__badge { position: absolute; top: 6px; right: 6px; z-index: 1; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; background: var(--ui-cmc-hover); color: var(--ui-cmc-muted); pointer-events: none; animation: ui-cmc-fade 240ms ease both; }
.ui-cmc__badge > svg { width: 11px; height: 11px; }
/* A pinned card's block: a quiet ring in its own color */
.ui-cmc__tile[data-pinned] { box-shadow: inset 0 0 0 1.5px var(--k-ink); }
.ui-cmc__tile[data-fate="summarized"][data-pinned] { outline-style: solid; }
.ui-cmc__tile { cursor: pointer; }
.ui-cmc__tile[data-kind="free"] { cursor: default; }

/* The line under the map: before → after, then how many blocks went which way */
.ui-cmc__fates { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-height: 16px; margin: 10px 0 0; font-size: 12px; line-height: 16px; color: var(--ui-cmc-muted); font-variant-numeric: tabular-nums; }
.ui-cmc__fates b { font-weight: 500; color: var(--ui-cmc-ink); }
.ui-cmc__fates--none { color: var(--ui-cmc-faint); }
.ui-cmc__fate { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ui-cmc__fate::before { content: ""; flex: none; width: 8px; height: 8px; border-radius: 2.5px; background: var(--ui-cmc-system-bg); box-shadow: inset 0 0 0 1px var(--ui-cmc-system-edge); }
.ui-cmc__fate[data-fate="summarized"]::before { background: none; box-shadow: none; outline: 1px dashed var(--ui-cmc-muted); outline-offset: -1px; }
.ui-cmc__fate[data-fate="dropped"]::before { opacity: 0.45; }

/* ----- Narrow: a shorter area, the numbers on their own line ----- */
@container ui-cmc (max-width: 480px) {
  /* The count on the left, Before | After and the share together on the right */
  .ui-cmc__compare { order: 2; margin-left: auto; }
  /* As tall as the switch from the start, so the row doesn't grow when it appears */
  .ui-cmc__sum { min-height: 24px; }
  /* Room for the summary line's two rows, so it takes the placeholder's place without growing */
  .ui-cmc__fates { min-height: 36px; align-content: flex-start; }
  .ui-cmc__pct { order: 3; }
  .ui-cmc__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-cmc__area { --ui-cmc-height: 240px; }
}

@keyframes ui-cmc-in { from { opacity: 0; } }
@keyframes ui-cmc-fade { from { opacity: 0; } }
@keyframes ui-cmc-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
.ui-cmc__spin { flex: none; width: 12px; height: 12px; animation: ui-cmc-spin 800ms steps(8) infinite; }
@keyframes ui-cmc-spin { to { transform: rotate(360deg); } }
@keyframes ui-cmc-tip { from { opacity: 0; transform: translateY(3px) scale(0.97); } }

@media (prefers-reduced-motion: reduce) {
  .ui-cmc *, .ui-cmc *::before, .ui-cmc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cmc {
  --ui-cmc-panel: #1c1c1f;
  --ui-cmc-card: #232326;
  --ui-cmc-strong: #ffffff;
  --ui-cmc-ink: rgba(255, 255, 255, 0.9);
  --ui-cmc-text: rgba(255, 255, 255, 0.62);
  --ui-cmc-muted: rgba(255, 255, 255, 0.45);
  --ui-cmc-faint: rgba(255, 255, 255, 0.28);
  --ui-cmc-line: rgba(255, 255, 255, 0.08);
  --ui-cmc-accent: #5b9aff;
  --ui-cmc-shine: rgba(255, 255, 255, 0.35);
  --ui-cmc-hover: rgba(255, 255, 255, 0.07);
  --ui-cmc-high: #ffb357;
  --ui-cmc-high-bg: rgba(255, 160, 40, 0.18);
  --ui-cmc-full: #ff977d;
  --ui-cmc-full-bg: rgba(255, 70, 50, 0.2);
  --ui-cmc-system-bg: rgba(255, 255, 255, 0.07);
  --ui-cmc-system-edge: rgba(255, 255, 255, 0.14);
  --ui-cmc-system-ink: rgba(255, 255, 255, 0.7);
  --ui-cmc-tools-bg: rgba(40, 170, 220, 0.16);
  --ui-cmc-tools-edge: rgba(70, 190, 235, 0.42);
  --ui-cmc-tools-ink: #6fd0f2;
  --ui-cmc-memory-bg: rgba(120, 120, 255, 0.18);
  --ui-cmc-memory-edge: rgba(150, 150, 255, 0.45);
  --ui-cmc-memory-ink: #b3b3ff;
  --ui-cmc-file-bg: rgba(60, 130, 255, 0.18);
  --ui-cmc-file-edge: rgba(112, 170, 255, 0.45);
  --ui-cmc-file-ink: #8ab8ff;
  --ui-cmc-chat-bg: rgba(180, 110, 240, 0.17);
  --ui-cmc-chat-edge: rgba(200, 140, 250, 0.42);
  --ui-cmc-chat-ink: #d4a8ff;
  --ui-cmc-result-bg: rgba(255, 160, 40, 0.17);
  --ui-cmc-result-edge: rgba(255, 180, 70, 0.45);
  --ui-cmc-result-ink: #ffc078;
  --ui-cmc-summary-bg: rgba(40, 200, 110, 0.17);
  --ui-cmc-summary-edge: rgba(60, 220, 130, 0.42);
  --ui-cmc-summary-ink: #6fe0a4;
  --ui-cmc-free-edge: rgba(255, 255, 255, 0.16);
  --ui-cmc-free-hatch: rgba(255, 255, 255, 0.04);
  --ui-cmc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-cmc-button: var(--ui-cmc-shadow);
  --ui-cmc-button-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 1px 3px 0 rgba(0, 0, 0, 0.45);
  --ui-cmc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
`;
