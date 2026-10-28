"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Agent Graph (clean style) – agents and the tools they use, drawn as a living network, in a single self-contained file.
 * Quiet like the rest of the clean style: one white panel, white rounded squares with 0.5px hairlines, Inter 400/500.
 * The lead agent sits in the middle, the agents it hands work to on an inner orbit, and the tools, data sources and you
 * on an outer orbit – each tool turned towards the agents that use it, so the links stay short and rarely cross.
 * Nodes are rounded squares and links straight lines with one right-angled turn, like the branches in Agent Tree: a tool
 * almost in line with its agent moves into line, and links sharing a side of a node run side by side, never on top of
 * each other.
 *   · every link is the same light gray line; a call sends a short line along it that fades out behind – blue out to the
 *     tool, green back with the answer – and the node it reaches ripples once
 *   · working agents breathe with a soft ring; an agent that waits for you turns amber, and its link to you with it;
 *     a failed call comes back red and flashes the link; waiting and failed nodes get a light amber or red fill with a shine sweeping across and a thin stroke running around
 *   · nodes glide to their new place when the graph changes – a new tool slides out of
 *     the agent that first calls it while its link draws itself, a tool that goes fades away
 *   · hover or focus a node to light up its neighbourhood – the rest dims; click it for a card with what it does,
 *     its latest calls and its cost
 *   · the bar on top counts agents, tools, calls per minute and the total cost
 * The layout is computed from the width (measured with a ResizeObserver): narrow containers get tighter orbits,
 * smaller nodes and short labels. The styles are injected below, so no extra files are needed.
 */

export type GraphNodeKind = "agent" | "tool" | "user";
export type GraphNodeStatus = "idle" | "working" | "waiting" | "error" | "done";

export type GraphNode = {
  id: string;
  name: string;
  /** "agent" sits on the inner orbit (the lead in the middle), "tool" and "user" on the outer one */
  kind: GraphNodeKind;
  /** A shorter name for narrow containers, e.g. "Search" for "Web search" */
  short?: string;
  /** A small mark, e.g. the model maker's or the tool's logo – defaults to the initials */
  icon?: ReactNode;
  /** One line under the name – the model of an agent, what a tool is */
  detail?: string;
  status?: GraphNodeStatus;
  /** What it is doing right now – shown in its card */
  doing?: string;
  /** What it has cost so far – summed up in the bar */
  cost?: number;
  /** The agent in the middle – defaults to the first agent */
  lead?: boolean;
};

export type GraphCall = {
  id: string;
  /** Who calls … */
  from: string;
  /** … and who is called – a tool, another agent, or you */
  to: string;
  /** What was asked, e.g. "search: pricing linear.app" */
  label?: string;
  /** "pending" sends the pulse out; once it turns "ok" or "error" the answer travels back */
  status?: "pending" | "ok" | "error";
  /** When it was made (ms) */
  at: number;
  /** How long it took (ms) */
  ms?: number;
};

export type AgentGraphProps = {
  nodes: GraphNode[];
  /** Recent calls, newest last – every new id sends a pulse. Calls also draw the links they need */
  calls?: GraphCall[];
  /** Links that are always there, even before their first call */
  edges?: [string, string][];
  /** The clock for calls per minute and link heat – defaults to now */
  now?: number;
  /** How far back calls count towards a link's activity (ms) */
  heatWindow?: number;
  /** A click on a node – it also opens its card; null when the card closes */
  onSelect?: (node: GraphNode | null) => void;
  /** Fixed height of the graph in px – defaults to one that fits the width */
  height?: number;
  /** Formats every cost – defaults to dollars, e.g. "$0.42" */
  formatCost?: (amount: number) => string;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const STATUS: Record<GraphNodeStatus, string> = { idle: "Idle", working: "Working", waiting: "Needs you", error: "Error", done: "Done" };
const KIND: Record<GraphNodeKind, string> = { agent: "agent", tool: "tool", user: "you" };
/** A number that came in broken (NaN, Infinity) counts as not given */
const num = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
const dollars = (n: number) => {
  const a = Math.abs(n);
  const s = a > 0 && a < 0.005 ? "<$0.01" : `$${a < 10 ? a.toFixed(2) : Math.round(a).toLocaleString("en-US")}`;
  return n < 0 && s !== "$0.00" ? `-${s}` : s;
};
const pad = (n: number) => String(n).padStart(2, "0");
const took = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${m}m ${pad(Math.floor(ms / 1000) % 60)}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
/** The first letter or digit of the first two words – whole characters, so an emoji or markup never gives half a sign */
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
/** The circular mean of fractions of a turn */
const circMean = (us: number[]) => {
  let s = 0;
  let c = 0;
  for (const u of us) {
    s += Math.sin(u * TAU);
    c += Math.cos(u * TAU);
  }
  return (((Math.atan2(s, c) / TAU) % 1) + 1) % 1;
};

type Pt = { x: number; y: number };
/** 0 = the middle, 1 = the inner orbit, 2 = the outer orbit */
type Ring = 0 | 1 | 2;
type Spot = Pt & { ring: Ring };

/** A point on an ellipse at a share u of its length, starting at the top and going clockwise – so nodes sit evenly apart */
const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
  const N = 240;
  const cum = [0];
  let px = cx;
  let py = cy - ry;
  for (let i = 1; i <= N; i++) {
    const t = -Math.PI / 2 + (i / N) * TAU;
    const x = cx + rx * Math.cos(t);
    const y = cy + ry * Math.sin(t);
    cum.push(cum[i - 1] + Math.hypot(x - px, y - py));
    px = x;
    py = y;
  }
  const total = cum[N] || 1;
  return (u: number): Pt => {
    const goal = (((u % 1) + 1) % 1) * total;
    let i = 1;
    while (i < N && cum[i] < goal) i++;
    const f = (goal - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const t = -Math.PI / 2 + ((i - 1 + f) / N) * TAU;
    return { x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) };
  };
};

type Layout = {
  w: number;
  h: number;
  narrow: boolean;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** The inner orbit as a share of the outer one, across and down */
  ix: number;
  iy: number;
  lead?: string;
  spots: Map<string, Spot>;
  /** Diameter of every node */
  size: Map<string, number>;
  /** When each node pops in on the first draw – and when its links start drawing */
  pop: Map<string, number>;
  draw: Map<string, number>;
};

const SIZES = {
  wide: { lead: 56, agent: 46, tool: 34, user: 34 },
  narrow: { lead: 42, agent: 34, tool: 28, user: 28 },
};

/** Where every node goes: the lead in the middle, agents evenly on the inner orbit, the rest on the outer one near their agents */
const layOut = (nodes: GraphNode[], pairs: [string, string][], w: number, h: number): Layout => {
  const narrow = w < 520;
  const sz = narrow ? SIZES.narrow : SIZES.wide;
  const labelHalf = narrow ? 28 : 48;
  const toolR = sz.tool / 2;
  const padX = toolR + labelHalf;
  // Outer nodes in the top part carry their label above them (their links come from below), so the top needs label room too
  const padTop = toolR + (narrow ? 40 : 46);
  const padBottom = toolR + (narrow ? 40 : 46);
  const cx = w / 2;
  const rx = Math.max(40, w / 2 - padX);
  const ry = Math.max(40, (h - padTop - padBottom) / 2);
  const cy = padTop + ry;
  // Narrow graphs are taller than wide: the inner orbit gets narrower and taller, to keep clear of the tools at the sides
  const ix = narrow ? 0.5 : 0.5;
  const iy = narrow ? 0.64 : 0.5;
  const outerAt = ellipse(cx, cy, rx, ry);
  const innerAt = ellipse(cx, cy, rx * ix, ry * iy);

  const agents = nodes.filter((n) => n.kind === "agent");
  const lead = (agents.find((a) => a.lead) ?? agents[0])?.id;
  const ring = agents.filter((a) => a.id !== lead);
  const outer = nodes.filter((n) => n.kind !== "agent");
  const spots = new Map<string, Spot>();
  const size = new Map<string, number>();
  const pop = new Map<string, number>();
  const draw = new Map<string, number>();

  if (lead) {
    spots.set(lead, { x: cx, y: cy, ring: 0 });
    pop.set(lead, 0);
    draw.set(lead, -1);
  }
  const uOf = new Map<string, number>();
  ring.forEach((a, i) => {
    const u = ring.length === 1 ? 0.5 : (i + 0.5) / ring.length;
    uOf.set(a.id, u);
    spots.set(a.id, { ...innerAt(u), ring: 1 });
    draw.set(a.id, 140 + i * 90);
    pop.set(a.id, 140 + i * 90 + 260);
  });


  // Each outer node prefers the direction of the agents it talks to; then they share the orbit evenly, in that order
  const neighbours = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    neighbours.set(a, [...(neighbours.get(a) ?? []), b]);
    neighbours.set(b, [...(neighbours.get(b) ?? []), a]);
  }
  const prefs = outer.map((n, i) => {
    const us = (neighbours.get(n.id) ?? []).map((id) => uOf.get(id)).filter((u): u is number => u !== undefined);
    const pref = us.length ? circMean(us) : n.kind === "user" ? 0 : (i + 0.5) / Math.max(1, outer.length);
    return { id: n.id, pref, i };
  });
  prefs.sort((a, b) => a.pref - b.pref || a.i - b.i);
  const m = prefs.length;
  if (m) {
    const offset = circMean(prefs.map((p, i) => p.pref - i / m));
    prefs.forEach((p, i) => {
      const u = offset + i / m;
      spots.set(p.id, { ...outerAt(u), ring: 2 });
    });
    // Popping in on the first draw: around the orbit, starting at the top
    [...prefs]
      .sort((a, b) => ((offset + prefs.indexOf(a) / m) % 1) - ((offset + prefs.indexOf(b) / m) % 1))
      .forEach((p, i) => {
        draw.set(p.id, 620 + i * 70);
        pop.set(p.id, 620 + i * 70 + 260);
      });
  }
  for (const n of nodes) size.set(n.id, n.id === lead ? sz.lead : sz[n.kind]);
  const snap = Math.min(96, w * 0.12);
  const room = narrow ? { x: 64, y: 76 } : { x: 96, y: 84 };
  // First, any outer node sitting on another node takes the nearest free spot – outwards first, then turning either way
  // around it (tight on phones, where the orbits are close)
  const free = (id: string, p: Pt) => [...spots].every(([o, q]) => o === id || Math.abs(q.x - p.x) > room.x * 0.8 || Math.abs(q.y - p.y) > room.y * 0.8);
  for (const n of outer) {
    const at = spots.get(n.id);
    if (!at || free(n.id, at)) continue;
    const out = Math.atan2(at.y - cy, at.x - cx);
    search: for (let r = 8; r <= 120; r += 8)
      for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6]) {
        const p = { x: at.x + Math.cos(out + turn) * r, y: at.y + Math.sin(out + turn) * r };
        if (p.x < padX || p.x > w - padX || p.y < padTop || p.y > h - padBottom || !free(n.id, p)) continue;
        at.x = p.x;
        at.y = p.y;
        break search;
      }
  }
  // An outer node almost in line with its first agent moves into line, so its link runs straight, without a tiny jog
  for (const n of outer) {
    const at = spots.get(n.id);
    const near = (neighbours.get(n.id) ?? []).map((id) => spots.get(id));
    const ag = near.find((p) => p?.ring === 1) ?? near.find((p) => p?.ring === 0);
    if (!at || !ag) continue;
    // Only where it stays clear of every other node and its label
    const clear = (p: Pt) => [...spots].every(([id, q]) => id === n.id || Math.abs(q.x - p.x) > room.x || Math.abs(q.y - p.y) > room.y);
    // A few pixels off always snap – a tiny jog looks like a mistake
    const dx = Math.abs(at.x - ag.x);
    const dy = Math.abs(at.y - ag.y);
    if (dx < 8 || (dx < snap && clear({ x: ag.x, y: at.y }))) at.x = ag.x;
    else if (dy < 8 || (dy < snap && clear({ x: at.x, y: ag.y }))) at.y = ag.y;
  }
  return { w, h, narrow, cx, cy, rx, ry, ix, iy, lead, spots, size, pop, draw };
};

