"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";

/*
 * Task Board – a kanban board for a sprint, in a single self-contained file.
 * Drag cards between columns and reorder them, add cards per column, open a card to change its status,
 * priority, labels and title, search, filter by label and switch to a compact view.
 * The styles are injected below, so no extra files are needed.
 */

export type TaskStatus = { id: string; label: string; icon: ReactNode };
export type TaskLabel = { id: string; label: string; color: string };
export type TaskPerson = { id: string; name: string; avatar?: string };

export type Task = {
  id: string;
  /** Short reference, e.g. "NW-214" */
  key: string;
  title: string;
  status: string;
  /** 0 none · 1 low · 2 medium · 3 high · 4 urgent */
  priority: 0 | 1 | 2 | 3 | 4;
  estimate?: "XS" | "S" | "M" | "L" | "XL";
  labels: string[];
  assignee?: string;
  /** Days until due – negative when overdue */
  dueIn?: number;
  subtasks?: [done: number, total: number];
  pullRequest?: number;
  created: string;
};

export type TaskBoardProps = {
  tasks: Task[];
  statuses: TaskStatus[];
  labels: TaskLabel[];
  people: TaskPerson[];
  /** Breadcrumb above the board */
  path?: string[];
  /** Called with all tasks after every change */
  onChange?: (tasks: Task[]) => void;
  className?: string;
};

const priorityNames = ["No priority", "Low", "Medium", "High", "Urgent"];

