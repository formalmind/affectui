"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Context Map – what fills an agent's context window, as a treemap, in a single self-contained file.
 * A soft gray tray with the agent and how full it is, a white card of a fixed height below: every part of the context –
 * the system prompt, tools, memory, each file, the chat, tool results – a tile as large as its share of the tokens,
 * and what's left as a dashed free space.
 *   · tiles keep their order and glide as the context grows – sizes ease toward their new value and the whole map is
 *     laid out again every frame, so tiles never overlap; a new file grows in where it belongs, a removed one shrinks away
 *   · tinted by kind: a light tint and an edge in the same color
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
  <svg className="ui-cm__spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    <div className={["ui-cm", className].filter(Boolean).join(" ")}>
      <style href="ui-context-map" precedence="default">
        {css}
      </style>

      <header className="ui-cm__bar">
        <span className="ui-cm__mark">
          <MapMark />
        </span>
        <span className="ui-cm__title" id={label}>
          {title}
        </span>
        {current ? (
          <span className="ui-cm__pick" ref={menuRef}>
            <button type="button" className="ui-cm__who ui-cm__agent" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              {current.icon && (
                <span className="ui-cm__logo" aria-hidden="true">
                  {current.icon}
                </span>
              )}
              <span className="ui-cm__model">{current.name}</span>
              <span className="ui-cm__limit">{tokens(limit)}</span>
              <svg className="ui-cm__chev" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="m3.5 4.75 2.5 2.5 2.5-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {menu && (
              <span ref={listRef} className="ui-cm__menu" role="menu">
                {agents!.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={a.id === current.id}
                    className="ui-cm__option"
                    onClick={() => {
                      setMenu(false);
                      if (a.id !== current.id) onAgentChange?.(a.id);
                    }}
                  >
                    <span className="ui-cm__logo" aria-hidden="true">
                      {a.icon}
                    </span>
                    <span className="ui-cm__option-text">
                      <span className="ui-cm__option-name">{a.name}</span>
                      {a.model && <span className="ui-cm__option-model">{a.model}</span>}
                    </span>
                    <span className="ui-cm__limit">{tokens(a.limit)}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
        ) : (model || modelIcon) && (
          <span className="ui-cm__who">
            {modelIcon && (
              <span className="ui-cm__logo" aria-hidden="true">
                {modelIcon}
              </span>
            )}
            {model && <span className="ui-cm__model">{model}</span>}
            {/* The window's size as a small tag */}
            <span className="ui-cm__limit">{tokens(limit)}</span>
          </span>
        )}
        {status && (
          <span className="ui-cm__status" key={status}>
            <Spinner />
            {status}
          </span>
        )}
        <span className="ui-cm__sum">
          {/* In the count's row – so on phones, where that row is the whole width, it never adds a line */}
          {compaction && (
            <span className="ui-cm__compare" role="group" aria-label="Compaction">
              {(["before", "after"] as const).map((v) => (
                <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "before" ? "Before" : "After"}
                </button>
              ))}
            </span>
          )}
          <span>
            {/* What's used, with a shine running over it */}
            <b className="ui-cm__used">{tokens(used)}</b> / {tokens(limit)}
          </span>
          <span className="ui-cm__pct" data-level={level}>
            {Math.round(share * 100)}%
          </span>
        </span>
      </header>

      <div ref={areaRef} className="ui-cm__area" role="list" aria-labelledby={label} onMouseLeave={() => setHover(null)}>
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
              className="ui-cm__tile"
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
                <span className="ui-cm__badge" title="Summarized – click for more" aria-hidden="true">
                  <Folded />
                </span>
              )}
              <span className="ui-cm__label" aria-hidden="true">
                <span className="ui-cm__name" data-show={name ? "" : undefined}>
                  {b?.icon && !isFree && <span className="ui-cm__icon">{b.icon}</span>}
                  {isFree ? "Free" : b?.label}
                </span>
                <span className="ui-cm__tokens" data-show={second ? "" : undefined}>
                  {tokens(target.get(it.id) || it.value)}
                  {!isFree && b && (
                    <span className="ui-cm__kind" data-show={kind ? "" : undefined}>
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
          <div ref={tipRef} className="ui-cm__tip" key={hovered.id} role="tooltip">
            <span className="ui-cm__tip-head">
              {hovered.icon ? (
                <span className="ui-cm__logo" aria-hidden="true">
                  {hovered.icon}
                </span>
              ) : (
                <span className="ui-cm__swatch" data-kind={hovered.kind} aria-hidden="true" />
              )}
              <span className="ui-cm__tip-name">{hovered.label}</span>
            </span>
            <span className="ui-cm__tip-meta">
              {KIND[hovered.kind]} · {tokens(hovered.tokens)} tokens · {Math.round((hovered.tokens / limit) * 1000) / 10}%
            </span>
            {hovered.detail && <span className="ui-cm__tip-detail">{hovered.detail}</span>}
            {compaction && view === "before" && compaction.before.some((x) => x.id === hovered.id) && (
              <span className="ui-cm__tip-fate" data-fate={fateOf(hovered.id)}>
                {(() => {
                  const FateIcon = FATE_ICON[fateOf(hovered.id)];
                  return <FateIcon />;
                })()}
                {fateOf(hovered.id) === "summarized" ? "Folded into the summary" : fateOf(hovered.id) === "dropped" ? "Dropped when it compacted" : "Kept as it was"}
              </span>
            )}
            {compaction && view === "after" && hovered.id === compaction.summary && (
              <span className="ui-cm__tip-fate" data-fate="summary">
                <Folded />
                From {compaction.summarized?.length ?? 0} blocks, {tokens(compaction.before.filter((b) => compaction.summarized?.includes(b.id)).reduce((t, b) => t + b.tokens, 0))} before
              </span>
            )}
            {hovered.items && hovered.items.length > 0 && (
              <ul className="ui-cm__tip-items">
                {hovered.items.map((item) => (
                  <li key={item.label}>
                    {item.icon && (
                      <span className="ui-cm__logo" aria-hidden="true">
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
    <span className="ui-cm__roll">
      {out && (
        <span className="ui-cm__roll-out" key={`out-${out.k}`} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span className="ui-cm__roll-in" key={k} data-rolling={out ? "" : undefined}>
        {children}
      </span>
    </span>
  );
}

/** "186k → 54k · 7 kept 112k · 3 summarized 66k into 8.6k · 1 dropped 15.6k" */
function Fates({ compaction, after }: { compaction: ContextCompaction | null; after: ContextBlock[] }) {
  if (!compaction)
    return (
      <div className="ui-cm__fates-row">
        <Roll k="none">
          <p className="ui-cm__fates ui-cm__fates--none">Not compacted yet – once it is, compare before and after here.</p>
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
    <div className="ui-cm__fates-row">
      <Roll k="done">
    <p className="ui-cm__fates">
      <b>
        {tokens(sum(compaction.before))} → {tokens(sum(after))}
      </b>
      <span className="ui-cm__fate" data-fate="kept">
        {kept.length} kept · {tokens(sum(kept))}
      </span>
      {summarized.length > 0 && (
        <span className="ui-cm__fate" data-fate="summarized">
          {summarized.length} summarized · {tokens(sum(summarized))}
          {summary && <> into {tokens(summary.tokens)}</>}
        </span>
      )}
      {dropped.length > 0 && (
        <span className="ui-cm__fate" data-fate="dropped">
          {dropped.length} dropped · {tokens(sum(dropped))}
        </span>
      )}
    </p>
      </Roll>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-cm */
.ui-cm {
  --ui-cm-tray: #f0f0f0;
  --ui-cm-panel: #ffffff;
  --ui-cm-card: #ffffff;
  --ui-cm-strong: #171717;
  --ui-cm-ink: #171717;
  --ui-cm-text: #6b6b6b;
  --ui-cm-muted: #8a8a8a;
  --ui-cm-faint: #b8b8b8;
  --ui-cm-line: #ececec;
  --ui-cm-accent: #2f6bff;
  --ui-cm-shine: #b8b8b8;
  --ui-cm-hover: rgba(0, 0, 0, 0.05);
  --ui-cm-high: #b85c00;
  --ui-cm-high-bg: #ffefd6;
  --ui-cm-full: #c2331f;
  --ui-cm-full-bg: #fde3df;
  /* Tiles by kind: a tint, its edge and the ink on it */
  --ui-cm-system-bg: #f3f3f3;
  --ui-cm-system-edge: #e1e1e1;
  --ui-cm-system-ink: #5c5c5c;
  --ui-cm-tools-bg: #e2f2f9;
  --ui-cm-tools-edge: #a6d6ea;
  --ui-cm-tools-ink: #006a94;
  --ui-cm-memory-bg: #ececfc;
  --ui-cm-memory-edge: #bdbdf0;
  --ui-cm-memory-ink: #4a4ac2;
  --ui-cm-file-bg: #e6effd;
  --ui-cm-file-edge: #a9c4f5;
  --ui-cm-file-ink: #2456d6;
  --ui-cm-chat-bg: #f3eafa;
  --ui-cm-chat-edge: #d3b6ec;
  --ui-cm-chat-ink: #7b3fb0;
  --ui-cm-result-bg: #ffefd6;
  --ui-cm-result-edge: #f7c27a;
  --ui-cm-result-ink: #b35400;
  --ui-cm-summary-bg: #dcf3e4;
  --ui-cm-summary-edge: #9fd9b4;
  --ui-cm-summary-ink: #1a7f45;
  --ui-cm-free-edge: #d6d6d6;
  --ui-cm-free-hatch: rgba(0, 0, 0, 0.035);
  --ui-cm-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-cm-button: var(--ui-cm-shadow);
  --ui-cm-button-hover: 0 0 0 1px #e2e2e2, 0 1px 3px rgba(0, 0, 0, 0.07);
  --ui-cm-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-cm-height: 280px;
  --ui-cm-gap: 3px;
  --ui-cm-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-cm-tray);
  min-width: 0;
  container: ui-cm / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-cm-text);
  text-align: left;
  letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
}
.ui-cm *, .ui-cm *::before, .ui-cm *::after { box-sizing: border-box; }

/* ----- On the tray: the agent, the status, how full it is ----- */
.ui-cm__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; min-width: 0; padding: 10px 12px 12px; }
.ui-cm__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-cm-accent); }
.ui-cm__title { flex: none; font-weight: 600; color: var(--ui-cm-strong); }
.ui-cm__who { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
/* The model maker's logo on a small white tile */
.ui-cm__logo { display: grid; flex: none; place-items: center; width: 22px; height: 22px; border-radius: 7px; background: var(--ui-cm-card); box-shadow: var(--ui-cm-shadow); }
.ui-cm__logo > svg { width: 12px; height: 12px; }
.ui-cm__model { min-width: 0; overflow: hidden; color: var(--ui-cm-text); white-space: nowrap; text-overflow: ellipsis; }
/* The agent menu */
.ui-cm__pick { position: relative; display: inline-flex; min-width: 0; }
.ui-cm__agent { min-width: 0; height: 32px; margin: -5px 0; padding: 0 8px 0 11px; border: 0; border-radius: 999px; letter-spacing: inherit; background: var(--ui-cm-card); box-shadow: var(--ui-cm-button); font: inherit; color: inherit; cursor: pointer; transition: box-shadow 160ms ease; }
.ui-cm__agent:hover, .ui-cm__agent[aria-expanded="true"] { box-shadow: var(--ui-cm-button-hover); }
.ui-cm__agent .ui-cm__logo { width: 14px; height: 14px; border-radius: 0; background: none; box-shadow: none; }
.ui-cm__agent .ui-cm__logo > svg { width: 15px; height: 15px; }
.ui-cm__agent:focus-visible, .ui-cm__option:focus-visible { outline: 2px solid rgba(23, 23, 23, 0.22); outline-offset: 2px; }
.ui-cm__chev { flex: none; width: 13px; height: 13px; margin-left: -2px; color: var(--ui-cm-muted); transition: transform 180ms var(--ui-cm-ease); }
.ui-cm__agent[aria-expanded="true"] .ui-cm__chev { transform: rotate(180deg); }
.ui-cm__menu { position: absolute; top: calc(100% + 8px); left: 0; z-index: 6; display: grid; gap: 2px; width: 268px; padding: 5px; border-radius: 16px; background: var(--ui-cm-card); box-shadow: var(--ui-cm-shadow); animation: ui-cm-tip 160ms var(--ui-cm-ease) both; }
.ui-cm__option { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 10px 7px 7px; border: 0; border-radius: 11px; letter-spacing: inherit; background: none; font: inherit; text-align: left; color: inherit; cursor: pointer; }
.ui-cm__option:hover { background: var(--ui-cm-hover); }
.ui-cm__option[aria-checked="true"] { background: var(--ui-cm-hover); }
.ui-cm__option-text { display: grid; flex: 1; min-width: 0; }
.ui-cm__option-name { overflow: hidden; font-size: 14px; font-weight: 600; line-height: 19px; color: var(--ui-cm-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cm__option-model { font-size: 12.5px; line-height: 17px; color: var(--ui-cm-muted); }
.ui-cm__option .ui-cm__logo { width: 28px; height: 28px; border-radius: 8px; }
.ui-cm__option .ui-cm__logo > svg { width: 14px; height: 14px; }
.ui-cm__limit { flex: none; height: 20px; padding: 0 7px; border-radius: 999px; background: var(--ui-cm-hover); font-size: 12px; font-weight: 500; line-height: 20px; color: var(--ui-cm-text); font-variant-numeric: tabular-nums; }
.ui-cm__status { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 24px; padding: 0 10px 0 8px; border-radius: 999px; background: var(--ui-cm-summary-bg); font-size: 12.5px; font-weight: 500; color: var(--ui-cm-summary-ink); animation: ui-cm-fade 240ms ease both; }
.ui-cm__sum { display: flex; align-items: center; gap: 10px; margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ui-cm-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-cm__sum b { font-weight: 600; color: var(--ui-cm-ink); }
/* The used count: a shine sweeping over it, all the time */
.ui-cm__used { background: linear-gradient(90deg, var(--ui-cm-ink) 0%, var(--ui-cm-ink) 38%, var(--ui-cm-shine) 50%, var(--ui-cm-ink) 62%, var(--ui-cm-ink) 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent !important; animation: ui-cm-shine 1100ms linear infinite; }
.ui-cm__pct { min-width: 44px; height: 24px; padding: 0 8px; border-radius: 999px; background: var(--ui-cm-card); box-shadow: var(--ui-cm-shadow); font-size: 12.5px; font-weight: 600; line-height: 24px; color: var(--ui-cm-text); text-align: center; transition: background-color 300ms ease, color 300ms ease; }
.ui-cm__pct[data-level="high"] { background: var(--ui-cm-high-bg); color: var(--ui-cm-high); }
.ui-cm__pct[data-level="full"] { background: var(--ui-cm-full-bg); color: var(--ui-cm-full); }
/* Before | After a compaction */
.ui-cm__compare { display: inline-flex; flex: none; gap: 1px; padding: 2px; border-radius: 999px; background: var(--ui-cm-hover); }
.ui-cm__compare { margin: -2px 0; animation: ui-cm-fade 280ms ease both; }
/* Rolling text: both sit in one cell, the old one leaves upward as the new one rises in */
.ui-cm__roll { display: inline-grid; vertical-align: top; overflow: hidden; }
.ui-cm__roll > * { grid-area: 1 / 1; }
.ui-cm__roll-in[data-rolling] { animation: ui-cm-roll-in 340ms var(--ui-cm-ease) both; }
.ui-cm__roll-out { animation: ui-cm-roll-out 300ms var(--ui-cm-ease) both; pointer-events: none; }
.ui-cm__fates-row { display: grid; }
.ui-cm__fates-row > .ui-cm__roll { display: grid; }
@keyframes ui-cm-roll-in { from { opacity: 0; transform: translateY(80%); } }
@keyframes ui-cm-roll-out { to { opacity: 0; transform: translateY(-80%); } }
.ui-cm__compare button { height: 24px; padding: 0 9px; border: 0; border-radius: 999px; background: none; font: inherit; font-size: 12.5px; font-weight: 500; color: var(--ui-cm-muted); cursor: pointer; transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease; }
.ui-cm__compare button:hover { color: var(--ui-cm-ink); }
.ui-cm__compare button[aria-pressed="true"] { background: var(--ui-cm-card); color: var(--ui-cm-ink); box-shadow: var(--ui-cm-shadow); }
.ui-cm__compare button:focus-visible { outline: 2px solid var(--ui-cm-accent); outline-offset: 1px; }

/* ----- The white card: one tile per part, placed by the layout, gliding when it changes ----- */
.ui-cm__area { position: relative; height: var(--ui-cm-height); padding: 0; border-radius: 16px; background: var(--ui-cm-panel); box-shadow: var(--ui-cm-shadow); }
.ui-cm__tile { position: absolute; left: 0; top: 0; width: max(0px, calc(var(--w) - var(--ui-cm-gap))); height: max(0px, calc(var(--h) - var(--ui-cm-gap))); border-radius: 9px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); overflow: hidden; transform: translate(calc(var(--x) + var(--ui-cm-gap) / 2), calc(var(--y) + var(--ui-cm-gap) / 2)); transition: opacity 200ms ease, background-color 300ms ease; cursor: default; }
/* The free space: dashed, with a faint hatch */
.ui-cm__tile[data-kind="free"] { background: repeating-linear-gradient(135deg, transparent 0 6px, var(--ui-cm-free-hatch) 6px 7px); box-shadow: none; outline: 1.5px dashed var(--ui-cm-free-edge); outline-offset: -2px; }
.ui-cm__tile[data-dim] { opacity: 0.55; }
/* The label: no ellipsis – a line that runs into the edge fades out, and a line without room fades away before it's cut */
.ui-cm__label { position: absolute; top: 8px; right: 0; left: 10px; display: grid; min-width: 0; pointer-events: none; }
.ui-cm__name, .ui-cm__tokens { overflow: hidden; white-space: nowrap; -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent calc(100% - 4px)); mask-image: linear-gradient(90deg, #000 calc(100% - 22px), transparent calc(100% - 4px)); opacity: 0; transition: opacity 220ms ease; }
.ui-cm__name { font-size: 13px; font-weight: 600; line-height: 17px; color: var(--k-ink); }
.ui-cm__tokens { font-size: 12.5px; line-height: 17px; color: var(--k-ink); font-variant-numeric: tabular-nums; }
.ui-cm__name[data-show] { opacity: 1; }
.ui-cm__tokens[data-show] { opacity: 0.7; }
.ui-cm__kind { opacity: 0; transition: opacity 220ms ease; }
.ui-cm__kind[data-show] { opacity: 1; }
.ui-cm__tile[data-kind="free"] :is(.ui-cm__name, .ui-cm__tokens) { color: var(--ui-cm-muted); }

/* Every kind's colors in one place */
.ui-cm [data-kind="system"] { --k-bg: var(--ui-cm-system-bg); --k-edge: var(--ui-cm-system-edge); --k-ink: var(--ui-cm-system-ink); }
.ui-cm [data-kind="tools"] { --k-bg: var(--ui-cm-tools-bg); --k-edge: var(--ui-cm-tools-edge); --k-ink: var(--ui-cm-tools-ink); }
.ui-cm [data-kind="memory"] { --k-bg: var(--ui-cm-memory-bg); --k-edge: var(--ui-cm-memory-edge); --k-ink: var(--ui-cm-memory-ink); }
.ui-cm [data-kind="file"] { --k-bg: var(--ui-cm-file-bg); --k-edge: var(--ui-cm-file-edge); --k-ink: var(--ui-cm-file-ink); }
.ui-cm [data-kind="chat"] { --k-bg: var(--ui-cm-chat-bg); --k-edge: var(--ui-cm-chat-edge); --k-ink: var(--ui-cm-chat-ink); }
.ui-cm [data-kind="result"] { --k-bg: var(--ui-cm-result-bg); --k-edge: var(--ui-cm-result-edge); --k-ink: var(--ui-cm-result-ink); }
.ui-cm [data-kind="summary"] { --k-bg: var(--ui-cm-summary-bg); --k-edge: var(--ui-cm-summary-edge); --k-ink: var(--ui-cm-summary-ink); }

/* ----- The window over a tile ----- */
.ui-cm__tip { position: absolute; top: 0; left: 0; z-index: 5; display: grid; gap: 2px; width: max-content; max-width: 320px; padding: 10px 14px 11px; border-radius: 14px; background: var(--ui-cm-card); box-shadow: var(--ui-cm-pop); pointer-events: none; animation: ui-cm-tip 160ms var(--ui-cm-ease) both; }
.ui-cm__tip-head { display: flex; align-items: center; gap: 7px; min-width: 0; }
.ui-cm__swatch { flex: none; width: 10px; height: 10px; border-radius: 3px; background: var(--k-bg); box-shadow: inset 0 0 0 1px var(--k-edge); }
.ui-cm__tip-name { overflow: hidden; font-weight: 600; color: var(--ui-cm-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cm__tip-meta { font-size: 12.5px; line-height: 18px; color: var(--ui-cm-muted); font-variant-numeric: tabular-nums; }
/* What's inside: each with its logo, in two columns */
.ui-cm__tip-items { display: grid; grid-template-columns: repeat(2, max-content); gap: 7px 18px; margin: 8px 0 0; padding: 9px 0 0; border-top: 1px solid var(--ui-cm-line); list-style: none; }
.ui-cm__tip-items li { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; color: var(--ui-cm-text); white-space: nowrap; }
.ui-cm__tip-items .ui-cm__logo, .ui-cm__tip-head .ui-cm__logo { width: 20px; height: 20px; border-radius: 6px; color: var(--ui-cm-ink); }
.ui-cm__tip-items .ui-cm__logo > svg, .ui-cm__tip-head .ui-cm__logo > svg { width: 11px; height: 11px; }
.ui-cm__icon { display: inline-flex; vertical-align: -2px; margin-right: 5px; }
.ui-cm__icon > svg { width: 13px; height: 13px; border-radius: 3px; }
.ui-cm__tip-detail { font-size: 13px; line-height: 19px; color: var(--ui-cm-text); }
/* What the compaction did with the block, in the window */
.ui-cm__tip-fate { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-cm-text); }
.ui-cm__tip-fate > svg { flex: none; width: 12px; height: 12px; }
.ui-cm__tip-fate:is([data-fate="summarized"], [data-fate="summary"]) { color: var(--ui-cm-summary-ink); }
.ui-cm__tip-fate[data-fate="dropped"] { color: var(--ui-cm-muted); }

/* ----- Before a compaction: each block marked by what happened to it ----- */
/* Summarized: its own tint, a dashed edge in its own color, and "→ summary" in green */
.ui-cm__tile[data-fate="summarized"] { box-shadow: none; outline: 1.5px dashed color-mix(in srgb, var(--k-ink) 55%, transparent); outline-offset: -1.5px; }
/* Dropped: greyed out, its name struck through */
.ui-cm__tile[data-fate="dropped"] { opacity: 0.42; filter: grayscale(1); }
.ui-cm__tile[data-fate="dropped"] .ui-cm__name { text-decoration: line-through; }
/* After: the summary they went into carries a ring */
.ui-cm__tile[data-fate="summary"] { box-shadow: inset 0 0 0 1px var(--ui-cm-summary-edge); }

/* Summarized: a small grey mark in the top right corner */
.ui-cm__badge { position: absolute; top: 6px; right: 6px; z-index: 1; display: grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; background: var(--ui-cm-hover); color: var(--ui-cm-muted); pointer-events: none; animation: ui-cm-fade 240ms ease both; }
.ui-cm__badge > svg { width: 11px; height: 11px; }
/* A pinned card's block: a quiet ring in its own color */
.ui-cm__tile[data-pinned] { box-shadow: inset 0 0 0 1.5px var(--k-ink); }
.ui-cm__tile[data-fate="summarized"][data-pinned] { outline-style: solid; }
.ui-cm__tile { cursor: pointer; }
.ui-cm__tile[data-kind="free"] { cursor: default; }

/* The line under the map: before → after, then how many blocks went which way */
.ui-cm__fates { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; min-height: 18px; margin: 10px 0 0; padding: 0 10px 8px; font-size: 13px; line-height: 18px; color: var(--ui-cm-muted); font-variant-numeric: tabular-nums; }
.ui-cm__fates b { font-weight: 500; color: var(--ui-cm-ink); }
.ui-cm__fates--none { color: var(--ui-cm-faint); }
.ui-cm__fate { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ui-cm__fate::before { content: ""; flex: none; width: 9px; height: 9px; border-radius: 2.5px; background: var(--ui-cm-system-bg); box-shadow: inset 0 0 0 1.5px var(--ui-cm-system-edge); }
.ui-cm__fate[data-fate="summarized"]::before { background: none; box-shadow: none; outline: 1px dashed var(--ui-cm-muted); outline-offset: -1px; }
.ui-cm__fate[data-fate="dropped"]::before { opacity: 0.45; }

/* ----- Narrow: a shorter area, the numbers on their own line ----- */
@container ui-cm (max-width: 480px) {
  /* The count on the left, Before | After and the share together on the right */
  .ui-cm__compare { order: 2; margin-left: auto; }
  /* As tall as the switch from the start, so the row doesn't grow when it appears */
  .ui-cm__sum { min-height: 28px; }
  /* Room for the summary line's two rows, so it takes the placeholder's place without growing */
  .ui-cm__fates { min-height: 40px; align-content: flex-start; }
  .ui-cm__pct { order: 3; }
  .ui-cm__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-cm__area { --ui-cm-height: 240px; }
}

@keyframes ui-cm-in { from { opacity: 0; } }
@keyframes ui-cm-fade { from { opacity: 0; } }
@keyframes ui-cm-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
.ui-cm__spin { flex: none; width: 12px; height: 12px; animation: ui-cm-spin 800ms steps(8) infinite; }
@keyframes ui-cm-spin { to { transform: rotate(360deg); } }
@keyframes ui-cm-tip { from { opacity: 0; transform: translateY(4px) scale(0.96); } }

@media (prefers-reduced-motion: reduce) {
  .ui-cm *, .ui-cm *::before, .ui-cm *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cm {
  --ui-cm-tray: #1a1a1c;
  --ui-cm-panel: #232326;
  --ui-cm-card: #2a2a2e;
  --ui-cm-strong: #f5f5f5;
  --ui-cm-ink: #f0f0f0;
  --ui-cm-text: #a1a1a1;
  --ui-cm-muted: #8a8a8a;
  --ui-cm-faint: #5c5c5c;
  --ui-cm-line: #2e2e31;
  --ui-cm-accent: #6d93ff;
  --ui-cm-shine: #8a8a8a;
  --ui-cm-hover: rgba(255, 255, 255, 0.07);
  --ui-cm-high: #ffb357;
  --ui-cm-high-bg: #3a2a12;
  --ui-cm-full: #ff8a76;
  --ui-cm-full-bg: #3d1a16;
  --ui-cm-system-bg: #2b2b2f;
  --ui-cm-system-edge: #3a3a40;
  --ui-cm-system-ink: #bdbdbd;
  --ui-cm-tools-bg: #12303b;
  --ui-cm-tools-edge: #2a6a84;
  --ui-cm-tools-ink: #6fd0f2;
  --ui-cm-memory-bg: #24244a;
  --ui-cm-memory-edge: #4a4aa0;
  --ui-cm-memory-ink: #b3b3ff;
  --ui-cm-file-bg: #1d2b4d;
  --ui-cm-file-edge: #3c5fb3;
  --ui-cm-file-ink: #8aaeff;
  --ui-cm-chat-bg: #2f2140;
  --ui-cm-chat-edge: #6a4a94;
  --ui-cm-chat-ink: #d4a8ff;
  --ui-cm-result-bg: #3a2a12;
  --ui-cm-result-edge: #8a5a1c;
  --ui-cm-result-ink: #ffc078;
  --ui-cm-summary-bg: #15321f;
  --ui-cm-summary-edge: #2f7a4b;
  --ui-cm-summary-ink: #55d68c;
  --ui-cm-free-edge: #3a3a40;
  --ui-cm-free-hatch: rgba(255, 255, 255, 0.04);
  --ui-cm-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-cm-button: var(--ui-cm-shadow);
  --ui-cm-button-hover: 0 0 0 1px #3a3a40, 0 1px 3px rgba(0, 0, 0, 0.45);
  --ui-cm-pop: 0 0 0 1px #34343a, 0 16px 36px -12px rgba(0, 0, 0, 0.7);
}
`;
