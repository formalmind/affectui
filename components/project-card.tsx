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
 * Project Card – a two-line summary that quietly grows into the full picture, in a single self-contained file.
 * The progress is a ring cut into one segment per subtask. Nothing flies around when the card opens: the head stays
 * where it is and the list unfolds below it. The life is inside the open card instead –
 *   · hover a subtask and its segment lights up in the ring (and the other way round); click either to tick it
 *   · hover a person to see only their subtasks, click to keep that view
 *   · click the status to pick another one from a row that unfolds in place
 *   · the line on the gray tray always says what you are pointing at
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
  /** A button on the tray of the open card, e.g. { label: "Open", onClick } */
  action?: { label: string; onClick: () => void };
  /** Replaces the line on the tray while nothing is hovered */
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
  const line = { stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;
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
    <circle className="ui-pc__ring" cx="8" cy="8" r="6.3" />
    <circle className="ui-pc__disc" cx="8" cy="8" r="7" />
    <path className="ui-pc__tick" d="m5.2 8.2 1.9 1.9 3.7-4" />
  </svg>
);

function Avatar({ member }: { member: ProjectMember }) {
  // An image that fails to load falls back to the initials
  const [broken, setBroken] = useState(false);
  return (
    <span
      className="ui-pc__avatar"
      style={{ ["--ui-pc-hue" as string]: hue(member.name) }}
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
      ?.querySelector<HTMLElement>(".ui-pc__toggle")
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

  /* ---------- What the tray says ---------- */

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
      className={["ui-pc", className].filter(Boolean).join(" ")}
      data-open={isOpen ? "" : undefined}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onKeyDown={onKeyDown}
    >
      <style href="ui-project-card" precedence="default">
        {css}
      </style>

      <div className="ui-pc__card">
        <div className="ui-pc__head">
          {/* The whole head toggles; what sits on top of it only reacts once the card is open */}
          <button
            type="button"
            className="ui-pc__toggle"
            aria-expanded={isOpen}
            aria-controls={`${uid}-body`}
            aria-label={`${title}: ${count.format(doneCount)} of ${count.format(list.length)} done, ${statusNow?.label ?? ""}${due ? `, due ${due}` : ""}`}
            onClick={() => change(!isOpen)}
          />

          <span
            className="ui-pc__progress"
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
                  className="ui-pc__seg"
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
                    className="ui-pc__seg"
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
            <span className="ui-pc__num" key={doneCount}>
              {doneCount}
            </span>
          </span>

          <span className="ui-pc__titles">
            <span className="ui-pc__name" dir="auto" title={title}>
              {title}
            </span>
            <span className="ui-pc__sub">
              {statusNow && (
              <button
                type="button"
                className="ui-pc__status"
                data-tone={toneOf(statusNow.tone)}
                title={statusNow.label}
                aria-expanded={choosing}
                aria-controls={`${uid}-status`}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => setChoosing((c) => !c)}
              >
                {statusNow.icon ?? <ToneIcon tone={toneOf(statusNow.tone)} />}
                <span className="ui-pc__status-text" dir="auto">
                  {statusNow.label}
                </span>
              </button>
              )}
              {due && (
                <span className="ui-pc__due" dir="auto" title={due}>
                  <span className="ui-pc__due-word">Due </span>
                  {due}
                </span>
              )}
            </span>
          </span>

          {members.length > 0 && (
            <span
              className="ui-pc__people"
              onPointerLeave={() => setPeek(null)}
            >
              {members.slice(0, MAX_FACES).map((m, i) => (
                <button
                  key={`${m.name}#${i}`}
                  title={m.name}
                  type="button"
                  className="ui-pc__member"
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
                  className="ui-pc__avatar ui-pc__more"
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

        <div id={`${uid}-body`} className="ui-pc__fold" inert={!isOpen}>
          <div className="ui-pc__body">
            {/* The status picker unfolds in place */}
            <div
              id={`${uid}-status`}
              className="ui-pc__fold ui-pc__fold--status"
              data-open={choosing ? "" : undefined}
              inert={!choosing}
            >
              <div className="ui-pc__clip">
                <div
                  className="ui-pc__options"
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
                      className="ui-pc__option"
                      data-tone={toneOf(o.tone)}
                      onClick={() => pick(o.id)}
                    >
                      {o.icon ?? <ToneIcon tone={toneOf(o.tone)} />}
                      <span className="ui-pc__option-text" dir="auto">
                        {o.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {list.length > 0 && (
              <ul className="ui-pc__tasks" onPointerLeave={() => setHot(null)}>
                {list.map((t) => {
                  const owner = members.find((m) => m.name === t.assignee);
                  return (
                    <li key={t.key}>
                      <button
                        type="button"
                        className="ui-pc__task"
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
                        <span className="ui-pc__label" dir="auto" title={t.label}>
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
      </div>

      {/* The tray: it says what you are pointing at, and holds the action */}
      <div className="ui-pc__fold" inert={!isOpen}>
        <div className="ui-pc__clip">
          <div className="ui-pc__foot">
            <span className="ui-pc__caption" aria-live="polite">
              <span key={captionKey} dir="auto">
                {caption}
              </span>
            </span>
            {action && (
              <button
                type="button"
                className="ui-pc__action"
                title={action.label}
                onClick={action.onClick}
              >
                <span className="ui-pc__action-text">{action.label}</span>
                <ArrowIcon />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-pc {
  --ui-pc-tray: #f0f0f0;
  --ui-pc-card: #ffffff;
  --ui-pc-line: #ececec;
  --ui-pc-ink: #171717;
  --ui-pc-text: #404040;
  --ui-pc-muted: #8f8f8f;
  --ui-pc-well: #f4f4f5;
  --ui-pc-ring: #dcdce0;
  --ui-pc-focus: rgba(23, 23, 23, 0.22);
  --ui-pc-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  --ui-pc-time: 520ms;
  box-sizing: border-box;
  width: 100%;
  max-width: 320px;
  container-type: inline-size;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-pc-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-pc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pc *, .ui-pc *::before, .ui-pc *::after { box-sizing: border-box; }
:where(.ui-pc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-pc button:focus-visible { outline: 2px solid var(--ui-pc-focus); outline-offset: 2px; }
.ui-pc svg { display: block; flex: none; }
.ui-pc b { font-weight: 500; color: var(--ui-pc-ink); }

/* Status tags: colored text on a light fill of the same color */
.ui-pc [data-tone="red"] { --ui-pc-tag: #b42318; --ui-pc-tag-bg: rgba(229, 72, 77, 0.1); --ui-pc-tag-on: rgba(229, 72, 77, 0.18); }
.ui-pc [data-tone="amber"] { --ui-pc-tag: #96590a; --ui-pc-tag-bg: rgba(240, 160, 32, 0.14); --ui-pc-tag-on: rgba(240, 160, 32, 0.24); }
.ui-pc [data-tone="green"] { --ui-pc-tag: #18794e; --ui-pc-tag-bg: rgba(34, 160, 90, 0.11); --ui-pc-tag-on: rgba(34, 160, 90, 0.2); }
.ui-pc [data-tone="blue"] { --ui-pc-tag: #1f55d6; --ui-pc-tag-bg: rgba(47, 107, 255, 0.09); --ui-pc-tag-on: rgba(47, 107, 255, 0.17); }
.ui-pc [data-tone="violet"] { --ui-pc-tag: #6941c6; --ui-pc-tag-bg: rgba(124, 92, 255, 0.1); --ui-pc-tag-on: rgba(124, 92, 255, 0.18); }
.ui-pc [data-tone="gray"] { --ui-pc-tag: #5f5f66; --ui-pc-tag-bg: rgba(110, 110, 120, 0.09); --ui-pc-tag-on: rgba(110, 110, 120, 0.17); }

.ui-pc__card { border-radius: 16px; background: var(--ui-pc-card); box-shadow: 0 0 0 1px var(--ui-pc-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* Everything that opens does it the same quiet way: it unfolds and fades, nothing travels */
.ui-pc__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows var(--ui-pc-time) var(--ui-pc-ease), opacity 260ms ease; }
.ui-pc__fold > * { min-height: 0; overflow: hidden; }
.ui-pc[data-open] > .ui-pc__fold, .ui-pc[data-open] > .ui-pc__card > .ui-pc__fold, .ui-pc__fold--status[data-open] { grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows var(--ui-pc-time) var(--ui-pc-ease), opacity 380ms ease 120ms; }

/* ----- Head: the same in both states ----- */
.ui-pc__head { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
.ui-pc__toggle { position: absolute; inset: 0; border-radius: 16px; }
.ui-pc__head > :not(.ui-pc__toggle) { position: relative; pointer-events: none; }
.ui-pc[data-open] :is(.ui-pc__status, .ui-pc__member), .ui-pc__progress[data-live] .ui-pc__seg { pointer-events: auto; }

.ui-pc__progress { display: grid; flex: none; place-items: center; width: 32px; height: 32px; }
.ui-pc__progress > * { grid-area: 1 / 1; }
.ui-pc__seg { fill: none; stroke: var(--ui-pc-ring); stroke-width: 3; stroke-linecap: round; cursor: pointer; transition: stroke 260ms ease, stroke-width 260ms var(--ui-pc-ease), opacity 240ms ease; }
.ui-pc__seg[data-done] { stroke: var(--ui-pc-ink); }
.ui-pc__seg[data-hot] { stroke-width: 4.5; stroke: var(--ui-pc-muted); }
.ui-pc__seg[data-done][data-hot] { stroke: var(--ui-pc-ink); }
.ui-pc__seg[data-dim] { opacity: 0.3; }
.ui-pc__num { font-size: 11.5px; font-weight: 600; line-height: 1; color: var(--ui-pc-ink); font-variant-numeric: tabular-nums; pointer-events: none; animation: ui-pc-num 320ms var(--ui-pc-ease) both; }

.ui-pc__titles { display: grid; grid-template-columns: minmax(0, 1fr); flex: 1; min-width: 0; }
.ui-pc__name { overflow: hidden; text-align: start; font-size: 13.5px; font-weight: 600; color: var(--ui-pc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-pc__sub { display: flex; align-items: center; gap: 6px; min-width: 0; height: 20px; margin-top: 1px; overflow: hidden; font-size: 12px; line-height: 20px; color: var(--ui-pc-muted); white-space: nowrap; }
.ui-pc__status { display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 100%; align-items: center; gap: 4px; height: 20px; padding: 0 7px 0 5px; border-radius: 5px; background: var(--ui-pc-tag-bg); font-weight: 500; color: var(--ui-pc-tag); transition: background-color 200ms ease, color 200ms ease; }
.ui-pc[data-open] .ui-pc__status:hover, .ui-pc__status[aria-expanded="true"] { background: var(--ui-pc-tag-on); }
.ui-pc__status-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-pc__due { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

/* People: hover one to see only their subtasks, click to keep it */
.ui-pc__people { display: flex; flex: none; }
.ui-pc__member { position: relative; border-radius: 50%; transition: transform 260ms var(--ui-pc-ease), opacity 240ms ease; }
.ui-pc__member + .ui-pc__member { margin-left: -6px; }
.ui-pc__member[data-on] { z-index: 1; transform: scale(1.12); }
.ui-pc__member[data-off] { opacity: 0.4; }
.ui-pc__member[aria-pressed="true"] .ui-pc__avatar { box-shadow: 0 0 0 1.5px var(--ui-pc-card), 0 0 0 3px var(--ui-pc-ink); }
.ui-pc__avatar {
  display: grid;
  flex: none;
  place-items: center;
  width: 20px;
  height: 20px;
  overflow: hidden;
  border-radius: 50%;
  background: hsl(var(--ui-pc-hue) 70% 90%);
  box-shadow: 0 0 0 1.5px var(--ui-pc-card);
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  color: hsl(var(--ui-pc-hue) 45% 34%);
  transition: box-shadow 200ms ease;
}
.ui-pc__avatar img { width: 100%; height: 100%; object-fit: cover; }
/* The rest of the people as one quiet chip */
.ui-pc__more { position: relative; margin-left: -5px; padding: 0 3px; width: auto; min-width: 20px; border-radius: 10px; background: var(--ui-pc-well); color: var(--ui-pc-text); font-variant-numeric: tabular-nums; }
.ui-pc[data-open] .ui-pc__more { pointer-events: auto; }

/* ----- Body ----- */
.ui-pc__body { padding: 0 12px; }
.ui-pc__options { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 10px; }
.ui-pc__option { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px 0 7px; border-radius: 6px; background: var(--ui-pc-tag-bg); font-size: 12px; font-weight: 500; color: var(--ui-pc-tag); white-space: nowrap; transition: background-color 160ms ease, box-shadow 160ms ease;  max-width: 100%; }
.ui-pc__option-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pc__option:hover { background: var(--ui-pc-tag-on); }
.ui-pc__option[aria-checked="true"] { background: var(--ui-pc-tag-on); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-pc-tag) 34%, transparent); }

/* A long list scrolls inside the card; the padding keeps the rows' hover inside the scroll box, the top line is a fixed background in a clear border, so it keeps its place */
.ui-pc__tasks { max-height: 352px; margin: 0 -6px; padding: 8px 6px; border-top: 1px solid transparent; overflow-y: auto; overscroll-behavior: contain; background: linear-gradient(var(--ui-pc-line), var(--ui-pc-line)) 6px 0 / calc(100% - 12px) 1px no-repeat border-box; list-style: none; }
.ui-pc__task { display: flex; align-items: center; gap: 9px; width: calc(100% + 12px); height: 30px; margin: 0 -6px; padding: 0 6px; border-radius: 8px; color: var(--ui-pc-text); transition: background-color 160ms ease, color 200ms ease, opacity 240ms ease; }
.ui-pc__task[data-hot] { background: var(--ui-pc-well); }
.ui-pc__task[data-dim] { opacity: 0.35; }
.ui-pc__label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; text-align: start; }
.ui-pc__task .ui-pc__avatar { width: 18px; height: 18px; font-size: 8px; opacity: 0; transform: translateX(4px); transition: opacity 200ms ease, transform 260ms var(--ui-pc-ease); }
.ui-pc__task:is([data-hot], :focus-visible) .ui-pc__avatar { opacity: 1; transform: none; }
.ui-pc__ring { fill: none; stroke: #c9c9ce; stroke-width: 1.4; transition: stroke 160ms ease; }
.ui-pc__task[data-hot] .ui-pc__ring { stroke: var(--ui-pc-muted); }
.ui-pc__disc { fill: var(--ui-pc-ink); transform-origin: 8px 8px; transform: scale(0); transition: transform 340ms var(--ui-pc-ease); }
.ui-pc__tick { fill: none; stroke: var(--ui-pc-card); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 9; stroke-dashoffset: 9; transition: stroke-dashoffset 280ms var(--ui-pc-ease) 80ms; }
.ui-pc__task[aria-checked="true"] .ui-pc__disc { transform: scale(1); }
.ui-pc__task[aria-checked="true"] .ui-pc__tick { stroke-dashoffset: 0; }
.ui-pc__task[aria-checked="true"] { color: var(--ui-pc-muted); }

/* ----- Tray ----- */
.ui-pc__foot { display: flex; align-items: center; gap: 8px; height: 38px; padding: 4px 4px 0 10px; }
.ui-pc__caption { flex: 1; min-width: 0; overflow: hidden; text-align: start; font-size: 12.5px; color: var(--ui-pc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-pc__caption > span { display: inline-block; animation: ui-pc-in 280ms var(--ui-pc-ease) both; }
.ui-pc__action { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 60%; height: 26px; padding: 0 6px 0 8px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: var(--ui-pc-text); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease; }
.ui-pc__action-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-pc__action:hover { background: var(--ui-pc-card); color: var(--ui-pc-ink); }
.ui-pc__action svg { transition: transform 220ms var(--ui-pc-ease); }
.ui-pc__action:hover svg { transform: translateX(2px); }

@keyframes ui-pc-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-pc-num { from { opacity: 0; transform: scale(0.8); } }

/* Narrow cards (small phones, tight columns): the date loses its word and the avatars move closer, so nothing is cut */
@container (max-width: 290px) {
  .ui-pc__due-word { display: none; }
  .ui-pc__member + .ui-pc__member { margin-left: -9px; }
  .ui-pc__head { gap: 8px; }
  .ui-pc__sub { gap: 4px; }
  .ui-pc__status { padding: 0 6px 0 4px; }
}

@media (pointer: coarse) {
  .ui-pc__task { height: 36px; }
  .ui-pc__task .ui-pc__avatar { opacity: 1; transform: none; }
  .ui-pc__option { height: 30px; }
  .ui-pc__action { height: 30px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pc *, .ui-pc *::before, .ui-pc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pc {
  --ui-pc-tray: #111113;
  --ui-pc-card: #19191b;
  --ui-pc-line: #2a2a2e;
  --ui-pc-ink: #ededed;
  --ui-pc-text: #c8c8cc;
  --ui-pc-muted: #8b8b92;
  --ui-pc-well: #222225;
  --ui-pc-ring: #3a3a40;
  --ui-pc-focus: rgba(255, 255, 255, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-pc__ring { stroke: #4a4a50; }
:where(.dark, [data-theme="dark"]) .ui-pc__avatar { background: hsl(var(--ui-pc-hue) 30% 26%); color: hsl(var(--ui-pc-hue) 70% 82%); }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="red"] { --ui-pc-tag: #ff9b93; }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="amber"] { --ui-pc-tag: #f5c264; }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="green"] { --ui-pc-tag: #6ee7a8; }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="blue"] { --ui-pc-tag: #9bb8ff; }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="violet"] { --ui-pc-tag: #c3b1ff; }
:where(.dark, [data-theme="dark"]) .ui-pc [data-tone="gray"] { --ui-pc-tag: #b4b4bb; }
`;