const f1 = (n: number) => Math.round(n * 10) / 10;
/** A link as drawn: its path, and a point at a share t of its length */
type Route = { d: string; at: (t: number) => Pt };
/** Straight lines with one right-angled turn, like a branch in Agent Tree: "vh" leaves the first point up or down and
 *  turns sideways into the second, "hv" the other way round – the corner rounded a little */
const CORNER = 8;
const squareRoute = (a: Pt, b: Pt, first: "vh" | "hv"): Route => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const r = Math.min(CORNER, Math.abs(dx), Math.abs(dy));
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1 || r < 0.5) {
    const d = `M${f1(a.x)} ${f1(a.y)}L${f1(b.x)} ${f1(b.y)}`;
    return { d, at: (t) => ({ x: a.x + dx * t, y: a.y + dy * t }) };
  }
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const c: Pt = first === "vh" ? { x: a.x, y: b.y } : { x: b.x, y: a.y };
  const p1: Pt = first === "vh" ? { x: c.x, y: c.y - sy * r } : { x: c.x - sx * r, y: c.y };
  const p2: Pt = first === "vh" ? { x: c.x + sx * r, y: c.y } : { x: c.x, y: c.y + sy * r };
  const d = `M${f1(a.x)} ${f1(a.y)}L${f1(p1.x)} ${f1(p1.y)}Q${f1(c.x)} ${f1(c.y)} ${f1(p2.x)} ${f1(p2.y)}L${f1(b.x)} ${f1(b.y)}`;
  // The same path as a dense polyline, measured, so a pulse moves along it at an even speed
  const pts: Pt[] = [a, p1];
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    const u = 1 - t;
    pts.push({ x: u * u * p1.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p1.y + 2 * u * t * c.y + t * t * p2.y });
  }
  pts.push(b);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  return {
    d,
    at: (t) => {
      const goal = clamp(t, 0, 1) * total;
      let i = 1;
      while (i < pts.length - 1 && cum[i] < goal) i++;
      const f = (goal - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f };
    },
  };
};
type Side = "top" | "bottom" | "left" | "right";
type Turn = "vh" | "hv" | "v" | "h";
/** Every square link at once. Each picks its turn: from the lead up or down a trunk, then sideways into the agent; from an
 *  agent sideways when the tool lies further out, otherwise up or down first – and the other way round if that runs through a
 *  node. Then each side of a node spreads the links it has there side by side, centred on it, ordered so they never cross */
const squareLinks = (keys: string[], at: Map<string, Spot>, size: Map<string, number>, c: Pt, gap: number): Map<string, Route> => {
  type Plan = { key: string; p: Spot; q: Spot; turn: Turn; op: number; oq: number };
  type Port = { plan: Plan; end: "p" | "q"; order: number };
  const plans: Plan[] = [];
  const ports = new Map<string, Port[]>();
  const hits = (pts: Pt[], skip: string[]) => {
    let n = 0;
    for (const [id, s] of at) {
      if (skip.includes(id)) continue;
      const r = (size.get(id) ?? 34) / 2 + 6;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if (Math.min(a.x, b.x) - r < s.x && s.x < Math.max(a.x, b.x) + r && Math.min(a.y, b.y) - r < s.y && s.y < Math.max(a.y, b.y) + r) n++;
      }
    }
    return n;
  };
  const addPort = (id: string, side: Side, port: Port) => {
    const k = `${id}:${side}`;
    ports.set(k, [...(ports.get(k) ?? []), port]);
  };
  for (const key of keys) {
    const [a, b] = key.split("|");
    const sa = at.get(a);
    const sb = at.get(b);
    if (!sa || !sb) continue;
    const inner = sa.ring < sb.ring || (sa.ring === sb.ring && a < b);
    const [pid, qid] = inner ? [a, b] : [b, a];
    const p = inner ? sa : sb;
    const q = inner ? sb : sa;
    let turn: Turn;
    if (Math.abs(q.x - p.x) < 1) turn = "v";
    else if (Math.abs(q.y - p.y) < 1) turn = "h";
    else {
      const out = Math.sign(q.x - p.x) === Math.sign(p.x - c.x) || Math.abs(p.x - c.x) < 1;
      const pref: Turn = p.ring === 0 ? "vh" : p.ring === q.ring || out ? "hv" : "vh";
      const other: Turn = pref === "vh" ? "hv" : "vh";
      const via = (t: Turn) => [p, t === "vh" ? { x: p.x, y: q.y } : { x: q.x, y: p.y }, q];
      turn = hits(via(pref), [pid, qid]) > hits(via(other), [pid, qid]) ? other : pref;
    }
    const plan: Plan = { key, p, q, turn, op: 0, oq: 0 };
    plans.push(plan);
    // The side each end sits on; along it, a link that turns sooner sits further out – towards where it turns
    const pUp = turn === "v" || turn === "vh";
    const qUp = turn === "v" || turn === "hv";
    const first = pUp ? Math.abs(q.y - p.y) : Math.abs(q.x - p.x);
    const second = pUp ? Math.abs(q.x - p.x) : Math.abs(q.y - p.y);
    const pDir = turn === "v" || turn === "h" ? 0 : pUp ? Math.sign(q.x - p.x) : Math.sign(q.y - p.y);
    const qDir = turn === "v" || turn === "h" ? 0 : qUp ? Math.sign(p.x - q.x) : Math.sign(p.y - q.y);
    addPort(pid, pUp ? (q.y > p.y ? "bottom" : "top") : q.x > p.x ? "right" : "left", { plan, end: "p", order: pDir * (1e5 - first) });
    addPort(qid, qUp ? (p.y > q.y ? "bottom" : "top") : p.x > q.x ? "right" : "left", { plan, end: "q", order: qDir * (1e5 - second) });
  }
  for (const [k, list] of ports) {
    if (list.length < 2) continue;
    const d = size.get(k.slice(0, k.lastIndexOf(":"))) ?? 34;
    const g = Math.min(gap, (d * 0.6) / (list.length - 1));
    list.sort((x, y) => x.order - y.order);
    list.forEach((pt, i) => {
      const o = (i - (list.length - 1) / 2) * g;
      if (pt.end === "p") pt.plan.op = o;
      else pt.plan.oq = o;
    });
  }
  const routes = new Map<string, Route>();
  for (const { key, p, q, turn, op, oq } of plans) {
    if (turn === "v") {
      const x = p.x + (op || oq);
      routes.set(key, squareRoute({ x, y: p.y }, { x, y: q.y }, "vh"));
    } else if (turn === "h") {
      const y = p.y + (op || oq);
      routes.set(key, squareRoute({ x: p.x, y }, { x: q.x, y }, "hv"));
    } else if (turn === "vh") routes.set(key, squareRoute({ x: p.x + op, y: p.y }, { x: q.x, y: q.y + oq }, "vh"));
    else routes.set(key, squareRoute({ x: p.x, y: p.y + op }, { x: q.x + oq, y: q.y }, "hv"));
  }
  return routes;
};
const easeInOut = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/* ---------- Icons ---------- */