export function TaskBoard({
  tasks: initial,
  statuses,
  labels,
  people,
  path = ["Northwind", "Launch", "Sprint 12"],
  onChange,
  className,
}: TaskBoardProps) {
  const [tasks, setTasksState] = useState(initial);
  const [query, setQuery] = useState("");
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [compact, setCompact] = useState(false);
  const [menu, setMenu] = useState<"filter" | null>(null);
  const [starred, setStarred] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<{ id: string; over?: string; index?: number } | null>(null);
  const counter = useRef(initial.length + 300);
  const menuRef = useRef<HTMLDivElement>(null);

  const setTasks = (next: Task[]) => {
    setTasksState(next);
    onChange?.(next);
  };
  const update = (id: string, patch: Partial<Task>) => setTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(null);
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [menu]);

  useEffect(() => {
    if (!openId) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpenId(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [openId]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (!q || `${t.key} ${t.title}`.toLowerCase().includes(q)) &&
          (labelFilter.size === 0 || t.labels.some((l) => labelFilter.has(l))),
      ),
    [tasks, q, labelFilter],
  );

  const person = (id?: string) => people.find((p) => p.id === id);
  const label = (id: string) => labels.find((l) => l.id === id);
  const open = tasks.find((t) => t.id === openId) ?? null;

  /* ---- drag and drop ---- */
  const onDragOver = (e: DragEvent, status: string) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Insert position: before the first card whose middle is below the pointer
    const cards = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[data-card]")].filter(
      (c) => c.dataset.card !== drag.id,
    );
    let index = cards.length;
    for (let i = 0; i < cards.length; i++) {
      const box = cards[i].getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    if (drag.over !== status || drag.index !== index) setDrag({ ...drag, over: status, index });
  };
  const onDrop = (status: string) => {
    if (!drag) return;
    const moving = tasks.find((t) => t.id === drag.id);
    if (!moving) return setDrag(null);
    const rest = tasks.filter((t) => t.id !== drag.id);
    const column = rest.filter((t) => t.status === status && visible.some((v) => v.id === t.id));
    const before = column[drag.index ?? column.length];
    const moved = { ...moving, status };
    const at = before ? rest.indexOf(before) : rest.length;
    setTasks([...rest.slice(0, at), moved, ...rest.slice(at)]);
    setDrag(null);
  };

  const add = (status: string) => {
    const title = draft.trim();
    setAdding(null);
    setDraft("");
    if (!title) return;
    counter.current += 1;
    const task: Task = {
      id: `t-${counter.current}`,
      key: `NW-${counter.current}`,
      title,
      status,
      priority: 0,
      labels: [],
      created: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
    setTasks([task, ...tasks]);
  };

  return (
    <>
      <style href="ui-task-board" precedence="default">
        {css}
      </style>
      <section className={["ui-tb", className].filter(Boolean).join(" ")} aria-label={path.join(" / ")} data-compact={compact || undefined}>
        <header className="ui-tb__top">
          <nav className="ui-tb__crumbs" aria-label="Breadcrumb">
            <span className="ui-tb__logo" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {path.map((p, i) => (
              <span key={p} className="ui-tb__crumb" aria-current={i === path.length - 1 ? "page" : undefined}>
                {i > 0 && <Chevron />}
                {p}
              </span>
            ))}
            <button
              type="button"
              className="ui-tb__icon"
              aria-pressed={starred}
              aria-label={starred ? "Remove from favorites" : "Add to favorites"}
              onClick={() => setStarred((s) => !s)}
            >
              <StarIcon filled={starred} />
            </button>
          </nav>
        </header>

        <div className="ui-tb__bar">
          <span className="ui-tb__count">
            {visible.length} {visible.length === 1 ? "task" : "tasks"}
            {visible.length !== tasks.length && <span> of {tasks.length}</span>}
          </span>
          <div className="ui-tb__tools">
            <label className="ui-tb__search">
              <Icon d="M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM11 11l3.5 3.5" size={14} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search tasks" />
            </label>
            <div className="ui-tb__menu-wrap" ref={menuRef}>
              <button
                type="button"
                className="ui-tb__icon"
                aria-label="Filter by label"
                aria-haspopup="menu"
                aria-expanded={menu === "filter"}
                data-active={labelFilter.size > 0 || undefined}
                onClick={() => setMenu(menu ? null : "filter")}
              >
                <Icon d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3" />
                {labelFilter.size > 0 && <span className="ui-tb__dot" />}
              </button>
              {menu === "filter" && (
                <div className="ui-tb__menu" role="menu">
                  <p className="ui-tb__menu-title">Labels</p>
                  {labels.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={labelFilter.has(l.id)}
                      className="ui-tb__menu-item"
                      onClick={() =>
                        setLabelFilter((f) => {
                          const next = new Set(f);
                          if (next.has(l.id)) next.delete(l.id);
                          else next.add(l.id);
                          return next;
                        })
                      }
                    >
                      <span className="ui-tb__swatch" style={{ background: l.color }} />
                      {l.label}
                      {labelFilter.has(l.id) && <Icon d="m3.5 8.5 3 3 6-7" size={14} />}
                    </button>
                  ))}
                  {labelFilter.size > 0 && (
                    <button type="button" className="ui-tb__menu-item ui-tb__menu-clear" onClick={() => setLabelFilter(new Set())}>
                      Clear filter
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="ui-tb__icon"
              aria-pressed={compact}
              aria-label="Compact cards"
              title="Compact cards"
              onClick={() => setCompact((c) => !c)}
            >
              <Icon d="M2.5 3.5h11v3h-11zM2.5 9.5h11v3h-11z" />
            </button>
          </div>
        </div>

        <div className="ui-tb__columns">
          {statuses.map((status) => {
            const cards = visible.filter((t) => t.status === status.id);
            const isOver = drag?.over === status.id;
            return (
              <div
                key={status.id}
                className="ui-tb__column"
                data-over={isOver || undefined}
                onDragOver={(e) => onDragOver(e, status.id)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node) && drag) setDrag({ id: drag.id });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDrop(status.id);
                }}
              >
                <div className="ui-tb__col-head">
                  <span className="ui-tb__status">{status.icon}</span>
                  <span className="ui-tb__col-title">{status.label}</span>
                  <span className="ui-tb__col-count">{cards.length}</span>
                  <button
                    type="button"
                    className="ui-tb__icon ui-tb__add"
                    aria-label={`Add task to ${status.label}`}
                    onClick={() => {
                      setAdding(status.id);
                      setDraft("");
                    }}
                  >
                    <Icon d="M8 3v10M3 8h10" size={14} />
                  </button>
                </div>

                <div className="ui-tb__cards">
                  {adding === status.id && (
                    <form
                      className="ui-tb__new"
                      onSubmit={(e) => {
                        e.preventDefault();
                        add(status.id);
                      }}
                    >
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => add(status.id)}
                        onKeyDown={(e) => e.key === "Escape" && (setAdding(null), setDraft(""))}
                        placeholder="Task title, then Enter"
                        aria-label={`New task in ${status.label}`}
                      />
                    </form>
                  )}
                  {cards.map((t, i) => {
                    const who = person(t.assignee);
                    return (
                      <div key={t.id} className="ui-tb__slot">
                        {isOver && drag?.index === i && <span className="ui-tb__drop" />}
                        <article
                          className="ui-tb__card"
                          data-card={t.id}
                          data-dragging={drag?.id === t.id || undefined}
                          draggable
                          tabIndex={0}
                          aria-label={`${t.key} ${t.title}`}
                          onDragStart={(e) => {
                            e.dataTransfer.setData("text/plain", t.id);
                            e.dataTransfer.effectAllowed = "move";
                            setDrag({ id: t.id });
                          }}
                          onDragEnd={() => setDrag(null)}
                          onClick={() => setOpenId(t.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setOpenId(t.id);
                            }
                          }}
                        >
                          <div className="ui-tb__card-top">
                            <span className="ui-tb__key">{t.key}</span>
                            {who && <Avatar person={who} size={18} />}
                          </div>
                          <p className="ui-tb__card-title">
                            <span className="ui-tb__status">{status.icon}</span>
                            <span>{t.title}</span>
                          </p>
                          <div className="ui-tb__props">
                            <span className="ui-tb__prop" title={priorityNames[t.priority]}>
                              <PriorityIcon level={t.priority} />
                            </span>
                            {t.estimate && (
                              <span className="ui-tb__prop" title="Estimate">
                                <Icon d="M8 2.5 13.5 12h-11Z" size={12} />
                                {t.estimate}
                              </span>
                            )}
                            {t.dueIn !== undefined && (
                              <span className="ui-tb__prop" data-tone={t.dueIn < 0 ? "late" : t.dueIn <= 2 ? "soon" : undefined}>
                                <Icon d="M8 14.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11ZM8 6v3l2 1.2M6.5 1.5h3" size={12} />
                                {t.dueIn < 0 ? `${-t.dueIn}d late` : t.dueIn === 0 ? "Today" : `${t.dueIn}d`}
                              </span>
                            )}
                            {t.subtasks && (
                              <span className="ui-tb__prop">
                                <Ring done={t.subtasks[0]} total={t.subtasks[1]} />
                                {t.subtasks[0]}/{t.subtasks[1]}
                              </span>
                            )}
                            {t.pullRequest && (
                              <span className="ui-tb__prop">
                                <Icon d="M4.5 4v8M4.5 4a1.5 1.5 0 1 0 0-.01M11.5 12a1.5 1.5 0 1 0 0 .01M11.5 10.5V6.5a2 2 0 0 0-2-2H7.5M8.5 3.5l-1 1 1 1" size={12} />#
                                {t.pullRequest}
                              </span>
                            )}
                            {t.labels.map((id) => {
                              const l = label(id);
                              return l ? (
                                <span key={id} className="ui-tb__prop">
                                  <span className="ui-tb__swatch ui-tb__swatch--dot" style={{ background: l.color }} />
                                  {l.label}
                                </span>
                              ) : null;
                            })}
                          </div>
                          <p className="ui-tb__created">Created {t.created}</p>
                        </article>
                      </div>
                    );
                  })}
                  {isOver && drag?.index === cards.length && <span className="ui-tb__drop" />}
                  {cards.length === 0 && adding !== status.id && <p className="ui-tb__empty">Drop tasks here</p>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel: opens over the board from the right */}
        <div className="ui-tb__scrim" data-open={open ? true : undefined} onClick={() => setOpenId(null)} aria-hidden="true" />
        <aside className="ui-tb__panel" data-open={open ? true : undefined} aria-label="Task details" inert={!open}>
          {open && (
            <>
              <div className="ui-tb__panel-head">
                <span className="ui-tb__key">{open.key}</span>
                <button type="button" className="ui-tb__icon" aria-label="Close details" onClick={() => setOpenId(null)}>
                  <Icon d="m4 4 8 8M12 4l-8 8" />
                </button>
              </div>
              <textarea
                className="ui-tb__title-input"
                value={open.title}
                rows={2}
                onChange={(e) => update(open.id, { title: e.target.value })}
                aria-label="Title"
              />
              <dl className="ui-tb__fields">
                <dt>Status</dt>
                <dd className="ui-tb__choices">
                  {statuses.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="ui-tb__choice"
                      aria-pressed={open.status === s.id}
                      onClick={() => update(open.id, { status: s.id })}
                    >
                      <span className="ui-tb__status">{s.icon}</span>
                      {s.label}
                    </button>
                  ))}
                </dd>
                <dt>Priority</dt>
                <dd className="ui-tb__choices">
                  {[4, 3, 2, 1, 0].map((p) => (
                    <button
                      key={p}
                      type="button"
                      className="ui-tb__choice"
                      aria-pressed={open.priority === p}
                      onClick={() => update(open.id, { priority: p as Task["priority"] })}
                    >
                      <PriorityIcon level={p} />
                      {priorityNames[p]}
                    </button>
                  ))}
                </dd>
                <dt>Labels</dt>
                <dd className="ui-tb__choices">
                  {labels.map((l) => {
                    const on = open.labels.includes(l.id);
                    return (
                      <button
                        key={l.id}
                        type="button"
                        className="ui-tb__choice"
                        aria-pressed={on}
                        onClick={() =>
                          update(open.id, { labels: on ? open.labels.filter((x) => x !== l.id) : [...open.labels, l.id] })
                        }
                      >
                        <span className="ui-tb__swatch ui-tb__swatch--dot" style={{ background: l.color }} />
                        {l.label}
                      </button>
                    );
                  })}
                </dd>
                <dt>Assignee</dt>
                <dd className="ui-tb__choices">
                  {people.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="ui-tb__choice"
                      aria-pressed={open.assignee === p.id}
                      onClick={() => update(open.id, { assignee: open.assignee === p.id ? undefined : p.id })}
                    >
                      <Avatar person={p} size={16} />
                      {p.name.split(" ")[0]}
                    </button>
                  ))}
                </dd>
              </dl>
              <div className="ui-tb__panel-foot">
                <span>Created {open.created}</span>
                <button
                  type="button"
                  className="ui-tb__delete"
                  onClick={() => {
                    setTasks(tasks.filter((t) => t.id !== open.id));
                    setOpenId(null);
                  }}
                >
                  Delete task
                </button>
              </div>
            </>
          )}
        </aside>
      </section>
    </>
  );
}

