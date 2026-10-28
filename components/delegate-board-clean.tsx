"use client";

import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

/*
 * Delegate Board – hand work to your agents by dragging it onto them, in a single self-contained file.
 * One white card: new tasks on the left ("Unassigned"), the agents on the right – their mark, name and model, a
 * "Free" or "Busy until 14:32" tag and their queue as small chips, the running task first.
 *   · drag a task onto an agent: it lifts and follows the pointer, the agent under it lights up and previews what
 *     changes ("+12m · until 14:44"); on drop the card glides into that agent's queue
 *   · drag a queued chip to another agent to hand it over, or back to the left to unassign it
 *   · the Auto switch: on, every new task goes to the least busy agent on its own, one after another;
 *     off, you drag them yourself
 * Keyboard: Enter on a task picks it up, ↑ ↓ choose the agent, Enter drops it; 1–9 sends it to that agent at once.
 * The styles are injected below, so no extra files are needed.
 */

export type DelegateAgent = {
  id: string;
  name: string;
  /** Model or role, shown under the name */
  model?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the initials */
  avatar?: ReactNode;
  /** Minutes left on the task it is running now (the first task in its queue), for the "Busy until" time */
  current?: number;
  /** What a minute of its work costs (e.g. 0.05 for $0.05) – shows the price per task when you hand one over */
  rate?: number;
};

export type DelegateTask = {
  id: string;
  title: string;
  /** Rough minutes it takes */
  estimate: number;
  /** Small logos of the tools it works in – up to three */
  tools?: ReactNode[];
  /** Who it is with – leave it out for unassigned. In each queue, the first task is the running one */
  agentId?: string | null;
};

export type DelegateMode = "auto" | "manual";

export type DelegateBoardProps = {
  agents: DelegateAgent[];
  tasks: DelegateTask[];
  /** A drop, a keyboard pick or "Assign all". Without it the board moves the tasks itself */
  onAssign?: (taskId: string, agentId: string | null) => void;
  /** The clock for the "Busy until" times – defaults to now */
  now?: number;
  /** Auto hands every unassigned task to the least busy agent on its own; Manual waits for a drag */
  mode?: DelegateMode;
  defaultMode?: DelegateMode;
  onModeChange?: (mode: DelegateMode) => void;
  /** A suggested hand-off, e.g. from your router: the agent lights up and previews the new time, the task is marked */
  suggestion?: { taskId: string; agentId: string } | null;
  /** Formats a cost from rate × minutes – defaults to dollars, e.g. "$0.60" */
  formatCost?: (amount: number) => string;
  title?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const MIN = 60_000;
/** A finite number or nothing – NaN and Infinity from a broken feed count as not given */
const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : undefined);
const est = (t: DelegateTask) => Math.max(0, num(t.estimate) ?? 0);
const dollars = (n: number) =>
  n > 0 && n < 0.01 ? "<$0.01" : `$${n < 10 ? n.toFixed(2) : n < 100 ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString("en-US")}`;
