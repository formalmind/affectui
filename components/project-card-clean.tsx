"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/*
 * Project Card (Clean) – a two-line summary that quietly grows into the full picture, in a single self-contained file.
 * Clean style: no tray – one white card with hairline shadows, quiet gray type, tinted tags and a last row for the action.
 * The progress is a ring cut into one segment per subtask. Nothing flies around when the card opens: the head stays
 * where it is and the list unfolds below it. The life is inside the open card instead –
 *   · hover a subtask and its segment lights up in the ring (and the other way round); click either to tick it
 *   · hover a person to see only their subtasks, click to keep that view
 *   · click the status to pick another one from a row that unfolds in place
 *   · the last row of the card always says what you are pointing at
 * The styles are injected below, so no extra files are needed.
 */

export type ProjectTask = {
  id: string;
  label: string;
  done?: boolean;
  /** Name of a member – shows their avatar on the row and powers the people filter */
  assignee?: string;
};
export type ProjectMember = {
  name: string;
  /** Image URL – initials on a soft color when left out */
  avatar?: string;
};
export type ProjectTone = "red" | "amber" | "green" | "blue" | "violet" | "gray";
export type ProjectOption = {
  id: string;
  label: string;
  /** Color of the tag – also picks its icon: violet or gray = not started, amber = in progress, blue = in review, green = done, red = blocked */
  tone?: ProjectTone;
  /** Replaces the icon that comes with the tone */
  icon?: ReactNode;
};