/* ---------- Small parts ---------- */

function Avatar({ person, size }: { person: TaskPerson; size: number }) {
  return person.avatar ? (
    <img className="ui-tb__avatar" src={person.avatar} alt={person.name} title={person.name} width={size} height={size} loading="lazy" />
  ) : (
    <span className="ui-tb__avatar ui-tb__avatar--initials" style={{ width: size, height: size }} title={person.name}>
      {person.name[0]}
    </span>
  );
}

/** Three rising bars – filled up to the level; urgent is a small alert square */
function PriorityIcon({ level }: { level: number }) {
  if (level === 4) {
    return (
      <svg className="ui-tb__prio" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
        <rect x="1" y="1" width="12" height="12" rx="3" fill="#ec4899" />
        <path d="M7 3.8v4M7 9.9v.3" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg className="ui-tb__prio" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 4} y={9 - i * 3} width="2.4" height={3 + i * 3} rx="0.8" className={level > i ? "ui-tb__prio-on" : "ui-tb__prio-off"} />
      ))}
    </svg>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const c = 2 * Math.PI * 5;
  return (
    <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
      <circle className="ui-tb__ring-track" cx="7" cy="7" r="5" fill="none" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r="5"
        fill="none"
        stroke="#2f6bff"
        strokeWidth="2"
        strokeDasharray={`${(done / Math.max(1, total)) * c} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

const Chevron = () => <Icon d="m6 4 4 4-4 4" size={12} />;
const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
    <path
      d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6Z"
      fill={filled ? "#f5b400" : "none"}
      stroke={filled ? "#f5b400" : "currentColor"}
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-tb {
  --ui-tb-tray: #f6f6f6;
  --ui-tb-card: #ffffff;
  --ui-tb-line: #ececec;
  --ui-tb-ink: #171717;
  --ui-tb-text: #404040;
  --ui-tb-muted: #8f8f8f;
  --ui-tb-accent: #2f6bff;
  --ui-tb-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  container-type: inline-size;
  background: #fff;
  border: 1px solid #e5e5e5;
  border-radius: 20px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-tb-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-tb *, .ui-tb *::before, .ui-tb *::after { box-sizing: border-box; }
.ui-tb button { margin: 0; font: inherit; color: inherit; cursor: pointer; }
.ui-tb button:focus-visible, .ui-tb [tabindex]:focus-visible { outline: 2px solid var(--ui-tb-accent); outline-offset: 2px; }

.ui-tb__top {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 0 14px 0 18px;
  border-bottom: 1px solid var(--ui-tb-line);
}
.ui-tb__crumbs { display: flex; align-items: center; gap: 6px; font-size: 14px; }
.ui-tb__logo { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; margin-right: 4px; }
.ui-tb__logo i { width: 3px; border-radius: 1px; background: var(--ui-tb-accent); }
.ui-tb__logo i:nth-child(1) { height: 6px; opacity: 0.45; }
.ui-tb__logo i:nth-child(2) { height: 10px; opacity: 0.7; }
.ui-tb__logo i:nth-child(3) { height: 14px; }
.ui-tb__crumb { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; color: var(--ui-tb-muted); }
/* Phone width: only the last two steps of the path, so the breadcrumb stays on one line */
@container (max-width: 420px) {
  .ui-tb__crumb:not(:nth-last-of-type(-n + 2)) { display: none; }
}
.ui-tb__crumb svg { color: #c4c4c4; }
.ui-tb__crumb[aria-current] { color: var(--ui-tb-ink); font-weight: 500; }

.ui-tb__icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-tb-muted) !important;
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-tb__icon:hover { background: #f3f3f3; color: var(--ui-tb-ink) !important; }
.ui-tb__icon[aria-pressed="true"], .ui-tb__icon[data-active] { background: #eef3ff; color: var(--ui-tb-accent) !important; }
.ui-tb__dot { position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-tb-accent); }

.ui-tb__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 46px;
  padding: 0 12px 0 18px;
}
.ui-tb__count { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--ui-tb-text); }
.ui-tb__count span { color: var(--ui-tb-muted); }
.ui-tb__tools { display: flex; align-items: center; gap: 4px; }
.ui-tb__search {
  display: flex;
  align-items: center;
  gap: 6px;
  width: clamp(110px, 30vw, 170px);
  height: 30px;
  margin-right: 4px;
  padding: 0 10px;
  border-radius: 9px;
  background: #f5f5f5;
  color: var(--ui-tb-muted);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.ui-tb__search:focus-within { background: #fff; box-shadow: 0 0 0 1px var(--ui-tb-accent), 0 0 0 3px rgba(47, 107, 255, 0.12); }
.ui-tb__search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: inherit; font-size: 13px; color: var(--ui-tb-ink); }
.ui-tb__search input::-webkit-search-cancel-button { display: none; }
.ui-tb__menu-wrap { position: relative; }
.ui-tb__menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 8;
  display: grid;
  gap: 2px;
  min-width: 180px;
  padding: 6px 4px 4px;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 0 0 1px #e5e5e5, 0 12px 30px -8px rgba(0, 0, 0, 0.2);
  animation: ui-tb-drop 180ms var(--ui-tb-ease);
}
.ui-tb__menu-title { margin: 0 0 2px; padding: 0 10px; font-size: 11.5px; color: var(--ui-tb-muted); }
.ui-tb__menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font-size: 13px !important;
  text-align: left;
}
.ui-tb__menu-item svg { margin-left: auto; color: var(--ui-tb-accent); }
.ui-tb__menu-item:hover { background: #f5f5f5; }
.ui-tb__menu-clear { color: var(--ui-tb-muted) !important; }
.ui-tb__swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.ui-tb__swatch--dot { border-radius: 50%; }
.ui-tb__prio-on { fill: #525252; }
.ui-tb__prio-off { fill: #d4d4d4; }
.ui-tb__ring-track { stroke: #e0e0e0; }

/* Columns: gray lanes like our trays, white cards on top */
.ui-tb__columns {
  display: grid;
  grid-auto-columns: minmax(224px, 1fr);
  grid-auto-flow: column;
  gap: 10px;
  padding: 0 12px 12px;
  overflow-x: auto;
  scrollbar-width: thin;
}
.ui-tb__column {
  display: flex;
  flex-direction: column;
  min-height: 300px;
  padding: 4px 6px 6px;
  border-radius: 16px;
  background: var(--ui-tb-tray);
  transition: background-color 160ms ease, box-shadow 160ms ease;
}
.ui-tb__column[data-over] { background: #eaeffc; box-shadow: inset 0 0 0 1px #cddbff; }
.ui-tb__col-head { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 4px 0 8px; }
.ui-tb__col-title { font-size: 13.5px; font-weight: 500; }
.ui-tb__col-count { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-tb-muted); }
.ui-tb__add { margin-left: auto; }
.ui-tb__status { display: grid; place-items: center; flex: none; width: 15px; height: 15px; }
.ui-tb__status svg { width: 15px; height: 15px; }
.ui-tb__cards { display: grid; align-content: start; gap: 6px; flex: 1; }
.ui-tb__slot { display: grid; gap: 6px; }

.ui-tb__card {
  padding: 10px 12px 11px;
  border-radius: 12px;
  background: var(--ui-tb-card);
  box-shadow: 0 0 0 1px #e8e8e8, 0 1px 2px rgba(0, 0, 0, 0.04);
  cursor: grab;
  animation: ui-tb-in 320ms var(--ui-tb-ease) both;
  transition: box-shadow 160ms ease, opacity 160ms ease, transform 200ms var(--ui-tb-ease);
}
.ui-tb__card:hover { box-shadow: 0 0 0 1px #dcdcdc, 0 6px 16px -8px rgba(0, 0, 0, 0.14); }
.ui-tb__card:active { cursor: grabbing; }
.ui-tb__card[data-dragging] { opacity: 0.35; transform: scale(0.98); }
.ui-tb__card-top { display: flex; align-items: center; justify-content: space-between; min-height: 18px; }
.ui-tb__key { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--ui-tb-muted); }
.ui-tb__avatar { flex: none; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06); }
.ui-tb__avatar--initials { display: grid; place-items: center; background: #eef3ff; font-size: 9px; font-weight: 600; color: var(--ui-tb-accent); }
.ui-tb__card-title { display: flex; gap: 8px; margin: 4px 0 0; font-size: 13.5px; font-weight: 450; line-height: 19px; }
.ui-tb__card-title .ui-tb__status { margin-top: 2px; }
.ui-tb__props { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 9px; }
.ui-tb__prop {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 7px;
  border-radius: 7px;
  box-shadow: inset 0 0 0 1px #ebebeb;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--ui-tb-text);
}
.ui-tb__prop svg { flex: none; color: var(--ui-tb-muted); }
.ui-tb__prop[data-tone="soon"] { color: #b45309; }
.ui-tb__prop[data-tone="soon"] svg { color: #f59e0b; }
.ui-tb__prop[data-tone="late"] { color: #db2777; background: #fff5f9; box-shadow: inset 0 0 0 1px #fde0ec; }
.ui-tb__prop[data-tone="late"] svg { color: #ec4899; }
.ui-tb__created { margin: 9px 0 0; font-size: 11.5px; color: var(--ui-tb-muted); }
.ui-tb[data-compact] .ui-tb__props, .ui-tb[data-compact] .ui-tb__created { display: none; }

.ui-tb__drop { display: block; height: 3px; margin: -1px 4px; border-radius: 2px; background: var(--ui-tb-accent); animation: ui-tb-grow 160ms var(--ui-tb-ease); }
.ui-tb__empty {
  display: grid;
  place-items: center;
  height: 80px;
  margin: 0;
  border: 1px dashed #d9d9d9;
  border-radius: 12px;
  font-size: 12.5px;
  color: var(--ui-tb-muted);
}
.ui-tb__new input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 12px;
  outline: none;
  background: #fff;
  box-shadow: 0 0 0 1px var(--ui-tb-accent), 0 0 0 3px rgba(47, 107, 255, 0.12);
  font: inherit;
  font-size: 13.5px;
}

/* Detail panel */
.ui-tb__scrim {
  position: absolute;
  inset: 0;
  z-index: 9;
  background: rgba(23, 23, 23, 0.08);
  opacity: 0;
  pointer-events: none;
  transition: opacity 240ms ease;
}
.ui-tb__scrim[data-open] { opacity: 1; pointer-events: auto; }
.ui-tb__panel {
  position: absolute;
  top: 8px;
  right: 8px;
  bottom: 8px;
  z-index: 10;
  display: flex;
  flex-direction: column;
  width: min(360px, calc(100% - 16px));
  padding: 14px 16px 14px;
  overflow-y: auto;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 0 0 1px #e5e5e5, 0 20px 50px -12px rgba(0, 0, 0, 0.25);
  transform: translateX(calc(100% + 24px));
  transition: transform 380ms var(--ui-tb-ease);
}
.ui-tb__panel[data-open] { transform: none; }
.ui-tb__panel-head { display: flex; align-items: center; justify-content: space-between; }
.ui-tb__title-input {
  margin: 8px -6px 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 8px;
  outline: none;
  resize: none;
  font: inherit;
  font-size: 17px;
  font-weight: 600;
  line-height: 23px;
  color: var(--ui-tb-ink);
}
.ui-tb__title-input:focus { background: #f7f7f7; }
.ui-tb__fields { display: grid; gap: 6px; margin: 14px 0 0; }
.ui-tb__fields dt { margin-top: 8px; font-size: 12px; color: var(--ui-tb-muted); }
.ui-tb__fields dd { margin: 0; }
.ui-tb__choices { display: flex; flex-wrap: wrap; gap: 5px; }
.ui-tb__choice {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: #fff;
  box-shadow: inset 0 0 0 1px #e8e8e8;
  font-size: 12.5px !important;
  color: var(--ui-tb-text) !important;
  transition: background-color 140ms ease, box-shadow 140ms ease;
}
.ui-tb__choice:hover { background: #f7f7f7; }
.ui-tb__choice[aria-pressed="true"] { background: #eef3ff; box-shadow: inset 0 0 0 1px #cddbff; color: var(--ui-tb-ink) !important; }
.ui-tb__panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 16px;
  font-size: 12px;
  color: var(--ui-tb-muted);
}
.ui-tb__delete { height: 28px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; font-size: 12.5px !important; color: #e5484d !important; }
.ui-tb__delete:hover { background: #fff1f1; }

@keyframes ui-tb-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-tb-drop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-tb-grow { from { transform: scaleX(0.6); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-tb__card, .ui-tb__menu, .ui-tb__drop { animation: none; }
  .ui-tb__panel, .ui-tb__scrim, .ui-tb__card { transition: none; }
}


/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-tb input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-tb textarea:focus-visible,
.ui-tb [contenteditable]:focus-visible { outline: none; }
/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-tb {
  --ui-tb-tray: #161618;
  --ui-tb-card: #232326;
  --ui-tb-line: rgba(255, 255, 255, 0.08);
  --ui-tb-ink: #ededed;
  --ui-tb-text: #c4c4c4;
  --ui-tb-muted: #8f8f8f;
  background: #232326;
  border-color: rgba(255, 255, 255, 0.08);
}
:where(.dark, [data-theme="dark"]) .ui-tb__crumb svg { color: #6b6b70; }
:where(.dark, [data-theme="dark"]) .ui-tb__icon:hover { background: rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) .ui-tb__icon[aria-pressed="true"],
:where(.dark, [data-theme="dark"]) .ui-tb__icon[data-active] { background: rgba(47, 107, 255, 0.16); color: #6b95ff !important; }
:where(.dark, [data-theme="dark"]) .ui-tb__search { background: #2a2a2d; }
:where(.dark, [data-theme="dark"]) .ui-tb__search:focus-within { background: #2a2a2d; box-shadow: 0 0 0 1px var(--ui-tb-accent), 0 0 0 3px rgba(47, 107, 255, 0.24); }
:where(.dark, [data-theme="dark"]) .ui-tb__menu { background: #2a2a2d; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 12px 30px -8px rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) .ui-tb__menu-item:hover { background: rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) .ui-tb__menu-item svg { color: #6b95ff; }
:where(.dark, [data-theme="dark"]) .ui-tb__column[data-over] { background: rgba(47, 107, 255, 0.12); box-shadow: inset 0 0 0 1px rgba(47, 107, 255, 0.4); }
:where(.dark, [data-theme="dark"]) .ui-tb__card { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.4); }
:where(.dark, [data-theme="dark"]) .ui-tb__card:hover { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.14), 0 6px 16px -8px rgba(0, 0, 0, 0.5); }
:where(.dark, [data-theme="dark"]) .ui-tb__avatar { box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); }
:where(.dark, [data-theme="dark"]) .ui-tb__avatar--initials { background: rgba(47, 107, 255, 0.16); color: #6b95ff; }
:where(.dark, [data-theme="dark"]) .ui-tb__prop { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
:where(.dark, [data-theme="dark"]) .ui-tb__prop[data-tone="soon"] { color: #fbbf24; }
:where(.dark, [data-theme="dark"]) .ui-tb__prop[data-tone="late"] { color: #f472b6; background: rgba(236, 72, 153, 0.14); box-shadow: inset 0 0 0 1px rgba(236, 72, 153, 0.28); }
:where(.dark, [data-theme="dark"]) .ui-tb__prio-on { fill: #c4c4c4; }
:where(.dark, [data-theme="dark"]) .ui-tb__prio-off { fill: #4a4a4f; }
:where(.dark, [data-theme="dark"]) .ui-tb__ring-track { stroke: rgba(255, 255, 255, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-tb__empty { border-color: rgba(255, 255, 255, 0.14); }
:where(.dark, [data-theme="dark"]) .ui-tb__new input { background: #2a2a2d; color: var(--ui-tb-ink); box-shadow: 0 0 0 1px var(--ui-tb-accent), 0 0 0 3px rgba(47, 107, 255, 0.24); }
:where(.dark, [data-theme="dark"]) .ui-tb__scrim { background: rgba(0, 0, 0, 0.4); }
:where(.dark, [data-theme="dark"]) .ui-tb__panel { background: #232326; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1), 0 20px 50px -12px rgba(0, 0, 0, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-tb__title-input { background: transparent; }
:where(.dark, [data-theme="dark"]) .ui-tb__title-input:focus { background: #2a2a2d; }
:where(.dark, [data-theme="dark"]) .ui-tb__choice { background: #2a2a2d; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08); }
:where(.dark, [data-theme="dark"]) .ui-tb__choice:hover { background: #313135; }
:where(.dark, [data-theme="dark"]) .ui-tb__choice[aria-pressed="true"] { background: rgba(47, 107, 255, 0.16); box-shadow: inset 0 0 0 1px rgba(47, 107, 255, 0.45); }
:where(.dark, [data-theme="dark"]) .ui-tb__delete { color: #ff6b70 !important; }
:where(.dark, [data-theme="dark"]) .ui-tb__delete:hover { background: rgba(229, 72, 77, 0.14); }
`;