/* A small network: the title mark */
const GraphMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M8 8.4 3.2 4M8 8.4l5-4.2M8 8.4l4.4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.5" />
    <circle cx="8" cy="8.4" r="2.4" fill="currentColor" />
    <circle cx="3.2" cy="4" r="1.6" fill="currentColor" />
    <circle cx="13" cy="4.2" r="1.6" fill="currentColor" />
    <circle cx="12.4" cy="12.4" r="1.6" fill="currentColor" />
  </svg>
);
/* User, cancel, arrows, check, alert, clock: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M6.57757 15.4816C5.1628 16.324 1.45336 18.0441 3.71266 20.1966C4.81631 21.248 6.04549 22 7.59087 22H16.4091C17.9545 22 19.1837 21.248 20.2873 20.1966C22.5466 18.0441 18.8372 16.324 17.4224 15.4816C14.1048 13.5061 9.89519 13.5061 6.57757 15.4816Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M16.5 6.5C16.5 8.98528 14.4853 11 12 11C9.51472 11 7.5 8.98528 7.5 6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5Z" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);
const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M19 5L5 19M5 5L19 19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const OutIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 12L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15 17C15 17 20 13.3176 20 12C20 10.6824 15 7 15 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const InIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 12L20 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9 17C9 17 4 13.3176 4 12C4 10.6824 9 7 9 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
  </svg>
);
const AlertIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 7V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    <path d="M12 17.5V17.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3.4" />
  </svg>
);
const ClockIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 6.5V12L15 14.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.8" />
  </svg>
);
const Spinner = () => (
  <svg className="ui-aggc__spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
    <path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
  </svg>
);

/* ---------- The moving parts, kept outside React: positions, pulses, ripples ---------- */

type Body = { x: number; y: number; vx: number; vy: number };
type Pulse = {
  call: string;
  from: string;
  to: string;
  kind: "req" | "res" | "err" | "ask" | "askres";
  start: number;
  dur: number;
  /** For a request: how its call ended, once known – the answer leaves when the request arrives */
  then?: "ok" | "error";
  el?: SVGGElement;
  live?: boolean;
};
type Ripple = { node: string; kind: Pulse["kind"]; start: number; el?: SVGCircleElement | SVGRectElement };
type Flash = { el: Element; attr: string; until: number };

const SVGNS = "http://www.w3.org/2000/svg";
const EXIT = 420;
const RIPPLE = 720;