const count = new Intl.NumberFormat("en-US");
/** Long stretches roll up: 1284 → "21h 24m", 2880 → "2d 0h" */
const long = (m: number) => {
  const r = Math.round(m);
  const h = Math.floor(r / 60);
  return h < 24 ? `${h}h ${String(r % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
const minutes = (m: number) => (m < 60 ? `${Math.round(m)} min` : long(m));
const plus = (m: number) => (m < 60 ? `${Math.round(m)}m` : long(m));
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.32, 0.72, 0.24, 1)";
const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
/** A clock time today, the weekday within a week, a date beyond – "Busy until 14:32" must not hide two days */
const until = (t: number, now: number) => {
  const d = new Date(t);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(d) - day(new Date(now))) / 86_400_000);
  if (days <= 0) return hhmm(t);
  if (days < 7) return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${hhmm(t)}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
/** First letter of the first two words – whole letters only, so an emoji never leaves half a character */
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

const toolsOf = (t: DelegateTask) =>
  t.tools?.length ? (
    <span className="ui-dbc__tools" aria-hidden="true">
      {t.tools.slice(0, 3).map((tool, k) => (
        <span key={k} className="ui-dbc__tool">
          {tool}
        </span>
      ))}
    </span>
  ) : null;

type CardProps = {
  t: DelegateTask;
  dragging: boolean;
  picked: boolean;
  describedBy: string;
  track: (el: HTMLElement | null) => void;
  on: Handlers;
};
type Handlers = {
  down: (e: ReactPointerEvent<HTMLElement>, id: string, from: "pile" | "queue") => void;
  move: (e: ReactPointerEvent<HTMLElement>) => void;
  up: (e: ReactPointerEvent<HTMLElement>) => void;
  cancel: () => void;
  key: (e: KeyboardEvent, id: string) => void;
};
/** One task in the pile – memoized, so a drag or a keyboard pick re-renders only the cards it touches */
const Card = memo(function Card({ t, dragging, picked, describedBy, track, on }: CardProps) {
  return (
    <li ref={track} className="ui-dbc__task-slot">
      <button
        type="button"
        className="ui-dbc__task"
        data-task-id={t.id}
        data-dragging={dragging ? "" : undefined}
        data-picked={picked ? "" : undefined}
        aria-describedby={describedBy}
        onPointerDown={(e) => on.down(e, t.id, "pile")}
        onPointerMove={on.move}
        onPointerUp={on.up}
        onPointerCancel={on.cancel}
        onKeyDown={(e) => on.key(e, t.id)}
      >
        <span className="ui-dbc__grip">
          <GripIcon />
        </span>
        <span className="ui-dbc__task-main">
          <span className="ui-dbc__task-title" dir="auto" title={t.title}>
            {t.title}
          </span>
          <span className="ui-dbc__task-meta">
            {toolsOf(t)}~{minutes(est(t))}
          </span>
        </span>
      </button>
    </li>
  );
});

/* ---------- Icons ---------- */

const Spark = () => (
  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    <path d="M7 1.2c.4 2.9 1.9 4.4 4.8 4.8-2.9.4-4.4 1.9-4.8 4.8C6.6 7.9 5.1 6.4 2.2 6 5.1 5.6 6.6 4.1 7 1.2Z" fill="currentColor" />
    <circle cx="11.6" cy="11.4" r="1.1" fill="currentColor" opacity="0.55" />
  </svg>
);
const GripIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    {[3, 6, 9].map((y) => [4.3, 7.7].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="0.95" fill="currentColor" />))}
  </svg>
);
const Spinner = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="ui-dbc__spin">
    <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.6" />
    <path d="M6 1.4a4.6 4.6 0 0 1 4.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** Pointer and card in screen pixels while dragging */
type Drag = { id: string; x: number; y: number; dx: number; dy: number; w: number; from: "pile" | "queue" };

/** How much the board is scaled on screen (CSS zoom or transforms on a parent) – screen pixels per CSS pixel */
const scaleOf = (el: HTMLElement | null) => (el && el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1);

export function DelegateBoard({
  agents,
  tasks,
  onAssign,
  now: nowProp,
  mode,
  defaultMode = "manual",
  onModeChange,
  suggestion,
  formatCost = dollars,
  title = "Delegate",
  className,
}: DelegateBoardProps) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState<Record<string, string | null>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [pickAt, setPickAt] = useState(0);
  const [announce, setAnnounce] = useState("");
  // Avatars whose image failed to load fall back to the initials
  const [broken, setBroken] = useState<Record<string, true>>({});
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return;
    const id = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [nowProp]);
  const now = nowProp ?? tick;
  const [innerMode, setInnerMode] = useState<DelegateMode>(defaultMode);
  const currentMode = mode ?? innerMode;
  const setMode = (next: DelegateMode) => {
    setInnerMode(next);
    onModeChange?.(next);
  };

  // Without a handler the board keeps the moves itself; tasks then join the end of a queue
  const order = useRef<string[]>([]);
  const list = tasks.map((t) => (t.id in local ? { ...t, agentId: local[t.id] } : t));
  const rank = new Map(order.current.map((id, i) => [id, i]));
  const sorted = [...list].sort((a, b) => (rank.get(a.id) ?? -1) - (rank.get(b.id) ?? -1));
  const pile = sorted.filter((t) => !t.agentId);
  const queueOf = (agentId: string) => sorted.filter((t) => t.agentId === agentId);
  const agentById = (id: string) => agents.find((a) => a.id === id);

  /** When an agent is done with everything in its queue – optionally with one more task */
  const busyUntil = (a: DelegateAgent, extra?: DelegateTask) => {
    const q = queueOf(a.id).filter((t) => t.id !== extra?.id);
    if (!q.length && !extra) return null;
    const first = q.length ? (num(a.current) ?? est(q[0])) : 0;
    const rest = q.slice(1).reduce((sum, t) => sum + est(t), 0);
    return now + (first + rest + (extra ? est(extra) : 0)) * MIN;
  };

  /** What an agent's remaining queue costs – or one task on it */
  const workLeft = (a: DelegateAgent) => {
    const q = queueOf(a.id);
    return q.length ? (num(a.current) ?? est(q[0])) + q.slice(1).reduce((sum, t) => sum + est(t), 0) : 0;
  };
  const costOf = (a: DelegateAgent, mins: number) => {
    const rate = num(a.rate);
    return rate != null ? rate * mins : null;
  };
  const queued = agents.reduce<number | null>((sum, a) => {
    const c = costOf(a, workLeft(a));
    return c == null ? sum : (sum ?? 0) + c;
  }, null);

  const assign = (taskId: string, agentId: string | null) => {
    const task = list.find((t) => t.id === taskId);
    if (!task || (task.agentId ?? null) === agentId) return;
    order.current = [...order.current.filter((id) => id !== taskId), taskId];
    const who = agentId ? agentById(agentId)?.name : null;
    setAnnounce(who ? `${task.title} → ${who}` : `${task.title} is unassigned again`);
    if (onAssign) onAssign(taskId, agentId);
    else setLocal((l) => ({ ...l, [taskId]: agentId }));
  };

  /** The agent that is free soonest */
  const leastBusy = () => [...agents].sort((a, b) => (busyUntil(a) ?? now) - (busyUntil(b) ?? now))[0];

  // Auto: the next unassigned task goes to the least busy agent, one about every second
  const nextId = pile[0]?.id;
  useEffect(() => {
    if (currentMode !== "auto" || !nextId || drag) return;
    const id = window.setTimeout(() => {
      const who = leastBusy();
      if (who) assign(nextId, who.id);
    }, reduced() ? 0 : 900);
    return () => window.clearTimeout(id);
  }, [currentMode, nextId, drag]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- Motion: every card glides from where it was; a dropped card from where it was let go ---------- */

  const tracked = useRef(new Map<string, HTMLElement>());
  // One ref callback per task, kept across renders, so memoized cards stay untouched
  const trackers = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const track = (id: string) => {
    let fn = trackers.current.get(id);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) tracked.current.set(id, el);
        else tracked.current.delete(id);
      };
      trackers.current.set(id, fn);
    }
    return fn;
  };
  const before = useRef(new Map<string, DOMRect>());
  const dropped = useRef<{ id: string; rect: DOMRect } | null>(null);
  const shape = JSON.stringify(sorted.map((t) => [t.id, t.agentId ?? null]));
  const lastShape = useRef(shape);
  if (rootRef.current && shape !== lastShape.current) {
    before.current = new Map([...tracked.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  }
  useLayoutEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    const drop = dropped.current;
    dropped.current = null;
    if (reduced()) return;
    const z = scaleOf(rootRef.current);
    for (const [id, el] of tracked.current) {
      const from = drop?.id === id ? drop.rect : before.current.get(id);
      if (!from) continue;
      const to = el.getBoundingClientRect();
      const dx = (from.left - to.left) / z;
      const dy = (from.top - to.top) / z;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // A card that turned into a chip (or back) glides from where it was and fades in – no stretched text
      const resized = Math.abs(from.width - to.width) > 8 || Math.abs(from.height - to.height) > 4;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: resized ? 0.4 : 1, zIndex: 3 },
          { transform: "none", opacity: 1, zIndex: 3 },
        ],
        { duration: 480, easing: EASE },
      );
    }
  }, [shape]);

  /* ---------- Dragging ---------- */

  const start = useRef<{ id: string; x: number; y: number; el: HTMLElement; from: Drag["from"] } | null>(null);
  const targetAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const agent = el?.closest<HTMLElement>("[data-agent]");
    if (agent && rootRef.current?.contains(agent)) return agent.dataset.agent ?? null;
    const pileEl = el?.closest<HTMLElement>("[data-pile]");
    if (pileEl && rootRef.current?.contains(pileEl)) return "pile";
    return null;
  };
  const onDown = (e: ReactPointerEvent<HTMLElement>, id: string, from: Drag["from"]) => {
    if (e.button !== 0) return;
    start.current = { id, x: e.clientX, y: e.clientY, el: e.currentTarget, from };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    if (!drag) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 4) return;
      const r = s.el.getBoundingClientRect();
      setDrag({ id: s.id, x: e.clientX, y: e.clientY, dx: s.x - r.left, dy: s.y - r.top, w: Math.max(r.width, 200), from: s.from });
      setPicked(null);
    } else setDrag({ ...drag, x: e.clientX, y: e.clientY });
    setOver(targetAt(e.clientX, e.clientY));
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    start.current = null;
    if (!s || !drag) return;
    const target = targetAt(e.clientX, e.clientY);
    const ghost = rootRef.current?.querySelector<HTMLElement>(".ui-dbc__ghost");
    if (ghost && target) dropped.current = { id: drag.id, rect: ghost.getBoundingClientRect() };
    setDrag(null);
    setOver(null);
    if (target === "pile") assign(drag.id, null);
    else if (target) assign(drag.id, target);
  };

  /* ---------- Keyboard: pick up, choose, drop ---------- */

  const onTaskKey = (e: KeyboardEvent, id: string) => {
    if (!agents.length) return;
    const n = Number(e.key);
    if (n >= 1 && n <= agents.length) {
      e.preventDefault();
      assign(id, agents[n - 1].id);
      setPicked(null);
      return;
    }
    if (picked === id) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setPickAt((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + agents.length) % agents.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        assign(id, agents[pickAt].id);
        setPicked(null);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPicked(null);
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setPicked(id);
      setPickAt(0);
      setAnnounce(`Picked up ${list.find((t) => t.id === id)?.title}. Choose an agent with the arrow keys, Enter to hand it over.`);
    }
  };
  const target = drag ? over : picked ? agents[pickAt]?.id : (suggestion?.agentId ?? null);
  const moving = list.find((t) => t.id === (drag?.id ?? picked ?? suggestion?.taskId));

  /* ---------- Pieces ---------- */

  // Stable handlers for the memoized cards – they read the latest state through a ref
  const live = useRef<Handlers>(null!);
  live.current = {
    down: onDown,
    move: onMove,
    up: onUp,
    cancel: () => {
      start.current = null;
      setDrag(null);
      setOver(null);
    },
    key: onTaskKey,
  };
  const on = useMemo<Handlers>(
    () => ({
      down: (e, id, from) => live.current.down(e, id, from),
      move: (e) => live.current.move(e),
      up: (e) => live.current.up(e),
      cancel: () => live.current.cancel(),
      key: (e, id) => live.current.key(e, id),
    }),
    [],
  );
  const tools = toolsOf;
  const card = (t: DelegateTask) => (
    <Card
      key={t.id}
      t={t}
      dragging={drag?.id === t.id}
      picked={picked === t.id || suggestion?.taskId === t.id}
      describedBy={`${uid}-how`}
      track={track(t.id)}
      on={on}
    />
  );

  return (
    <div ref={rootRef} className={["ui-dbc", className].filter(Boolean).join(" ")} data-dragging={drag ? "" : undefined}>
      <style href="ui-delegate-board-clean" precedence="default">
        {css}
      </style>

      <div className="ui-dbc__card">
        <header className="ui-dbc__bar">
          <span className="ui-dbc__spark">
            <Spark />
          </span>
          <span className="ui-dbc__title" dir="auto" title={title}>
            {title}
          </span>
          <span className="ui-dbc__hint">{currentMode === "auto" ? "New tasks go to whoever is free first" : "Drag a task onto an agent"}</span>
          {/* Auto as a switch: the word stays strong while it is on, and fades with the switch when it is off */}
          <button type="button" role="switch" aria-checked={currentMode === "auto"} className="ui-dbc__auto" onClick={() => setMode(currentMode === "auto" ? "manual" : "auto")}>
            <span className="ui-dbc__auto-label">Auto</span>
            <span className="ui-dbc__switch" aria-hidden="true">
              <span />
            </span>
          </button>
        </header>

        <div className="ui-dbc__body">
          {/* ----- New work ----- */}
          <section className="ui-dbc__pile" data-pile="" data-over={over === "pile" && drag?.from === "queue" ? "" : undefined} aria-labelledby={`${uid}-pile`}>
            <h4 className="ui-dbc__head" id={`${uid}-pile`}>
              Unassigned <span className="ui-dbc__count">{count.format(pile.length)}</span>
            </h4>
            <ul className="ui-dbc__tasks" data-long={pile.length > 12 ? "" : undefined}>
              {pile.map(card)}
              {pile.length === 0 && <li className="ui-dbc__empty">Everything is handed out</li>}
            </ul>
          </section>

          {/* ----- Who does it ----- */}
          <section className="ui-dbc__agents" aria-labelledby={`${uid}-agents`}>
            <h4 className="ui-dbc__head" id={`${uid}-agents`}>
              Agents
              {queued != null && queued > 0 && (
                <span className="ui-dbc__spend" key={Math.round(queued * 100)}>
                  {formatCost(queued)} in queues
                </span>
              )}
            </h4>
            <ul className="ui-dbc__roster">
              {agents.map((a, i) => {
                const q = queueOf(a.id);
                const busy = busyUntil(a);
                const isTarget = target === a.id;
                const preview = isTarget && moving && moving.agentId !== a.id ? busyUntil(a, moving) : null;
                const price = preview && moving ? costOf(a, est(moving)) : null;
                return (
                  <li key={a.id} className="ui-dbc__agent" data-agent={a.id} data-target={isTarget ? "" : undefined}>
                    <span
                      className="ui-dbc__avatar"
                      data-logo={a.avatar && !broken[a.id] ? "" : undefined}
                      onErrorCapture={() => setBroken((b) => (b[a.id] ? b : { ...b, [a.id]: true }))}
                    >
                      {a.avatar && !broken[a.id] ? a.avatar : initials(a.name)}
                    </span>
                    <span className="ui-dbc__who">
                      <span className="ui-dbc__name-line">
                        <span className="ui-dbc__name" dir="auto" title={a.name}>
                          {a.name}
                        </span>
                        <span className="ui-dbc__key" aria-hidden="true">
                          {i + 1}
                        </span>
                      </span>
                      <span className="ui-dbc__model">
                        <span className="ui-dbc__model-text" dir="auto" title={a.model}>
                          {a.model}
                        </span>
                        {num(a.rate) != null && <span className="ui-dbc__rate">{formatCost(num(a.rate)!)}/min</span>}
                      </span>
                    </span>
                    <span className="ui-dbc__load">
                      {price != null && (
                        <span key="price" className="ui-dbc__price">
                          +{formatCost(price)}
                        </span>
                      )}
                      {preview ? (
                        <span key="preview" className="ui-dbc__tag" data-kind="preview">
                          +{plus(moving ? est(moving) : 0)} until {until(preview, now)}
                        </span>
                      ) : busy ? (
                        <span key={busy} className="ui-dbc__tag" data-kind="busy">
                          Busy until {until(busy, now)}
                        </span>
                      ) : (
                        <span key="free" className="ui-dbc__tag" data-kind="free">
                          Free
                        </span>
                      )}
                    </span>
                    <ul className="ui-dbc__queue" aria-label={`${a.name}'s queue`}>
                      {q.slice(0, 3).map((t, k) => (
                        <li key={t.id} ref={track(t.id)} className="ui-dbc__chip-slot">
                          <button
                            type="button"
                            className="ui-dbc__chip"
                            data-chip-id={t.id}
                            data-running={k === 0 ? "" : undefined}
                            data-dragging={drag?.id === t.id ? "" : undefined}
                            title={`${t.title} · ~${minutes(est(t))}`}
                            onPointerDown={(e) => onDown(e, t.id, "queue")}
                            onPointerMove={onMove}
                            onPointerUp={onUp}
                            onKeyDown={(e) => onTaskKey(e, t.id)}
                          >
                            {k === 0 ? <Spinner /> : tools(t)}
                            <span className="ui-dbc__chip-title" dir="auto">
                              {t.title}
                            </span>
                          </button>
                        </li>
                      ))}
                      {/* What does not fit: a "+2" chip, its tasks in a small dark tooltip on hover or focus */}
                      {q.length > 3 && (
                        <li className="ui-dbc__more">
                          <button type="button" className="ui-dbc__chip ui-dbc__chip--more" aria-describedby={`${uid}-${a.id}-more`}>
                            +{count.format(q.length - 3)}
                          </button>
                          <span className="ui-dbc__tip" id={`${uid}-${a.id}-more`} role="tooltip">
                            <ul className="ui-dbc__tip-list">
                              {q.slice(3, 11).map((t) => (
                                <li key={t.id}>
                                  {tools(t)}
                                  <span className="ui-dbc__tip-title" dir="auto">
                                    {t.title}
                                  </span>
                                  <span className="ui-dbc__tip-min">~{minutes(est(t))}</span>
                                </li>
                              ))}
                              {q.length > 11 && <li className="ui-dbc__tip-min">+{count.format(q.length - 11)} more</li>}
                            </ul>
                          </span>
                        </li>
                      )}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>

      {/* The lifted card under the pointer */}
      {drag &&
        moving &&
        (() => {
          // Placed inside the board in its own pixels, so it stays under the pointer even when the board is scaled
          const root = rootRef.current;
          const z = scaleOf(root);
          const r = root?.getBoundingClientRect();
          const left = ((drag.x - drag.dx - (r?.left ?? 0)) / z).toFixed(1);
          const top = ((drag.y - drag.dy - (r?.top ?? 0)) / z).toFixed(1);
          return (
        <div className="ui-dbc__ghost" style={{ left: `${left}px`, top: `${top}px`, width: drag.w / z }} aria-hidden="true">
          <span className="ui-dbc__grip">
            <GripIcon />
          </span>
          <span className="ui-dbc__task-main">
            <span className="ui-dbc__task-title" dir="auto">
              {moving.title}
            </span>
            <span className="ui-dbc__task-meta">
              {tools(moving)}~{minutes(est(moving))}
            </span>
          </span>
        </div>
          );
        })()}

      <span className="ui-dbc__sr" id={`${uid}-how`}>
        Drag onto an agent, or press Enter, choose with the arrow keys and press Enter again. Number keys hand it over at once.
      </span>
      <span className="ui-dbc__sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-dbc */
.ui-dbc {
  --ui-dbc-card: #ffffff;
  --ui-dbc-strong: #000000;
  --ui-dbc-ink: rgba(0, 0, 0, 0.88);
  --ui-dbc-text: rgba(0, 0, 0, 0.61);
  --ui-dbc-muted: rgba(0, 0, 0, 0.45);
  --ui-dbc-faint: rgba(0, 0, 0, 0.27);
  --ui-dbc-line: rgba(0, 0, 0, 0.06);
  --ui-dbc-wash: rgba(0, 0, 0, 0.03);
  --ui-dbc-lane: rgba(0, 0, 0, 0.035);
  --ui-dbc-switch-off: rgba(0, 0, 0, 0.12);
  --ui-dbc-fill: rgba(0, 0, 0, 0.06);
  --ui-dbc-accent: rgba(0, 96, 226, 0.765);
  --ui-dbc-brand-bg: #008ff519;
  --ui-dbc-brand-fg: #006dcbf2;
  --ui-dbc-warn-bg: #ff9c0029;
  --ui-dbc-warn-fg: #cc4e00;
  --ui-dbc-ok-bg: #00a43319;
  --ui-dbc-ok-fg: #00713fde;
  --ui-dbc-focus: rgba(0, 96, 226, 0.35);
  --ui-dbc-target-bg: rgba(0, 120, 245, 0.045);
  --ui-dbc-target-edge: rgba(0, 96, 226, 0.3);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-dbc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-dbc-lift: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 16px 32px -12px rgba(0, 0, 0, 0.25), 0 2px 6px rgba(0, 0, 0, 0.06);
  --ui-dbc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 720px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-dbc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-dbc[data-dragging] { cursor: grabbing; user-select: none; -webkit-user-select: none; }
.ui-dbc *, .ui-dbc *::before, .ui-dbc *::after { box-sizing: border-box; }
:where(.ui-dbc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-dbc button:focus-visible { outline: 2px solid var(--ui-dbc-focus); outline-offset: 1px; }
.ui-dbc ul { margin: 0; padding: 0; list-style: none; }
.ui-dbc h4 { margin: 0; }
.ui-dbc svg { display: block; flex: none; }
.ui-dbc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* One white card – the edge is a shadow, not a border */
.ui-dbc__card { border-radius: 10px; background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); }

.ui-dbc__bar { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px 12px 12px 16px; border-bottom: 0.5px solid var(--ui-dbc-line); }
.ui-dbc__spark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-dbc-accent); }
.ui-dbc__title { min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 500; color: var(--ui-dbc-strong); white-space: nowrap; }
.ui-dbc__hint { flex: 1 1 0; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-dbc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Auto: a label and a switch – on, the word is strong and the track filled; off, both fade */
.ui-dbc__auto { display: inline-flex; flex: none; align-items: center; gap: 8px; height: 28px; padding: 0 2px 0 6px; border-radius: 6px; }
.ui-dbc__auto-label { font-size: 12px; font-weight: 500; color: var(--ui-dbc-strong); transition: opacity 200ms ease; }
.ui-dbc__auto[aria-checked="false"] .ui-dbc__auto-label { opacity: 0.45; }
.ui-dbc__switch { position: relative; width: 28px; height: 16px; border-radius: 999px; background: var(--ui-dbc-switch-off); transition: background-color 220ms ease; }
.ui-dbc__switch > span { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.18), 0 0 0 0.5px rgba(0, 0, 0, 0.04); transition: transform 240ms var(--ui-dbc-ease); }
.ui-dbc__auto[aria-checked="true"] .ui-dbc__switch { background: var(--ui-dbc-accent); }
.ui-dbc__auto[aria-checked="true"] .ui-dbc__switch > span { transform: translateX(12px); }

