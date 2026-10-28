"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/*
 * Agent Tree – who started whom, in a single self-contained file.
 * An orchestrator splits a job and hands parts to sub-agents, which may start their own. The tree shows every agent
 * as a white card on a soft gray tray – model, status, what it was asked, its cost and time – joined by thin blue connectors with a
 * hollow dot where they leave the parent.
 *   · new agents grow in: the connector draws itself, then the card rises in – several at once, one after another
 *   · when the tree changes, cards glide to their new place and the connectors follow them frame by frame
 *   · agents that go – a folded branch, a new run – fade out a beat after each other, bottom first,
 *     while their connectors pull back into the parent
 *   · costs roll up – a branch with children shows what the whole branch cost
 *   · fold a branch to "+3"; the header sums up the whole run
 *   · the tools an agent works with sit as small overlapping tiles before what it does
 * Wide containers lay the first level out side by side, deeper levels hang below their parent;
 * narrow ones indent every level. The styles are injected below, so no extra files are needed.
 */

export type TreeAgentStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";

export type TreeAgent = {
  id: string;
  name: string;
  /** What it was asked to do */
  task: string;
  model?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the initials */
  avatar?: ReactNode;
  /** Marks of the tools it works with, e.g. GitHub and Stripe – shown as small overlapping tiles */
  tools?: ReactNode[];
  status: TreeAgentStatus;
  /** Its own cost so far – the children's costs are added on top */
  cost?: number;
  /** What it waits for you to decide – shown when you open "needs you" */
  ask?: string;
  /** What went wrong – shown when you open "failed" */
  error?: string;
  /** When it started and ended (ms) – for the time it took */
  started?: number;
  ended?: number;
  children?: TreeAgent[];
};

export type AgentTreeProps = {
  root: TreeAgent;
  /** Controlled ids of folded branches */
  collapsed?: string[];
  defaultCollapsed?: string[];
  onCollapsedChange?: (collapsed: string[]) => void;
  /** An answer from the "needs you" or "failed" window: approve or reject a waiting agent, retry or dismiss a failed one */
  onResolve?: (agent: TreeAgent, action: "approve" | "reject" | "retry" | "dismiss") => void;
  /** A click on a card – e.g. to open its log */
  onSelect?: (agent: TreeAgent) => void;
  /** The clock for running times – defaults to now */
  now?: number;
  /** Formats every cost – defaults to dollars, e.g. "$0.42" */
  formatCost?: (amount: number) => string;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const STATUS: Record<TreeAgentStatus, string> = {
  queued: "Queued",
  running: "Running",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
};
// Less than a cent still cost something – "<$0.01", never "$0.00"
const dollars = (n: number) => (n > 0 && n < 0.005 ? "<$0.01" : `$${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString("en-US")}`);
const count = new Intl.NumberFormat("en-US");
const took = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
// Whole letters only – "🔍 Researcher" gives "R", not half an emoji; "Research & Design" gives "RD"
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => Array.from(w.replace(/^[^\p{L}\p{N}]+/u, ""))[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
const walk = (a: TreeAgent): TreeAgent[] => [a, ...(a.children ?? []).flatMap(walk)];
const costOf = (a: TreeAgent): number => (a.cost ?? 0) + (a.children ?? []).reduce((sum, c) => sum + costOf(c), 0);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Position of an element inside the tree, from offsets – so transforms and zoom don't throw it off */
const place = (el: HTMLElement, box: HTMLElement) => {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== box) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
};

/* ---------- Icons ---------- */

const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
/* Status glyphs, chevron: Hugeicons Free (MIT, © Hugeicons, hugeicons.com); the loader is a plain arc */
const StatusIcon = ({ status }: { status: TreeAgentStatus }) => {
  if (status === "running")
    return (
      <svg className="ui-agt__spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
        <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
      </svg>
    );
  if (status === "done")
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      </svg>
    );
  if (status === "failed")
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d="M12 9V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
        <path d="M12 16.8V17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
      </svg>
    );
  if (status === "waiting")
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V12L14.5 14.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
      </svg>
    );
  if (status === "stopped")
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="2.2" />
      </svg>
    );
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
};
/* Chevron: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18 9.00005C18 9.00005 13.5811 15 12 15C10.4188 15 6 9 6 9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);

type Link = { id: string; d: string; dot: [number, number]; muted: boolean; leaving?: number; enter: number };
/** An agent as it is shown: its sub-agents after folding, and – while it fades out – the delay it leaves with */
type Shown = { agent: TreeAgent; kids: Shown[]; leaving?: number };
type Ghost = { shown: Shown; parent: string; index: number };

/** Motion: how long cards take to leave and to move, and the beat between cards that go together */
const EXIT = 280;
const MOVE = 420;
const STAGGER = 60;
const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)";
const flat = (s: Shown): Shown[] => [s, ...s.kids.flatMap(flat)];
/** How many levels hang below an agent */
const depthOf = (s: Shown): number => Math.max(0, ...s.kids.map((k) => depthOf(k) + 1));

// One shared second for every running clock – only the times render again, not the whole tree
const ticker = { subs: new Set<() => void>(), id: 0 };
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    ticker.subs.add(tick);
    if (!ticker.id) ticker.id = window.setInterval(() => ticker.subs.forEach((f) => f()), 1000);
    return () => {
      ticker.subs.delete(tick);
      if (!ticker.subs.size) {
        window.clearInterval(ticker.id);
        ticker.id = 0;
      }
    };
  }, [active]);
  return now;
};
/** The time an agent took – while it works, it counts on from `since` (or follows the tree's `now`) */
const Took = ({ since, until, now }: { since: number; until?: number; now?: number }) => {
  const tick = useNow(until === undefined && now === undefined);
  return <>{took((until ?? now ?? tick) - since)}</>;
};