export type ProjectCardProps = {
  title: string;
  /** Subtasks – one ring segment and one row each */
  tasks: ProjectTask[];
  /** Called with the full list after a subtask was ticked or unticked */
  onTasksChange?: (tasks: ProjectTask[]) => void;
  /** Options of the status picker and the chosen id */
  statuses?: ProjectOption[];
  status?: string;
  onStatusChange?: (id: string) => void;
  /** Ready-to-show due date, e.g. "Oct 24" */
  due?: string;
  members?: ProjectMember[];
  /** A button in the last row of the open card, e.g. { label: "Open", onClick } */
  action?: { label: string; onClick: () => void };
  /** Replaces the line in the last row while nothing is hovered */
  hint?: ReactNode;
  /** "hover" opens under the pointer (taps and the keyboard still toggle), "click" only on click */
  trigger?: "hover" | "click";
  /** Controlled open state */
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/* ---------- Helpers ---------- */

const DEFAULT_STATUSES: ProjectOption[] = [
  { id: "todo", label: "To do", tone: "violet" },
  { id: "progress", label: "In progress", tone: "amber" },
  { id: "review", label: "In review", tone: "blue" },
  { id: "done", label: "Done", tone: "green" },
];
// First whole letter or digit of the first two words – an emoji in front never splits in half
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((p) => p.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
const TONES: ProjectTone[] = ["red", "amber", "green", "blue", "violet", "gray"];
/** An unknown tone reads as gray, so the tag keeps its colors and icon */
const toneOf = (tone?: string): ProjectTone => (TONES.includes(tone as ProjectTone) ? (tone as ProjectTone) : "gray");
const count = new Intl.NumberFormat("en");
/** Faces in the head before the rest folds into +N */
const MAX_FACES = 4;
/** A steady soft color per name */
const hue = (name: string) =>
  [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** One arc of the ring, from `from` to `to` (0–1 around the circle, starting at the top) */
function arc(from: number, to: number, r: number, c: number) {
  const point = (t: number) => {
    const a = t * Math.PI * 2 - Math.PI / 2;
    return `${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
  };
  return `M ${point(from)} A ${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${point(to)}`;
}

/** The icon in front of a status – one per tone, so custom statuses get a fitting one for free */
function ToneIcon({ tone }: { tone: ProjectTone }) {
  const line = { stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      {(tone === "gray" || tone === "violet") && <circle cx="6" cy="6" r="4.25" {...line} strokeDasharray="2.2 2.25" />}
      {tone === "amber" && (
        <>
          <circle cx="6" cy="6" r="4.25" {...line} />
          <path d="M6 3.4a2.6 2.6 0 0 1 0 5.2V3.4Z" fill="currentColor" />
        </>
      )}
      {tone === "blue" && (
        <>
          <path d="M1.2 6S3 2.7 6 2.7 10.8 6 10.8 6 9 9.3 6 9.3 1.2 6 1.2 6Z" {...line} />
          <circle cx="6" cy="6" r="1.4" fill="currentColor" />
        </>
      )}
      {tone === "green" && (
        <>
          <circle cx="6" cy="6" r="4.25" {...line} />
          <path d="m4.1 6.1 1.3 1.3 2.5-2.7" {...line} />
        </>
      )}
      {tone === "red" && (
        <>
          <circle cx="6" cy="6" r="4.25" {...line} />
          <path d="M6 3.8v2.6M6 8.2v.01" {...line} />
        </>
      )}
    </svg>
  );
}
const ArrowIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2.5 6h7M6.5 3l3 3-3 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const CheckMark = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <circle className="ui-pcc__ring" cx="8" cy="8" r="6.3" />
    <circle className="ui-pcc__disc" cx="8" cy="8" r="7" />
    <path className="ui-pcc__tick" d="m5.2 8.2 1.9 1.9 3.7-4" />
  </svg>
);

function Avatar({ member }: { member: ProjectMember }) {
  // An image that fails to load falls back to the initials
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="ui-pcc__avatar"
      style={{ ["--ui-pcc-hue" as string]: hue(member.name) }}
    >
      {member.avatar && !broken ? (
        <img src={member.avatar} alt="" onError={() => setBroken(true)} />
      ) : (
        initials(member.name)
      )}
    </span>
  );
}

export function ProjectCard({
  title,
  tasks,
  onTasksChange,
  statuses = DEFAULT_STATUSES,
  status,
  onStatusChange,
  due,
  members = [],
  action,
  hint,
  trigger = "hover",
  open,
  defaultOpen = false,
  onOpenChange,
  className,
}: ProjectCardProps) {
  const uid = useId();
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const isOpen = open ?? innerOpen;

  // Ticks and status work on their own; the callbacks let the parent keep the truth
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [innerStatus, setInnerStatus] = useState<string | undefined>();
  // Every row gets its own key – two subtasks with the same id still tick on their own
  const seenIds: Record<string, number> = {};
  const list = tasks.map((t) => {
    const n = (seenIds[t.id] = (seenIds[t.id] ?? -1) + 1);
    const key = n ? `${t.id}#${n}` : t.id;
    return { ...t, key, done: onTasksChange ? Boolean(t.done) : (done[key] ?? Boolean(t.done)) };
  });
  const doneCount = list.filter((t) => t.done).length;
  const statusNow =
    statuses.find(
      (o) => o.id === (onStatusChange ? status : (innerStatus ?? status)),
    ) ?? statuses[0];

  /** The subtask under the pointer (row or ring segment) */
  const [hot, setHot] = useState<string | null>(null);
  /** The person under the pointer, and the one that was clicked to stay */
  const [peek, setPeek] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const person = peek ?? pinned;
  const theirs = (t: ProjectTask) => !person || t.assignee === person;

  const rootRef = useRef<HTMLDivElement>(null);

  /* ---------- Opening and closing ---------- */

  const timer = useRef(0);
  const change = (next: boolean) => {
    window.clearTimeout(timer.current);
    if (next === isOpen) return;
    if (!next) {
      setChoosing(false);
      setHot(null);
      setPeek(null);
    }
    setInnerOpen(next);
    onOpenChange?.(next);
  };
  const later = (next: boolean, ms: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => change(next), ms);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const hover = trigger === "hover";
  const onEnter = (e: PointerEvent) => {
    if (hover && e.pointerType === "mouse") later(true, 90);
  };
  const onLeave = (e: PointerEvent) => {
    if (hover && e.pointerType === "mouse") later(false, 220);
  };

  // While open, a press outside closes it
  useEffect(() => {
    if (!isOpen) return;
    const down = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) change(false);
    };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || !isOpen) return;
    e.stopPropagation();
    if (choosing) return setChoosing(false);
    change(false);
    rootRef.current
      ?.querySelector<HTMLElement>(".ui-pcc__toggle")
      ?.focus({ preventScroll: true });
  };

  /* ---------- Editing ---------- */

  const toggle = (key: string) => {
    const next = list.map((t) => (t.key === key ? { ...t, done: !t.done } : t));
    setDone(Object.fromEntries(next.map((t) => [t.key, Boolean(t.done)])));
    onTasksChange?.(
      next.map(({ id: taskId, label, done: isDone, assignee }) => ({
        id: taskId,
        label,
        done: isDone,
        assignee,
      })),
    );
  };
  const pick = (id: string) => {
    setInnerStatus(id);
    onStatusChange?.(id);
    setChoosing(false);
  };

  /* ---------- What the last row says ---------- */

  const hotTask = list.find((t) => t.key === hot);
  const left = list.length - doneCount;
  let caption: ReactNode = hint ?? (left === 0 ? "All done" : `${count.format(left)} left`);
  let captionKey = "rest";
  if (hotTask) {
    caption = hotTask.assignee ? (
      <>
        {hotTask.done ? "Done by" : "Assigned to"} <b>{hotTask.assignee}</b>
      </>
    ) : hotTask.done ? (
      "Done"
    ) : (
      "Nobody on it yet"
    );
    captionKey = `task-${hotTask.key}`;
  } else if (person) {
    const own = list.filter((t) => t.assignee === person);
    caption = (
      <>
        <b>{person}</b> · {count.format(own.filter((t) => t.done).length)} of {count.format(own.length)}{" "}
        done
      </>
    );
    captionKey = `person-${person}`;
  }

  // The ring: one segment per subtask, with a small gap in between
  const SIZE = 32;
  const R = 12.5;
  // The gap shrinks with the slices, so a long list never turns a segment inside out
  const gap = list.length > 1 ? Math.min(0.055, (1 / list.length) * 0.35) : 0;
  const slice = 1 / Math.max(list.length, 1);

  return (
    <div
      ref={rootRef}
      className={["ui-pcc", className].filter(Boolean).join(" ")}
      data-open={isOpen ? "" : undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={onKeyDown}
    >
      <style href="ui-project-card-clean" precedence="default">
        {css}
      </style>

      <div className="ui-pcc__card">
        <div className="ui-pcc__head">
          {/* The whole head toggles; what sits on top of it only reacts once the card is open */}
          <button
            type="button"
            className="ui-pcc__toggle"
            aria-expanded={isOpen}
            aria-controls={`${uid}-body`}
            aria-label={`${title}: ${count.format(doneCount)} of ${count.format(list.length)} done, ${statusNow?.label ?? ""}${due ? `, due ${due}` : ""}`}
            onClick={() => change(!isOpen)}
          />

          <span
            className="ui-pcc__progress"
            data-live={isOpen ? "" : undefined}
          >
            <svg
              width={SIZE}
              height={SIZE}
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              fill="none"
              aria-hidden="true"
              onPointerLeave={() => setHot(null)}
            >
              {list.length === 1 ? (
                <circle
                  className="ui-pcc__seg"
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  data-done={list[0].done ? "" : undefined}
                  data-hot={hot === list[0].key ? "" : undefined}
                  onPointerEnter={() => setHot(list[0].key)}
                  onClick={() => toggle(list[0].key)}
                />
              ) : (
                list.map((t, i) => (
                  <path
                    key={t.key}
                    className="ui-pcc__seg"
                    d={arc(
                      i * slice + gap / 2,
                      (i + 1) * slice - gap / 2,
                      R,
                      SIZE / 2,
                    )}
                    data-done={t.done ? "" : undefined}
                    data-hot={hot === t.key ? "" : undefined}
                    data-dim={theirs(t) ? undefined : ""}
                    onPointerEnter={() => setHot(t.key)}
                    onClick={() => toggle(t.key)}
                  />
                ))
              )}
            </svg>
            <span className="ui-pcc__num" key={doneCount}>
              {doneCount}
            </span>
          </span>

          <span className="ui-pcc__titles">
            <span className="ui-pcc__name" dir="auto" title={title}>
              {title}
            </span>
            <span className="ui-pcc__sub">
              {statusNow && (
              <button
                type="button"
                className="ui-pcc__status"
                data-tone={toneOf(statusNow.tone)}
                title={statusNow.label}
                aria-expanded={choosing}
                aria-controls={`${uid}-status`}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => setChoosing((c) => !c)}
              >
                {statusNow.icon ?? <ToneIcon tone={toneOf(statusNow.tone)} />}
                <span className="ui-pcc__status-text" dir="auto">
                  {statusNow.label}
                </span>
              </button>
              )}
              {due && (
                <span className="ui-pcc__due" dir="auto" title={due}>
                  <span className="ui-pcc__due-word">Due </span>
                  {due}
                </span>
              )}
            </span>
          </span>

          {members.length > 0 && (
            <span
              className="ui-pcc__people"
              onPointerLeave={() => setPeek(null)}
            >
              {members.slice(0, MAX_FACES).map((m, i) => (
                <button
                  key={`${m.name}#${i}`}
                  title={m.name}
                  type="button"
                  className="ui-pcc__member"
                  aria-label={`Only ${m.name}'s subtasks`}
                  aria-pressed={pinned === m.name}
                  data-on={person === m.name ? "" : undefined}
                  data-off={person && person !== m.name ? "" : undefined}
                  tabIndex={isOpen ? 0 : -1}
                  onPointerEnter={(e) =>
                    e.pointerType === "mouse" && setPeek(m.name)
                  }
                  onFocus={() => setPeek(m.name)}
                  onBlur={() => setPeek(null)}
                  onClick={() =>
                    setPinned((p) => (p === m.name ? null : m.name))
                  }
                >
                  <Avatar member={m} />
                </button>
              ))}
              {members.length > MAX_FACES && (
                <span
                  className="ui-pcc__avatar ui-pcc__more"
                  title={members
                    .slice(MAX_FACES)
                    .map((m) => m.name)
                    .join(", ")}
                >
                  +{count.format(members.length - MAX_FACES)}
                </span>
              )}
            </span>
          )}
        </div>

        <div id={`${uid}-body`} className="ui-pcc__fold" inert={!isOpen}>
          <div className="ui-pcc__body">
            {/* The status picker unfolds in place */}
            <div
              id={`${uid}-status`}
              className="ui-pcc__fold ui-pcc__fold--status"
              data-open={choosing ? "" : undefined}
              inert={!choosing}
            >
              <div className="ui-pcc__clip">
                <div
                  className="ui-pcc__options"
                  role="radiogroup"
                  aria-label="Status"
                >
                  {statuses.map((o, i) => (
                    <button
                      key={`${o.id}#${i}`}
                      title={o.label}
                      type="button"
                      role="radio"
                      aria-checked={o.id === statusNow?.id}
                      className="ui-pcc__option"
                      data-tone={toneOf(o.tone)}
                      onClick={() => pick(o.id)}
                    >
                      {o.icon ?? <span className="ui-pcc__dot" aria-hidden="true" />}
                      <span className="ui-pcc__option-text" dir="auto">
                        {o.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {list.length > 0 && (
              <ul className="ui-pcc__tasks" onPointerLeave={() => setHot(null)}>
                {list.map((t) => {
                  const owner = members.find((m) => m.name === t.assignee);
                  return (
                    <li key={t.key}>
                      <button
                        type="button"
                        className="ui-pcc__task"
                        role="checkbox"
                        aria-checked={t.done}
                        data-hot={hot === t.key ? "" : undefined}
                        data-dim={theirs(t) ? undefined : ""}
                        onPointerEnter={(e) =>
                          e.pointerType === "mouse" && setHot(t.key)
                        }
                        onFocus={() => setHot(t.key)}
                        onBlur={() => setHot(null)}
                        onClick={() => toggle(t.key)}
                      >
                        <CheckMark />
                        <span className="ui-pcc__label" dir="auto" title={t.label}>
                          {t.label}
                        </span>
                        {owner && <Avatar member={owner} />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* The last row of the card: it says what you are pointing at, and holds the action */}
        <div className="ui-pcc__fold" inert={!isOpen}>
          <div className="ui-pcc__clip">
            <div className="ui-pcc__foot">
              <span className="ui-pcc__caption" aria-live="polite">
                <span key={captionKey} dir="auto">
                  {caption}
                </span>
              </span>
              {action && (
                <button
                  type="button"
                  className="ui-pcc__action"
                  title={action.label}
                  onClick={action.onClick}
                >
                  <span className="ui-pcc__action-text">{action.label}</span>
                  <ArrowIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-pcc */
.ui-pcc {
  --ui-pcc-card: #ffffff;
  --ui-pcc-ink: rgba(0, 0, 0, 0.88);
  --ui-pcc-strong: #000000;
  --ui-pcc-text: rgba(0, 0, 0, 0.61);
  --ui-pcc-muted: rgba(0, 0, 0, 0.45);
  --ui-pcc-faint: rgba(0, 0, 0, 0.27);
  --ui-pcc-icon: rgba(0, 0, 0, 0.447);
  --ui-pcc-line: rgba(0, 0, 0, 0.06);
  --ui-pcc-fill: rgba(0, 0, 0, 0.06);
  --ui-pcc-wash: rgba(0, 0, 0, 0.03);
  --ui-pcc-ring: rgba(0, 0, 0, 0.08);
  --ui-pcc-ring-hot: rgba(0, 0, 0, 0.2);
  --ui-pcc-accent: rgba(0, 96, 226, 0.765);
  --ui-pcc-primary: rgba(0, 0, 0, 0.88);
  --ui-pcc-on-primary: #fcfcfc;
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-pcc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-pcc-focus: rgba(0, 96, 226, 0.35);
  --ui-pcc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-pcc-time: 520ms;
  box-sizing: border-box;
  width: 100%;
  max-width: 320px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-pcc-ink);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pcc *, .ui-pcc *::before, .ui-pcc *::after { box-sizing: border-box; }
:where(.ui-pcc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-pcc button:focus-visible { outline: 2px solid var(--ui-pcc-focus); outline-offset: 1px; }
:where(.ui-pcc) svg { display: block; flex: none; }
.ui-pcc b { font-weight: 500; color: var(--ui-pcc-ink); }

/* Status tags: colored text on a light fill of the same color */
.ui-pcc [data-tone="red"] { --ui-pcc-tag: #d93d42; --ui-pcc-tag-bg: rgba(229, 72, 77, 0.08); }
.ui-pcc [data-tone="amber"] { --ui-pcc-tag: #a86f00; --ui-pcc-tag-bg: rgba(232, 162, 12, 0.1); }
.ui-pcc [data-tone="green"] { --ui-pcc-tag: #1a9a52; --ui-pcc-tag-bg: rgba(26, 154, 82, 0.08); }
.ui-pcc [data-tone="blue"] { --ui-pcc-tag: rgba(0, 96, 226, 0.9); --ui-pcc-tag-bg: rgba(0, 96, 226, 0.06); }
.ui-pcc [data-tone="violet"] { --ui-pcc-tag: #5b5bd6; --ui-pcc-tag-bg: rgba(91, 91, 214, 0.08); }
.ui-pcc [data-tone="gray"] { --ui-pcc-tag: rgba(0, 0, 0, 0.61); --ui-pcc-tag-bg: rgba(0, 0, 0, 0.05); }

/* One white card – the edge is a shadow, not a border */
.ui-pcc__card { border-radius: 10px; background: var(--ui-pcc-card); box-shadow: var(--ui-pcc-shadow); }

/* Everything that opens does it the same quiet way: it unfolds and fades, nothing travels */
.ui-pcc__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows var(--ui-pcc-time) var(--ui-pcc-ease), opacity 260ms ease; }
.ui-pcc__fold > * { min-height: 0; overflow: hidden; }
.ui-pcc[data-open] > .ui-pcc__card > .ui-pcc__fold, .ui-pcc__fold--status[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows var(--ui-pcc-time) var(--ui-pcc-ease), opacity 380ms ease 120ms; }

/* ----- Head: the same in both states ----- */
.ui-pcc__head { position: relative; display: flex; align-items: center; gap: 10px; padding: 12px; }
.ui-pcc__toggle { position: absolute; inset: 0; border-radius: 10px; }
.ui-pcc__head > :not(.ui-pcc__toggle) { position: relative; pointer-events: none; }
.ui-pcc[data-open] :is(.ui-pcc__status, .ui-pcc__member), .ui-pcc__progress[data-live] .ui-pcc__seg { pointer-events: auto; }

/* The ring: one segment per subtask, done ones in the accent */
.ui-pcc__progress { display: grid; flex: none; place-items: center; width: 32px; height: 32px; }
.ui-pcc__progress > * { grid-area: 1 / 1; }
.ui-pcc__seg { fill: none; stroke: var(--ui-pcc-ring); stroke-width: 3; stroke-linecap: round; cursor: pointer; transition: stroke 220ms ease, stroke-width 240ms var(--ui-pcc-ease), opacity 220ms ease; }
.ui-pcc__seg[data-done] { stroke: var(--ui-pcc-accent); }
.ui-pcc__seg[data-hot] { stroke-width: 4.25; stroke: var(--ui-pcc-ring-hot); }
.ui-pcc__seg[data-done][data-hot] { stroke: var(--ui-pcc-accent); }
.ui-pcc__seg[data-dim] { opacity: 0.3; }
.ui-pcc__num { font-size: 12px; font-weight: 500; line-height: 1; color: var(--ui-pcc-strong); font-variant-numeric: tabular-nums; pointer-events: none; animation: ui-pcc-num 320ms var(--ui-pcc-ease) both; }

.ui-pcc__titles { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-width: 0; }
.ui-pcc__name { overflow: hidden; text-align: start; font-size: 13px; line-height: 20px; font-weight: 500; color: var(--ui-pcc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-pcc__sub { display: flex; align-items: center; gap: 6px; min-width: 0; height: 20px; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-pcc-muted); white-space: nowrap; }
.ui-pcc__status { display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 100%; align-items: center; gap: 5px; height: 20px; padding: 0 6px 0 5px; border-radius: 5px; background: var(--ui-pcc-tag-bg); font-size: 12px; line-height: 16px; font-weight: 500; color: var(--ui-pcc-tag); transition: box-shadow 160ms ease; }
.ui-pcc[data-open] .ui-pcc__status:hover, .ui-pcc__status[aria-expanded="true"] { box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-pcc-tag) 35%, transparent); }
.ui-pcc__status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-pcc__due { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }

/* People: hover one to see only their subtasks, click to keep it */
.ui-pcc__people { display: flex; flex: none; }
.ui-pcc__member { position: relative; border-radius: 50%; transition: transform 240ms var(--ui-pcc-ease), opacity 220ms ease; }
.ui-pcc__member + .ui-pcc__member { margin-left: -5px; }
.ui-pcc__member[data-on] { z-index: 1; transform: scale(1.1); }
.ui-pcc__member[data-off] { opacity: 0.4; }
.ui-pcc__member[aria-pressed="true"] .ui-pcc__avatar { box-shadow: 0 0 0 1.5px var(--ui-pcc-card), 0 0 0 2.5px var(--ui-pcc-accent); }
.ui-pcc__avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  overflow: hidden;
  border-radius: 50%;
  background: hsl(var(--ui-pcc-hue) 60% 92%);
  box-shadow: 0 0 0 1.5px var(--ui-pcc-card);
  font-size: 9px;
  font-weight: 500;
  line-height: 1;
  color: hsl(var(--ui-pcc-hue) 40% 36%);
  transition: box-shadow 200ms ease;
}
.ui-pcc__avatar img { width: 100%; height: 100%; object-fit: cover; }
/* The rest of the people as one quiet chip */
.ui-pcc__more { position: relative; margin-left: -5px; padding: 0 3px; width: auto; min-width: 20px; border-radius: 10px; background: var(--ui-pcc-fill); color: var(--ui-pcc-text); font-variant-numeric: tabular-nums; }
.ui-pcc[data-open] .ui-pcc__more { pointer-events: auto; }

/* ----- Body ----- */
.ui-pcc__body { padding: 0 12px; }
/* Status options: the switch-chip look – a soft fill marks the chosen one */
.ui-pcc__options { display: flex; gap: 4px; margin: -2px -12px 0; padding: 3px 12px 12px; overflow-x: auto; scrollbar-width: none; }
.ui-pcc__options::-webkit-scrollbar { display: none; }
.ui-pcc__option { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 24px; padding: 2px 7px 2px 6px; border-radius: 6px; box-shadow: inset 0 0 0 0.5px var(--ui-pcc-line); font-size: 12px; line-height: 16px; font-weight: 500; color: var(--ui-pcc-text); white-space: nowrap; transition: background-color 120ms ease-out, color 120ms ease-out;  max-width: 100%; }
.ui-pcc__option svg { color: var(--ui-pcc-tag); }
/* A small square in the tone's color – the full icon sits on the chosen tag in the head */
.ui-pcc__dot { flex: none; width: 6px; height: 6px; border-radius: 1.5px; background: var(--ui-pcc-tag); }
.ui-pcc__option-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pcc__option:hover { background: var(--ui-pcc-wash); color: var(--ui-pcc-ink); }
.ui-pcc__option[aria-checked="true"] { background: var(--ui-pcc-fill); color: var(--ui-pcc-ink); }

/* A long list scrolls inside the card; the padding keeps the rows' hover inside the scroll box, the top line is a fixed background in a clear border, so it keeps its place */
.ui-pcc__tasks { max-height: 352px; margin: 0 -6px; padding: 6px 6px; border-top: 0.5px solid transparent; overflow-y: auto; overscroll-behavior: contain; background: linear-gradient(var(--ui-pcc-line), var(--ui-pcc-line)) 6px 0 / calc(100% - 12px) 0.5px no-repeat border-box; list-style: none; }
.ui-pcc__task { display: flex; align-items: center; gap: 10px; width: calc(100% + 12px); height: 32px; margin: 0 -6px; padding: 0 6px; border-radius: 6px; color: var(--ui-pcc-ink); transition: background-color 90ms ease-out, color 200ms ease, opacity 220ms ease; }
.ui-pcc__task[data-hot] { background: var(--ui-pcc-wash); }
.ui-pcc__task[data-dim] { opacity: 0.35; }
.ui-pcc__label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: start; }
.ui-pcc__task .ui-pcc__avatar { width: 18px; height: 18px; font-size: 8px; opacity: 0; transform: translateX(4px); transition: opacity 200ms ease, transform 240ms var(--ui-pcc-ease); }
.ui-pcc__task:is([data-hot], :focus-visible) .ui-pcc__avatar { opacity: 1; transform: none; }
/* The check: a thin ring that fills with the accent */
.ui-pcc__ring { fill: none; stroke: var(--ui-pcc-faint); stroke-width: 1.1; transition: stroke 160ms ease; }
.ui-pcc__task[data-hot] .ui-pcc__ring { stroke: var(--ui-pcc-icon); }
.ui-pcc__disc { fill: var(--ui-pcc-accent); transform-origin: 8px 8px; transform: scale(0); transition: transform 340ms var(--ui-pcc-ease); }
.ui-pcc__tick { fill: none; stroke: #ffffff; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 9; stroke-dashoffset: 9; transition: stroke-dashoffset 280ms var(--ui-pcc-ease) 80ms; }
.ui-pcc__task[aria-checked="true"] .ui-pcc__disc { transform: scale(1); }
.ui-pcc__task[aria-checked="true"] .ui-pcc__tick { stroke-dashoffset: 0; }
.ui-pcc__task[aria-checked="true"] { color: var(--ui-pcc-muted); }

/* ----- The last row inside the card ----- */
.ui-pcc__foot { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 8px 0 12px; border-top: 0.5px solid var(--ui-pcc-line); }
.ui-pcc__caption { flex: 1; min-width: 0; overflow: hidden; text-align: start; font-size: 12px; line-height: 16px; color: var(--ui-pcc-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-pcc__caption > span { display: inline-block; animation: ui-pcc-in 280ms var(--ui-pcc-ease) both; }
/* Primary: the dark chip */
.ui-pcc__action { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 60%; height: 28px; padding: 0 7px 0 10px; border-radius: 6px; background: var(--ui-pcc-primary); font-size: 13px; line-height: 20px; font-weight: 500; color: var(--ui-pcc-on-primary); white-space: nowrap; transition: opacity 160ms ease; }
.ui-pcc__action-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pcc__action:hover { opacity: 0.9; }
.ui-pcc__action svg { transition: transform 220ms var(--ui-pcc-ease); }
.ui-pcc__action:hover svg { transform: translateX(2px); }

@keyframes ui-pcc-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-pcc-num { from { opacity: 0; transform: scale(0.8); } }

/* Narrow cards (small phones, tight columns): the date loses its word and the avatars move closer, so nothing is cut */
@container (max-width: 290px) {
  .ui-pcc__due-word { display: none; }
  .ui-pcc__member + .ui-pcc__member { margin-left: -8px; }
  .ui-pcc__head { gap: 8px; padding: 10px; }
  .ui-pcc__body { padding: 0 10px; }
  .ui-pcc__sub { gap: 4px; }
  .ui-pcc__status { padding: 0 5px 0 4px; }
  .ui-pcc__options { margin: -2px -10px 0; padding: 3px 10px 10px; }
  .ui-pcc__option { padding: 2px 6px; }
  .ui-pcc__dot { display: none; }
  .ui-pcc__foot { padding: 0 8px 0 10px; }
}

@media (pointer: coarse) {
  .ui-pcc__task { height: 38px; }
  .ui-pcc__task .ui-pcc__avatar { opacity: 1; transform: none; }
  .ui-pcc__option { height: 32px; padding: 0 7px 0 6px; }
  .ui-pcc__foot { height: 52px; }
  .ui-pcc__action { height: 34px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pcc *, .ui-pcc *::before, .ui-pcc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pcc {
  --ui-pcc-card: #1c1c1e;
  --ui-pcc-ink: rgba(255, 255, 255, 0.9);
  --ui-pcc-strong: #ffffff;
  --ui-pcc-text: rgba(255, 255, 255, 0.62);
  --ui-pcc-muted: rgba(255, 255, 255, 0.46);
  --ui-pcc-faint: rgba(255, 255, 255, 0.3);
  --ui-pcc-icon: rgba(255, 255, 255, 0.5);
  --ui-pcc-line: rgba(255, 255, 255, 0.08);
  --ui-pcc-fill: rgba(255, 255, 255, 0.08);
  --ui-pcc-wash: rgba(255, 255, 255, 0.04);
  --ui-pcc-ring: rgba(255, 255, 255, 0.1);
  --ui-pcc-ring-hot: rgba(255, 255, 255, 0.26);
  --ui-pcc-accent: #4d8dff;
  --ui-pcc-primary: rgba(255, 255, 255, 0.9);
  --ui-pcc-on-primary: #1c1c1e;
  --ui-pcc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-pcc-focus: rgba(77, 141, 255, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-pcc__avatar { background: hsl(var(--ui-pcc-hue) 26% 26%); color: hsl(var(--ui-pcc-hue) 60% 82%); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="red"] { --ui-pcc-tag: #ff8a8d; --ui-pcc-tag-bg: rgba(229, 72, 77, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="amber"] { --ui-pcc-tag: #f5c264; --ui-pcc-tag-bg: rgba(232, 162, 12, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="green"] { --ui-pcc-tag: #5fd394; --ui-pcc-tag-bg: rgba(26, 154, 82, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="blue"] { --ui-pcc-tag: #8fb6ff; --ui-pcc-tag-bg: rgba(77, 141, 255, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="violet"] { --ui-pcc-tag: #ababf5; --ui-pcc-tag-bg: rgba(91, 91, 214, 0.18); }
:where(.dark, [data-theme="dark"]) .ui-pcc [data-tone="gray"] { --ui-pcc-tag: rgba(255, 255, 255, 0.62); --ui-pcc-tag-bg: rgba(255, 255, 255, 0.08); }
`;