.ui-dbc__body { display: grid; grid-template-columns: 236px minmax(0, 1fr); }
.ui-dbc__head { display: flex; align-items: center; gap: 6px; margin: 0 4px 8px !important; font-size: 12px; font-weight: 400; line-height: 16px; color: var(--ui-dbc-muted); }
.ui-dbc__count { display: grid; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); font-size: 10px; font-weight: 500; color: var(--ui-dbc-text); font-variant-numeric: tabular-nums; }

/* ----- The pile ----- */
/* New work sits in a soft gray area, like the columns of Agent Inbox */
.ui-dbc__pile { margin: 12px 0 12px 12px; padding: 10px 6px 6px; border-radius: 10px; background: var(--ui-dbc-lane); transition: background-color 200ms ease, box-shadow 200ms ease; }
.ui-dbc__pile .ui-dbc__head { margin-left: 6px !important; }
.ui-dbc__pile[data-over] { box-shadow: inset 0 0 0 1px var(--ui-dbc-line); }
.ui-dbc__tasks { display: grid; gap: 4px; }
/* A long pile scrolls inside the gray area – a little room around, so the cards keep their edges */
.ui-dbc__tasks[data-long] { max-height: 560px; margin: -2px; padding: 2px; overflow-y: auto; overscroll-behavior: contain; }
.ui-dbc__task, .ui-dbc__ghost { display: flex; align-items: flex-start; gap: 8px; width: 100%; padding: 8px 10px 8px 6px; border-radius: 8px; background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); cursor: grab; touch-action: none; transition: opacity 160ms ease, box-shadow 160ms ease; }
.ui-dbc__task:hover { box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 2px 6px -2px rgba(0, 0, 0, 0.12); }
.ui-dbc__task[data-dragging], .ui-dbc__chip[data-dragging] { opacity: 0.35; }
.ui-dbc__task[data-picked] { background: var(--ui-dbc-target-bg); box-shadow: inset 0 0 0 0.5px var(--ui-dbc-target-edge), var(--ui-dbc-shadow); }
.ui-dbc__grip { display: grid; flex: none; place-items: center; width: 12px; height: 20px; color: var(--ui-dbc-faint); }
.ui-dbc__task-main { display: grid; gap: 2px; min-width: 0; }
.ui-dbc__task-title { overflow: hidden; text-align: start; font-weight: 500; color: var(--ui-dbc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-dbc__task-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--ui-dbc-muted); font-variant-numeric: tabular-nums; }
.ui-dbc__tools { display: flex; gap: 4px; }
.ui-dbc__tool, .ui-dbc__tool > svg, .ui-dbc__tool > img { display: grid; width: 12px; height: 12px; }
.ui-dbc__tool { flex: none; overflow: hidden; }
.ui-dbc__tool > img { object-fit: contain; }
/* Empty: just a quiet line on the gray area */
.ui-dbc__empty { display: grid; place-items: center; min-height: 52px; padding: 8px 10px; font-size: 12px; line-height: 16px; color: var(--ui-dbc-muted); text-align: center; }

