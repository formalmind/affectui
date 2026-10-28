"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Agent Graph – agents and the tools they use, drawn as a living network, in a single self-contained file.
 * The lead agent sits in the middle, the agents it hands work to on an inner orbit, and the tools, data sources and you
 * on an outer orbit – each tool turned towards the agents that use it, so the links stay short and rarely cross.
 * Nodes are rounded squares and links straight lines with one right-angled turn, like the branches in Agent Tree: a tool
 * almost in line with its agent moves into line, and links sharing a side of a node run side by side, never on top of
 * each other.
 *   · every call sends a small pulse along its link – a solid dot out to the tool, a hollow one back with the answer;
 *     the node it reaches ripples once
 *   · links that are used a lot grow thicker, links that go quiet fade back
 *   · working agents breathe with a soft ring; an agent that waits for you turns amber, and its link to you with it;
 *     a failed call comes back red and flashes the link and the node
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
  /** How far back calls make a link thicker (ms) */
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
  <svg className="ui-agg__spin" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
  const hottest = Math.max(1, ...[...heat.values()].map((e) => e.n));

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
        g.setAttribute("class", "ui-agg__pulse");
        g.setAttribute("data-kind", p.kind);
        const hollow = p.kind === "res" || p.kind === "askres" || p.kind === "err";
        const glow = document.createElementNS(SVGNS, "circle");
        glow.setAttribute("r", "8");
        glow.setAttribute("class", "ui-agg__glow");
        g.appendChild(glow);
        const tails = hollow ? [1.7, 1.3, 0.9] : [3, 2.4, 1.8, 1.2];
        tails.forEach((r, i) => {
          const dot = document.createElementNS(SVGNS, "circle");
          dot.setAttribute("r", String(r));
          dot.setAttribute("class", "ui-agg__tail");
          dot.style.opacity = String((hollow ? [0.45, 0.28, 0.14] : [0.5, 0.34, 0.2, 0.1])[i]);
          g.appendChild(dot);
        });
        const head = document.createElementNS(SVGNS, "circle");
        head.setAttribute("r", hollow ? "3.4" : "3.8");
        head.setAttribute("class", "ui-agg__head");
        g.appendChild(head);
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
      const kids = p.el.children;
      const n = kids.length - 1;
      for (let i = 0; i <= n; i++) {
        // The glow (first) and the head (last) ride together; the tail dots trail behind
        const lag = i === n || i === 0 ? 0 : i * 0.03;
        const q = clamp(e - lag, 0, 1);
        const pt = bz.at(fwd ? q : 1 - q);
        kids[i].setAttribute("cx", String(f1(pt.x)));
        kids[i].setAttribute("cy", String(f1(pt.y)));
      }
      p.el.style.opacity = String(Math.min(1, prog * 7, (1 - prog) * 7));
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
        r.el.setAttribute("class", "ui-agg__ripple");
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
      flash(nodeEls.current.get(p.to), "data-flash", t + 1500);
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
        className="ui-agg__node"
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
        <div className="ui-agg__body" style={{ animationDelay: `${delay}ms` }}>
          <span className="ui-agg__ring" aria-hidden="true" />
          <button
            type="button"
            className="ui-agg__disc"
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
            {n.icon ?? (n.kind === "user" ? <UserIcon /> : <span className="ui-agg__initials">{initials(n.name)}</span>)}
          </button>
          {(status === "waiting" || status === "error" || status === "done") && n.kind === "agent" && (
            <span className="ui-agg__badge" data-status={status} aria-hidden="true">
              {status === "waiting" ? <ClockIcon /> : status === "error" ? <AlertIcon /> : <CheckIcon />}
            </span>
          )}
          {(label || line) && (
          <span className="ui-agg__label" data-above={above ? "" : undefined} aria-hidden="true">
            {label && (
              <span className="ui-agg__name" dir="auto">
                {label}
              </span>
            )}
            {line && (
              <span className="ui-agg__line" dir="auto" data-status={status === "waiting" || status === "error" ? status : undefined}>
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
        className="ui-agg__card"
        role="dialog"
        aria-label={n.name}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          const id = n.id;
          select(null);
          nodeEls.current.get(id)?.querySelector("button")?.focus();
        }}
      >
        <div className="ui-agg__card-head">
          <span className="ui-agg__card-icon" data-kind={n.kind}>
            {n.icon ?? (n.kind === "user" ? <UserIcon /> : initials(n.name))}
          </span>
          <span className="ui-agg__card-who">
            <span className="ui-agg__card-name" dir="auto" title={n.name}>
              {n.name}
            </span>
            {n.detail && (
              <span className="ui-agg__card-detail" title={n.detail}>
                {n.detail}
              </span>
            )}
          </span>
          {n.status && (
            <span className="ui-agg__pill" data-status={status}>
              {STATUS[status]}
            </span>
          )}
          <button type="button" className="ui-agg__close" aria-label="Close" autoFocus onClick={() => select(null)}>
            <CloseIcon />
          </button>
        </div>
        {n.doing ? (
          <p className="ui-agg__doing" dir="auto">
            {n.doing}
          </p>
        ) : (
          users.length > 0 && (
            <p className="ui-agg__doing">
              {n.kind === "agent" ? "Works with " : "Used by "}
              {users.map((u) => u.name).join(", ")}
            </p>
          )
        )}
        {recent.length > 0 && (
          <ul className="ui-agg__calls" aria-label="Latest calls">
            {recent.map((c) => {
              const out = c.from === n.id;
              const other = byId.get(out ? c.to : c.from);
              const st = c.status ?? "ok";
              return (
                <li key={c.id} className="ui-agg__call" data-status={st}>
                  <span className="ui-agg__call-dir">
                    {out ? <OutIcon /> : <InIcon />}
                    <span className="ui-agg__sr">{out ? "To" : "From"}</span>
                  </span>
                  <span className="ui-agg__call-icon" aria-hidden="true">
                    {other?.icon ?? (other?.kind === "user" ? <UserIcon /> : initials(other?.name ?? ""))}
                  </span>
                  <span className="ui-agg__call-text" dir="auto" title={`${other?.name ?? ""}${c.label ? ` · ${c.label}` : ""}`}>
                    <span className="ui-agg__call-who">{other?.name ?? (out ? c.to : c.from)}</span>
                    {c.label && <span className="ui-agg__call-label"> · {c.label}</span>}
                  </span>
                  <span className="ui-agg__call-end">{st === "pending" ? <Spinner /> : st === "error" ? "Failed" : num(c.ms) !== undefined ? took(Math.max(0, c.ms!)) : "OK"}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="ui-agg__card-foot">
          {num(n.cost) !== undefined && <span className="ui-agg__card-cost">{formatCost(n.cost!)}</span>}
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
    <div className={["ui-agg", className].filter(Boolean).join(" ")} data-narrow={layout.narrow ? "" : undefined} data-focus={focusId ? "" : undefined}>
      <style href="ui-agent-graph" precedence="default">
        {css}
      </style>

      <header className="ui-agg__bar">
        <span className="ui-agg__mark">
          <GraphMark />
        </span>
        <span className="ui-agg__title" title={title}>
          {title}
        </span>
      {(waiting.length > 0 || failed.length > 0) && (
        <div className="ui-agg__alerts" aria-live="polite">
          {(layout.narrow ? waiting.slice(0, 1) : waiting).map((n) => (
            <button key={n.id} type="button" className="ui-agg__chip" data-kind="waiting" onClick={() => select(n.id)}>
              <ClockIcon />
              {layout.narrow ? (waiting.length > 1 ? `${waiting.length} need you` : "Needs you") : `${n.short ?? n.name} needs you`}
            </button>
          ))}
          {(layout.narrow ? failed.slice(0, 1) : failed).map((n) => (
            <button key={n.id} type="button" className="ui-agg__chip" data-kind="error" onClick={() => select(n.id)}>
              <AlertIcon />
              {layout.narrow ? "Failed" : `${n.short ?? n.name} failed`}
            </button>
          ))}
        </div>
      )}
        <span className="ui-agg__sum">
          <span>
            <b>{agents.length}</b> {agents.length === 1 ? "agent" : "agents"}
          </span>
          <span>
            <b>{tools.length}</b> {tools.length === 1 ? "tool" : "tools"}
          </span>
          <span>
            <b>{perMinute.toLocaleString("en-US")}</b> calls/min
          </span>
          <span className="ui-agg__sum-cost">{formatCost(total)}</span>
        </span>
      </header>

      <div className="ui-agg__panel">
        <div ref={stageRef} className="ui-agg__stage" style={{ height: ready ? h : undefined }} role="group" aria-label={`${title}: ${agents.length} agents and ${tools.length} tools`}>
          {ready && (
            <svg className="ui-agg__svg" width={layout.w} height={layout.h} aria-hidden="true">
              <defs>
                <radialGradient id={`${cardId}-glow`}>
                  <stop offset="0" style={{ stopColor: "var(--ui-agg-glow)" }} />
                  <stop offset="1" style={{ stopColor: "var(--ui-agg-glow)", stopOpacity: 0 }} />
                </radialGradient>
              </defs>
              <ellipse className="ui-agg__halo" cx={layout.cx} cy={layout.cy} rx={outerRx * layout.ix * 0.9} ry={outerRy * layout.iy * 0.9} fill={`url(#${cardId}-glow)`} />
              <g>
                {pairs.map(([k, [a, b]]) => {
                  const e = heat.get(k);
                  const width = e && e.n ? 1.25 + 2.75 * Math.sqrt(e.n / hottest) : 1.25;
                  const idle = !e || now - e.last > 6000;
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
                      className="ui-agg__edge"
                      pathLength={1}
                      data-idle={idle ? "" : undefined}
                      data-ask={ask ? "" : undefined}
                      data-leaving={gone ? "" : undefined}
                      data-near={focusId && near.has(a) && near.has(b) && (a === focusId || b === focusId) ? "" : undefined}
                      style={{ strokeWidth: width, animationDelay: `${delay}ms` }}
                    />
                  );
                })}
              </g>
              <g ref={pulseRef} />
            </svg>
          )}
          {ready && <div className="ui-agg__nodes">{shownNodes.map(node)}</div>}
          {card()}
        </div>
        <div className="ui-agg__legend" aria-hidden="true">
          <span>
            <svg width="22" height="8" viewBox="0 0 22 8">
              <circle cx="4" cy="4" r="1.1" className="ui-agg__legend-tail" opacity="0.2" />
              <circle cx="9" cy="4" r="1.8" className="ui-agg__legend-tail" opacity="0.4" />
              <circle cx="16" cy="4" r="3.2" className="ui-agg__legend-call" />
            </svg>
            Call
          </span>
          <span>
            <svg width="12" height="8" viewBox="0 0 12 8">
              <circle cx="6" cy="4" r="3" className="ui-agg__legend-reply" />
            </svg>
            Answer
          </span>
          <span>
            <svg width="22" height="8" viewBox="0 0 22 8">
              <path d="M1 4H21" className="ui-agg__legend-line" strokeWidth="3.5" />
            </svg>
            Busier link
          </span>
          <span>
            <svg width="10" height="8" viewBox="0 0 10 8">
              <circle cx="5" cy="4" r="3.5" className="ui-agg__legend-wait" />
            </svg>
            Needs you
          </span>
        </div>
      </div>

      {/* For screen readers: every node with what it does and who it calls */}
      <ul className="ui-agg__sr">
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
/* Colors and motion as variables – override them on .ui-agg */
.ui-agg {
  --ui-agg-tray: #f0f0f0;
  --ui-agg-panel: #ffffff;
  --ui-agg-card: #ffffff;
  --ui-agg-ink: #171717;
  --ui-agg-text: #6b6b6b;
  --ui-agg-muted: #8a8a8a;
  --ui-agg-line: #ececec;
  --ui-agg-chip: #f5f5f5;
  /* Links: the soft blue of Agent Tree; pulses a deeper blue */
  --ui-agg-link: #82bcff;
  --ui-agg-pulse: #2f6bff;
  --ui-agg-glow: rgba(130, 188, 255, 0.2);
  --ui-agg-breath: rgba(47, 107, 255, 0.17);
  --ui-agg-breath-out: rgba(47, 107, 255, 0.03);
  --ui-agg-user-bg: #171717;
  --ui-agg-user-fg: #ffffff;
  --ui-agg-brand-bg: #eaf1ff;
  --ui-agg-brand-fg: #2456d6;
  --ui-agg-ok: #1fa35c;
  --ui-agg-ok-bg: #e6f6ec;
  --ui-agg-ok-fg: #1a7f45;
  --ui-agg-warn: #f59f0a;
  --ui-agg-warn-bg: #fff3e0;
  --ui-agg-warn-fg: #b85c00;
  --ui-agg-danger: #e5484d;
  --ui-agg-danger-bg: #fdecea;
  --ui-agg-danger-fg: #c2331f;
  --ui-agg-ring: rgba(23, 23, 23, 0.22);
  --ui-agg-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-agg-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-agg-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-agg *, .ui-agg *::before, .ui-agg *::after { box-sizing: border-box; }
:where(.ui-agg) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-agg button:focus-visible { outline: 2px solid var(--ui-agg-ring); outline-offset: 2px; }
.ui-agg p, .ui-agg ul { margin: 0; padding: 0; }
.ui-agg svg { display: block; flex: none; overflow: visible; }

/* ----- The bar: title and the whole run in numbers, on the tray ----- */
.ui-agg__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 7px 12px 9px 12px; }
.ui-agg__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-agg-pulse); }
.ui-agg__title { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-agg-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-agg__sum { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 2px 14px; margin-left: auto; font-size: 12.5px; line-height: 18px; color: var(--ui-agg-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-agg__sum b { font-weight: 600; color: var(--ui-agg-ink); }
.ui-agg__sum-cost { min-width: 42px; font-weight: 600; color: var(--ui-agg-ink); text-align: right; }
/* Narrow: the numbers get a line of their own, so a chip coming and going never moves the graph */
.ui-agg[data-narrow] .ui-agg__bar { row-gap: 6px; }
.ui-agg[data-narrow] .ui-agg__title { line-height: 24px; }
.ui-agg[data-narrow] .ui-agg__sum { flex-basis: 100%; justify-content: space-between; gap: 2px 8px; margin-left: 0; font-size: 12px; }

/* ----- The white panel with the graph ----- */
.ui-agg__panel { position: relative; overflow: hidden; border-radius: 16px; background: var(--ui-agg-panel); box-shadow: 0 0 0 1px var(--ui-agg-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-agg__stage { position: relative; width: 100%; min-height: 200px; container-type: inline-size; }
.ui-agg__svg { position: absolute; inset: 0; pointer-events: none; }
.ui-agg__halo { animation: ui-agg-fade-in 1200ms ease both; }

/* Links: thicker when busy, faded when quiet, lit while a pulse runs along them */
.ui-agg__edge { fill: none; stroke: var(--ui-agg-link); stroke-linecap: round; opacity: 0.75; stroke-dasharray: 1 1; stroke-dashoffset: 0; animation: ui-agg-draw 560ms var(--ui-agg-ease) backwards; transition: stroke-width 700ms var(--ui-agg-ease), opacity 320ms ease, stroke 300ms ease; }
.ui-agg__edge[data-idle] { opacity: 0.38; }
.ui-agg__edge[data-live] { opacity: 1; transition-duration: 700ms, 160ms, 300ms; }
.ui-agg__edge[data-ask] { stroke: var(--ui-agg-warn); opacity: 0.9; }
.ui-agg__edge[data-error] { stroke: var(--ui-agg-danger); opacity: 1; transition-duration: 700ms, 120ms, 120ms; }
.ui-agg__edge[data-leaving] { stroke-dashoffset: 0; animation: ui-agg-retract ${EXIT}ms var(--ui-agg-ease) forwards; }
.ui-agg[data-focus] .ui-agg__edge:not([data-near]) { opacity: 0.1; }
.ui-agg[data-focus] .ui-agg__edge[data-near] { opacity: 1; }

/* Pulses: a solid dot with a short tail out, a hollow one back */
.ui-agg__pulse .ui-agg__head, .ui-agg__pulse .ui-agg__tail { fill: var(--ui-agg-pulse); }
.ui-agg__pulse[data-kind="res"] .ui-agg__head, .ui-agg__pulse[data-kind="askres"] .ui-agg__head, .ui-agg__pulse[data-kind="err"] .ui-agg__head { fill: var(--ui-agg-panel); stroke: var(--ui-agg-pulse); stroke-width: 1.75; }
.ui-agg__pulse[data-kind="ask"] :is(.ui-agg__head, .ui-agg__tail), .ui-agg__pulse[data-kind="askres"] .ui-agg__tail { fill: var(--ui-agg-warn); }
.ui-agg__pulse[data-kind="askres"] .ui-agg__head { stroke: var(--ui-agg-warn); }
.ui-agg__pulse[data-kind="err"] .ui-agg__tail { fill: var(--ui-agg-danger); }
.ui-agg__pulse[data-kind="err"] .ui-agg__head { stroke: var(--ui-agg-danger); }
.ui-agg[data-focus] .ui-agg__pulse { opacity: 0.25; }
.ui-agg__glow { fill: var(--ui-agg-pulse); opacity: 0.16; }
.ui-agg__pulse:is([data-kind="ask"], [data-kind="askres"]) .ui-agg__glow { fill: var(--ui-agg-warn); }
.ui-agg__pulse[data-kind="err"] .ui-agg__glow { fill: var(--ui-agg-danger); }
.ui-agg__ripple { fill: none; stroke: var(--ui-agg-pulse); stroke-width: 1.25; }
.ui-agg__ripple:is([data-kind="ask"], [data-kind="askres"]) { stroke: var(--ui-agg-warn); }
.ui-agg__ripple[data-kind="err"] { stroke: var(--ui-agg-danger); stroke-width: 2; }

/* ----- Nodes: placed and floated by the frame loop; a disc with a label under it ----- */
.ui-agg__nodes { position: absolute; inset: 0; pointer-events: none; }
.ui-agg__node { position: absolute; top: 0; left: 0; width: 0; height: 0; transition: opacity 320ms ease; will-change: transform; }
.ui-agg[data-focus] .ui-agg__node[data-dim] { opacity: 0.3; }
.ui-agg__body { position: absolute; top: 0; left: 0; transform-origin: 0 0; animation: ui-agg-pop 560ms var(--ui-agg-ease) both; }
.ui-agg__node[data-leaving] .ui-agg__body { animation: ui-agg-out ${EXIT}ms var(--ui-agg-ease) forwards; }
.ui-agg__disc { position: absolute; top: calc(var(--d) / -2); left: calc(var(--d) / -2); display: grid; place-items: center; width: var(--d); height: var(--d); border-radius: 50%; background: var(--ui-agg-card); box-shadow: 0 0 0 1px var(--ui-agg-line), 0 2px 6px -2px rgba(0, 0, 0, 0.1); color: var(--ui-agg-text); pointer-events: auto; transition: width 300ms var(--ui-agg-ease), height 300ms var(--ui-agg-ease), top 300ms var(--ui-agg-ease), left 300ms var(--ui-agg-ease), box-shadow 240ms ease, transform 240ms var(--ui-agg-ease); }
/* A bigger touch target than the disc */
.ui-agg__disc::before { content: ""; position: absolute; inset: -6px; border-radius: 50%; }
.ui-agg__disc:hover, .ui-agg__node[data-open] .ui-agg__disc { transform: scale(1.06); }
.ui-agg__disc > svg { width: 48%; height: 48%; }
.ui-agg__initials { font-size: 11px; font-weight: 600; color: var(--ui-agg-text); }
/* Agents: the white disc on a gray tray ring, like every card of the library */
.ui-agg__node[data-kind="agent"] .ui-agg__disc { box-shadow: 0 0 0 4px var(--ui-agg-tray), 0 0 0 5px var(--ui-agg-line), 0 4px 12px -4px rgba(0, 0, 0, 0.14); }
.ui-agg__node[data-kind="agent"] .ui-agg__disc > svg { width: 46%; height: 46%; }
.ui-agg__node[data-kind="user"] .ui-agg__disc { background: var(--ui-agg-user-bg); color: var(--ui-agg-user-fg); box-shadow: 0 2px 6px -2px rgba(0, 0, 0, 0.25); }
.ui-agg__node[data-kind="user"] .ui-agg__disc > svg { width: 44%; height: 44%; }
.ui-agg__node[data-flash] .ui-agg__disc { animation: ui-agg-flash 500ms ease 3; }

/* Working agents breathe; waiting ones breathe amber, a little quicker */
.ui-agg__ring { position: absolute; top: calc(var(--d) / -2); left: calc(var(--d) / -2); width: var(--d); height: var(--d); border-radius: 50%; opacity: 0; transition: opacity 400ms ease; }
.ui-agg__node[data-status="working"] .ui-agg__ring { opacity: 1; animation: ui-agg-breathe 2600ms ease-in-out infinite; }
.ui-agg__node[data-status="waiting"] .ui-agg__ring { opacity: 1; --ui-agg-breath: rgba(245, 159, 10, 0.22); --ui-agg-breath-out: rgba(245, 159, 10, 0.04); animation: ui-agg-breathe 1500ms ease-in-out infinite; }
.ui-agg__node[data-status="error"] .ui-agg__ring { opacity: 1; box-shadow: 0 0 0 8px rgba(229, 72, 77, 0.16); }
.ui-agg__node[data-status="waiting"] .ui-agg__disc { box-shadow: 0 0 0 4px var(--ui-agg-tray), 0 0 0 5.5px var(--ui-agg-warn), 0 4px 12px -4px rgba(0, 0, 0, 0.14); }
.ui-agg__node[data-status="error"] .ui-agg__disc { box-shadow: 0 0 0 4px var(--ui-agg-tray), 0 0 0 5.5px var(--ui-agg-danger), 0 4px 12px -4px rgba(0, 0, 0, 0.14); }

/* A small badge on the disc's edge: needs you, failed, done */
.ui-agg__badge { position: absolute; top: calc(var(--d) * -0.36 - 9px); left: calc(var(--d) * 0.36 - 7px); display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 2px var(--ui-agg-panel); color: #fff; pointer-events: none; animation: ui-agg-pop 360ms var(--ui-agg-ease) both; }
.ui-agg__badge > svg { width: 11px; height: 11px; }
.ui-agg__badge[data-status="waiting"] { background: var(--ui-agg-warn); }
.ui-agg__badge[data-status="error"] { background: var(--ui-agg-danger); }
.ui-agg__badge[data-status="done"] { background: var(--ui-agg-ok); }

/* Labels under the disc, with a soft halo so links never cut through them */
.ui-agg__label { position: absolute; top: calc(var(--d) / 2 + 5px); left: 0; display: grid; justify-items: center; padding: 1px 6px; border-radius: 7px; background: var(--ui-agg-panel); box-shadow: 0 0 6px 2px var(--ui-agg-panel); transform: translateX(-50%); white-space: nowrap; pointer-events: none; }
.ui-agg__label[data-above] { top: auto; bottom: calc(var(--d) / 2 + 5px); }
.ui-agg__node[data-kind="agent"] .ui-agg__label { top: calc(var(--d) / 2 + 7px); }
.ui-agg__node[data-kind="agent"] .ui-agg__label[data-above] { top: auto; bottom: calc(var(--d) / 2 + 7px); }
/* A long name or line shortens – the full name is on the node's tooltip and in its card */
.ui-agg__name, .ui-agg__line { width: max-content; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
.ui-agg[data-narrow] :is(.ui-agg__name, .ui-agg__line) { max-width: 72px; }
.ui-agg__name { font-size: 12px; font-weight: 500; line-height: 15px; color: var(--ui-agg-text); }
.ui-agg__node[data-kind="agent"] .ui-agg__name { font-size: 12.5px; font-weight: 600; color: var(--ui-agg-ink); }
.ui-agg__line { font-size: 11px; line-height: 14px; color: var(--ui-agg-muted); }
.ui-agg__line[data-status="waiting"] { font-weight: 500; color: var(--ui-agg-warn-fg); }
.ui-agg__line[data-status="error"] { font-weight: 500; color: var(--ui-agg-danger-fg); }
.ui-agg[data-narrow] .ui-agg__name { font-size: 11px; line-height: 14px; }
.ui-agg[data-narrow] .ui-agg__ring { --ui-agg-b1: 4px; --ui-agg-b2: 9px; }
.ui-agg[data-narrow] .ui-agg__label { padding: 0 4px; }
.ui-agg[data-narrow] .ui-agg__node[data-kind="agent"] .ui-agg__name { font-size: 11.5px; }
.ui-agg[data-narrow] .ui-agg__line { font-size: 10.5px; line-height: 13px; }
.ui-agg[data-narrow] .ui-agg__node[data-kind="agent"] .ui-agg__disc { box-shadow: 0 0 0 3px var(--ui-agg-tray), 0 0 0 4px var(--ui-agg-line), 0 3px 10px -4px rgba(0, 0, 0, 0.14); }

/* "needs you" and "failed" – in the bar, a click opens that node's card */
.ui-agg__alerts { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.ui-agg__chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; margin: -3px 0; padding: 0 9px 0 6px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; animation: ui-agg-rise 320ms var(--ui-agg-ease) both; transition: filter 160ms ease; }
.ui-agg__chip > svg { width: 14px; height: 14px; }
.ui-agg__chip[data-kind="waiting"] { background: var(--ui-agg-warn-bg); color: var(--ui-agg-warn-fg); }
.ui-agg__chip[data-kind="error"] { background: var(--ui-agg-danger-bg); color: var(--ui-agg-danger-fg); }
.ui-agg__chip:hover { filter: saturate(1.3) brightness(0.97); }

/* ----- The card of a node ----- */
.ui-agg__card { position: absolute; z-index: 5; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; width: 264px; padding: 12px; border-radius: 16px; background: var(--ui-agg-card); box-shadow: 0 0 0 1px var(--ui-agg-line), 0 16px 32px -12px rgba(0, 0, 0, 0.2); animation: ui-agg-rise 220ms var(--ui-agg-ease) both; }
.ui-agg[data-narrow] .ui-agg__card { right: 8px; bottom: 8px; left: 8px; width: auto; }
.ui-agg__card-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.ui-agg__card-icon { display: grid; flex: none; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: var(--ui-agg-card); box-shadow: 0 0 0 1px var(--ui-agg-line), 0 1px 2px rgba(0, 0, 0, 0.06); font-size: 10px; font-weight: 600; color: var(--ui-agg-text); }
.ui-agg__card-icon > svg { width: 15px; height: 15px; }
.ui-agg__card-icon[data-kind="user"] { background: var(--ui-agg-user-bg); color: var(--ui-agg-user-fg); box-shadow: none; }
.ui-agg__card-who { display: grid; flex: 1; min-width: 0; }
.ui-agg__card-name { overflow: hidden; font-size: 13.5px; font-weight: 600; line-height: 17px; color: var(--ui-agg-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-agg__card-detail { overflow: hidden; font-size: 11.5px; line-height: 15px; color: var(--ui-agg-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agg__pill { flex: none; height: 20px; padding: 0 7px; border-radius: 999px; background: var(--ui-agg-chip); font-size: 11px; font-weight: 500; line-height: 20px; color: var(--ui-agg-text); white-space: nowrap; }
.ui-agg__pill[data-status="working"] { background: var(--ui-agg-brand-bg); color: var(--ui-agg-brand-fg); }
.ui-agg__pill[data-status="waiting"] { background: var(--ui-agg-warn-bg); color: var(--ui-agg-warn-fg); }
.ui-agg__pill[data-status="error"] { background: var(--ui-agg-danger-bg); color: var(--ui-agg-danger-fg); }
.ui-agg__pill[data-status="done"] { background: var(--ui-agg-ok-bg); color: var(--ui-agg-ok-fg); }
.ui-agg__close { display: grid; flex: none; place-items: center; width: 24px; height: 24px; margin: -4px -4px -4px -2px; border-radius: 999px; color: var(--ui-agg-muted); transition: background-color 160ms ease, color 160ms ease; }
.ui-agg__close:hover { background: var(--ui-agg-chip); color: var(--ui-agg-ink); }
.ui-agg__doing { font-size: 12.5px; line-height: 17px; color: var(--ui-agg-text); text-align: start; overflow-wrap: anywhere; white-space: pre-line; }
.ui-agg__calls { display: grid; gap: 2px; padding: 4px; border-radius: 12px; background: var(--ui-agg-tray); list-style: none; }
.ui-agg__call { display: flex; align-items: center; gap: 6px; min-width: 0; height: 26px; padding: 0 6px; border-radius: 8px; font-size: 12px; line-height: 16px; animation: ui-agg-rise 260ms var(--ui-agg-ease) both; }
.ui-agg__call:first-child { background: var(--ui-agg-card); box-shadow: 0 0 0 1px var(--ui-agg-line); }
.ui-agg__call-dir { display: grid; flex: none; place-items: center; color: var(--ui-agg-muted); }
.ui-agg__call-icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; font-size: 7.5px; font-weight: 600; color: var(--ui-agg-text); }
.ui-agg__call-icon > svg { width: 13px; height: 13px; }
.ui-agg__call-text { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-agg-muted); }
.ui-agg__call-who { font-weight: 500; color: var(--ui-agg-ink); }
.ui-agg__call-end { flex: none; font-size: 11.5px; color: var(--ui-agg-muted); font-variant-numeric: tabular-nums; }
.ui-agg__call[data-status="pending"] .ui-agg__call-end { color: var(--ui-agg-brand-fg); }
.ui-agg__call[data-status="error"] .ui-agg__call-end { font-weight: 500; color: var(--ui-agg-danger-fg); }
.ui-agg__spin { animation: ui-agg-spin 900ms linear infinite; }
.ui-agg__card-foot { display: flex; align-items: center; gap: 8px; padding: 0 2px; font-size: 12px; line-height: 16px; color: var(--ui-agg-muted); font-variant-numeric: tabular-nums; }
.ui-agg__card-cost { font-weight: 600; color: var(--ui-agg-ink); }

/* ----- The legend ----- */
.ui-agg__legend { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 16px; padding: 0 12px 12px; font-size: 11.5px; line-height: 16px; color: var(--ui-agg-muted); }
.ui-agg__legend > span { display: inline-flex; align-items: center; gap: 6px; }
.ui-agg__legend-call, .ui-agg__legend-tail { fill: var(--ui-agg-pulse); }
.ui-agg__legend-reply { fill: var(--ui-agg-panel); stroke: var(--ui-agg-pulse); stroke-width: 1.6; }
.ui-agg__legend-line { stroke: var(--ui-agg-link); stroke-linecap: round; }
.ui-agg__legend-wait { fill: var(--ui-agg-warn); }

.ui-agg__sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ----- Rounded squares, like the cards in Agent Tree ----- */
@property --ui-agg-turn { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.ui-agg .ui-agg__node { --ui-agg-r: calc(var(--d) * 0.27); }
.ui-agg :is(.ui-agg__disc, .ui-agg__ring, .ui-agg__disc::after) { border-radius: var(--ui-agg-r); }
.ui-agg .ui-agg__disc::before { border-radius: calc(var(--ui-agg-r) + 6px); }
.ui-agg .ui-agg__badge { top: calc(var(--d) / -2 - 6px); left: calc(var(--d) / 2 - 9px); }
.ui-agg .ui-agg__card-icon { border-radius: 8px; }
.ui-agg .ui-agg__stroke { box-sizing: border-box; padding: 1px; border-radius: var(--ui-agg-r); background: conic-gradient(from var(--ui-agg-turn), transparent 0deg, transparent 40deg, var(--ui-agg-state) 360deg); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0); animation: ui-agg-turn 1200ms linear infinite; }
@keyframes ui-agg-turn { to { --ui-agg-turn: 360deg; } }

@keyframes ui-agg-draw { from { stroke-dashoffset: 1; } }
@keyframes ui-agg-retract { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 1; opacity: 0; } }
@keyframes ui-agg-pop { from { opacity: 0; transform: scale(0.4); } }
@keyframes ui-agg-out { to { opacity: 0; transform: scale(0.5); } }
@keyframes ui-agg-rise { from { opacity: 0; transform: translateY(4px) scale(0.98); } }
@keyframes ui-agg-fade-in { from { opacity: 0; } }
@keyframes ui-agg-breathe { 0%, 100% { box-shadow: 0 0 0 var(--ui-agg-b1, 6px) var(--ui-agg-breath); } 50% { box-shadow: 0 0 0 var(--ui-agg-b2, 13px) var(--ui-agg-breath-out); } }
@keyframes ui-agg-flash { 50% { background: var(--ui-agg-danger-bg); } }
@keyframes ui-agg-spin { to { transform: rotate(360deg); } }

@media (prefers-reduced-motion: reduce) {
  .ui-agg *, .ui-agg *::before, .ui-agg *::after { animation: none !important; transition: none !important; }
  .ui-agg__edge { stroke-dasharray: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-agg {
  --ui-agg-tray: #19191c;
  --ui-agg-panel: #1f1f22;
  --ui-agg-card: #2a2a2e;
  --ui-agg-ink: #ededed;
  --ui-agg-text: #a1a1a6;
  --ui-agg-muted: #7c7c82;
  --ui-agg-line: #303035;
  --ui-agg-chip: #2e2e33;
  --ui-agg-link: #4f8fdb;
  --ui-agg-pulse: #6ea8ff;
  --ui-agg-glow: rgba(79, 143, 219, 0.16);
  --ui-agg-breath: rgba(110, 168, 255, 0.16);
  --ui-agg-breath-out: rgba(110, 168, 255, 0.03);
  --ui-agg-user-bg: #ededed;
  --ui-agg-user-fg: #141416;
  --ui-agg-brand-bg: #16243f;
  --ui-agg-brand-fg: #8ab4ff;
  --ui-agg-ok: #2fbf71;
  --ui-agg-ok-bg: #12301f;
  --ui-agg-ok-fg: #3dd68c;
  --ui-agg-warn: #f5a524;
  --ui-agg-warn-bg: #3a2410;
  --ui-agg-warn-fg: #ffa057;
  --ui-agg-danger: #f2555a;
  --ui-agg-danger-bg: #3b1714;
  --ui-agg-danger-fg: #ff977d;
  --ui-agg-ring: rgba(237, 237, 237, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-agg__panel { box-shadow: 0 0 0 1px var(--ui-agg-line); }
`;