export function AgentGraph({
  nodes,
  calls = [],
  edges = [],
  now: nowProp,
  heatWindow = 20000,
  onSelect,
  height,
  formatCost = dollars,
  title = "Agent graph",
  className,
}: AgentGraphProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef<SVGGElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardId = useId();
  const [w, setW] = useState(0);
  const [reduced, setReduced] = useState(false);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    setW(el.offsetWidth);
    const ro = new ResizeObserver(() => setW(el.offsetWidth));
    ro.observe(el);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMq);
    };
  }, []);

  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;

  /* ---------- Nodes on their way out stay a moment, to fade ---------- */

  const prevNodes = useRef(new Map<string, GraphNode>());
  const [ghosts, setGhosts] = useState<GraphNode[]>([]);
  const ids = new Set(nodes.map((n) => n.id));
  const leaving = ghosts.filter((g) => !ids.has(g.id));
  const leavingIds = new Set(leaving.map((g) => g.id));
  useLayoutEffect(() => {
    const prev = prevNodes.current;
    const gone = [...prev.values()].filter((n) => !ids.has(n.id));
    prevNodes.current = new Map(nodes.map((n) => [n.id, n]));
    if (!gone.length) return;
    const goneIds = new Set(gone.map((g) => g.id));
    setGhosts((gs) => [...gs.filter((g) => !goneIds.has(g.id)), ...gone]);
    window.setTimeout(() => setGhosts((gs) => gs.filter((g) => !goneIds.has(g.id))), EXIT + 40);
  });
  const shownNodes = [...nodes, ...leaving];
  const byId = new Map(shownNodes.map((n) => [n.id, n]));

  /* ---------- Links: the fixed ones plus every pair that called each other ---------- */

  const pairMap = new Map<string, [string, string]>();
  const addPair = (a: string, b: string) => {
    if (a === b || !byId.has(a) || !byId.has(b)) return;
    const k = pairKey(a, b);
    if (!pairMap.has(k)) pairMap.set(k, a < b ? [a, b] : [b, a]);
  };
  edges.forEach(([a, b]) => addPair(a, b));
  calls.forEach((c) => Number.isFinite(c.at) && addPair(c.from, c.to));
  const pairs = [...pairMap.entries()];

  const h = height ?? (w < 520 ? Math.round(clamp(w * 1.7, 380, 640)) : Math.round(clamp(w * 0.6, 360, 520))) + 32;
  const shapeKey = JSON.stringify([w, h, nodes.map((n) => [n.id, n.kind, n.lead ? 1 : 0]), pairs.filter(([, [a, b]]) => ids.has(a) && ids.has(b)).map(([k]) => k)]);
  const layout = useMemo(
    () =>
      layOut(
        nodes,
        pairs.filter(([, [a, b]]) => ids.has(a) && ids.has(b)).map(([, p]) => p),
        w,
        h,
      ),
    [shapeKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ---------- Heat: calls per link in the last heatWindow ms ---------- */

  const heat = new Map<string, { n: number; last: number }>();
  let perMinute = 0;
  // Calls between two nodes that are there, at a real time – a call to itself or to a missing node isn't drawn or counted
  const valid = calls.filter((c) => c.from !== c.to && byId.has(c.from) && byId.has(c.to) && Number.isFinite(c.at));
  const recentOf = new Map<string, GraphCall[]>();
  const minuteCount = new Map<string, number>();
  const minuteOut = new Map<string, Map<string, number>>();
  for (const c of valid) {
    if (c.at > now) continue;
    for (const id of [c.from, c.to]) {
      const list = recentOf.get(id) ?? [];
      list.push(c);
      if (list.length > 4) list.shift();
      recentOf.set(id, list);
      if (c.at > now - 60000) minuteCount.set(id, (minuteCount.get(id) ?? 0) + 1);
    }
    if (c.at > now - 60000) {
      const out = minuteOut.get(c.from) ?? new Map<string, number>();
      out.set(c.to, (out.get(c.to) ?? 0) + 1);
      minuteOut.set(c.from, out);
    }
    if (c.at > now - 60000) perMinute++;
    const k = pairKey(c.from, c.to);
    const e = heat.get(k) ?? { n: 0, last: 0 };
    if (c.at > now - heatWindow) e.n++;
    e.last = Math.max(e.last, c.at);
    heat.set(k, e);
  }

  /* ---------- Hover, focus and the open card ---------- */

  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const openNode = open ? byId.get(open) : undefined;
  const focusId = hover ?? (openNode ? open : null);
  const near = new Set<string>();
  if (focusId) {
    near.add(focusId);
    for (const [, [a, b]] of pairs) {
      if (a === focusId) near.add(b);
      if (b === focusId) near.add(a);
    }
  }
  const select = (id: string | null) => {
    setOpen(id);
    onSelect?.(id ? byId.get(id) ?? null : null);
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (cardRef.current?.contains(t) || t.closest?.("[data-agg-node]")) return;
      select(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && !byId.has(open)) setOpen(null);
  });

  /* ---------- The engine: one frame loop for floating, gliding, pulses and ripples ---------- */

  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const edgeEls = useRef(new Map<string, SVGPathElement>());
  const eng = useRef({
    bodies: new Map<string, Body>(),
    drawn: new Map<string, Spot>(),
    rings: new Map<string, Ring>(),
    pulses: [] as Pulse[],
    /** Numbers the streaks' gradients */
    seq: 0,
    ripples: [] as Ripple[],
    flashes: [] as Flash[],
    arrived: new Set<string>(),
    live: new Map<string, number>(),
    readyAt: 0,
    routes: new Map<string, Route>(),
    routeSig: "",
  });
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const pairsRef = useRef(pairs);
  pairsRef.current = pairs;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  for (const [id, s] of layout.spots) eng.current.rings.set(id, s.ring);

  const step = (t: number, dt: number) => {
    const E = eng.current;
    const L = layoutRef.current;
    if (!L.w) return;
    if (!E.readyAt) E.readyAt = t;
    const still = reducedRef.current;
    const w0 = 7; // spring: about 0.6s to settle, no overshoot
    for (const [id, el] of nodeEls.current) {
      const target = L.spots.get(id);
      let b = E.bodies.get(id);
      if (!b) {
        // A node that arrives later slides out of the first neighbour that is already there
        let from: Pt | undefined = target;
        if (t - E.readyAt > 200 && !still) {
          for (const [, [p, q]] of pairsRef.current) {
            const other = p === id ? q : q === id ? p : null;
            const at = other ? E.drawn.get(other) : undefined;
            if (at) {
              from = at;
              break;
            }
          }
        }
        if (!from) continue;
        b = { x: from.x, y: from.y, vx: 0, vy: 0 };
        E.bodies.set(id, b);
      }
      if (target) {
        if (still) {
          b.x = target.x;
          b.y = target.y;
          b.vx = b.vy = 0;
        } else if (dt > 0) {
          b.vx += (w0 * w0 * (target.x - b.x) - 2 * w0 * b.vx) * dt;
          b.vy += (w0 * w0 * (target.y - b.y) - 2 * w0 * b.vy) * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
      }
      const x = b.x;
      const y = b.y;
      E.drawn.set(id, { x, y, ring: E.rings.get(id) ?? 2 });
      el.style.transform = `translate3d(${f1(x)}px, ${f1(y)}px, 0)`;
    }
    for (const id of [...E.bodies.keys()]) if (!nodeEls.current.has(id)) E.bodies.delete(id), E.drawn.delete(id);

    const c = { x: L.cx, y: L.cy };
    // Routing every link checks it against every node – so only when something moved or the links changed
    const keys = [...edgeEls.current.keys()];
    let sig = `${L.w}:${L.h}:${keys.join(",")}`;
    for (const [id, p] of E.drawn) sig += `|${id}:${f1(p.x)},${f1(p.y)}`;
    if (sig !== E.routeSig) {
      E.routeSig = sig;
      E.routes = squareLinks(keys, E.drawn, L.size, c, L.narrow ? 6 : 8);
      for (const [key, el] of edgeEls.current) {
        const bz = E.routes.get(key);
        if (bz) el.setAttribute("d", bz.d);
      }
    }
    const routes = E.routes;
    const curve = (a: string, b: string): Route | null => routes.get(pairKey(a, b)) ?? null;

    // Pulses: out along the link, then the answer back
    const layer = pulseRef.current;
    const keep: Pulse[] = [];
    for (const p of E.pulses) {
      const pa = E.drawn.get(p.from);
      const pb = E.drawn.get(p.to);
      const k = pairKey(p.from, p.to);
      const edge = edgeEls.current.get(k);
      if (!pa || !pb || !layer || !edge) {
        p.el?.remove();
        if (p.live) unlive(k);
        continue;
      }
      if (!p.dur) p.dur = clamp(Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1.15 / 0.3, 520, 1200);
      const prog = (t - p.start) / p.dur;
      if (prog < 0) {
        keep.push(p);
        continue;
      }
      if (!p.el) {
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "ui-aggc__pulse");
        g.setAttribute("data-kind", p.kind);
        {
          // A short line along the link, full color at the front and fading to nothing behind
          const grad = document.createElementNS(SVGNS, "linearGradient");
          grad.id = `${cardId.replace(/:/g, "")}-s${++E.seq}`;
          grad.setAttribute("gradientUnits", "userSpaceOnUse");
          for (const [offset, opacity] of [["0", "0"], ["1", "1"]]) {
            const stop = document.createElementNS(SVGNS, "stop");
            stop.setAttribute("offset", offset);
            stop.setAttribute("stop-opacity", opacity);
            stop.setAttribute("class", "ui-aggc__stop");
            grad.appendChild(stop);
          }
          // The same line once more underneath, wider and blurred – a light glow in its own color
          const glow = document.createElementNS(SVGNS, "path");
          glow.setAttribute("class", "ui-aggc__streak-glow");
          glow.setAttribute("stroke", `url(#${grad.id})`);
          glow.setAttribute("filter", `url(#${cardId}-blur)`);
          const line = document.createElementNS(SVGNS, "path");
          line.setAttribute("class", "ui-aggc__streak");
          line.setAttribute("stroke", `url(#${grad.id})`);
          g.append(grad, glow, line);
        }
        layer.appendChild(g);
        p.el = g;
        p.live = true;
        E.live.set(k, (E.live.get(k) ?? 0) + 1);
        edge.setAttribute("data-live", "");
      }
      if (prog >= 1) {
        p.el.remove();
        unlive(k);
        arrive(p, t);
        continue;
      }
      const bz = curve(p.from, p.to)!;
      const fwd = pa.ring < pb.ring || (pa.ring === pb.ring && p.from < p.to);
      const e = easeInOut(prog);
      {
        // About 36px of the link behind the front, shorter at the very start
        const span = Math.min(0.3, 36 / (Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1.15 || 1));
        const head = e * (1 + span);
        const tail = Math.max(0, head - span);
        const front = Math.min(1, head);
        const pts: Pt[] = [];
        for (let i = 0; i <= 16; i++) {
          const q = tail + ((front - tail) * i) / 16;
          pts.push(bz.at(fwd ? q : 1 - q));
        }
        const [grad, glow, line] = p.el.children as unknown as [SVGLinearGradientElement, SVGPathElement, SVGPathElement];
        const d = "M" + pts.map((pt) => `${f1(pt.x)} ${f1(pt.y)}`).join("L");
        line.setAttribute("d", d);
        glow.setAttribute("d", d);
        grad.setAttribute("x1", String(f1(pts[0].x)));
        grad.setAttribute("y1", String(f1(pts[0].y)));
        grad.setAttribute("x2", String(f1(pts[16].x)));
        grad.setAttribute("y2", String(f1(pts[16].y)));
        p.el.style.opacity = String(Math.min(1, prog * 7, (1 - prog) * 4));
      }
      keep.push(p);
    }
    E.pulses = keep;

    // Ripples where a pulse lands – they follow the floating node
    const rip: Ripple[] = [];
    for (const r of E.ripples) {
      const at = E.drawn.get(r.node);
      const prog = (t - r.start) / RIPPLE;
      if (!at || prog >= 1 || !layer) {
        r.el?.remove();
        continue;
      }
      if (!r.el) {
        r.el = document.createElementNS(SVGNS, "rect");
        r.el.setAttribute("class", "ui-aggc__ripple");
        r.el.setAttribute("data-kind", r.kind);
        layer.appendChild(r.el);
      }
      const R = (L.size.get(r.node) ?? 34) / 2;
      const e = easeOut(prog);
      r.el.setAttribute("cx", String(f1(at.x)));
      r.el.setAttribute("cy", String(f1(at.y)));
      const rr = R + 1 + e * (L.narrow ? 9 : 13);
      r.el.setAttribute("r", String(f1(rr)));
      if (r.el.tagName === "rect") {
        r.el.setAttribute("x", String(f1(at.x - rr)));
        r.el.setAttribute("y", String(f1(at.y - rr)));
        r.el.setAttribute("width", String(f1(rr * 2)));
        r.el.setAttribute("height", String(f1(rr * 2)));
        r.el.setAttribute("rx", String(f1(R * 0.5 + 1 + e * 4)));
      }
      r.el.style.opacity = String(0.55 * (1 - e));
      rip.push(r);
    }
    E.ripples = rip;

    E.flashes = E.flashes.filter((f) => {
      if (t < f.until) return true;
      f.el.removeAttribute(f.attr);
      return false;
    });
  };

  const unlive = (k: string) => {
    const E = eng.current;
    const n = (E.live.get(k) ?? 1) - 1;
    if (n > 0) E.live.set(k, n);
    else {
      E.live.delete(k);
      edgeEls.current.get(k)?.removeAttribute("data-live");
    }
  };
  const flash = (el: Element | undefined, attr: string, until: number) => {
    if (!el) return;
    el.setAttribute(attr, "");
    eng.current.flashes.push({ el, attr, until });
  };
  const arrive = (p: Pulse, t: number) => {
    const E = eng.current;
    E.ripples.push({ node: p.to, kind: p.kind, start: t });
    if (p.kind === "err") {
      flash(edgeEls.current.get(pairKey(p.from, p.to)), "data-error", t + 1500);
    }
    if (p.kind === "req" || p.kind === "ask") {
      if (p.then) answer(p.call, p.to, p.from, p.then, t + 90);
      else {
        E.arrived.add(p.call);
        if (E.arrived.size > 400) E.arrived.delete(E.arrived.values().next().value as string);
      }
    }
  };
  /** The answer travels back from the called node to the caller */
  const answer = (call: string, from: string, to: string, status: "ok" | "error", start: number) => {
    const user = byIdRef.current.get(from)?.kind === "user";
    eng.current.pulses.push({ call, from, to, kind: status === "error" ? "err" : user ? "askres" : "res", start, dur: 0 });
  };
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const stepRef = useRef(step);
  stepRef.current = step;

  // The frame loop runs while the graph is on screen – not at all with reduced motion
  useEffect(() => {
    if (reduced) return;
    let raf = 0;
    let last = performance.now();
    let visible = true;
    const loop = (t: number) => {
      const dt = Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      stepRef.current(t, dt);
      raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      if (raf || !visible || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      wake();
    });
    if (stageRef.current) io.observe(stageRef.current);
    document.addEventListener("visibilitychange", wake);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", wake);
    };
  }, [reduced]);

  // After every render: new nodes and links get their place before they are painted
  useLayoutEffect(() => {
    stepRef.current(performance.now(), 0);
  });

  /* ---------- New calls send pulses; finished ones send the answer back ---------- */

  const seen = useRef<Map<string, string> | null>(null);
  useLayoutEffect(() => {
    const first = seen.current === null;
    if (first) seen.current = new Map();
    const s = seen.current!;
    const t = performance.now();
    const E = eng.current;
    for (const c of valid) {
      const st = c.status ?? "ok";
      const prev = s.get(c.id);
      if (prev === st || (!first && c.at > now + 1)) continue;
      s.set(c.id, st);
      // Only fresh calls travel – old ones that show up again (or the history on the first draw) just count
      if (first || (prev === undefined && c.at < now - 4000)) continue;
      const k = pairKey(c.from, c.to);
      if (reduced) {
        // No travelling dots: the link lights up instead
        const el = edgeEls.current.get(k);
        flash(el, "data-live", t + 900);
        if (st === "error") flash(el, "data-error", t + 1500);
        window.setTimeout(() => stepRef.current(performance.now(), 0), 1600);
        continue;
      }
      if (prev === undefined) {
        const toUser = byId.get(c.to)?.kind === "user";
        E.pulses.push({ call: c.id, from: c.from, to: c.to, kind: toUser ? "ask" : "req", start: t, dur: 0, then: st === "pending" ? undefined : (st as "ok" | "error") });
      } else {
        const out = E.pulses.find((p) => p.call === c.id && (p.kind === "req" || p.kind === "ask"));
        if (out) out.then = st as "ok" | "error";
        else answer(c.id, c.to, c.from, st as "ok" | "error", t);
      }
    }
    if (s.size > calls.length * 2 + 100) {
      const live = new Set(calls.map((c) => c.id));
      for (const k of [...s.keys()]) if (!live.has(k)) s.delete(k);
    }
  }, [calls]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card sits beside its node, kept inside the graph (narrow graphs dock it at the bottom)
  useLayoutEffect(() => {
    const el = cardRef.current;
    const at = open ? layout.spots.get(open) : undefined;
    if (!el || !at || layout.narrow) return;
    const R = (layout.size.get(open!) ?? 40) / 2;
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;
    const right = at.x < layout.w / 2;
    el.style.left = `${clamp(right ? at.x + R + 18 : at.x - R - 18 - cw, 8, layout.w - cw - 8)}px`;
    el.style.top = `${clamp(at.y - ch / 2, 8, layout.h - ch - 8)}px`;
  });

  /* ---------- What is shown ---------- */

  const agents = nodes.filter((n) => n.kind === "agent");
  const tools = nodes.filter((n) => n.kind === "tool");
  const total = nodes.reduce((sum, n) => sum + (num(n.cost) ?? 0), 0);
  const waiting = nodes.filter((n) => n.status === "waiting");
  const failed = nodes.filter((n) => n.status === "error");
  // On the first draw everything grows in, middle first; the delay sticks to each node and link, later ones come at once
  const delays = useRef(new Map<string, number>());
  const drawn = useRef(false);
  if (w > 0) {
    for (const n of shownNodes) if (!delays.current.has(n.id)) delays.current.set(n.id, drawn.current ? 0 : layout.pop.get(n.id) ?? 0);
    for (const [k, [a, b]] of pairs) if (!delays.current.has(k)) delays.current.set(k, drawn.current ? 0 : Math.max(layout.draw.get(a) ?? 0, layout.draw.get(b) ?? 0));
    for (const k of [...delays.current.keys()]) if (!byId.has(k) && !pairMap.has(k)) delays.current.delete(k);
  }
  useEffect(() => {
    if (w) drawn.current = true;
  }, [w]);

  const callsOf = (id: string) => [...(recentOf.get(id) ?? [])].reverse();
  const minuteOf = (id: string) => minuteCount.get(id) ?? 0;

  const node = (n: GraphNode) => {
    const D = layout.size.get(n.id) ?? 34;
    const gone = leavingIds.has(n.id);
    const isLead = n.id === layout.lead;
    const narrow = layout.narrow;
    const label = narrow ? n.short ?? n.name : n.name;
    const status = n.status ?? "idle";
    // Narrow graphs keep one line per label – the badge and the chip in the bar still tell waiting and failed apart
    const line = n.kind !== "agent" || narrow ? undefined : status === "waiting" || status === "error" ? STATUS[status] : n.detail;
    const delay = delays.current.get(n.id) ?? 0;
    const count = minuteOf(n.id);
    const spot = layout.spots.get(n.id);
    // Labels sit where the links aren't: above outer nodes at the top (their links come from below), and – when narrow –
    // above the upper agents too, so they keep clear of the lead
    const above = !!spot && (n.kind !== "agent" ? spot.y < layout.cy - layout.ry * 0.45 : narrow && spot.ring === 1 && spot.y < layout.cy);
    return (
      <div
        key={n.id}
        className="ui-aggc__node"
        data-kind={n.kind}
        data-lead={isLead ? "" : undefined}
        data-status={status}
        data-leaving={gone ? "" : undefined}
        data-dim={focusId && !near.has(n.id) ? "" : undefined}
        data-open={open === n.id ? "" : undefined}
        style={{ ["--d" as string]: `${D}px`, zIndex: open === n.id || hover === n.id ? 3 : isLead ? 2 : 1 }}
        ref={(el) => {
          if (el) nodeEls.current.set(n.id, el);
          else nodeEls.current.delete(n.id);
        }}
      >
        <div className="ui-aggc__body" style={{ animationDelay: `${delay}ms` }}>
          <span className="ui-aggc__ring" aria-hidden="true" />
          <button
            type="button"
            className="ui-aggc__disc"
            data-agg-node=""
            data-logo={n.icon ? "" : undefined}
            title={[n.name, n.detail].filter(Boolean).join(" · ") || undefined}
            tabIndex={gone ? -1 : undefined}
            aria-label={`${n.name}, ${KIND[n.kind]}${n.status ? `, ${STATUS[status].toLowerCase()}` : ""}${n.doing ? `: ${n.doing}` : ""}. ${count} ${count === 1 ? "call" : "calls"} in the last minute`}
            aria-haspopup="dialog"
            aria-expanded={open === n.id}
            aria-controls={open === n.id ? cardId : undefined}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover(n.id)}
            onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover((h) => (h === n.id ? null : h))}
            onClick={() => select(open === n.id ? null : n.id)}
          >
            {n.icon ?? (n.kind === "user" ? <UserIcon /> : <span className="ui-aggc__initials">{initials(n.name)}</span>)}
          </button>
          <span className="ui-aggc__stroke" aria-hidden="true" />
          {(status === "waiting" || status === "error" || status === "done") && n.kind === "agent" && (
            <span className="ui-aggc__badge" data-status={status} aria-hidden="true">
              {status === "waiting" ? <ClockIcon /> : status === "error" ? <AlertIcon /> : <CheckIcon />}
            </span>
          )}
          {(label || line) && (
          <span className="ui-aggc__label" data-above={above ? "" : undefined} aria-hidden="true">
            {label && (
              <span className="ui-aggc__name" dir="auto">
                {label}
              </span>
            )}
            {line && (
              <span className="ui-aggc__line" dir="auto" data-status={status === "waiting" || status === "error" ? status : undefined}>
                {line}
              </span>
            )}
          </span>
          )}
        </div>
      </div>
    );
  };

  const card = () => {
    if (!openNode) return null;
    const n = openNode;
    const status = n.status ?? "idle";
    const recent = callsOf(n.id);
    const count = minuteOf(n.id);
    const users = pairs.filter(([, [a, b]]) => a === n.id || b === n.id).map(([, [a, b]]) => byId.get(a === n.id ? b : a)!);
    return (
      <div
        ref={cardRef}
        id={cardId}
        className="ui-aggc__card"
        role="dialog"
        aria-label={n.name}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          const id = n.id;
          select(null);
          nodeEls.current.get(id)?.querySelector("button")?.focus();
        }}
      >
        <div className="ui-aggc__card-head">
          <span className="ui-aggc__card-icon" data-kind={n.kind}>
            {n.icon ?? (n.kind === "user" ? <UserIcon /> : initials(n.name))}
          </span>
          <span className="ui-aggc__card-who">
            <span className="ui-aggc__card-name" dir="auto" title={n.name}>
              {n.name}
            </span>
            {n.detail && (
              <span className="ui-aggc__card-detail" title={n.detail}>
                {n.detail}
              </span>
            )}
          </span>
          {n.status && (
            <span className="ui-aggc__pill" data-status={status}>
              {STATUS[status]}
            </span>
          )}
          <button type="button" className="ui-aggc__close" aria-label="Close" autoFocus onClick={() => select(null)}>
            <CloseIcon />
          </button>
        </div>
        {n.doing ? (
          <p className="ui-aggc__doing" dir="auto">
            {n.doing}
          </p>
        ) : (
          users.length > 0 && (
            <p className="ui-aggc__doing">
              {n.kind === "agent" ? "Works with " : "Used by "}
              {users.map((u) => u.name).join(", ")}
            </p>
          )
        )}
        {recent.length > 0 && (
          <ul className="ui-aggc__calls" aria-label="Latest calls">
            {recent.map((c) => {
              const out = c.from === n.id;
              const other = byId.get(out ? c.to : c.from);
              const st = c.status ?? "ok";
              return (
                <li key={c.id} className="ui-aggc__call" data-status={st}>
                  <span className="ui-aggc__call-dir">
                    {out ? <OutIcon /> : <InIcon />}
                    <span className="ui-aggc__sr">{out ? "To" : "From"}</span>
                  </span>
                  <span className="ui-aggc__call-icon" aria-hidden="true">
                    {other?.icon ?? (other?.kind === "user" ? <UserIcon /> : initials(other?.name ?? ""))}
                  </span>
                  <span className="ui-aggc__call-text" dir="auto" title={`${other?.name ?? ""}${c.label ? ` · ${c.label}` : ""}`}>
                    <span className="ui-aggc__call-who">{other?.name ?? (out ? c.to : c.from)}</span>
                    {c.label && <span className="ui-aggc__call-label"> · {c.label}</span>}
                  </span>
                  <span className="ui-aggc__call-end">{st === "pending" ? <Spinner /> : st === "error" ? "Failed" : num(c.ms) !== undefined ? took(Math.max(0, c.ms!)) : "OK"}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ui-aggc__card-foot">
          {num(n.cost) !== undefined && <span className="ui-aggc__card-cost">{formatCost(n.cost!)}</span>}
          <span>
            {count} {count === 1 ? "call" : "calls"} in the last minute
          </span>
        </div>
      </div>
    );
  };

  const ready = w > 0;
  const outerRx = layout.rx;
  const outerRy = layout.ry;

  return (
    <div className={["ui-aggc", className].filter(Boolean).join(" ")} data-narrow={layout.narrow ? "" : undefined} data-focus={focusId ? "" : undefined}>
      <style href="ui-agent-graph-clean" precedence="default">
        {css}
      </style>

      <header className="ui-aggc__bar">
        <span className="ui-aggc__mark">
          <GraphMark />
        </span>
        <span className="ui-aggc__title" title={title}>
          {title}
        </span>
      {(waiting.length > 0 || failed.length > 0) && (
        <div className="ui-aggc__alerts" aria-live="polite">
          {(layout.narrow ? waiting.slice(0, 1) : waiting).map((n) => (
            <button key={n.id} type="button" className="ui-aggc__chip" data-kind="waiting" onClick={() => select(n.id)}>
              <ClockIcon />
              {layout.narrow ? (waiting.length > 1 ? `${waiting.length} need you` : "Needs you") : `${n.short ?? n.name} needs you`}
            </button>
          ))}
          {(layout.narrow ? failed.slice(0, 1) : failed).map((n) => (
            <button key={n.id} type="button" className="ui-aggc__chip" data-kind="error" onClick={() => select(n.id)}>
              <AlertIcon />
              {layout.narrow ? "Failed" : `${n.short ?? n.name} failed`}
            </button>
          ))}
        </div>
      )}
        <span className="ui-aggc__sum">
          <span>
            <b>{agents.length}</b> {agents.length === 1 ? "agent" : "agents"}
          </span>
          <span>
            <b>{tools.length}</b> {tools.length === 1 ? "tool" : "tools"}
          </span>
          <span>
            <b>{perMinute.toLocaleString("en-US")}</b> calls/min
          </span>
          <span className="ui-aggc__sum-cost">{formatCost(total)}</span>
        </span>
      </header>

      <div className="ui-aggc__panel">
        <div ref={stageRef} className="ui-aggc__stage" style={{ height: ready ? h : undefined }} role="group" aria-label={`${title}: ${agents.length} agents and ${tools.length} tools`}>
          {ready && (
            <svg className="ui-aggc__svg" width={layout.w} height={layout.h} aria-hidden="true">
              <defs>
                <radialGradient id={`${cardId}-glow`}>
                  <stop offset="0" style={{ stopColor: "var(--ui-aggc-glow)" }} />
                  <stop offset="1" style={{ stopColor: "var(--ui-aggc-glow)", stopOpacity: 0 }} />
                </radialGradient>
                {/* The soft colored glow around a streak */}
                <filter id={`${cardId}-blur`} x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="1.5" />
                </filter>
              </defs>
              <ellipse className="ui-aggc__halo" cx={layout.cx} cy={layout.cy} rx={outerRx * layout.ix * 0.9} ry={outerRy * layout.iy * 0.9} fill={`url(#${cardId}-glow)`} />
              <g>
                {pairs.map(([k, [a, b]]) => {
                  const na = byId.get(a);
                  const nb = byId.get(b);
                  const ask = (na?.status === "waiting" && nb?.kind === "user") || (nb?.status === "waiting" && na?.kind === "user");
                  const gone = leavingIds.has(a) || leavingIds.has(b);
                  const delay = delays.current.get(k) ?? 0;
                  return (
                    <path
                      key={k}
                      ref={(el) => {
                        if (el) {
                          if (!edgeEls.current.has(k)) eng.current.routeSig = "";
                          edgeEls.current.set(k, el);
                        } else edgeEls.current.delete(k);
                      }}
                      className="ui-aggc__edge"
                      pathLength={1}
                      data-ask={ask ? "" : undefined}
                      data-leaving={gone ? "" : undefined}
                      data-near={focusId && near.has(a) && near.has(b) && (a === focusId || b === focusId) ? "" : undefined}
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  );
                })}
              </g>
              <g ref={pulseRef} />
            </svg>
          )}
          {ready && <div className="ui-aggc__nodes">{shownNodes.map(node)}</div>}
          {card()}
        </div>
        <div className="ui-aggc__legend" aria-hidden="true">
          {/* Streaks tell apart by color */}
          {([
            ["call", "Call"],
            ["answer", "Answer"],
            ["ask", "Needs you"],
            ["error", "Failed"],
          ] as const).map(([kind, label]) => (
            <span key={kind}>
              <svg width="20" height="8" viewBox="0 0 20 8">
                <defs>
                  {/* In user space – a flat line has no height, so a bounding-box gradient would paint nothing */}
                  <linearGradient id={`${cardId.replace(/:/g, "")}-lg-${kind}`} gradientUnits="userSpaceOnUse" x1="2" y1="4" x2="18" y2="4">
                    <stop offset="0" stopOpacity="0" className="ui-aggc__legend-stop" data-kind={kind} />
                    <stop offset="1" className="ui-aggc__legend-stop" data-kind={kind} />
                  </linearGradient>
                </defs>
                <path d="M2 4H18" className="ui-aggc__legend-streak" stroke={`url(#${cardId.replace(/:/g, "")}-lg-${kind})`} />
              </svg>
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* For screen readers: every node with what it does and who it calls */}
      <ul className="ui-aggc__sr">
        {nodes.map((n) => {
          const out = new Map<string, number>();
          for (const [to, k] of minuteOut.get(n.id) ?? []) out.set(to, k);
          return (
            <li key={n.id}>
              {n.name} ({KIND[n.kind]}
              {n.status ? `, ${STATUS[n.status].toLowerCase()}` : ""}){n.doing ? `: ${n.doing}` : ""}.
              {out.size > 0 && ` Calls in the last minute: ${[...out].map(([id, k]) => `${byId.get(id)?.name ?? id} ${k}`).join(", ")}.`}
              {num(n.cost) !== undefined && ` Cost ${formatCost(n.cost!)}.`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const css = /* css */ `
/* The state colors fade, so they're registered as colors */
@property --ui-aggc-state { syntax: "<color>"; inherits: true; initial-value: transparent; }
@property --ui-aggc-state-bg { syntax: "<color>"; inherits: true; initial-value: transparent; }
/* Colors and motion as variables – override them on .ui-aggc */
.ui-aggc {
  --ui-aggc-panel: #ffffff;
  --ui-aggc-card: #ffffff;
  --ui-aggc-strong: #000000;
  --ui-aggc-ink: rgba(0, 0, 0, 0.88);
  --ui-aggc-text: rgba(0, 0, 0, 0.61);
  --ui-aggc-muted: rgba(0, 0, 0, 0.45);
  --ui-aggc-faint: rgba(0, 0, 0, 0.27);
  --ui-aggc-line: rgba(0, 0, 0, 0.06);
  --ui-aggc-fill: rgba(0, 0, 0, 0.06);
  /* Links: a light gray; streaks the clean accent blue */
  --ui-aggc-link: rgba(0, 0, 0, 0.07);
  --ui-aggc-pulse: rgba(0, 96, 226, 0.8);
  --ui-aggc-glow: rgba(130, 188, 255, 0.16);
  --ui-aggc-breath: rgba(0, 96, 226, 0.12);
  --ui-aggc-breath-out: rgba(0, 96, 226, 0.02);
  --ui-aggc-user-bg: rgba(0, 0, 0, 0.88);
  --ui-aggc-user-fg: #fcfcfc;
  /* Subtle tones after Interfere's tokens (Radix scales): a soft background and its foreground */
  --ui-aggc-brand-bg: #008ff519;
  --ui-aggc-brand-fg: #006dcbf2;
  --ui-aggc-ok: #30a46c;
  --ui-aggc-ok-bg: #00a43319;
  --ui-aggc-ok-fg: #007d2ee0;
  --ui-aggc-warn: #f5a524;
  --ui-aggc-warn-bg: #ff9c0029;
  --ui-aggc-warn-fg: #cc4e00;
  --ui-aggc-danger: #e5484d;
  --ui-aggc-danger-bg: #f52b0018;
  --ui-aggc-shine: rgba(255, 255, 255, 0.75);
  --ui-aggc-danger-fg: #d72400da;
  --ui-aggc-focus: rgba(0, 96, 226, 0.35);
  --ui-aggc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-aggc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-aggc-lift: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 2px 0 rgba(0, 0, 0, 0.06), 0 4px 12px -4px rgba(0, 0, 0, 0.12);
  --ui-aggc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-aggc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-aggc *, .ui-aggc *::before, .ui-aggc *::after { box-sizing: border-box; }
:where(.ui-aggc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-aggc button:focus-visible { outline: 2px solid var(--ui-aggc-focus); outline-offset: 1px; }
.ui-aggc p, .ui-aggc ul { margin: 0; padding: 0; }
.ui-aggc svg { display: block; flex: none; overflow: visible; }

/* ----- The bar: title and the whole run in numbers, above the panel ----- */
.ui-aggc__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; margin-bottom: 16px; }
.ui-aggc__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-aggc-pulse); }
.ui-aggc__title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-aggc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-aggc__sum { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 2px 12px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-aggc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-aggc__sum b { font-weight: 500; color: var(--ui-aggc-ink); }
.ui-aggc__sum-cost { min-width: 40px; font-weight: 500; color: var(--ui-aggc-ink); text-align: right; }
/* Narrow: the numbers get a line of their own, so a chip coming and going never moves the graph */
.ui-aggc[data-narrow] .ui-aggc__bar { row-gap: 6px; }
.ui-aggc[data-narrow] .ui-aggc__title { line-height: 22px; }
.ui-aggc[data-narrow] .ui-aggc__sum { flex-basis: 100%; justify-content: space-between; gap: 2px 8px; margin-left: 0; }

/* ----- The white panel with the graph ----- */
.ui-aggc__panel { position: relative; overflow: hidden; border-radius: 10px; background: var(--ui-aggc-panel); box-shadow: var(--ui-aggc-shadow); }
.ui-aggc__stage { position: relative; width: 100%; min-height: 200px; container-type: inline-size; }
.ui-aggc__svg { position: absolute; inset: 0; pointer-events: none; }
.ui-aggc__halo { animation: ui-aggc-fade-in 1200ms ease both; }

/* Links: one even 1.5px line in a light gray, busy or not – only the moving streaks carry color */
.ui-aggc__edge { fill: none; stroke: var(--ui-aggc-link); stroke-width: 1.5; stroke-linecap: round; opacity: 1; stroke-dasharray: 1 1; stroke-dashoffset: 0; animation: ui-aggc-draw 560ms var(--ui-aggc-ease) backwards; transition: opacity 320ms ease, stroke 300ms ease; }
.ui-aggc__edge[data-ask] { stroke: var(--ui-aggc-warn); opacity: 0.9; }
.ui-aggc__edge[data-error] { stroke: var(--ui-aggc-danger); opacity: 1; transition-duration: 120ms, 120ms; }
.ui-aggc__edge[data-leaving] { stroke-dashoffset: 0; animation: ui-aggc-retract ${EXIT}ms var(--ui-aggc-ease) forwards; }
.ui-aggc[data-focus] .ui-aggc__edge:not([data-near]) { opacity: 0.1; }
.ui-aggc[data-focus] .ui-aggc__edge[data-near] { opacity: 1; }

.ui-aggc[data-focus] .ui-aggc__pulse { opacity: 0.25; }
/* Streaks: a short line fading out behind – blue out, green with the answer, amber when it asks you, red when it fails */
.ui-aggc__streak { fill: none; stroke-width: 2; stroke-linecap: round; }
.ui-aggc__streak-glow { fill: none; stroke-width: 4; stroke-linecap: round; opacity: 0.2; }
.ui-aggc__stop { stop-color: var(--ui-aggc-pulse); }
.ui-aggc__pulse[data-kind="res"] .ui-aggc__stop { stop-color: var(--ui-aggc-ok); }
.ui-aggc__pulse:is([data-kind="ask"], [data-kind="askres"]) .ui-aggc__stop { stop-color: var(--ui-aggc-warn); }
.ui-aggc__pulse[data-kind="err"] .ui-aggc__stop { stop-color: var(--ui-aggc-danger); }
.ui-aggc__ripple { fill: none; stroke: var(--ui-aggc-pulse); stroke-width: 1; }
.ui-aggc__ripple:is([data-kind="ask"], [data-kind="askres"]) { stroke: var(--ui-aggc-warn); }
.ui-aggc__ripple[data-kind="err"] { stroke: var(--ui-aggc-danger); stroke-width: 1.5; }
.ui-aggc__ripple[data-kind="res"] { stroke: var(--ui-aggc-ok); }

/* ----- Nodes: placed and floated by the frame loop; a white disc with a hairline and a label under it ----- */
.ui-aggc__nodes { position: absolute; inset: 0; pointer-events: none; }
.ui-aggc__node { position: absolute; top: 0; left: 0; width: 0; height: 0; transition: opacity 320ms ease; will-change: transform; }
.ui-aggc[data-focus] .ui-aggc__node[data-dim] { opacity: 0.3; }
.ui-aggc__body { position: absolute; top: 0; left: 0; transform-origin: 0 0; animation: ui-aggc-pop 560ms var(--ui-aggc-ease) both; }
.ui-aggc__node[data-leaving] .ui-aggc__body { animation: ui-aggc-out ${EXIT}ms var(--ui-aggc-ease) forwards; }
.ui-aggc__disc { position: absolute; top: calc(var(--d) / -2); left: calc(var(--d) / -2); display: grid; place-items: center; width: var(--d); height: var(--d); border-radius: 50%; background: var(--ui-aggc-card); box-shadow: inset 0 0 0 999px var(--ui-aggc-state-bg), var(--ui-aggc-shadow); color: var(--ui-aggc-text); pointer-events: auto; transition: width 300ms var(--ui-aggc-ease), height 300ms var(--ui-aggc-ease), top 300ms var(--ui-aggc-ease), left 300ms var(--ui-aggc-ease), box-shadow 240ms ease, transform 240ms var(--ui-aggc-ease); }
/* A bigger touch target than the disc */
.ui-aggc__disc::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; }
.ui-aggc__disc:hover, .ui-aggc__node[data-open] .ui-aggc__disc { transform: scale(1.06); }
.ui-aggc__disc > svg { width: 46%; height: 46%; }
.ui-aggc__initials { font-size: 11px; font-weight: 500; color: var(--ui-aggc-text); }
/* Agents: a little more lift than the tools */
.ui-aggc__node[data-kind="agent"] .ui-aggc__disc { box-shadow: inset 0 0 0 999px var(--ui-aggc-state-bg), var(--ui-aggc-lift); }
.ui-aggc__node[data-kind="agent"] .ui-aggc__disc > svg { width: 44%; height: 44%; }
.ui-aggc__node[data-kind="user"] .ui-aggc__disc { background: var(--ui-aggc-user-bg); color: var(--ui-aggc-user-fg); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.16); }
.ui-aggc__node[data-kind="user"] .ui-aggc__disc > svg { width: 42%; height: 42%; }

/* Working agents breathe; waiting ones breathe amber, a little quicker */
.ui-aggc__ring { position: absolute; top: calc(var(--d) / -2); left: calc(var(--d) / -2); width: var(--d); height: var(--d); border-radius: 50%; opacity: 0; transition: opacity 400ms ease; }
.ui-aggc__node[data-status="working"] .ui-aggc__ring { opacity: 1; animation: ui-aggc-breathe 2600ms ease-in-out infinite; }
/* Waiting for you and failed look the same, in amber and red: a light fill laid over the disc's own white (an inset shadow
   paints above the background, below the icon) with a soft shine sweeping across, and a thin stroke inside the edge that
   runs around, full color fading to nothing – as on Agent Cursors. Both colors are registered properties, so the fill and
   the stroke fade in and out with the status instead of switching */
.ui-aggc__node { --ui-aggc-state: transparent; --ui-aggc-state-bg: transparent; transition: opacity 320ms ease, --ui-aggc-state 480ms ease, --ui-aggc-state-bg 480ms ease; }
.ui-aggc__node[data-status="waiting"] { --ui-aggc-state: var(--ui-aggc-warn); --ui-aggc-state-bg: var(--ui-aggc-warn-bg); }
.ui-aggc__node[data-status="error"] { --ui-aggc-state: var(--ui-aggc-danger); --ui-aggc-state-bg: var(--ui-aggc-danger-bg); }
.ui-aggc__stroke { position: absolute; top: calc(var(--d) / -2); left: calc(var(--d) / -2); width: var(--d); height: var(--d); border-radius: 50%; background: conic-gradient(from 0deg, transparent 0deg, transparent 40deg, var(--ui-aggc-state) 360deg); -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.25px), #000 calc(100% - 0.75px)); mask: radial-gradient(farthest-side, transparent calc(100% - 1.25px), #000 calc(100% - 0.75px)); pointer-events: none; animation: ui-aggc-spin 1200ms linear infinite; transition: width 300ms var(--ui-aggc-ease), height 300ms var(--ui-aggc-ease), top 300ms var(--ui-aggc-ease), left 300ms var(--ui-aggc-ease); }
.ui-aggc__node:is([data-status="waiting"], [data-status="error"]) .ui-aggc__disc::after { content: ""; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(110deg, transparent 30%, var(--ui-aggc-shine) 50%, transparent 70%) 130% 0 / 250% 100% no-repeat; pointer-events: none; animation: ui-aggc-shimmer 2400ms ease-in-out infinite; }

/* A small badge on the disc's edge: needs you, failed, done */
.ui-aggc__badge { position: absolute; top: calc(var(--d) * -0.36 - 8px); left: calc(var(--d) * 0.36 - 6px); display: grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ui-aggc-panel); color: #fff; pointer-events: none; animation: ui-aggc-pop 360ms var(--ui-aggc-ease) both; }
.ui-aggc__badge > svg { width: 10px; height: 10px; }
.ui-aggc__badge[data-status="waiting"] { background: var(--ui-aggc-warn); }
.ui-aggc__badge[data-status="error"] { background: var(--ui-aggc-danger); }
/* Done: a solid green check on a light green disc – the green mixed into the panel color, so nothing behind shows through */
.ui-aggc__badge[data-status="done"] { background: color-mix(in srgb, var(--ui-aggc-ok) 18%, var(--ui-aggc-panel)); color: var(--ui-aggc-ok); }

/* Labels under the disc, on the panel color so links pass behind them */
.ui-aggc__label { position: absolute; top: calc(var(--d) / 2 + 5px); left: 0; display: grid; justify-items: center; padding: 0 5px; border-radius: 5px; background: var(--ui-aggc-panel); box-shadow: 0 0 6px 2px var(--ui-aggc-panel); transform: translateX(-50%); white-space: nowrap; pointer-events: none; }
.ui-aggc__label[data-above] { top: auto; bottom: calc(var(--d) / 2 + 5px); }
.ui-aggc__node[data-kind="agent"] .ui-aggc__label { top: calc(var(--d) / 2 + 6px); }
.ui-aggc__node[data-kind="agent"] .ui-aggc__label[data-above] { top: auto; bottom: calc(var(--d) / 2 + 6px); }
/* A long name or line shortens – the full name is on the node's tooltip and in its card */
.ui-aggc__name, .ui-aggc__line { width: max-content; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.ui-aggc[data-narrow] :is(.ui-aggc__name, .ui-aggc__line) { max-width: 72px; }
.ui-aggc__name { font-size: 12px; line-height: 16px; color: var(--ui-aggc-text); }
.ui-aggc__node[data-kind="agent"] .ui-aggc__name { font-weight: 500; color: var(--ui-aggc-strong); }
.ui-aggc__line { font-size: 11px; line-height: 14px; color: var(--ui-aggc-muted); }
.ui-aggc__line[data-status="waiting"] { font-weight: 500; color: var(--ui-aggc-warn-fg); }
.ui-aggc__line[data-status="error"] { font-weight: 500; color: var(--ui-aggc-danger-fg); }
.ui-aggc[data-narrow] .ui-aggc__name { font-size: 11px; line-height: 14px; }
.ui-aggc[data-narrow] .ui-aggc__ring { --ui-aggc-b1: 4px; --ui-aggc-b2: 9px; }
.ui-aggc[data-narrow] .ui-aggc__label { padding: 0 4px; }

/* "needs you" and "failed" – in the bar, a click opens that node's card */
.ui-aggc__alerts { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.ui-aggc__chip { display: inline-flex; align-items: center; gap: 4px; height: 22px; margin: -2px 0; padding: 0 7px 0 5px; border-radius: 5px; font-size: 12px; font-weight: 500; white-space: nowrap; animation: ui-aggc-rise 320ms var(--ui-aggc-ease) both; transition: filter 160ms ease; }
.ui-aggc__chip > svg { width: 13px; height: 13px; }
.ui-aggc__chip[data-kind="waiting"] { background: var(--ui-aggc-warn-bg); color: var(--ui-aggc-warn-fg); }
.ui-aggc__chip[data-kind="error"] { background: var(--ui-aggc-danger-bg); color: var(--ui-aggc-danger-fg); }
.ui-aggc__chip:hover { filter: saturate(1.3) brightness(0.97); }

/* ----- The card of a node ----- */
.ui-aggc__card { position: absolute; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; width: 260px; padding: 10px; border-radius: 10px; background: var(--ui-aggc-card); box-shadow: var(--ui-aggc-pop); animation: ui-aggc-rise 220ms var(--ui-aggc-ease) both; }
.ui-aggc[data-narrow] .ui-aggc__card { right: 8px; bottom: 8px; left: 8px; width: auto; }
.ui-aggc__card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-aggc__card-icon { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: var(--ui-aggc-card); box-shadow: var(--ui-aggc-shadow); font-size: 10px; font-weight: 500; color: var(--ui-aggc-text); }
.ui-aggc__card-icon > svg { width: 14px; height: 14px; }
.ui-aggc__card-icon[data-kind="user"] { background: var(--ui-aggc-user-bg); color: var(--ui-aggc-user-fg); box-shadow: none; }
.ui-aggc__card-who { display: grid; flex: 1; min-width: 0; }
.ui-aggc__card-name { overflow: hidden; font-weight: 500; line-height: 16px; color: var(--ui-aggc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-aggc__card-detail { overflow: hidden; font-size: 11px; line-height: 14px; color: var(--ui-aggc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-aggc__pill { flex: none; height: 18px; padding: 0 6px; border-radius: 4px; background: var(--ui-aggc-fill); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-aggc-text); white-space: nowrap; }
.ui-aggc__pill[data-status="working"] { background: var(--ui-aggc-brand-bg); color: var(--ui-aggc-brand-fg); }
.ui-aggc__pill[data-status="waiting"] { background: var(--ui-aggc-warn-bg); color: var(--ui-aggc-warn-fg); }
.ui-aggc__pill[data-status="error"] { background: var(--ui-aggc-danger-bg); color: var(--ui-aggc-danger-fg); }
.ui-aggc__pill[data-status="done"] { background: var(--ui-aggc-ok-bg); color: var(--ui-aggc-ok-fg); }
.ui-aggc__close { display: grid; flex: none; place-items: center; width: 24px; height: 24px; margin: -3px -3px -3px -2px; border-radius: 6px; color: var(--ui-aggc-muted); transition: background-color 160ms ease, color 160ms ease; }
.ui-aggc__close:hover { background: var(--ui-aggc-fill); color: var(--ui-aggc-ink); }
.ui-aggc__doing { font-size: 12px; line-height: 16px; color: var(--ui-aggc-text); text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
.ui-aggc__calls { display: grid; border-top: 0.5px solid var(--ui-aggc-line); border-bottom: 0.5px solid var(--ui-aggc-line); list-style: none; }
.ui-aggc__call { display: flex; align-items: center; gap: 6px; min-width: 0; height: 28px; font-size: 12px; line-height: 16px; animation: ui-aggc-rise 260ms var(--ui-aggc-ease) both; }
.ui-aggc__call + .ui-aggc__call { border-top: 0.5px solid var(--ui-aggc-line); }
.ui-aggc__call-dir { display: grid; flex: none; place-items: center; color: var(--ui-aggc-faint); }
.ui-aggc__call-icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; font-size: 7.5px; font-weight: 500; color: var(--ui-aggc-text); }
.ui-aggc__call-icon > svg { width: 13px; height: 13px; }
.ui-aggc__call-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-aggc-muted); }
.ui-aggc__call-who { font-weight: 500; color: var(--ui-aggc-ink); }
.ui-aggc__call-end { flex: none; font-size: 11px; color: var(--ui-aggc-muted); font-variant-numeric: tabular-nums; }
.ui-aggc__call[data-status="pending"] .ui-aggc__call-end { color: var(--ui-aggc-brand-fg); }
.ui-aggc__call[data-status="error"] .ui-aggc__call-end { font-weight: 500; color: var(--ui-aggc-danger-fg); }
.ui-aggc__spin { animation: ui-aggc-spin 900ms linear infinite; }
.ui-aggc__card-foot { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 16px; color: var(--ui-aggc-muted); font-variant-numeric: tabular-nums; }
.ui-aggc__card-cost { font-weight: 500; color: var(--ui-aggc-ink); }

/* ----- The legend ----- */
.ui-aggc__legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 14px; padding: 0 10px 10px; font-size: 11px; line-height: 16px; color: var(--ui-aggc-muted); }
.ui-aggc__legend > span { display: inline-flex; align-items: center; gap: 6px; }
.ui-aggc__legend-streak { fill: none; stroke-width: 2; stroke-linecap: round; }
.ui-aggc__legend-stop { stop-color: var(--ui-aggc-pulse); }
.ui-aggc__legend-stop[data-kind="answer"] { stop-color: var(--ui-aggc-ok); }
.ui-aggc__legend-stop[data-kind="ask"] { stop-color: var(--ui-aggc-warn); }
.ui-aggc__legend-stop[data-kind="error"] { stop-color: var(--ui-aggc-danger); }

.ui-aggc__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ----- Rounded squares, like the cards in Agent Tree ----- */
@property --ui-aggc-turn { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.ui-aggc .ui-aggc__node { --ui-aggc-r: calc(var(--d) * 0.27); }
.ui-aggc :is(.ui-aggc__disc, .ui-aggc__ring, .ui-aggc__disc::after) { border-radius: var(--ui-aggc-r); }
.ui-aggc .ui-aggc__disc::before { border-radius: calc(var(--ui-aggc-r) + 6px); }
.ui-aggc .ui-aggc__badge { top: calc(var(--d) / -2 - 6px); left: calc(var(--d) / 2 - 9px); }
.ui-aggc .ui-aggc__card-icon { border-radius: 8px; }
.ui-aggc .ui-aggc__stroke { box-sizing: border-box; padding: 1px; border-radius: var(--ui-aggc-r); background: conic-gradient(from var(--ui-aggc-turn), transparent 0deg, transparent 40deg, var(--ui-aggc-state) 360deg); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); animation: ui-aggc-turn 1200ms linear infinite; }
@keyframes ui-aggc-turn { to { --ui-aggc-turn: 360deg; } }

@keyframes ui-aggc-draw { from { stroke-dashoffset: 1; } }
@keyframes ui-aggc-retract { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 1; opacity: 0; } }
@keyframes ui-aggc-pop { from { opacity: 0; transform: scale(0.4); } }
@keyframes ui-aggc-out { to { opacity: 0; transform: scale(0.5); } }
@keyframes ui-aggc-rise { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@keyframes ui-aggc-fade-in { from { opacity: 0; } }
@keyframes ui-aggc-breathe { 0%, 100% { box-shadow: 0 0 0 var(--ui-aggc-b1, 5px) var(--ui-aggc-breath); } 50% { box-shadow: 0 0 0 var(--ui-aggc-b2, 11px) var(--ui-aggc-breath-out); } }
@keyframes ui-aggc-shimmer { 0% { background-position: 130% 0; } 55%, 100% { background-position: -30% 0; } }
@keyframes ui-aggc-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .ui-aggc *, .ui-aggc *::before, .ui-aggc *::after { animation: none !important; transition: none !important; }
  .ui-aggc__edge { stroke-dasharray: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-aggc {
  --ui-aggc-panel: #1c1c1f;
  --ui-aggc-card: #232326;
  --ui-aggc-strong: #ffffff;
  --ui-aggc-ink: rgba(255, 255, 255, 0.9);
  --ui-aggc-text: rgba(255, 255, 255, 0.62);
  --ui-aggc-muted: rgba(255, 255, 255, 0.45);
  --ui-aggc-faint: rgba(255, 255, 255, 0.28);
  --ui-aggc-line: rgba(255, 255, 255, 0.08);
  --ui-aggc-fill: rgba(255, 255, 255, 0.08);
  --ui-aggc-link: rgba(255, 255, 255, 0.08);
  --ui-aggc-pulse: #70b8ff;
  --ui-aggc-glow: rgba(79, 143, 219, 0.14);
  --ui-aggc-breath: rgba(112, 184, 255, 0.16);
  --ui-aggc-breath-out: rgba(112, 184, 255, 0.03);
  --ui-aggc-user-bg: rgba(255, 255, 255, 0.92);
  --ui-aggc-user-fg: #141416;
  --ui-aggc-brand-bg: #0077ff3a;
  --ui-aggc-brand-fg: #70b8ff;
  --ui-aggc-ok: #3dd68c;
  --ui-aggc-ok-bg: #00f04a1f;
  --ui-aggc-ok-fg: #3dd68c;
  --ui-aggc-warn: #ffa057;
  --ui-aggc-warn-bg: #fb6a0025;
  --ui-aggc-warn-fg: #ffa057;
  --ui-aggc-danger: #ff6369;
  --ui-aggc-danger-bg: #ff35232b;
  --ui-aggc-shine: rgba(255, 255, 255, 0.16);
  --ui-aggc-danger-fg: #ff977d;
  --ui-aggc-focus: rgba(91, 154, 255, 0.45);
  --ui-aggc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
  --ui-aggc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-aggc-lift: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 1px 2px 0 rgba(0, 0, 0, 0.4), 0 4px 12px -4px rgba(0, 0, 0, 0.5);
}
`;