/* The lifted card: tilted a touch, a deeper shadow, under the pointer */
.ui-dbc__ghost { position: absolute; z-index: 1000; box-shadow: var(--ui-dbc-lift); cursor: grabbing; pointer-events: none; transform: rotate(1.5deg) scale(1.02); }

/* ----- The agents ----- */
.ui-dbc__agents { padding: 14px 12px 12px; }
.ui-dbc__roster { display: grid; gap: 4px; }
.ui-dbc__agent { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; grid-template-areas: "avatar who load" "avatar queue queue"; column-gap: 10px; row-gap: 6px; padding: 8px 8px 8px 8px; border-radius: 8px; transition: background-color 180ms ease, box-shadow 180ms ease; }
.ui-dbc[data-dragging] .ui-dbc__agent { box-shadow: inset 0 0 0 0.5px var(--ui-dbc-line); }
/* The agent under a dragged task: just a light blue wash, no stroke */
.ui-dbc__agent[data-target] { background: var(--ui-dbc-target-bg); }
.ui-dbc__avatar { grid-area: avatar; display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: var(--ui-dbc-fill); font-size: 10px; font-weight: 500; color: var(--ui-dbc-text); }
.ui-dbc__avatar[data-logo] { background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); }
.ui-dbc__avatar > svg, .ui-dbc__avatar > img { width: 15px; height: 15px; }
.ui-dbc__avatar { flex: none; overflow: hidden; }
.ui-dbc__avatar > img { object-fit: contain; }
.ui-dbc__who { grid-area: who; display: grid; min-width: 0; }
.ui-dbc__name-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ui-dbc__name { overflow: hidden; text-align: start; font-weight: 500; color: var(--ui-dbc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-dbc__key { display: none; place-items: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 4px; background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); font-size: 10px; font-weight: 500; color: var(--ui-dbc-muted); }
.ui-dbc:focus-within .ui-dbc__key { display: grid; }
.ui-dbc__model { display: flex; min-width: 0; font-size: 12px; line-height: 16px; color: var(--ui-dbc-muted); white-space: nowrap; }
.ui-dbc__model-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: start; }
.ui-dbc__load { grid-area: load; align-self: start; display: flex; align-items: center; gap: 8px; }
.ui-dbc__spend { margin-left: auto; font-variant-numeric: tabular-nums; animation: ui-dbc-in 260ms var(--ui-dbc-ease) both; }
/* The price per minute sits after the model in a lighter grey, the hand-off price as quiet text next to the tag – no extra pills */
.ui-dbc__rate { flex: none; margin-left: 6px; color: var(--ui-dbc-faint); font-variant-numeric: tabular-nums; }
.ui-dbc__price { font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-dbc-brand-fg); white-space: nowrap; font-variant-numeric: tabular-nums; animation: ui-dbc-in 260ms var(--ui-dbc-ease) both; }
.ui-dbc__tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 5px; font-size: 11px; font-weight: 500; line-height: 16px; white-space: nowrap; font-variant-numeric: tabular-nums; animation: ui-dbc-in 260ms var(--ui-dbc-ease) both; }
.ui-dbc__tag[data-kind="free"] { background: var(--ui-dbc-ok-bg); color: var(--ui-dbc-ok-fg); }
.ui-dbc__tag[data-kind="busy"] { background: var(--ui-dbc-fill); color: var(--ui-dbc-text); }
.ui-dbc__tag[data-kind="preview"] { background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); color: var(--ui-dbc-brand-fg); }
.ui-dbc__queue { grid-area: queue; display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.ui-dbc__queue:empty { display: none; }
.ui-dbc__chip-slot { min-width: 0; max-width: 100%; }
.ui-dbc__chip { display: flex; align-items: center; gap: 5px; max-width: 100%; height: 24px; padding: 0 8px 0 6px; border-radius: 6px; background: var(--ui-dbc-card); box-shadow: var(--ui-dbc-shadow); font-size: 12px; line-height: 16px; color: var(--ui-dbc-text); cursor: grab; touch-action: none; }
.ui-dbc__chip[data-running] { background: var(--ui-dbc-brand-bg); box-shadow: none; color: var(--ui-dbc-brand-fg); font-weight: 500; }
.ui-dbc__chip-title { text-align: start; min-width: 0; max-width: 150px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-dbc__more { position: relative; }
.ui-dbc__chip--more { padding: 0 8px; font-weight: 500; color: var(--ui-dbc-text); cursor: default; }
/* The tooltip: dark and a little see-through, like in Agent Lanes – light in dark mode */
.ui-dbc__tip { position: absolute; bottom: calc(100% + 6px); left: 50%; z-index: 10; display: grid; width: max-content; max-width: min(320px, 90cqw); padding: 8px 10px; border-radius: 8px; background: rgba(24, 24, 27, 0.92); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.35); font-size: 12px; line-height: 16px; color: rgba(255, 255, 255, 0.86); text-align: left; opacity: 0; visibility: hidden; transform: translate(-50%, 3px); transition: opacity 160ms ease, transform 160ms ease, visibility 0s linear 160ms; pointer-events: none; }
.ui-dbc__more:hover .ui-dbc__tip, .ui-dbc__more:focus-within .ui-dbc__tip { opacity: 1; visibility: visible; transform: translate(-50%, 0); transition: opacity 160ms ease, transform 160ms ease, visibility 0s; }
.ui-dbc__tip-list { display: grid; gap: 2px; }
.ui-dbc__tip-list li { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
.ui-dbc__tip-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: start; }
.ui-dbc__tip-min { flex: none; }
/* Black marks (Notion, GitHub …) turn white on the dark tooltip – logos drawn in currentColor or the ink token follow */
.ui-dbc__tip { --ui-dbc-strong: #fff; --ui-db-ink: #fff; }
.ui-dbc__tip-min { color: rgba(255, 255, 255, 0.5); }
.ui-dbc__spin { animation: ui-dbc-spin 900ms linear infinite; }

@keyframes ui-dbc-spin { to { transform: rotate(360deg); } }
@keyframes ui-dbc-in { from { opacity: 0; transform: translateY(2px); } }

/* Narrow containers: the pile above the agents */
@container (max-width: 560px) {
  .ui-dbc__body { grid-template-columns: minmax(0, 1fr); }
  /* The "+2" tooltip spans the queue row instead of centering on its chip, so it stays inside the board */
  .ui-dbc__queue { position: relative; }
  .ui-dbc__more { position: static; }
  .ui-dbc__tip { left: 0; max-width: 100%; transform: translate(0, 3px); }
  .ui-dbc__more:hover .ui-dbc__tip, .ui-dbc__more:focus-within .ui-dbc__tip { transform: none; }
  .ui-dbc__pile { margin: 12px 12px 0; }
  .ui-dbc__hint { display: none; }
}
@media (pointer: coarse) {
  .ui-dbc__auto { height: 34px; }
  .ui-dbc__chip { height: 30px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dbc *, .ui-dbc *::before, .ui-dbc *::after { animation: none !important; transition: none !important; }
  .ui-dbc__ghost { transform: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-dbc {
  --ui-dbc-card: #1c1c1f;
  --ui-dbc-strong: #ffffff;
  --ui-dbc-ink: rgba(255, 255, 255, 0.9);
  --ui-dbc-text: rgba(255, 255, 255, 0.62);
  --ui-dbc-muted: rgba(255, 255, 255, 0.45);
  --ui-dbc-faint: rgba(255, 255, 255, 0.28);
  --ui-dbc-line: rgba(255, 255, 255, 0.08);
  --ui-dbc-wash: rgba(255, 255, 255, 0.04);
  --ui-dbc-lane: rgba(255, 255, 255, 0.035);
  --ui-dbc-switch-off: rgba(255, 255, 255, 0.16);
  --ui-dbc-fill: rgba(255, 255, 255, 0.08);
  --ui-dbc-accent: #5b9aff;
  --ui-dbc-brand-bg: #0077ff3a;
  --ui-dbc-brand-fg: #70b8ff;
  --ui-dbc-warn-bg: #fb6a0025;
  --ui-dbc-warn-fg: #ffa057;
  --ui-dbc-ok-bg: #22ff991e;
  --ui-dbc-ok-fg: #46fea5d4;
  --ui-dbc-focus: rgba(91, 154, 255, 0.45);
  --ui-dbc-target-bg: rgba(91, 154, 255, 0.08);
  --ui-dbc-target-edge: rgba(112, 184, 255, 0.35);
  --ui-dbc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-dbc-lift: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 16px 32px -12px rgba(0, 0, 0, 0.7);
}
/* Dark mode: the tooltip turns light, so it stands out from the dark card */
:where(.dark, [data-theme="dark"]) .ui-dbc__tip { background: rgba(250, 250, 250, 0.94); box-shadow: 0 8px 24px -8px rgba(0, 0, 0, 0.6); color: rgba(0, 0, 0, 0.82); }
:where(.dark, [data-theme="dark"]) .ui-dbc__tip { --ui-dbc-strong: rgba(0, 0, 0, 0.88); --ui-db-ink: rgba(0, 0, 0, 0.88); }
:where(.dark, [data-theme="dark"]) .ui-dbc__tip-min { color: rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) `;
