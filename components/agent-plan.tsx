"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

/*
 * Agent Plan – an AI agent proposes a step-by-step plan, the user adjusts it, then watches it run.
 * In review (status "draft") steps can be renamed inline, removed, reordered by dragging the grip
 * or with Alt+↑/↓, and new ones added at the end. Once running, each step shows a spinner and a
 * live timer, done steps draw a check and show their duration, failed ones offer "Retry from here",
 * and a thin line on the left fills as the plan moves along. All in a single self-contained file.
 * The styles are injected below, so no extra files are needed.
 */

export type PlanStepStatus = "pending" | "active" | "done" | "failed" | "skipped";

export type PlanStep = {
  id: string;
  title: string;
  /** A second, quieter line under the title */
  detail?: string;
  /** Tool the agent will call, shown as a small mono chip, e.g. "search_web" */
  tool?: string;
  status?: PlanStepStatus;
  /** How long the step took, in ms – shown next to done steps (measured live if left out) */
  duration?: number;
  /** Shown under a failed step */
  error?: string;
};

export type AgentPlanProps = {
  /** Controlled steps – pair with onChange */
  steps?: PlanStep[];
  /** Initial steps when uncontrolled */
  defaultSteps?: PlanStep[];
  /** "draft" = review and edit, "running" = executing, "done" = finished */
  status?: "draft" | "running" | "done";
  /** Every edit during review: rename, remove, reorder, add */
  onChange?: (steps: PlanStep[]) => void;
  /** "Run plan" pressed – gets the steps in their final order */
  onRun?: (steps: PlanStep[]) => void;
  /** Shows a "Cancel" button next to "Run plan" */
  onCancel?: () => void;
  /** Shows "Retry from here" on failed steps */
  onRetry?: (stepId: string) => void;
  /** The goal of the plan, shown as the heading */
  title?: string;
  /** Estimated run time shown in review, e.g. "~2 min" */
  estimate?: string;
  className?: string;
};

let uid = 0;
const makeId = () => `step-${Date.now().toString(36)}-${(uid++).toString(36)}`;
const RAYS = Array.from({ length: 8 }, (_, i) => i);