export function AgentTree({
  root,
  collapsed,
  defaultCollapsed = [],
  onCollapsedChange,
  onSelect,
  onResolve,
  now: nowProp,
  formatCost = dollars,
  title = "Agents",
  className,
}: AgentTreeProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [innerCollapsed, setInnerCollapsed] = useState<string[]>(defaultCollapsed);
  const folded = collapsed ?? innerCollapsed;
  const toggle = (id: string) => {
    const next = folded.includes(id) ? folded.filter((c) => c !== id) : [...folded, id];
    setInnerCollapsed(next);
    onCollapsedChange?.(next);
  };

  // The "needs you" or "failed" window; a click elsewhere or Esc closes it
  const [opened, setOpened] = useState<"waiting" | "failed" | null>(null);
  const barRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!opened) return;
    const away = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpened(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [opened]);

  const all = walk(root);

  /* ---------- Wide or narrow: side by side, or every level indented ---------- */

  const [room, setRoom] = useState<{ w: number; card: number; indent: number } | null>(null);

  /* ---------- What is shown: the open tree, plus cards that are on their way out ---------- */

  const toShown = (a: TreeAgent): Shown => ({ agent: a, kids: folded.includes(a.id) ? [] : (a.children ?? []).map(toShown) });
  const visible = toShown(root);
  const visibleIds = new Set(flat(visible).map((s) => s.agent.id));
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const leavingNow = ghosts.filter((g) => !visibleIds.has(g.shown.agent.id));
  const merge = (s: Shown): Shown => {
    const kids = s.kids.map(merge);
    leavingNow
      .filter((g) => g.parent === s.agent.id)
      .sort((a, b) => a.index - b.index)
      .forEach((g) => kids.splice(Math.min(g.index, kids.length), 0, g.shown));
    return { ...s, kids };
  };
  const shown = merge(visible);
  const shownAll = flat(shown);
  // Side by side only while the whole first level fits – a column is wider by an indent for every level below its card
  const wide =
    !room ||
    room.w >= Math.max(560, shown.kids.reduce((sum, k) => sum + room.card + room.indent * Math.max(1, depthOf(k)), 0) + Math.max(0, shown.kids.length - 1) * 8);

  // Cards that appear together rise one after another; the delay sticks to the card until it leaves
  const enterDelay = useRef(new Map<string, number>());
  const mounted = useRef(false);
  let newcomers = 0;
  for (const s of shownAll) {
    if (s.leaving !== undefined || enterDelay.current.has(s.agent.id)) continue;
    // The beat stops after a dozen cards – a big tree doesn't trickle in for a minute
    enterDelay.current.set(s.agent.id, s === shown ? 0 : (mounted.current ? 160 : 200) + Math.min(newcomers++, 12) * STAGGER);
  }

  /* ---------- The connectors, measured from the cards as they are drawn – so they follow every move ---------- */

  const nodes = useRef(new Map<string, HTMLElement>());
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const firstSeen = useRef(new Map<string, number>());
  const shape = JSON.stringify([
    wide,
    folded,
    shownAll.map((s) => [s.agent.id, s.agent.status, s.leaving ?? "", s.kids.map((k) => k.agent.id)]),
  ]);

  const measure = () => {
    const box = boxRef.current;
    if (!box) return;
    const outer = box.getBoundingClientRect();
    const scale = box.offsetWidth ? outer.width / box.offsetWidth : 1;
    const at = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return { x: (r.left - outer.left) / scale, y: (r.top - outer.top) / scale, w: r.width / scale, h: r.height / scale };
    };
    const next: Link[] = [];
    const R = 8;
    // The bar under the root runs at one height for every child: halfway down to the row the cards sit in –
    // not to each card, which may still be rising in or gliding, or the bar would split into steps
    const row = box.querySelector<HTMLElement>(":scope > .ui-agt__level");
    const rowTop = row ? at(row).y : null;
    const visit = (s: Shown, depth: number) => {
      const pe = nodes.current.get(s.agent.id);
      for (const k of s.kids) {
        const ce = nodes.current.get(k.agent.id);
        if (pe && ce) {
          const p = at(pe);
          const q = at(ce);
          const muted = k.agent.status === "queued" || k.agent.status === "stopped";
          const base = { id: `${s.agent.id}>${k.agent.id}`, muted, leaving: k.leaving, enter: enterDelay.current.get(k.agent.id) ?? 0 };
          if (wide && depth === 0) {
            // First level, side by side: one straight stem down from the parent, a straight bar along,
            // and each child's drop leaves the bar with a rounded corner
            const x1 = p.x + p.w / 2;
            const y1 = p.y + p.h;
            const x2 = q.x + q.w / 2;
            const y2 = q.y;
            const mid = Math.round(y1 + ((rowTop ?? y2) - y1) / 2);
            const dx = x2 - x1;
            const r = Math.max(0, Math.min(R, Math.abs(dx) / 2, (y2 - mid) / 2));
            const sg = Math.sign(dx);
            // Each drop starts at the card, so it draws itself in one stroke from the top – no gap at the stem while both draw.
            // A muted drop starts at the bar instead, so its gray never covers the blue stem; a card a few pixels off center
            // (still gliding in) hangs straight down rather than with a tiny kink
            const from = muted ? `M${x1} ${mid}` : `M${x1} ${y1}V${mid}`;
            const d = Math.abs(dx) < 12 ? `${from}V${y2}` : `${from}H${x2 - sg * r}Q${x2} ${mid} ${x2} ${mid + r}V${y2}`;
            next.push({ ...base, d, dot: [x1, y1] });
            // The stem, once per parent – it stays while any child is still there
            const stem = `${s.agent.id}>stem`;
            const prev = next.find((l) => l.id === stem);
            if (!prev) next.push({ id: stem, d: `M${x1} ${y1}V${mid}`, dot: [x1, y1], muted, leaving: k.leaving, enter: base.enter });
            else {
              prev.muted = prev.muted && muted;
              prev.leaving = prev.leaving === undefined || k.leaving === undefined ? undefined : Math.max(prev.leaving, k.leaving);
              prev.enter = Math.min(prev.enter, base.enter);
            }
          } else {
            // Hanging below: down along the parent's left edge, then into the child's side
            const x1 = p.x + 21;
            const y1 = p.y + p.h;
            const x2 = q.x;
            const y2 = q.y + 20;
            const r = Math.max(0, Math.min(R, (x2 - x1) / 2, (y2 - y1) / 2));
            const d = x2 - x1 < 2 ? `M${x1} ${y1}V${q.y}` : `M${x1} ${y1}V${y2 - r}Q${x1} ${y2} ${x1 + r} ${y2}H${x2}`;
            next.push({ ...base, d, dot: [x1, y1] });
          }
        }
        visit(k, depth + 1);
      }
    };
    visit(shown, 0);
    // A connector that is gone draws itself again when it comes back
    for (const id of [...firstSeen.current.keys()]) if (!next.some((l) => l.id === id)) firstSeen.current.delete(id);
    setLinks(next);
    // From the cards, not the box's scroll size – the layers themselves would keep an old, wider size alive
    const ends = [...nodes.current.values()].map(at);
    setSize({ w: Math.ceil(Math.max(box.clientWidth, ...ends.map((e) => e.x + e.w))), h: Math.ceil(Math.max(box.clientHeight, ...ends.map((e) => e.y + e.h))) });
  };
  const latest = useRef(measure);
  latest.current = measure;

  // While cards rise, glide or leave, the connectors are measured every frame
  const until = useRef(0);
  const raf = useRef(0);
  const follow = (ms: number) => {
    until.current = Math.max(until.current, performance.now() + ms);
    if (raf.current) return;
    const loop = () => {
      latest.current();
      raf.current = performance.now() < until.current ? requestAnimationFrame(loop) : 0;
    };
    raf.current = requestAnimationFrame(loop);
  };
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    },
    [],
  );

  /* ---------- Motion: cards glide to their new place ---------- */

  const lastPos = useRef(new Map<string, { x: number; y: number }>());
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let moved = false;
    for (const [id, el] of nodes.current) {
      const p = place(el, box);
      const before = lastPos.current.get(id);
      if (before && (Math.abs(before.x - p.x) > 0.5 || Math.abs(before.y - p.y) > 0.5) && !reduced()) {
        el.animate([{ translate: `${before.x - p.x}px ${before.y - p.y}px` }, { translate: "0px 0px" }], { duration: MOVE, easing: EASE });
        moved = true;
      }
      lastPos.current.set(id, p);
    }
    for (const id of [...lastPos.current.keys()]) if (!nodes.current.has(id)) lastPos.current.delete(id);
    if (moved) follow(MOVE + 40);
  });

  /* ---------- Motion: what leaves the tree fades out, a beat after each other, bottom first ---------- */

  const prevVisible = useRef<Shown | null>(null);
  useLayoutEffect(() => {
    const prev = prevVisible.current;
    prevVisible.current = visible;
    mounted.current = true;
    // Cards that are gone for good start over when they come back
    for (const id of [...enterDelay.current.keys()]) if (!shownAll.some((s) => s.agent.id === id && s.leaving === undefined)) enterDelay.current.delete(id);
    if (!prev || reduced()) return;
    const removed: Ghost[] = [];
    const scan = (s: Shown) =>
      s.kids.forEach((k, index) => {
        if (!visibleIds.has(k.agent.id)) removed.push({ shown: k, parent: s.agent.id, index });
        else scan(k);
      });
    scan(prev);
    if (!removed.length) return;
    const order = removed.flatMap((g) => flat(g.shown)).reverse();
    const delay = new Map(order.map((s, i) => [s.agent.id, i * STAGGER]));
    const mark = (s: Shown): Shown => ({ ...s, leaving: delay.get(s.agent.id) ?? 0, kids: s.kids.map(mark) });
    const batch = removed.filter((g) => visibleIds.has(g.parent) || g.parent === root.id).map((g) => ({ ...g, shown: mark(g.shown) }));
    const ids = new Set(batch.map((g) => g.shown.agent.id));
    setGhosts((gs) => [...gs.filter((g) => !ids.has(g.shown.agent.id)), ...batch]);
    const total = EXIT + (order.length - 1) * STAGGER;
    window.setTimeout(() => setGhosts((gs) => gs.filter((g) => !ids.has(g.shown.agent.id))), total + 30);
    follow(total + MOVE + 60);
  });

  useLayoutEffect(() => {
    measure();
    follow(900 + Math.min(newcomers, 12) * STAGGER);
  }, [shape]); // eslint-disable-line react-hooks/exhaustive-deps
  // One observer for size changes: it picks the layout and redraws the connectors
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => {
      const cs = getComputedStyle(box);
      setRoom({ w: box.offsetWidth, card: parseFloat(cs.getPropertyValue("--ui-agt-card-w")) || 216, indent: parseFloat(cs.getPropertyValue("--ui-agt-indent")) || 32 });
      latest.current();
    });
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // A connector drawn for the first time draws itself in, timed with its card
  const stamp = Date.now();
  for (const l of links) if (!firstSeen.current.has(l.id)) firstSeen.current.set(l.id, stamp);
  const fresh = new Set(links.filter((l) => stamp - firstSeen.current.get(l.id)! < 700 + l.enter).map((l) => l.id));

  /* ---------- One agent ---------- */

  const card = (s: Shown, depth: number) => {
    const a = s.agent;
    const kids = a.children ?? [];
    const isFolded = folded.includes(a.id);
    const branch = kids.length ? costOf(a) : a.cost ?? 0;
    const until = a.ended ?? (a.status === "running" || a.status === "waiting" ? undefined : a.started);
    const hidden = isFolded ? walk(a).length - 1 : 0;
    const leaving = s.leaving !== undefined;
    return (
      <div
        className="ui-agt__node"
        data-status={a.status}
        data-depth={depth}
        data-leaving={leaving ? "" : undefined}
        aria-hidden={leaving || undefined}
        style={{ animationDelay: `${leaving ? s.leaving : enterDelay.current.get(a.id) ?? 0}ms` }}
        ref={(el) => {
          if (el) nodes.current.set(a.id, el);
          else nodes.current.delete(a.id);
        }}
        onClick={onSelect && !leaving ? () => onSelect(a) : undefined}
        tabIndex={onSelect && !leaving ? 0 : undefined}
        onKeyDown={
          onSelect
            ? (e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  onSelect(a);
                }
              }
            : undefined
        }
        data-clickable={onSelect ? "" : undefined}
      >
        {/* The white card on the gray layer: who and what; cost, time and folding sit on the layer below it */}
        <div className="ui-agt__card">
          <div className="ui-agt__top">
            <span className="ui-agt__avatar" data-logo={a.avatar ? "" : undefined}>
              {a.avatar ?? initials(a.name)}
            </span>
            <span className="ui-agt__who">
              <span className="ui-agt__name" dir="auto" title={a.name}>
              {a.name}
            </span>
              {a.model && (
              <span className="ui-agt__model" title={a.model}>
                {a.model}
              </span>
            )}
            </span>
            <span className="ui-agt__status" data-status={a.status}>
              <StatusIcon status={a.status} />
              {STATUS[a.status]}
            </span>
          </div>
          {/* What it does – led by the tools it uses as small overlapping tiles; a second line runs on under them */}
          {(a.task || a.tools?.length) ? (
            <p className="ui-agt__task" dir="auto" title={a.task}>
              {a.tools && a.tools.length > 0 && (
                <span className="ui-agt__tools" aria-hidden="true">
                  {(a.tools.length > 4 ? a.tools.slice(0, 3) : a.tools).map((tool, i) => (
                    <span key={i} className="ui-agt__tool">
                      {tool}
                    </span>
                  ))}
                  {a.tools.length > 4 && <span className="ui-agt__tool ui-agt__tool--more">+{a.tools.length - 3}</span>}
                </span>
              )}
              {a.task}
            </p>
          ) : null}
        </div>
        <div className="ui-agt__meta">
          <span className="ui-agt__cost" title={kids.length ? "This branch, with its sub-agents" : undefined}>
            <span className="ui-agt__amount" data-live={walk(a).some((x) => x.status === "running") ? "" : undefined}>
              {formatCost(branch)}
            </span>
            {a.started ? (
              <span className="ui-agt__time">
                {" · "}
                <Took since={a.started} until={until} now={nowProp} />
              </span>
            ) : null}
          </span>
          {kids.length > 0 && (
            <button
              type="button"
              className="ui-agt__fold"
              aria-expanded={!isFolded}
              aria-label={isFolded ? `Show ${hidden} sub-agents of ${a.name}` : `Fold the sub-agents of ${a.name}`}
              tabIndex={leaving ? -1 : undefined}
              onClick={(e) => {
                e.stopPropagation();
                toggle(a.id);
              }}
            >
              {isFolded ? `+${hidden}` : kids.length}
              <Chevron />
            </button>
          )}
        </div>
      </div>
    );
  };

  /** A card with everything that hangs below it */
  const hang = (s: Shown, depth: number): ReactNode => (
    <div
      className="ui-agt__hang"
      key={s.agent.id}
      style={depth === 1 ? { ["--ui-agt-col" as string]: Math.max(1, depthOf(s)) } : undefined}
      role="treeitem"
      aria-expanded={s.agent.children?.length ? !folded.includes(s.agent.id) : undefined}
      aria-label={`${s.agent.name}: ${STATUS[s.agent.status]}`}
    >
      {card(s, depth)}
      {s.kids.length > 0 && (
        <div className="ui-agt__below" role="group">
          {s.kids.map((k) => hang(k, depth + 1))}
        </div>
      )}
    </div>
  );

  // The deepest level on screen – narrow trees size every card to fit it, so all cards are as wide
  const deepest = (s: Shown, d: number): number => Math.max(d, ...s.kids.map((k) => deepest(k, d + 1)));
  const depth = deepest(shown, 0);

  const total = costOf(root);
  const running = all.filter((a) => a.status === "running").length;
  const waiting = all.filter((a) => a.status === "waiting").length;
  const failed = all.filter((a) => a.status === "failed").length;
  const openList = opened ? all.filter((a) => a.status === opened) : [];
  const resolve = (a: TreeAgent, action: "approve" | "reject" | "retry" | "dismiss") => {
    onResolve?.(a, action);
    if (openList.length <= 1) setOpened(null);
  };

  // One dot per parent, faded out with the last of its connectors
  const dots = new Map<string, { at: [number, number]; muted: boolean; leaving?: number }>();
  for (const l of links) {
    const key = l.dot.join(",");
    const d = dots.get(key);
    const leaving = l.leaving;
    if (!d) dots.set(key, { at: l.dot, muted: l.muted, leaving });
    else dots.set(key, { at: d.at, muted: d.muted && l.muted, leaving: d.leaving === undefined || leaving === undefined ? undefined : Math.max(d.leaving, leaving) });
  }

  return (
    <div className={["ui-agt", className].filter(Boolean).join(" ")} data-wide={wide ? "" : undefined}>
      <style href="ui-agent-tree" precedence="default">
        {css}
      </style>

      <header ref={barRef} className="ui-agt__bar">
        <span className="ui-agt__spark">
          <Spark />
        </span>
        <span className="ui-agt__title" dir="auto" title={title}>
          {title}
        </span>
        <span className="ui-agt__sum" aria-live="polite">
          <span>{all.length === 1 ? "1 agent" : `${count.format(all.length)} agents`}</span>
          {running > 0 && <span className="ui-agt__sum-run">{count.format(running)} running</span>}
          {waiting > 0 && (
            <button type="button" className="ui-agt__sum-btn" data-kind="waiting" aria-expanded={opened === "waiting"} aria-haspopup="dialog" onClick={() => setOpened((o) => (o === "waiting" ? null : "waiting"))}>
              {count.format(waiting)} needs you
              <Chevron />
            </button>
          )}
          {failed > 0 && (
            <button type="button" className="ui-agt__sum-btn" data-kind="failed" aria-expanded={opened === "failed"} aria-haspopup="dialog" onClick={() => setOpened((o) => (o === "failed" ? null : "failed"))}>
              {count.format(failed)} failed
              <Chevron />
            </button>
          )}
          <span className="ui-agt__sum-cost">
            <span className="ui-agt__amount" data-live={running > 0 ? "" : undefined}>
              {formatCost(total)}
            </span>
          </span>
        </span>

        {/* The window behind "needs you" and "failed": every such agent, with what to do about it */}
        {opened && openList.length > 0 && (
          <div className="ui-agt__pop" role="dialog" aria-label={opened === "waiting" ? "Agents that need you" : "Agents that failed"} onKeyDown={(e) => e.key === "Escape" && setOpened(null)}>
            {openList.map((a, i) => (
              <div key={a.id} className="ui-agt__pop-item">
                <span className="ui-agt__pop-head">
                  <span className="ui-agt__status" data-status={a.status}>
                    <StatusIcon status={a.status} />
                  </span>
                  <span className="ui-agt__pop-name" dir="auto">
                    {a.name}
                  </span>
                  <span className="ui-agt__pop-task" dir="auto">
                    {a.task}
                  </span>
                </span>
                {(opened === "waiting" ? a.ask : a.error) && <span className="ui-agt__pop-text" dir="auto">{opened === "waiting" ? a.ask : a.error}</span>}
                <span className="ui-agt__pop-actions">
                  <button type="button" className="ui-agt__btn" onClick={() => resolve(a, opened === "waiting" ? "reject" : "dismiss")}>
                    {opened === "waiting" ? "Reject" : "Dismiss"}
                  </button>
                  <button type="button" className="ui-agt__btn ui-agt__btn--primary" autoFocus={i === 0} onClick={() => resolve(a, opened === "waiting" ? "approve" : "retry")}>
                    {opened === "waiting" ? "Approve" : "Retry"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </header>

      <div ref={boxRef} className="ui-agt__tree" role="tree" aria-label={title} style={{ ["--ui-agt-depth" as string]: depth }}>
        <svg className="ui-agt__links" width={size.w} height={size.h} aria-hidden="true">
          {links.map((l) => (
            <g key={l.id} data-muted={l.muted ? "" : undefined} data-fresh={fresh.has(l.id) && l.leaving === undefined && !reduced() ? "" : undefined} data-leaving={l.leaving !== undefined ? "" : undefined}>
              <path
                d={l.d}
                pathLength={1}
                className="ui-agt__link"
                style={{ animationDelay: `${l.leaving !== undefined ? l.leaving : Math.max(0, l.enter - 160)}ms` }}
              />
            </g>
          ))}
        </svg>

        {/* The root on top, the first level side by side (or indented when narrow), the rest hanging below */}
        <div className="ui-agt__root" role="treeitem" aria-expanded={root.children?.length ? !folded.includes(root.id) : undefined} aria-label={`${root.name}: ${STATUS[root.status]}`}>
          {card(shown, 0)}
        </div>
        {shown.kids.length > 0 && (
          <div className="ui-agt__level" role="group">
            {shown.kids.map((k) => hang(k, 1))}
          </div>
        )}

        <svg className="ui-agt__links ui-agt__dots" width={size.w} height={size.h} aria-hidden="true">
          {/* One hollow dot where the connectors leave a parent – on top of the card's edge */}
          {[...dots].map(([key, d]) => (
            <circle
              key={key}
              cx={d.at[0]}
              cy={d.at[1]}
              r={3.25}
              className="ui-agt__dot"
              data-muted={d.muted ? "" : undefined}
              data-leaving={d.leaving !== undefined ? "" : undefined}
              style={d.leaving !== undefined ? { animationDelay: `${d.leaving}ms` } : undefined}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-agt */
.ui-agt {
  --ui-agt-tray: #f0f0f0;
  --ui-agt-card: #ffffff;
  --ui-agt-ink: #171717;
  --ui-agt-text: #6b6b6b;
  --ui-agt-muted: #8a8a8a;
  --ui-agt-faint: #b8b8b8;
  --ui-agt-line: #ececec;
  --ui-agt-chip: #f5f5f5;
  --ui-agt-accent: #2f6bff;
  /* The connectors: a soft blue with hollow dots, as in the Project Flow illustration */
  --ui-agt-link: #82bcff;
  --ui-agt-link-muted: #d6d6d6;
  --ui-agt-brand-bg: #eaf1ff;
  --ui-agt-brand-fg: #2456d6;
  --ui-agt-ok-bg: #e6f6ec;
  --ui-agt-ok-fg: #1a7f45;
  --ui-agt-warn-bg: #fff3e0;
  --ui-agt-warn-fg: #b85c00;
  --ui-agt-danger-bg: #fdecea;
  --ui-agt-danger-fg: #c2331f;
  --ui-agt-ring: rgba(23, 23, 23, 0.22);
  --ui-agt-card-w: 222px;
  --ui-agt-indent: 24px;
  --ui-agt-shine: #c4c4c4;
  --ui-agt-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 4px 0;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-agt-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-agt *, .ui-agt *::before, .ui-agt *::after { box-sizing: border-box; }
:where(.ui-agt) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-agt button:focus-visible { outline: 2px solid var(--ui-agt-ring); outline-offset: 2px; }
.ui-agt p { margin: 0; }
.ui-agt svg { display: block; flex: none; }

/* ----- The bar: title and the whole run in numbers ----- */
.ui-agt__bar { position: relative; z-index: 3; display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0 4px 18px; }
.ui-agt__spark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-agt-accent); }
.ui-agt__title { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-agt-ink); }
.ui-agt__sum { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 4px 12px; margin-left: auto; font-size: 12.5px; line-height: 18px; color: var(--ui-agt-muted); font-variant-numeric: tabular-nums; }
.ui-agt__sum-run { color: var(--ui-agt-brand-fg); }
.ui-agt__sum-wait { color: var(--ui-agt-warn-fg); }
.ui-agt__sum-fail { color: var(--ui-agt-danger-fg); }
.ui-agt__sum-cost { min-width: 46px; color: var(--ui-agt-ink); font-weight: 600; text-align: right; }
/* "needs you" and "failed" open a small window to deal with them */
.ui-agt__sum-btn { display: inline-flex; align-items: center; gap: 2px; height: 24px; margin: -3px 0; padding: 0 6px 0 9px; border-radius: 999px; font-size: 12.5px; font-weight: 500; transition: filter 160ms ease; }
.ui-agt__sum-btn[data-kind="waiting"] { background: var(--ui-agt-warn-bg); color: var(--ui-agt-warn-fg); }
.ui-agt__sum-btn[data-kind="failed"] { background: var(--ui-agt-danger-bg); color: var(--ui-agt-danger-fg); }
.ui-agt__sum-btn:hover { filter: saturate(1.3) brightness(0.97); }
.ui-agt__sum-btn > svg { transition: transform 220ms var(--ui-agt-ease); }
.ui-agt__sum-btn[aria-expanded="true"] > svg { transform: rotate(180deg); }
.ui-agt__pop { max-height: min(440px, 70vh); overflow-y: auto; overscroll-behavior: contain; position: absolute; top: calc(100% + 8px); right: 0; z-index: 5; display: grid; gap: 4px; width: 310px; max-width: 100%; padding: 6px; border-radius: 16px; background: var(--ui-agt-card); box-shadow: 0 0 0 1px var(--ui-agt-line), 0 16px 32px -12px rgba(0, 0, 0, 0.2); animation: ui-agt-pop 200ms var(--ui-agt-ease) both; }
.ui-agt__pop-item { min-width: 0; display: grid; gap: 4px; padding: 10px; }
.ui-agt__pop-item + .ui-agt__pop-item { border-top: 1px solid var(--ui-agt-line); }
.ui-agt__pop-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-agt__pop-head .ui-agt__status { width: 22px; padding: 0; justify-content: center; }
.ui-agt__pop-name { flex: 0 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-agt-ink); }
.ui-agt__pop-task { flex: 1 1 0; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-agt-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agt__pop-text { overflow-wrap: anywhere; padding-left: 30px; font-size: 12.5px; line-height: 17px; color: var(--ui-agt-text); }
.ui-agt__pop-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 6px; }
.ui-agt__btn { display: inline-flex; align-items: center; height: 32px; padding: 0 14px; border-radius: 10px; background: var(--ui-agt-card); box-shadow: 0 0 0 1px var(--ui-agt-line), 0 1px 2px rgba(0, 0, 0, 0.04); font-size: 13.5px; font-weight: 500; color: var(--ui-agt-ink); transition: background-color 160ms ease, opacity 160ms ease; }
.ui-agt__btn:hover { background: var(--ui-agt-chip); }
.ui-agt__btn--primary { background: var(--ui-agt-ink); box-shadow: none; color: var(--ui-agt-card); }
.ui-agt__btn--primary:hover { background: var(--ui-agt-ink); opacity: 0.88; }

/* ----- The tree ----- */
.ui-agt__tree { position: relative; display: grid; justify-items: center; }
.ui-agt__links { position: absolute; top: 0; left: 0; overflow: visible; pointer-events: none; }
.ui-agt__link { fill: none; stroke: var(--ui-agt-link); stroke-width: 1.75; stroke-linecap: round; transition: stroke 240ms ease; }
.ui-agt__links [data-muted] .ui-agt__link { stroke: var(--ui-agt-link-muted); }
.ui-agt__links [data-fresh] .ui-agt__link { stroke-dasharray: 1 1; stroke-dashoffset: 1; animation: ui-agt-draw 420ms var(--ui-agt-ease) both; }
.ui-agt__dots { z-index: 2; }
.ui-agt__dot { fill: var(--ui-agt-dot, #ffffff); stroke: var(--ui-agt-link); stroke-width: 1.75; transition: stroke 240ms ease; }
.ui-agt__dot[data-muted] { stroke: var(--ui-agt-link-muted); }

/* Wide: the first level side by side under the root, each with its branch hanging below */
.ui-agt__root { position: relative; z-index: 1; }
.ui-agt__level { position: relative; z-index: 1; display: flex; align-items: flex-start; justify-content: center; gap: 8px; width: 100%; margin-top: 40px; }
/* Every column as wide as a card plus its indent, and the root over the middle of the cards – so an odd middle connector runs straight down */
.ui-agt__level > .ui-agt__hang { flex: none; width: calc(var(--ui-agt-card-w) + var(--ui-agt-indent) * var(--ui-agt-col, 1)); }
.ui-agt[data-wide] .ui-agt__root:has(+ .ui-agt__level) { margin-right: var(--ui-agt-indent); }
.ui-agt__hang { display: grid; align-content: start; gap: 12px; }
.ui-agt__below { display: grid; gap: 12px; padding-left: var(--ui-agt-indent); }
.ui-agt:not([data-wide]) .ui-agt__tree { justify-items: stretch; }
.ui-agt:not([data-wide]) .ui-agt__tree { container-type: inline-size; }
/* Every card is as wide as the others: a fixed width side by side, and room for the deepest level when indented */
.ui-agt__node { width: var(--ui-agt-card-w); }
/* Deep trees: the indent shrinks so no card gets narrower than 180px */
.ui-agt:not([data-wide]) .ui-agt__tree { --ui-agt-step: min(var(--ui-agt-indent), max(12px, (100cqw - 180px) / max(1, var(--ui-agt-depth, 1)))); }
.ui-agt:not([data-wide]) .ui-agt__node { width: calc(100cqw - var(--ui-agt-depth, 0) * var(--ui-agt-step)); }
.ui-agt:not([data-wide]) .ui-agt__below { padding-left: var(--ui-agt-step); }
.ui-agt:not([data-wide]) .ui-agt__level { display: grid; gap: 12px; margin-top: 12px; padding-left: var(--ui-agt-step); }
/* Narrow: the first level is a plain indented list – no fixed column width, no centering */
.ui-agt:not([data-wide]) .ui-agt__level { justify-content: stretch; }
.ui-agt:not([data-wide]) .ui-agt__level > .ui-agt__hang { width: auto; }

/* One agent: the gray layer with a white card on it, like every component of the library */
.ui-agt__node { position: relative; display: grid; padding: 4px; border-radius: 16px; background: var(--ui-agt-tray); animation: ui-agt-rise 360ms var(--ui-agt-ease) both; transition: opacity 240ms ease; }
.ui-agt__card { display: grid; gap: 6px; min-width: 0; padding: 9px 10px 10px 10px; border-radius: 12px; background: var(--ui-agt-card); box-shadow: 0 0 0 1px var(--ui-agt-line), 0 1px 2px rgba(0, 0, 0, 0.04); transition: box-shadow 200ms ease; }
/* Leaving: the card fades and sinks a little, its connector pulls back into the parent */
.ui-agt__node[data-leaving] { animation: ui-agt-leave ${EXIT}ms var(--ui-agt-ease) forwards; pointer-events: none; }
.ui-agt__links [data-leaving] .ui-agt__link { stroke-dasharray: 1 1; stroke-dashoffset: 0; animation: ui-agt-retract ${EXIT}ms var(--ui-agt-ease) forwards; }
.ui-agt__dot[data-leaving] { animation: ui-agt-fade ${EXIT}ms ease forwards; }
.ui-agt__node[data-clickable] { cursor: pointer; }
.ui-agt__node:focus-visible { outline: 2px solid var(--ui-agt-ring); outline-offset: 2px; }
.ui-agt__node[data-clickable]:hover .ui-agt__card { box-shadow: 0 0 0 1px #e0e0e0, 0 4px 12px -4px rgba(0, 0, 0, 0.1); }
.ui-agt__node[data-status="queued"], .ui-agt__node[data-status="stopped"] { opacity: 0.6; }
.ui-agt__top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-agt__avatar { display: grid; flex: none; place-items: center; width: 24px; height: 24px; border-radius: 8px; background: var(--ui-agt-card); box-shadow: 0 0 0 1px var(--ui-agt-line), 0 1px 2px rgba(0, 0, 0, 0.06); font-size: 10px; font-weight: 600; color: var(--ui-agt-text); }
.ui-agt__avatar[data-logo] > svg { width: 14px; height: 14px; }
.ui-agt__who { display: grid; flex: 1; min-width: 0; }
.ui-agt__name { overflow: hidden; font-size: 13px; font-weight: 600; line-height: 17px; color: var(--ui-agt-ink); white-space: nowrap; text-overflow: ellipsis; }
/* The tools: small white tiles, each slightly over the one before */
.ui-agt__tools { display: inline-flex; margin-right: 6px; vertical-align: top; }
.ui-agt__tool { display: grid; flex: none; place-items: center; width: 17px; height: 17px; border-radius: 5px; background: var(--ui-agt-card); box-shadow: 0 0 0 1px var(--ui-agt-line), 0 1px 2px rgba(0, 0, 0, 0.06); }
.ui-agt__tool + .ui-agt__tool { margin-left: -5px; }
.ui-agt__tool > svg { width: 10px; height: 10px; }
.ui-agt__tool--more { width: auto; min-width: 16px; padding: 0 3px; font-size: 9px; font-weight: 600; line-height: 16px; color: var(--ui-agt-muted); font-variant-numeric: tabular-nums; }
.ui-agt__model { overflow: hidden; font-size: 11.5px; line-height: 15px; color: var(--ui-agt-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agt__status { display: inline-flex; flex: none; align-self: start; align-items: center; gap: 3px; height: 20px; padding: 0 7px 0 5px; border-radius: 999px; background: var(--ui-agt-chip); font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-agt-text); white-space: nowrap; }
.ui-agt__status[data-status="running"] { background: var(--ui-agt-brand-bg); color: var(--ui-agt-brand-fg); }
.ui-agt__spin { animation: ui-agt-spin 900ms linear infinite; }
.ui-agt__status[data-status="waiting"] { background: var(--ui-agt-warn-bg); color: var(--ui-agt-warn-fg); }
.ui-agt__status[data-status="done"] { background: var(--ui-agt-ok-bg); color: var(--ui-agt-ok-fg); }
.ui-agt__status[data-status="failed"] { background: var(--ui-agt-danger-bg); color: var(--ui-agt-danger-fg); }
/* A little room around the text, so the tiles' hairline and shadow aren't clipped by the line clamp */
.ui-agt__task { text-align: start; overflow-wrap: anywhere; display: -webkit-box; overflow: hidden; margin: -2px -2px -3px !important; padding: 2px 2px 3px; font-size: 12.5px; line-height: 17px; color: var(--ui-agt-text); -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-agt__meta { display: flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 4px 0 8px; }
.ui-agt__cost { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; font-weight: 600; line-height: 16px; color: var(--ui-agt-ink); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
/* Costs that still climb: a light shimmer runs over the amount */
.ui-agt__amount[data-live] {
  background: linear-gradient(90deg, currentColor 0%, currentColor 38%, var(--ui-agt-shine) 50%, currentColor 62%, currentColor 100%) 0 0 / 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: ui-agt-shine 1100ms linear infinite;
}
.ui-agt__time { font-weight: 400; color: var(--ui-agt-muted); }
.ui-agt__fold { display: inline-flex; flex: none; align-items: center; gap: 2px; height: 22px; margin-right: -2px; padding: 0 4px 0 6px; border-radius: 999px; font-size: 11.5px; font-weight: 500; color: var(--ui-agt-text); font-variant-numeric: tabular-nums; transition: background-color 160ms ease, color 160ms ease; }
.ui-agt__fold:hover { background: var(--ui-agt-fold-hover, #e4e4e4); color: var(--ui-agt-ink); }
.ui-agt__fold > svg { transition: transform 220ms var(--ui-agt-ease); }
.ui-agt__fold[aria-expanded="false"] > svg { transform: rotate(-90deg); }

@keyframes ui-agt-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes ui-agt-draw { to { stroke-dashoffset: 0; } }
@keyframes ui-agt-retract { to { stroke-dashoffset: 1; } }
@keyframes ui-agt-leave { to { opacity: 0; transform: translateY(4px) scale(0.97); } }
@keyframes ui-agt-fade { to { opacity: 0; } }
@keyframes ui-agt-rise { from { opacity: 0; transform: translateY(6px) scale(0.98); } }
@keyframes ui-agt-spin { to { transform: rotate(360deg); } }
@keyframes ui-agt-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }

@media (pointer: coarse) {
  .ui-agt__fold { height: 32px; padding: 0 10px 0 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-agt *, .ui-agt *::before, .ui-agt *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-agt__node[data-clickable]:hover .ui-agt__card { box-shadow: 0 0 0 1px #34343a, 0 4px 12px -4px rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) .ui-agt {
  --ui-agt-tray: #19191c;
  --ui-agt-shine: #6a6a70;
  --ui-agt-card: #232326;
  --ui-agt-dot: #111113;
  --ui-agt-fold-hover: #2a2a2e;
  --ui-agt-ink: #ededed;
  --ui-agt-text: #a1a1a6;
  --ui-agt-muted: #7c7c82;
  --ui-agt-faint: #4a4a50;
  --ui-agt-line: #2a2a2e;
  --ui-agt-chip: #26262a;
  --ui-agt-accent: #5b9aff;
  --ui-agt-link: #4f8fdb;
  --ui-agt-link-muted: #3a3a40;
  --ui-agt-brand-bg: #16243f;
  --ui-agt-brand-fg: #8ab4ff;
  --ui-agt-ok-bg: #12301f;
  --ui-agt-ok-fg: #3dd68c;
  --ui-agt-warn-bg: #3a2410;
  --ui-agt-warn-fg: #ffa057;
  --ui-agt-danger-bg: #3b1714;
  --ui-agt-danger-fg: #ff977d;
  --ui-agt-ring: rgba(237, 237, 237, 0.3);
}
`;