const move = <T,>(list: T[], from: number, to: number) => {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

const reduced = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The current translateY of an element, including one mid-transition */
const translateOf = (el: HTMLElement) => {
  const t = getComputedStyle(el).transform;
  if (!t || t === "none") return 0;
  try {
    return new DOMMatrixReadOnly(t).m42;
  } catch {
    return 0;
  }
};

/** A usable duration in ms, or undefined for NaN, Infinity and anything that isn't a number */
const valid = (ms?: number) => (typeof ms === "number" && Number.isFinite(ms) ? ms : undefined);
const pad = (n: number) => String(n).padStart(2, "0");
/** Past a minute: 1m 05s, 3h 12m, 2d 4h */
const long = (r: number) => {
  const m = Math.floor(r / 60);
  if (m < 60) return `${m}m ${pad(r % 60)}s`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${pad(m % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
/** 0.8s, 12s, 1m 05s */
const fmt = (ms: number) => {
  const s = Math.max(0, valid(ms) ?? 0) / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  return long(Math.round(s));
};
/** 14s, 1m 05s – for totals */
const fmtWhole = (ms: number) => {
  const r = Math.max(1, Math.round((valid(ms) ?? 0) / 1000));
  return r < 60 ? `${r}s` : long(r);
};
const count = new Intl.NumberFormat("en");

// One shared tick for every live timer – only the timers render again, not the whole plan
const ticker = { subs: new Set<() => void>(), id: 0 };
const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    ticker.subs.add(tick);
    if (!ticker.id) ticker.id = window.setInterval(() => ticker.subs.forEach((f) => f()), 100);
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
/** Counts up from `since` while it's set */
const Ticking = ({ since, whole }: { since?: number; whole?: boolean }) => {
  const now = useNow(since !== undefined);
  const ms = since !== undefined ? now - since : 0;
  return <>{whole ? fmtWhole(ms) : fmt(ms)}</>;
};

const STATUS_TEXT: Record<PlanStepStatus, string> = {
  pending: "Pending",
  active: "In progress",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

type Drag = {
  id: string;
  pointer: number;
  ids: string[];
  from: number;
  to: number;
  startY: number;
  scale: number;
  dy: number;
  tops: number[];
  heights: number[];
};

export function AgentPlan({
  steps: controlled,
  defaultSteps = [],
  status = "draft",
  onChange,
  onRun,
  onCancel,
  onRetry,
  title,
  estimate,
  className,
}: AgentPlanProps) {
  const [inner, setInner] = useState(defaultSteps);
  const steps = controlled ?? inner;
  const draft = status === "draft";
  const latest = useRef(steps);
  latest.current = steps;

  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const [adding, setAdding] = useState("");
  const [removing, setRemoving] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [total, setTotal] = useState<number | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const addInput = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const tops = useRef(new Map<string, number>());
  const drag = useRef<Drag | null>(null);
  const refocus = useRef<string | null>(null);
  const born = useRef(new Set<string>());
  const timers = useRef(new Set<number>());
  const starts = useRef(new Map<string, number>());
  const measured = useRef(new Map<string, number>());
  const runStart = useRef<number | null>(null);
  const seen = useRef(new Map<string, PlanStepStatus>());
  const hintId = useId();

  const later = (fn: () => void, ms: number) => {
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  };
  useEffect(() => {
    const bag = timers.current;
    return () => bag.forEach((t) => window.clearTimeout(t));
  }, []);

  const commit = (next: PlanStep[]) => {
    if (controlled === undefined) setInner(next);
    onChange?.(next);
  };

  // A trailing no-break space makes repeated messages count as new for screen readers
  const announce = (text: string) => setMessage((m) => (m === text ? `${text} ` : text));

  /* ---------- FLIP: rows glide from where they were to where they are ---------- */

  const orderKey = steps.map((s) => s.id).join("\n");
  const prevKey = useRef(orderKey);
  useLayoutEffect(() => {
    const changed = prevKey.current !== orderKey;
    prevKey.current = orderKey;
    const next = new Map<string, number>();
    const motion = changed && !reduced();
    rows.current.forEach((el, id) => {
      const top = el.offsetTop;
      next.set(id, top);
      if (!changed) return;
      const old = tops.current.get(id);
      if (motion && old !== undefined && old !== top) {
        el.style.transition = "none";
        el.style.transform = `translateY(${old - top}px)`;
        el.getBoundingClientRect();
      }
      el.style.transition = "";
      el.style.transform = "";
    });
    tops.current = next;

    if (refocus.current) {
      const el = rows.current.get(refocus.current);
      refocus.current = null;
      if (el && document.activeElement !== el) el.focus();
    }
  });

  /* ---------- Run timing ---------- */

  const prevStatus = useRef(status);
  useLayoutEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (status === "running" && (runStart.current === null || was === "done")) runStart.current = Date.now();
    if (status === "draft") {
      runStart.current = null;
      setTotal(null);
    }
    if (status === "done") {
      const sum = latest.current.reduce(
        (acc, s) => acc + (valid(s.duration) ?? measured.current.get(s.id) ?? 0),
        0,
      );
      setTotal(runStart.current !== null ? Date.now() - runStart.current : sum);
    }
  }, [status]);

  // Remember when each step started, so the live timer and the duration need no extra props
  useLayoutEffect(() => {
    steps.forEach((s) => {
      const st = s.status ?? "pending";
      if (st === "active") {
        if (!starts.current.has(s.id)) starts.current.set(s.id, Date.now());
      } else if (starts.current.has(s.id)) {
        if (st === "done") measured.current.set(s.id, Date.now() - starts.current.get(s.id)!);
        starts.current.delete(s.id);
      }
      if (st === "pending") measured.current.delete(s.id);
    });
  });

  // Announce step results and the end of the run
  useEffect(() => {
    const said: string[] = [];
    steps.forEach((s, i) => {
      const st = s.status ?? "pending";
      const was = seen.current.get(s.id);
      if (!draft && was !== undefined && was !== st) {
        if (st === "done") said.push(`Step ${i + 1} done: ${s.title}`);
        if (st === "failed") said.push(`Step ${i + 1} failed: ${s.title}${s.error ? `. ${s.error}` : ""}`);
        if (st === "skipped") said.push(`Step ${i + 1} skipped`);
      }
      seen.current.set(s.id, st);
    });
    if (said.length) announce(said.join(". "));
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "running") announce("Running plan");
    if (status === "done" && total !== null) announce(`Plan done in ${fmtWhole(total)}`);
  }, [status, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving review cancels any half-finished edit or drag
  useEffect(() => {
    if (draft) return;
    setEditing(null);
    setAdding("");
  }, [draft]);

  /* ---------- Edits ---------- */

  const focusRow = (id: string | undefined) => {
    if (id) rows.current.get(id)?.focus();
    else addInput.current?.focus();
  };

  const moveBy = (id: string, delta: number) => {
    const list = latest.current;
    const from = list.findIndex((s) => s.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    refocus.current = id;
    commit(move(list, from, to));
    announce(`Moved “${list[from].title}” to position ${to + 1} of ${list.length}`);
  };

  const remove = (id: string) => {
    if (!draft || removing.includes(id)) return;
    const list = latest.current;
    const i = list.findIndex((s) => s.id === id);
    if (i < 0) return;
    const el = rows.current.get(id);
    if (el?.contains(document.activeElement)) focusRow((list[i + 1] ?? list[i - 1])?.id);
    announce(`Removed “${list[i].title}”`);
    if (!el || reduced()) {
      commit(list.filter((s) => s.id !== id));
      return;
    }
    // Collapse the row first, then drop it – the rows below close the gap with it
    el.style.height = `${el.offsetHeight}px`;
    el.getBoundingClientRect();
    setRemoving((r) => [...r, id]);
    later(() => {
      el.style.height = "";
      setRemoving((r) => r.filter((x) => x !== id));
      commit(latest.current.filter((s) => s.id !== id));
    }, 260);
  };

  const startEdit = (id: string) => {
    if (!draft) return;
    const s = latest.current.find((x) => x.id === id);
    if (s) setEditing({ id, value: s.title });
  };

  const finishEdit = (save: boolean, keyboard = false) => {
    const e = editingRef.current;
    if (!e) return;
    editingRef.current = null;
    setEditing(null);
    // Back to the row after Enter or Escape; a click elsewhere keeps its own focus
    if (keyboard) refocus.current = e.id;
    const value = e.value.trim();
    const s = latest.current.find((x) => x.id === e.id);
    if (save && s && value && value !== s.title) {
      commit(latest.current.map((x) => (x.id === e.id ? { ...x, title: value } : x)));
      announce(`Renamed to “${value}”`);
    }
  };

  const add = () => {
    const value = adding.trim();
    if (!value) return;
    const id = makeId();
    born.current.add(id);
    commit([...latest.current, { id, title: value }]);
    setAdding("");
    announce(`Added “${value}” as step ${latest.current.length + 1}`);
  };

  const onRowKey = (e: ReactKeyboardEvent<HTMLLIElement>, id: string) => {
    if (!draft || e.target !== e.currentTarget) return;
    const list = latest.current;
    const i = list.findIndex((s) => s.id === id);
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      moveBy(id, e.key === "ArrowUp" ? -1 : 1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = list[i + (e.key === "ArrowUp" ? -1 : 1)];
      if (next) focusRow(next.id);
      else if (e.key === "ArrowDown") addInput.current?.focus();
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit(id);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(id);
    }
  };

  /* ---------- Pointer: drag the grip to reorder ---------- */

  const onGripDown = (e: ReactPointerEvent<HTMLSpanElement>, id: string) => {
    if (!draft || e.button !== 0 || editingRef.current || removing.length) return;
    const ids = latest.current.map((s) => s.id);
    const els = ids.map((x) => rows.current.get(x));
    if (els.some((x) => !x)) return;
    const list = els as HTMLLIElement[];
    const from = ids.indexOf(id);
    const el = list[from];
    // Pointer moves are in screen pixels; offsets are in layout pixels (they differ inside CSS zoom)
    const scale = el.offsetHeight ? el.getBoundingClientRect().height / el.offsetHeight : 1;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    drag.current = {
      id,
      pointer: e.pointerId,
      ids,
      from,
      to: from,
      startY: e.clientY,
      scale: scale || 1,
      dy: 0,
      tops: list.map((x) => x.offsetTop),
      heights: list.map((x) => x.offsetHeight),
    };
    setDragId(id);
  };

  const onGripMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    const last = d.ids.length - 1;
    const min = d.tops[0] - d.tops[d.from];
    const max = d.tops[last] + d.heights[last] - (d.tops[d.from] + d.heights[d.from]);
    d.dy = Math.min(max, Math.max(min, (e.clientY - d.startY) / d.scale));
    rows.current.get(d.id)?.style.setProperty("transform", `translateY(${d.dy}px)`);

    const center = d.tops[d.from] + d.dy + d.heights[d.from] / 2;
    let to = 0;
    d.ids.forEach((_, i) => {
      if (i !== d.from && d.tops[i] + d.heights[i] / 2 < center) to++;
    });
    if (to === d.to) return;
    d.to = to;
    // The others make room for the dragged row
    const h = d.heights[d.from];
    d.ids.forEach((id, i) => {
      if (i === d.from) return;
      const shift = d.from < to && i > d.from && i <= to ? -h : to < d.from && i >= to && i < d.from ? h : 0;
      const el = rows.current.get(id);
      if (el) el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  };

  const onGripUp = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const d = drag.current;
    if (!d || d.pointer !== e.pointerId) return;
    drag.current = null;
    setDragId(null);
    if (d.to === d.from) {
      // Glides back into its slot
      const el = rows.current.get(d.id);
      if (el) el.style.transform = "";
      return;
    }
    // Start the FLIP from where everything is on screen right now
    rows.current.forEach((el, id) => {
      tops.current.set(id, el.offsetTop + translateOf(el));
      el.style.transition = "none";
      el.style.transform = "";
    });
    const list = latest.current;
    const moved = list.find((s) => s.id === d.id);
    commit(move(list, d.from, d.to));
    // If the order didn't change after all (a controlled parent said no), hand the transitions back
    requestAnimationFrame(() => rows.current.forEach((el) => (el.style.transition = "")));
    if (moved) announce(`Moved “${moved.title}” to position ${d.to + 1} of ${list.length}`);
  };

  /* ---------- Header ---------- */

  const n = steps.length;
  const statusOf = (s: PlanStep): PlanStepStatus => s.status ?? "pending";
  const activeAt = steps.findIndex((s) => statusOf(s) === "active");
  const failedAt = steps.findIndex((s) => statusOf(s) === "failed");
  const finished = steps.filter((s) => statusOf(s) === "done" || statusOf(s) === "skipped").length;

  let phase: "draft" | "running" | "failed" | "done" = "draft";
  let label = "";
  if (status === "done") {
    phase = "done";
    label = `Done in ${fmtWhole(total ?? 0)}`;
  } else if (status === "running") {
    if (failedAt >= 0 && activeAt < 0) {
      phase = "failed";
      label = `Stopped · step ${count.format(failedAt + 1)} failed`;
    } else {
      phase = "running";
      label = `Running · ${count.format(activeAt >= 0 ? activeAt + 1 : Math.min(finished + 1, n))} of ${count.format(n)}`;
    }
  }

  return (
    <div
      ref={root}
      className={["ui-pl", className].filter(Boolean).join(" ")}
      data-status={status}
      data-dragging={dragId ? "" : undefined}
    >
      {/* React 19 hoists this into <head> once, no matter how many plans render */}
      <style href="ui-agent-plan" precedence="default">
        {css}
      </style>

      <div className="ui-pl__card">
        <div className="ui-pl__head">
          <div className="ui-pl__meta">
            <span className="ui-pl__state">
              <span className="ui-pl__state-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7" />
                  <circle cx="3.25" cy="4.5" r=".6" />
                  <circle cx="3.25" cy="8" r=".6" />
                  <circle cx="3.25" cy="11.5" r=".6" />
                </svg>
              </span>
              <span className="ui-pl__state-label">
                Plan · {count.format(n)} {n === 1 ? "step" : "steps"}
              </span>
            </span>
            {draft && estimate ? (
              <span className="ui-pl__estimate" title={estimate}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3.2l2 1.3" />
                </svg>
                <span>
                  <span className="ui-pl__sr">Estimated time </span>
                  {estimate}
                </span>
              </span>
            ) : null}
          </div>
          {title && (
            <h3 className="ui-pl__title" dir="auto">
              {title}
            </h3>
          )}
        </div>

        <p id={hintId} className="ui-pl__sr">
          Press Enter to rename, Alt plus arrow keys to move, Delete to remove.
        </p>

        <ol className="ui-pl__list" aria-label={title ? `Plan: ${title}` : "Plan"}>
          {steps.map((s, i) => {
            const st = statusOf(s);
            const isEditing = draft && editing?.id === s.id;
            const ran = valid(s.duration) ?? measured.current.get(s.id);
            const started = starts.current.get(s.id);
            return (
              <li
                key={s.id}
                ref={(el) => {
                  if (el) rows.current.set(s.id, el);
                  return () => {
                    rows.current.delete(s.id);
                  };
                }}
                className="ui-pl__step"
                data-step={draft ? undefined : st}
                data-dragging={dragId === s.id ? "" : undefined}
                data-removing={removing.includes(s.id) ? "" : undefined}
                data-enter={born.current.has(s.id) ? "" : undefined}
                onAnimationEnd={(e) => {
                  if (e.target === e.currentTarget) born.current.delete(s.id);
                }}
                tabIndex={draft && !isEditing ? 0 : undefined}
                aria-describedby={draft ? hintId : undefined}
                aria-current={st === "active" && !draft ? "step" : undefined}
                onKeyDown={(e) => onRowKey(e, s.id)}
              >
                {draft && (
                  <span
                    className="ui-pl__grip"
                    aria-hidden="true"
                    title="Drag to reorder"
                    onPointerDown={(e) => onGripDown(e, s.id)}
                    onPointerMove={onGripMove}
                    onPointerUp={onGripUp}
                    onPointerCancel={onGripUp}
                  >
                    <svg viewBox="0 0 16 16">
                      <circle cx="6" cy="4" r="1.1" />
                      <circle cx="10" cy="4" r="1.1" />
                      <circle cx="6" cy="8" r="1.1" />
                      <circle cx="10" cy="8" r="1.1" />
                      <circle cx="6" cy="12" r="1.1" />
                      <circle cx="10" cy="12" r="1.1" />
                    </svg>
                  </span>
                )}

                <span className="ui-pl__marker" aria-hidden="true">
                  {draft || st === "pending" ? (
                    <span className="ui-pl__num">{i + 1}</span>
                  ) : st === "active" ? (
                    <Spinner />
                  ) : st === "done" ? (
                    <svg viewBox="0 0 16 16" className="ui-pl__mark">
                      <path d="M4.2 8.4 6.8 11l5-5.6" pathLength={1} className="ui-pl__draw" />
                    </svg>
                  ) : st === "failed" ? (
                    <svg viewBox="0 0 16 16" className="ui-pl__mark">
                      <path d="M8 4.2v4.4M8 11.6h.01" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" className="ui-pl__mark">
                      <path d="M5 8h6" />
                    </svg>
                  )}
                </span>

                <div className="ui-pl__main">
                  {isEditing ? (
                    <input
                      className="ui-pl__edit"
                      dir="auto"
                      value={editing.value}
                      aria-label={`Rename step ${i + 1}`}
                      autoFocus
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setEditing({ id: s.id, value: e.target.value })}
                      onBlur={() => finishEdit(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          finishEdit(true, true);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          finishEdit(false, true);
                        }
                      }}
                    />
                  ) : (
                    <span className="ui-pl__name" dir="auto" onDoubleClick={() => startEdit(s.id)}>
                      {s.title}
                    </span>
                  )}
                  {(s.detail || s.tool) && (
                    <span className="ui-pl__sub">
                      {s.detail && (
                        <span className="ui-pl__detail" dir="auto">
                          {s.detail}
                        </span>
                      )}
                      {s.tool && (
                        <code className="ui-pl__tool" title={s.tool}>
                          {s.tool}
                        </code>
                      )}
                    </span>
                  )}
                  {!draft && <span className="ui-pl__sr">, {STATUS_TEXT[st]}</span>}
                  {!draft && st === "failed" && (
                    <span className="ui-pl__fail">
                      <span className="ui-pl__error" dir="auto">
                        {s.error ?? "This step failed"}
                      </span>
                      {onRetry && (
                        <button type="button" className="ui-pl__retry" onClick={() => onRetry(s.id)}>
                          <svg viewBox="0 0 16 16" aria-hidden="true">
                            <path d="M13 8a5 5 0 1 1-1.6-3.7" />
                            <path d="M13 3v2.6h-2.6" />
                          </svg>
                          Retry from here
                        </button>
                      )}
                    </span>
                  )}
                </div>

                <span className="ui-pl__aside">
                  {draft ? (
                    <button
                      type="button"
                      className="ui-pl__remove"
                      aria-label={`Remove step ${i + 1}: ${s.title}`}
                      onClick={() => remove(s.id)}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
                      </svg>
                    </button>
                  ) : st === "active" ? (
                    <span className="ui-pl__time" aria-hidden="true">
                      <Ticking since={started} />
                    </span>
                  ) : st === "done" && ran !== undefined ? (
                    <span className="ui-pl__time ui-pl__time--done">
                      <span className="ui-pl__sr">took </span>
                      {fmt(ran)}
                    </span>
                  ) : st === "skipped" ? (
                    <span className="ui-pl__time" aria-hidden="true">
                      Skipped
                    </span>
                  ) : null}
                </span>

                {i < n - 1 && <span className="ui-pl__rail" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>

        {/* Add step folds away once the plan runs */}
        <div className="ui-pl__tail" inert={!draft}>
          <div className="ui-pl__tail-inner">
            <label className="ui-pl__add">
              <span className="ui-pl__add-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M8 4.5v7M4.5 8h7" />
                </svg>
              </span>
              <input
                ref={addInput}
                value={adding}
                placeholder="Add step"
                aria-label="Add a step at the end"
                enterKeyHint="done"
                onChange={(e) => setAdding(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    add();
                  } else if (e.key === "Escape") {
                    setAdding("");
                  } else if (e.key === "ArrowUp" && !adding) {
                    const last = latest.current[latest.current.length - 1];
                    if (last) {
                      e.preventDefault();
                      focusRow(last.id);
                    }
                  }
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* The tray below the card: actions in review, the run's status after */}
      <div className="ui-pl__foot" key={phase} data-phase={phase}>
        {phase === "draft" ? (
          <>
            <span className="ui-pl__hint" aria-hidden="true">
              Drag to reorder · double-click to rename
            </span>
            <span className="ui-pl__actions">
              {onCancel && (
                <button type="button" className="ui-pl__btn ui-pl__btn--quiet" onClick={onCancel}>
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="ui-pl__btn ui-pl__btn--primary ui-pl__run"
                disabled={!n}
                onClick={() => onRun?.(latest.current)}
              >
                Run plan
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.5 3.8v8.4L12 8z" />
                </svg>
              </button>
            </span>
          </>
        ) : (
          <>
            <span className="ui-pl__status">
              <span className="ui-pl__status-icon" aria-hidden="true">
                {phase === "running" ? (
                  <Spinner />
                ) : phase === "done" ? (
                  <svg viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M5.4 8.2 7.2 10l3.4-3.8" pathLength={1} className="ui-pl__draw" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6.5" />
                    <path d="M8 4.9v3.6M8 11h.01" />
                  </svg>
                )}
              </span>
              <span className="ui-pl__status-label">{label}</span>
            </span>
            {phase === "running" ? (
              <span className="ui-pl__elapsed" aria-hidden="true">
                <Ticking since={runStart.current ?? undefined} whole />
              </span>
            ) : phase === "done" && onRun ? (
              <span className="ui-pl__actions">
                <button
                  type="button"
                  className="ui-pl__btn ui-pl__btn--quiet ui-pl__again"
                  onClick={() => onRun(latest.current)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
                    <path d="M13 3v2.6h-2.6" />
                  </svg>
                  Run again
                </button>
              </span>
            ) : null}
          </>
        )}
      </div>

      <p className="ui-pl__sr" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

/** Eight rays that fade one after another – the spinner turns without rotating */
function Spinner() {
  return (
    <svg className="ui-pl__spinner" viewBox="0 0 16 16">
      {RAYS.map((i) => (
        <line
          key={i}
          x1="8"
          y1="1.75"
          x2="8"
          y2="4.75"
          transform={`rotate(${i * 45} 8 8)`}
          style={{ animationDelay: `${(i - 8) * 100}ms` }}
        />
      ))}
    </svg>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-pl */
.ui-pl {
  --ui-pl-tray: #f0f0f0;
  --ui-pl-card: #ffffff;
  --ui-pl-ink: #171717;
  --ui-pl-text: #6b6b6b;
  --ui-pl-muted: #8a8a8a;
  --ui-pl-faint: #b8b8b8;
  --ui-pl-line: #ececec;
  --ui-pl-raise: #ffffff;
  --ui-pl-hover: #f6f6f6;
  --ui-pl-quiet-hover: #e4e4e5;
  --ui-pl-press: rgba(23, 23, 23, 0.05);
  --ui-pl-chip: #f3f3f3;
  --ui-pl-chip-text: #555555;
  --ui-pl-marker: #f0f0f0;
  --ui-pl-rail: #c4c4c8;
  --ui-pl-on-ink: #ffffff;
  --ui-pl-red: #c2331f;
  --ui-pl-red-bg: #fdf3f1;
  --ui-pl-red-ring: rgba(194, 51, 31, 0.32);
  --ui-pl-ring: rgba(23, 23, 23, 0.22);
  --ui-pl-lift: 0 1px 2px rgba(0, 0, 0, 0.06), 0 12px 28px -10px rgba(0, 0, 0, 0.2);
  --ui-pl-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-pl-inset: 30px;

  container-type: inline-size;
  position: relative;
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 460px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-pl-tray);
  color: var(--ui-pl-text);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
/* The white card holds the goal and the steps */
.ui-pl__card {
  position: relative;
  border-radius: 16px;
  background: var(--ui-pl-card);
  box-shadow: 0 0 0 1px var(--ui-pl-line), 0 1px 2px rgba(0, 0, 0, 0.04);
}
.ui-pl:not([data-status="draft"]) {
  --ui-pl-inset: 14px;
}
.ui-pl[data-dragging] {
  cursor: grabbing;
  user-select: none;
  -webkit-user-select: none;
}
.ui-pl *,
.ui-pl *::before,
.ui-pl *::after {
  box-sizing: border-box;
}
.ui-pl svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}
:where(.ui-pl) button {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
  cursor: pointer;
}
.ui-pl__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

/* Header: a quiet status line, then the goal */
.ui-pl__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  padding: 16px 18px 8px;
}
.ui-pl__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 18px;
  font-size: 12.5px;
  line-height: 18px;
  color: var(--ui-pl-muted);
}
.ui-pl__state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  /* "Plan · 6 steps" is short and stays whole – a long estimate gives way */
  flex: none;
}
.ui-pl__state-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ui-pl__state-icon,
.ui-pl__status-icon {
  flex: none;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ui-pl__state-icon circle[r=".6"] {
  fill: currentColor;
}
.ui-pl__estimate {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  gap: 5px;
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
/* A long estimate shortens instead of widening the card */
.ui-pl__estimate > span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.ui-pl__estimate svg {
  flex: none;
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ui-pl__title {
  margin: 0;
  color: var(--ui-pl-ink);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: -0.012em;
  text-wrap: balance;
  overflow-wrap: anywhere;
  text-align: start;
}

/* Steps */
.ui-pl__list {
  position: relative;
  margin: 0;
  padding: 2px 6px 6px;
  list-style: none;
}
.ui-pl__step {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  column-gap: 12px;
  align-items: start;
  padding: 10px 10px 10px var(--ui-pl-inset);
  border-radius: 10px;
  outline: none;
  transition:
    transform 420ms var(--ui-pl-ease),
    padding 420ms var(--ui-pl-ease),
    height 260ms var(--ui-pl-ease),
    opacity 180ms ease,
    background-color 160ms ease,
    box-shadow 200ms ease;
}
.ui-pl[data-status="draft"] .ui-pl__step:hover {
  background: var(--ui-pl-hover);
}
.ui-pl__step:focus-visible {
  outline: 2px solid var(--ui-pl-ring);
  outline-offset: 0;
}
.ui-pl__step[data-dragging] {
  z-index: 2;
  background: var(--ui-pl-raise) !important;
  box-shadow: inset 0 0 0 1px var(--ui-pl-line), var(--ui-pl-lift);
  transition: background-color 160ms ease, box-shadow 200ms ease;
}
.ui-pl__step[data-removing] {
  height: 0 !important;
  padding-top: 0;
  padding-bottom: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
}
.ui-pl__step[data-enter] {
  animation: ui-pl-enter 380ms var(--ui-pl-ease) both;
}

/* Grip: in the left gutter, shows on hover and focus */
.ui-pl__grip {
  position: absolute;
  top: 10px;
  left: 6px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 22px;
  margin-top: -1px;
  border-radius: 5px;
  color: var(--ui-pl-faint);
  fill: currentColor;
  cursor: grab;
  touch-action: none;
  opacity: 0;
  transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease;
}
.ui-pl__grip svg {
  width: 14px;
  height: 14px;
}
.ui-pl__step:hover .ui-pl__grip,
.ui-pl__step:focus-visible .ui-pl__grip,
.ui-pl__step[data-dragging] .ui-pl__grip {
  opacity: 1;
}
.ui-pl__grip:hover,
.ui-pl__step[data-dragging] .ui-pl__grip {
  color: var(--ui-pl-text);
  background: var(--ui-pl-press);
}
.ui-pl__step[data-dragging] .ui-pl__grip {
  cursor: grabbing;
}

/* Marker: a quiet ring with the number → spinner → check */
.ui-pl__marker {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  justify-self: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--ui-pl-card);
  box-shadow: inset 0 0 0 1px var(--ui-pl-line);
  color: var(--ui-pl-muted);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  transition: background-color 320ms ease, color 320ms ease, box-shadow 320ms ease;
}
.ui-pl__marker > * {
  grid-area: 1 / 1;
  animation: ui-pl-pop 360ms var(--ui-pl-ease) both;
}
.ui-pl__num {
  animation: none !important;
}
.ui-pl__marker .ui-pl__spinner {
  width: 13px;
  height: 13px;
}
.ui-pl__mark {
  width: 11px !important;
  height: 11px !important;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.9;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ui-pl__step[data-step="active"] .ui-pl__marker {
  box-shadow: none;
  color: var(--ui-pl-ink);
}
.ui-pl__step[data-step="done"] .ui-pl__marker {
  background: var(--ui-pl-marker);
  box-shadow: none;
  color: var(--ui-pl-ink);
}
.ui-pl__step[data-step="failed"] .ui-pl__marker {
  background: var(--ui-pl-red-bg);
  box-shadow: inset 0 0 0 1px var(--ui-pl-red-ring);
  color: var(--ui-pl-red);
}
.ui-pl__step[data-step="skipped"] .ui-pl__marker {
  box-shadow: none;
  outline: 1px dashed var(--ui-pl-faint);
  outline-offset: -1px;
}

/* The check draws itself */
.ui-pl__draw {
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ui-pl-draw 420ms var(--ui-pl-ease) 80ms forwards;
}

.ui-pl__spinner line {
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  opacity: 0.18;
  animation: ui-pl-ray 800ms linear infinite;
}

/* Text */
.ui-pl__main {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.ui-pl__name {
  color: var(--ui-pl-ink);
  font-weight: 500;
  overflow-wrap: anywhere;
  text-align: start;
  transition: color 300ms ease;
}
.ui-pl[data-status="draft"] .ui-pl__name {
  cursor: text;
}
.ui-pl__step[data-step="pending"] .ui-pl__name {
  color: var(--ui-pl-text);
}
.ui-pl__step[data-step="skipped"] .ui-pl__name {
  color: var(--ui-pl-muted);
  text-decoration: line-through;
  text-decoration-color: var(--ui-pl-faint);
}
.ui-pl__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px 8px;
  min-width: 0;
  color: var(--ui-pl-muted);
  font-size: 12.5px;
  line-height: 18px;
}
.ui-pl__detail {
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: pre-line;
  text-align: start;
}
.ui-pl__tool {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--ui-pl-chip);
  color: var(--ui-pl-chip-text);
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ui-pl__edit {
  width: calc(100% + 14px);
  height: 26px;
  margin: -3px -7px;
  padding: 0 6px;
  border: 0;
  border-radius: 7px;
  background: var(--ui-pl-raise);
  box-shadow: inset 0 0 0 1px var(--ui-pl-line), 0 0 0 3px var(--ui-pl-press);
  color: var(--ui-pl-ink);
  font: inherit;
  font-weight: 500;
  letter-spacing: inherit;
  outline: none;
}

/* Failed: an error line and a way back in */
.ui-pl__fail {
  display: grid;
  justify-items: start;
  gap: 8px;
  margin-top: 4px;
  animation: ui-pl-fade 360ms var(--ui-pl-ease) both;
}
.ui-pl__error {
  color: var(--ui-pl-red);
  font-size: 12.5px;
  line-height: 18px;
  overflow-wrap: anywhere;
  white-space: pre-line;
  text-align: start;
}
.ui-pl__retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px 0 9px;
  border-radius: 8px;
  background: var(--ui-pl-raise);
  box-shadow: inset 0 0 0 1px var(--ui-pl-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  color: var(--ui-pl-ink);
  font-size: 12.5px;
  font-weight: 500;
  transition: background-color 160ms ease, transform 160ms var(--ui-pl-ease);
}
.ui-pl__retry svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.ui-pl__retry:hover {
  background: var(--ui-pl-hover);
}
.ui-pl__retry:active {
  transform: scale(0.97);
}

/* Right column: remove, live timer, duration */
.ui-pl__aside {
  display: flex;
  align-items: center;
  min-height: 20px;
  color: var(--ui-pl-muted);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ui-pl__time {
  animation: ui-pl-fade 300ms ease both;
}
.ui-pl__step[data-step="active"] .ui-pl__time {
  color: var(--ui-pl-ink);
}
.ui-pl__remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin: -2px -4px 0 0;
  border-radius: 7px;
  color: var(--ui-pl-faint);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  opacity: 0;
  transition: opacity 160ms ease, color 160ms ease, background-color 160ms ease;
}
.ui-pl__remove svg {
  width: 14px;
  height: 14px;
}
.ui-pl__step:hover .ui-pl__remove,
.ui-pl__step:focus-visible .ui-pl__remove,
.ui-pl__remove:focus-visible {
  opacity: 1;
}
.ui-pl__remove:hover {
  color: var(--ui-pl-ink);
  background: var(--ui-pl-press);
}
.ui-pl__remove:focus-visible,
.ui-pl__retry:focus-visible,
.ui-pl__btn:focus-visible {
  outline: 2px solid var(--ui-pl-ring);
  outline-offset: 1px;
}

/* Progress line: a segment under each marker that fills when the step finishes */
.ui-pl__rail {
  position: absolute;
  top: 35px;
  bottom: -5px;
  left: calc(var(--ui-pl-inset) + 10.5px);
  width: 1px;
  overflow: hidden;
  background: var(--ui-pl-line);
  opacity: 0;
  pointer-events: none;
  transition: opacity 300ms ease;
}
.ui-pl:not([data-status="draft"]) .ui-pl__rail {
  opacity: 1;
  transition-delay: 240ms;
}
.ui-pl__rail::after {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--ui-pl-rail);
  transform: scaleY(0);
  transform-origin: top;
  transition: transform 560ms var(--ui-pl-ease);
}
.ui-pl__step[data-step="done"] .ui-pl__rail::after,
.ui-pl__step[data-step="skipped"] .ui-pl__rail::after {
  transform: scaleY(1);
}

/* Add step folds away once running */
.ui-pl__tail {
  display: grid;
  grid-template-rows: 1fr;
  transition: grid-template-rows 420ms var(--ui-pl-ease), opacity 260ms ease;
}
.ui-pl:not([data-status="draft"]) .ui-pl__tail {
  grid-template-rows: 0fr;
  opacity: 0;
}
.ui-pl__tail-inner {
  min-height: 0;
  overflow: hidden;
}
.ui-pl__add {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  column-gap: 12px;
  align-items: center;
  margin: 0 6px 8px;
  padding: 7px 10px 7px var(--ui-pl-inset);
  border-radius: 10px;
  cursor: text;
  transition: background-color 160ms ease;
}
.ui-pl__add:hover,
.ui-pl__add:focus-within {
  background: var(--ui-pl-hover);
}
.ui-pl__add-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  outline: 1px dashed var(--ui-pl-faint);
  outline-offset: -1px;
  color: var(--ui-pl-muted);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.ui-pl__add-icon svg {
  width: 12px;
  height: 12px;
}
.ui-pl__add input {
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-pl-ink);
  font: inherit;
  letter-spacing: inherit;
  outline: none;
}
.ui-pl__add input::placeholder {
  color: var(--ui-pl-muted);
  opacity: 1;
}
/* The tray below the card */
.ui-pl__foot {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 46px;
  padding: 0 6px 0 12px;
  font-size: 12.5px;
  color: var(--ui-pl-muted);
  animation: ui-pl-fade 320ms var(--ui-pl-ease) both;
}
.ui-pl__hint {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-pl-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ui-pl__actions {
  display: flex;
  flex: none;
  gap: 8px;
  margin-left: auto;
}
.ui-pl__btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 13px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 160ms ease, opacity 160ms ease, transform 160ms var(--ui-pl-ease);
}
.ui-pl__btn:active {
  transform: scale(0.97);
}
.ui-pl__btn--primary {
  padding-right: 11px;
  background: var(--ui-pl-ink);
  color: var(--ui-pl-on-ink);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}
.ui-pl__btn--primary:hover {
  opacity: 0.88;
}
.ui-pl__btn--primary:disabled {
  opacity: 0.4;
  cursor: default;
  transform: none;
}
.ui-pl__btn--primary svg {
  width: 12px;
  height: 12px;
  fill: currentColor;
}
.ui-pl__btn--quiet {
  padding: 0 11px;
  color: var(--ui-pl-text);
}
.ui-pl__btn--quiet:hover {
  background: var(--ui-pl-quiet-hover);
  color: var(--ui-pl-ink);
}
.ui-pl__btn--quiet svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Status on the tray while running and after */
.ui-pl__status {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--ui-pl-ink);
}
.ui-pl__foot[data-phase="failed"] .ui-pl__status {
  color: var(--ui-pl-red);
}
.ui-pl__status-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.ui-pl__elapsed {
  margin-left: auto;
  padding-right: 6px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* Touch screens have no hover: keep the grip and remove button visible */
@media (hover: none) {
  .ui-pl__grip,
  .ui-pl__remove {
    opacity: 1;
  }
}

/* Narrow: drop the hint, tighten the gutters */
@container (max-width: 400px) {
  .ui-pl__hint {
    display: none;
  }
}
@container (max-width: 340px) {
  .ui-pl__head {
    padding: 14px 14px 8px;
  }
  .ui-pl__list {
    padding-inline: 4px;
  }
  .ui-pl__step,
  .ui-pl__add {
    column-gap: 10px;
    padding-right: 8px;
  }
  .ui-pl__add {
    margin-inline: 4px;
  }
  .ui-pl__foot {
    padding-left: 10px;
  }
  .ui-pl__btn {
    padding: 0 11px;
  }
}

@keyframes ui-pl-fade {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: none; }
}
@keyframes ui-pl-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes ui-pl-pop {
  from { opacity: 0; transform: scale(0.5); }
  to { opacity: 1; transform: none; }
}
@keyframes ui-pl-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes ui-pl-ray {
  0% { opacity: 1; }
  100% { opacity: 0.18; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pl *,
  .ui-pl *::before,
  .ui-pl *::after {
    animation-duration: 1ms !important;
    animation-delay: 0ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    transition-delay: 0ms !important;
  }
  .ui-pl__spinner line { opacity: 0.6; }
  .ui-pl__draw { stroke-dashoffset: 0; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pl {
  --ui-pl-tray: #111113;
  --ui-pl-card: #19191b;
  --ui-pl-ink: #ededed;
  --ui-pl-text: #a1a1a1;
  --ui-pl-muted: #8b8b92;
  --ui-pl-faint: #5c5c63;
  --ui-pl-line: #2a2a2e;
  --ui-pl-raise: #1f1f22;
  --ui-pl-hover: #1f1f22;
  --ui-pl-quiet-hover: #222225;
  --ui-pl-press: rgba(255, 255, 255, 0.07);
  --ui-pl-chip: #232326;
  --ui-pl-chip-text: #b4b4b4;
  --ui-pl-marker: #26262a;
  --ui-pl-rail: #4a4a50;
  --ui-pl-on-ink: #19191b;
  --ui-pl-red: #f2786b;
  --ui-pl-red-bg: rgba(242, 120, 107, 0.08);
  --ui-pl-red-ring: rgba(242, 120, 107, 0.4);
  --ui-pl-ring: rgba(237, 237, 237, 0.3);
  --ui-pl-lift: 0 1px 2px rgba(0, 0, 0, 0.4), 0 14px 32px -10px rgba(0, 0, 0, 0.7);
}
`;
