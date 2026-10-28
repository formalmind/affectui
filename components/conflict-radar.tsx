"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Conflict Radar (classic) – several agents working on their own branches at once, and where they get in each other's way,
 * in a single self-contained file.
 * A gray tray with the title and Merge on it, and two white cards: a row per file and a column per agent. A short bar fills in as soon as an agent touches a file. When
 * two agents change the same lines, their bars turn amber and a line runs between them – a conflict, seen before anyone
 * merges. Below, the conflict in focus lists each agent's way of solving it in one sentence; click one to keep it.
 * Merge sits in the bar and says what it still waits for, until every conflict is settled and the agents are done.
 * Rows never change height: a file's state swaps in place, and the list below keeps its size.
 * The data is yours: pass agents and the files with each agent's edit – the component finds the overlaps itself.
 * The styles are injected below, so no extra files are needed.
 */

export type RadarAgent = {
  id: string;
  name: string;
  /** Model or branch, shown in the agent's tooltip */
  model?: string;
  /** A small mark – defaults to the initials on a soft tile */
  avatar?: ReactNode;
  /** Defaults to running */
  status?: "running" | "done";
};

export type RadarEdit = {
  agentId: string;
  /** The lines it changes, first and last */
  lines: [number, number];
  /** How it solves it, one sentence – shown when this edit is part of a conflict */
  summary?: string;
  /** It's writing in this file right now */
  active?: boolean;
};

export type RadarFile = {
  path: string;
  edits: RadarEdit[];
};

export type ConflictRadarProps = {
  agents: RadarAgent[];
  files: RadarFile[];
  /** Heading in the bar */
  title?: string;
  /** The picked agent per conflicting file – pass it with onResolve to control it, leave it out and the component keeps it */
  resolved?: Record<string, string>;
  onResolve?: (path: string, agentId: string) => void;
  /** Merge was clicked – only possible once every conflict is settled and every agent is done */
  onMerge?: () => void;
  className?: string;
};

type Conflict = { agents: string[]; from: number; to: number };

/** Edits in the same file whose lines overlap – every agent in such a pair is part of the conflict */
const conflictOf = (file: RadarFile): Conflict | null => {
  const ids = new Set<string>();
  let from = Infinity;
  let to = -Infinity;
  file.edits.forEach((a, i) =>
    file.edits.slice(i + 1).forEach((b) => {
      if (a.agentId === b.agentId || a.lines[0] > b.lines[1] || b.lines[0] > a.lines[1]) return;
      ids.add(a.agentId).add(b.agentId);
      from = Math.min(from, a.lines[0], b.lines[0]);
      to = Math.max(to, a.lines[1], b.lines[1]);
    }),
  );
  return ids.size ? { agents: [...ids], from, to } : null;
};

/** First and last word that start with a letter, skipping suffixes like "III" – whole characters, so an emoji never splits */
const SUFFIX = /^(jr|sr|ii|iii|iv)\.?$/i;
const initials = (name: string) => {
  const words = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w) && !SUFFIX.test(w));
  const pick = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return pick.map((w) => Array.from(w)[0]).join("").toUpperCase() || Array.from(name.trim())[0] || "?";
};
const LABEL = { edit: "Changed", conflict: "Conflict", kept: "Kept", lost: "Left out" } as const;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const split = (path: string) => {
  const i = path.lastIndexOf("/") + 1;
  return [path.slice(0, i), path.slice(i)];
};

/** Rings of a radar with one blip */
const Radar = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.3" opacity="0.45" />
    <circle cx="8" cy="8" r="3.3" stroke="currentColor" strokeWidth="1.3" opacity="0.7" />
    <path d="M8 8 12.6 3.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="11.2" cy="10.6" r="1.3" fill="currentColor" />
  </svg>
);

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.8 6.3 2.1 2.1 4.3-4.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** What the bar colors mean – in the head row, or under the files where the head row is too narrow */
const Legend = ({ place }: { place: "head" | "foot" }) => (
  <span className="ui-cr__legend" data-place={place} aria-hidden="true">
    {(
      [
        ["edit", "Changed"],
        ["conflict", "Conflict"],
        ["kept", "Kept"],
      ] as const
    ).map(([role, label]) => (
      <span key={role}>
        <span className="ui-cr__bar-s" data-role={role} data-key="" />
        {label}
      </span>
    ))}
  </span>
);

const Avatar = ({ agent }: { agent?: RadarAgent }) => (
  <span className="ui-cr__avatar" data-logo={agent?.avatar ? "" : undefined}>
    {agent?.avatar ?? initials(agent?.name ?? "?")}
  </span>
);

export function ConflictRadar({ agents, files, title = "Parallel work", resolved: resolvedProp, onResolve, onMerge, className }: ConflictRadarProps) {
  const [ownResolved, setOwnResolved] = useState<Record<string, string>>({});
  const resolved = resolvedProp ?? ownResolved;
  // The conflict you opened – without one, the first that's still open
  const [focus, setFocus] = useState<string | null>(null);
  const advance = useRef(0);
  useEffect(() => () => window.clearTimeout(advance.current), []);

  const rows = files.map((f) => {
    const conflict = conflictOf(f);
    const pick = conflict && conflict.agents.includes(resolved[f.path]) ? resolved[f.path] : undefined;
    return { file: f, conflict, pick, state: conflict ? (pick ? "settled" : "conflict") : "clean" } as const;
  });
  const open = rows.filter((r) => r.state === "conflict");
  const conflicts = rows.filter((r) => r.conflict);
  const shown = rows.find((r) => r.conflict && r.file.path === focus) ?? open[0] ?? conflicts[conflicts.length - 1];
  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const running = agents.filter((a) => (a.status ?? "running") === "running").length;
  const branches = agents.filter((a) => files.some((f) => f.edits.some((e) => e.agentId === a.id))).length;
  const ready = open.length === 0 && running === 0 && branches > 0;

  const pick = (path: string, agentId: string) => {
    if (resolvedProp === undefined) setOwnResolved((r) => ({ ...r, [path]: agentId }));
    onResolve?.(path, agentId);
    // Stay on it for a beat, so the choice is seen – then on to the next open conflict
    setFocus(path);
    window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => setFocus(null), 700);
  };

  return (
    <div className={["ui-cr", className].filter(Boolean).join(" ")} style={{ ["--ui-cr-n" as string]: agents.length }}>
      <style href="ui-conflict-radar" precedence="default">
        {css}
      </style>
      <header className="ui-cr__bar">
        <span className="ui-cr__radar">
          <Radar />
        </span>
        <span className="ui-cr__title">{title}</span>
        <button type="button" className="ui-cr__merge" data-ready={ready || undefined} disabled={!ready} onClick={onMerge}>
          <span key={ready ? "ready" : open.length ? `open${open.length}` : "wait"}>
            {open.length ? `${plural(open.length, "conflict")} to settle` : running ? `Waiting for ${plural(running, "agent")}` : branches ? `Merge ${plural(branches, "branch", "branches")}` : "Nothing to merge"}
          </span>
        </button>
      </header>

      <div className="ui-cr__card">
        <div className="ui-cr__grid" role="table" aria-label="Files by agent">
          <div className="ui-cr__row" data-head="" role="row">
            <span className="ui-cr__file" role="columnheader">
              <span className="ui-cr__sr">File</span>
              <Legend place="head" />
            </span>
            <span className="ui-cr__cells">
              {agents.map((a, i) => {
                const working = (a.status ?? "running") === "running";
                // Its numbers: files it changed, conflicts still open with it, and how often its way was kept
                const touched = rows.filter((r) => r.file.edits.some((e) => e.agentId === a.id));
                const kpis = [
                  ["files", touched.length],
                  ["conflicts", touched.filter((r) => r.state === "conflict" && r.conflict!.agents.includes(a.id)).length],
                  ["kept", touched.filter((r) => r.pick === a.id).length],
                ] as const;
                const word = { files: ["File", "Files"], conflicts: ["Conflict", "Conflicts"], kept: ["Kept", "Kept"] } as const;
                return (
                  <span key={a.id} className="ui-cr__head" role="columnheader" data-status={working ? "running" : "done"} data-last={i === agents.length - 1 || undefined}>
                    <Avatar agent={a} />
                    <span className="ui-cr__hname" title={a.name}>
                      {a.name}
                    </span>
                    <span className="ui-cr__sr">{working ? ", working" : ", done"}</span>
                    <span className="ui-cr__kpi" aria-hidden="true">
                      <span className="ui-cr__kpitop">
                        <Avatar agent={a} />
                        <b>{a.name}</b>
                        <span className="ui-cr__kpistate">{working ? "Working" : "Done"}</span>
                      </span>
                      {a.model && <span className="ui-cr__kpimodel">{a.model}</span>}
                      <span className="ui-cr__kpis">
                        {kpis.map(([key, value]) => (
                          <span key={key} data-kpi={key} data-zero={value === 0 || undefined}>
                            <b>{value}</b>
                            {word[key][value === 1 ? 0 : 1]}
                          </span>
                        ))}
                      </span>
                    </span>
                  </span>
                );
              })}
            </span>
          </div>

          {rows.map(({ file, conflict, pick: kept, state }, r) => {
            const [dir, name] = split(file.path);
            const cols = conflict ? conflict.agents.map((id) => agents.findIndex((a) => a.id === id)).filter((i) => i >= 0) : [];
            const inner = (
              <>
                <span className="ui-cr__file" role="cell">
                  <span className="ui-cr__dot" data-state={state} aria-hidden="true" />
                  <span className="ui-cr__sr">{state === "conflict" ? "Conflict: " : state === "settled" ? "Settled: " : ""}</span>
                  <span className="ui-cr__path" title={file.path}>
                    <span className="ui-cr__dir">{dir}</span>
                    <span className="ui-cr__fname">{name}</span>
                  </span>
                </span>
                <span className="ui-cr__cells">
                  {cols.length > 1 && (
                    <span key={conflict!.agents.join()} className="ui-cr__link" style={{ ["--a" as string]: Math.min(...cols), ["--b" as string]: Math.max(...cols) }} aria-hidden="true" />
                  )}
                  {agents.map((ag, i) => {
                    const e = file.edits.find((x) => x.agentId === ag.id);
                    const inConflict = conflict?.agents.includes(ag.id);
                    const role = !e ? "none" : kept && inConflict ? (kept === ag.id ? "kept" : "lost") : inConflict ? "conflict" : "edit";
                    const writing = e?.active && !kept;
                    const others = inConflict && !kept ? conflict!.agents.filter((id) => id !== ag.id).map((id) => agentOf(id)?.name ?? id) : [];
                    return (
                      <span key={ag.id} className="ui-cr__cell" role="cell" data-last={i === agents.length - 1 || undefined}>
                        <span className="ui-cr__bar-s" data-role={role} data-active={writing || undefined} />
                        {e && (
                          // Pointing at a bar: who, what happened there and which lines
                          <span className="ui-cr__tip" data-role={role}>
                            <span className="ui-cr__tiptop">
                              <b>{ag.name}</b>
                              <span className="ui-cr__tipstate">{writing ? "Writing…" : LABEL[role as Exclude<typeof role, "none">]}</span>
                            </span>
                            <span className="ui-cr__tipmeta">
                              Lines {e.lines[0]}–{e.lines[1]}
                              {others.length > 0 && ` · overlaps ${others.join(", ")}`}
                            </span>
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
              </>
            );
            return conflict ? (
              <button key={file.path} type="button" role="row" className="ui-cr__row" data-state={state} data-alt={r % 2 === 1 || undefined} aria-pressed={shown?.file.path === file.path} onClick={() => setFocus(file.path)}>
                {inner}
              </button>
            ) : (
              <div key={file.path} role="row" className="ui-cr__row" data-state={state} data-alt={r % 2 === 1 || undefined}>
                {inner}
              </div>
            );
          })}
          <Legend place="foot" />
        </div>
      </div>

      <div className="ui-cr__card">
        <section className="ui-cr__pick" aria-live="polite">
          {shown?.conflict ? (
            <>
              <div className="ui-cr__phead" key={shown.file.path}>
                <span className="ui-cr__ptitle">{shown.state === "settled" ? "Settled" : "Pick a way"}</span>
                <span className="ui-cr__where">
                  {split(shown.file.path)[1]} · lines {shown.conflict.from}–{shown.conflict.to}
                </span>
              </div>
              <div className="ui-cr__ways" key={`${shown.file.path}-ways`} role="radiogroup" aria-label={`Ways to settle ${shown.file.path}`}>
                {shown.conflict.agents.map((id) => {
                  const ag = agentOf(id);
                  const e = shown.file.edits.find((x) => x.agentId === id);
                  const kept = shown.pick === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={kept} className="ui-cr__way" data-lost={(shown.pick && !kept) || undefined} onClick={() => pick(shown.file.path, id)}>
                      <span className="ui-cr__wtop">
                        <Avatar agent={ag} />
                        <span className="ui-cr__wname" title={ag?.name ?? id}>
                          {ag?.name ?? id}
                        </span>
                        {kept && (
                          <span className="ui-cr__kept">
                            <Check /> Kept
                          </span>
                        )}
                      </span>
                      <span className="ui-cr__summary">{e?.summary ?? (e ? `Changes lines ${e.lines[0]}–${e.lines[1]}` : "")}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ui-cr__calm">{running ? `Watching ${plural(running, "agent")} for overlaps` : branches ? "No overlaps – the branches merge cleanly" : "No changes yet"}</div>
          )}
        </section>
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-cr */
.ui-cr {
  --ui-cr-tray: #f0f0f0;
  --ui-cr-card: #ffffff;
  --ui-cr-strong: #171717;
  --ui-cr-ink: #171717;
  --ui-cr-text: #6b6b6b;
  --ui-cr-muted: #8a8a8a;
  --ui-cr-faint: #c2c2c2;
  --ui-cr-line: #ececec;
  --ui-cr-fill: rgba(0, 0, 0, 0.05);
  --ui-cr-hover: #fafafa;
  --ui-cr-select: #f5f5f5;
  --ui-cr-zebra: #fcfcfc;
  --ui-cr-pressed: #f2f2f2;
  /* Bars: a tint, its edge and the ink */
  --ui-cr-edit-bg: #e3ecff;
  --ui-cr-edit-edge: #a9c2ff;
  --ui-cr-edit-ink: #2456d6;
  --ui-cr-hit-bg: #fde3cf;
  --ui-cr-hit-edge: #f0a56d;
  --ui-cr-hit: #c2410c;
  --ui-cr-hit-row: #fff6ef;
  --ui-cr-ok-bg: #dcf3e4;
  --ui-cr-ok-edge: #9fd9b4;
  --ui-cr-ok: #1a7f45;
  --ui-cr-ok-tag: #1f9a55;
  --ui-cr-ok-tag-bg: #e6f6ec;
  --ui-cr-accent: #2f6bff;
  --ui-cr-focus: rgba(23, 23, 23, 0.22);
  --ui-cr-chip: #171717;
  --ui-cr-chip-ink: #ffffff;
  --ui-cr-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-cr-pop: 0 0 0 1px #ececec, 0 8px 24px -6px rgba(0, 0, 0, 0.16);
  --ui-cr-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 560px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-cr-tray);
  container: ui-cr / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-cr-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-cr *, .ui-cr *::before, .ui-cr *::after { box-sizing: border-box; }
:where(.ui-cr) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-cr button:focus-visible { outline: 2px solid var(--ui-cr-focus); outline-offset: -2px; }
.ui-cr svg { display: block; flex: none; }
.ui-cr__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* White cards on the tray */
.ui-cr__card { --ui-cr-col: 104px; --ui-cr-file: 216px; border-radius: 16px; background: var(--ui-cr-card); box-shadow: var(--ui-cr-shadow); overflow: hidden; }
.ui-cr__card + .ui-cr__card { margin-top: 4px; }

/* ----- On the tray: what it is, and Merge saying what it waits for ----- */
.ui-cr__bar { display: flex; align-items: center; gap: 10px; min-width: 0; height: 44px; padding: 0 8px 4px 14px; }
.ui-cr__radar { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-cr-accent); }
.ui-cr__title { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-cr-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-cr__merge { flex: none; height: 26px; padding: 0 10px; border-radius: 9px; font-size: 13px; line-height: 18px; background: var(--ui-cr-card); box-shadow: var(--ui-cr-shadow); font-weight: 600; color: var(--ui-cr-muted); white-space: nowrap; transition: background-color 240ms ease, color 240ms ease, box-shadow 240ms ease; }
.ui-cr__merge > span { display: block; animation: ui-cr-swap 320ms var(--ui-cr-ease); }
.ui-cr__merge:disabled { cursor: default; }
.ui-cr__merge[data-ready] { background: var(--ui-cr-chip); box-shadow: none; color: var(--ui-cr-chip-ink); }
.ui-cr__merge[data-ready]:hover { opacity: 0.9; }

/* ----- Files × agents: one fixed row per file ----- */
.ui-cr__grid { display: grid; }
/* A table: hairlines between the rows and the columns, every second row on a light gray */
/* The file column keeps room for its names (and the legend above them); the agent columns give way when there are many */
.ui-cr__row { display: grid; grid-template-columns: minmax(var(--ui-cr-file), 1fr) minmax(0, calc(var(--ui-cr-n) * var(--ui-cr-col))); align-items: center; width: 100%; height: 36px; border-top: 1px solid var(--ui-cr-line); transition: background-color 160ms ease; }
.ui-cr__row[data-head] { height: 32px; border-top: 0; }
.ui-cr__row[data-alt] { background: var(--ui-cr-zebra); }
button.ui-cr__row:hover { background: var(--ui-cr-select); }
button.ui-cr__row[aria-pressed="true"] { background: var(--ui-cr-pressed); }
/* The open conflict whose ways are below: a light wash of the conflict color */
button.ui-cr__row[aria-pressed="true"][data-state="conflict"] { background: var(--ui-cr-hit-row); }
.ui-cr__file { display: flex; align-items: center; gap: 10px; min-width: 0; height: 100%; padding: 0 12px 0 16px; }
.ui-cr__dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-cr-fill); transition: background-color 300ms ease; }
.ui-cr__dot[data-state="conflict"] { background: var(--ui-cr-hit); }
.ui-cr__dot[data-state="settled"] { background: var(--ui-cr-ok); }
.ui-cr__path { display: flex; min-width: 0; color: var(--ui-cr-ink); white-space: nowrap; }
/* A long path gives up its folders first, so the file name stays readable */
.ui-cr__dir, .ui-cr__fname { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-cr__dir { flex: 0 1000 auto; }
.ui-cr__fname { flex: 0 1 auto; }
.ui-cr__dir { color: var(--ui-cr-faint); }
.ui-cr__row[data-state="clean"] .ui-cr__path { color: var(--ui-cr-text); }

.ui-cr__cells { position: relative; display: grid; grid-template-columns: repeat(var(--ui-cr-n), minmax(0, 1fr)); align-items: center; height: 100%; }
.ui-cr__cells > :is(.ui-cr__head, .ui-cr__cell) { height: 100%; border-left: 1px solid var(--ui-cr-line); }
.ui-cr__head { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; padding: 0 12px; }
.ui-cr__hname { min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cr-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Pointing at an agent: a small card below its name with its numbers */
.ui-cr__head { position: relative; cursor: default; }
/* Each head measures itself: in a column too narrow for the name, only the mark stays (the name is on hover) */
.ui-cr__row[data-head] .ui-cr__head { container: ui-cr-head / inline-size; }
@container ui-cr-head (max-width: 72px) { .ui-cr__hname { display: none; } }
.ui-cr__head:hover { z-index: 4; }
.ui-cr__kpi {
  position: absolute;
  top: calc(100% - 2px);
  left: 50%;
  display: grid;
  gap: 2px;
  width: 232px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  background: var(--ui-cr-card);
  box-shadow: var(--ui-cr-pop);
  text-align: left;
  opacity: 0;
  transform: translate(-50%, -3px);
  pointer-events: none;
  transition: opacity 140ms ease, transform 180ms var(--ui-cr-ease);
}
.ui-cr__head[data-last] .ui-cr__kpi { left: auto; right: 6px; transform: translateY(-3px); }
.ui-cr__head:hover .ui-cr__kpi { opacity: 1; transform: translate(-50%, 0); transition-delay: 80ms; }
.ui-cr__head[data-last]:hover .ui-cr__kpi { transform: none; }
.ui-cr__kpitop { display: flex; align-items: flex-start; gap: 8px; min-width: 0; font-size: 13px; line-height: 20px; color: var(--ui-cr-ink); white-space: nowrap; }
.ui-cr__kpitop b { flex: 1; min-width: 0; font-weight: 600; white-space: normal; }
.ui-cr__kpistate { flex: none; height: 18px; padding: 0 6px; border-radius: 5px; background: var(--ui-cr-edit-bg); font-size: 11px; font-weight: 600; line-height: 18px; color: var(--ui-cr-edit-ink); }
.ui-cr__head[data-status="done"] .ui-cr__kpistate { background: var(--ui-cr-fill); color: var(--ui-cr-text); }
.ui-cr__kpimodel { overflow: hidden; padding-left: 26px; font-size: 11px; line-height: 16px; color: var(--ui-cr-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-cr__kpis { display: flex; gap: 6px; margin-top: 8px; }
.ui-cr__kpis > span { display: flex; flex: 1 1 auto; align-items: baseline; justify-content: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 6px; background: var(--ui-cr-hover); box-shadow: inset 0 0 0 1px var(--ui-cr-line); font-size: 11px; line-height: 24px; color: var(--ui-cr-muted); white-space: nowrap; }
.ui-cr__kpis b { font-size: 12px; font-weight: 600; color: var(--ui-cr-ink); font-variant-numeric: tabular-nums; }
.ui-cr__kpis [data-kpi="conflicts"]:not([data-zero]) b { color: var(--ui-cr-hit); }
.ui-cr__kpis [data-kpi="kept"]:not([data-zero]) b { color: var(--ui-cr-ok-tag); }
/* Still working: its mark breathes */
.ui-cr__head[data-status="running"] > .ui-cr__avatar { animation: ui-cr-breathe 1400ms ease-in-out infinite alternate; }
.ui-cr__avatar { display: grid; flex: none; place-items: center; width: 18px; height: 18px; overflow: hidden; border-radius: 5px; background: var(--ui-cr-fill); font-size: 9px; font-weight: 600; letter-spacing: 0.3px; color: var(--ui-cr-text); }
.ui-cr__avatar[data-logo] { background: var(--ui-cr-card); box-shadow: var(--ui-cr-shadow); }
.ui-cr__avatar > svg { width: 11px; height: 11px; }

/* A touched file: a short tinted bar that grows in from the left */
.ui-cr__cell { position: relative; z-index: 1; display: grid; place-items: center; height: 100%; }
.ui-cr__bar-s {
  position: relative;
  width: 32px;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  /* The tint sits on the card color, so a conflict line behind it never shows through */
  background: linear-gradient(var(--ui-cr-tint), var(--ui-cr-tint)) var(--ui-cr-card);
  box-shadow: inset 0 0 0 0.5px var(--ui-cr-edge);
  --ui-cr-tint: var(--ui-cr-edit-bg);
  --ui-cr-edge: var(--ui-cr-edit-edge);
  animation: ui-cr-grow 520ms var(--ui-cr-ease) both;
  transition: box-shadow 300ms ease, width 300ms var(--ui-cr-ease);
}
.ui-cr__bar-s[data-role="none"] { width: 4px; height: 4px; border-radius: 50%; --ui-cr-tint: var(--ui-cr-fill); --ui-cr-edge: transparent; animation: none; }
.ui-cr__bar-s[data-role="conflict"] { --ui-cr-tint: var(--ui-cr-hit-bg); --ui-cr-edge: var(--ui-cr-hit-edge); }
.ui-cr__bar-s[data-role="kept"] { --ui-cr-tint: var(--ui-cr-ok-bg); --ui-cr-edge: var(--ui-cr-ok-edge); }
.ui-cr__bar-s[data-role="lost"] { width: 12px; --ui-cr-tint: var(--ui-cr-fill); --ui-cr-edge: transparent; }
/* Still writing there: a sheen sweeps over it */
.ui-cr__bar-s[data-active]::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 14px; background: linear-gradient(90deg, transparent, var(--ui-cr-card), transparent); opacity: 0.8; animation: ui-cr-sheen 1300ms linear infinite; }

/* Pointing at a bar: a small card above it – who, what happened there and which lines */
.ui-cr__cell:hover { z-index: 3; }
.ui-cr__tip {
  position: absolute;
  bottom: calc(50% + 10px);
  left: 50%;
  display: grid;
  gap: 3px;
  width: max-content;
  max-width: 240px;
  padding: 7px 10px 8px;
  border-radius: 8px;
  background: var(--ui-cr-card);
  box-shadow: var(--ui-cr-pop);
  text-align: left;
  opacity: 0;
  transform: translate(-50%, 3px);
  pointer-events: none;
  transition: opacity 140ms ease, transform 180ms var(--ui-cr-ease);
}
.ui-cr__cell[data-last] .ui-cr__tip { left: auto; right: 8px; transform: translateY(3px); }
.ui-cr__cell:hover .ui-cr__tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 80ms; }
.ui-cr__cell[data-last]:hover .ui-cr__tip { transform: none; }
.ui-cr__tiptop { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 16px; color: var(--ui-cr-ink); white-space: nowrap; }
.ui-cr__tiptop b { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; }
.ui-cr__tipstate { flex: none; }
/* The state as a small tag in its color */
.ui-cr__tipstate { height: 18px; margin-right: -3px; padding: 0 6px; border-radius: 5px; background: var(--ui-cr-edit-bg); font-size: 11px; font-weight: 600; line-height: 18px; color: var(--ui-cr-edit-ink); }
.ui-cr__tip[data-role="conflict"] .ui-cr__tipstate { background: var(--ui-cr-hit-bg); color: var(--ui-cr-hit); }
.ui-cr__tip[data-role="kept"] .ui-cr__tipstate { background: var(--ui-cr-ok-tag-bg); color: var(--ui-cr-ok-tag); }
.ui-cr__tip[data-role="lost"] .ui-cr__tipstate { background: var(--ui-cr-fill); color: var(--ui-cr-text); }
.ui-cr__tipmeta { font-size: 11px; line-height: 16px; color: var(--ui-cr-muted); }

/* The legend: the same bars, small, each with its word */
.ui-cr__legend { display: flex; align-items: center; gap: 12px; min-width: 0; overflow: hidden; font-size: 11px; line-height: 16px; color: var(--ui-cr-muted); white-space: nowrap; }
.ui-cr__legend > span { display: inline-flex; align-items: center; gap: 5px; }
.ui-cr__bar-s[data-key] { width: 12px; height: 6px; border-radius: 3px; animation: none; }
.ui-cr__legend[data-place="foot"] { display: none; }

/* The conflict: a line between the agents that touch the same lines – drawn out from the middle, a glow running along it */
.ui-cr__link {
  position: absolute;
  top: 50%;
  left: calc((var(--a) + 0.5) * 100% / var(--ui-cr-n));
  width: calc((var(--b) - var(--a)) * 100% / var(--ui-cr-n));
  height: 1.5px;
  margin-top: -0.75px;
  overflow: hidden;
  background: var(--ui-cr-hit-edge);
  animation: ui-cr-draw 560ms var(--ui-cr-ease) both;
  transition: opacity 300ms ease;
}
.ui-cr__link::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 32px; background: linear-gradient(90deg, transparent, var(--ui-cr-hit), transparent); animation: ui-cr-run 1600ms ease-in-out infinite alternate; }
.ui-cr__row[data-state="settled"] .ui-cr__link { opacity: 0; }

/* ----- The conflict in focus: a card per way, side by side – click one to keep it ----- */
.ui-cr__pick { height: 168px; }
.ui-cr__phead { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 14px 16px 8px; animation: ui-cr-swap 320ms var(--ui-cr-ease); }
.ui-cr__ptitle { flex: none; font-weight: 600; color: var(--ui-cr-ink); }
.ui-cr__where { min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cr-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-cr__pick { display: flex; flex-direction: column; }
/* Many ways: they keep a readable width and scroll sideways (stacked, on narrow screens, they scroll down) */
.ui-cr__ways { display: grid; flex: 1; grid-auto-columns: minmax(120px, 1fr); grid-auto-flow: column; gap: 8px; min-height: 0; padding: 2px 12px 12px; overflow: auto; scrollbar-width: thin; animation: ui-cr-swap 360ms var(--ui-cr-ease); }
.ui-cr__way { display: flex; flex-direction: column; gap: 8px; min-width: 0; height: 104px; padding: 12px; border-radius: 12px; background: linear-gradient(var(--ui-cr-hover), var(--ui-cr-hover)) var(--ui-cr-card); box-shadow: var(--ui-cr-shadow); transition: box-shadow 200ms ease, opacity 300ms ease, background-color 160ms ease; }
/* Every way sits on a light gray until it's picked; pointing makes it a touch darker */
.ui-cr__way:hover { background: linear-gradient(var(--ui-cr-select), var(--ui-cr-select)) var(--ui-cr-card); }
/* The kept one: plain white */
.ui-cr__way[aria-checked="true"] { background: var(--ui-cr-card); cursor: default; }
.ui-cr__way[data-lost] { opacity: 0.5; }
.ui-cr__way[data-lost]:hover { opacity: 0.8; }
.ui-cr__wtop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-cr__wname { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-cr-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cr__summary { display: -webkit-box; overflow: hidden; font-size: 12px; line-height: 18px; color: var(--ui-cr-text); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
/* Kept: the same tag as on the bars, rising in from below */
.ui-cr__kept { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 18px; margin-right: -3px; padding: 0 6px 0 4px; border-radius: 5px; background: var(--ui-cr-ok-tag-bg); font-size: 11px; font-weight: 600; line-height: 18px; color: var(--ui-cr-ok-tag); animation: ui-cr-rise 380ms var(--ui-cr-ease) both; }
.ui-cr__calm { display: grid; place-items: center; height: 100%; font-size: 12px; color: var(--ui-cr-muted); animation: ui-cr-swap 320ms var(--ui-cr-ease); }

@keyframes ui-cr-grow { from { clip-path: inset(0 100% 0 0 round 4px); } to { clip-path: inset(0 0 0 0 round 4px); } }
@keyframes ui-cr-draw { from { clip-path: inset(0 50% 0 50%); } to { clip-path: inset(0 0 0 0); } }
@keyframes ui-cr-run { from { transform: translateX(-32px); } to { transform: translateX(calc(var(--ui-cr-col) * 2)); } }
@keyframes ui-cr-sheen { from { transform: translateX(-14px); } to { transform: translateX(40px); } }
@keyframes ui-cr-breathe { from { opacity: 0.5; } to { opacity: 1; } }
@keyframes ui-cr-swap { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-cr-rise { from { opacity: 0; transform: translateY(6px); } }

/* Narrow: agent names and folders go, the columns get smaller, a way's sentence moves under its name */
@container ui-cr (max-width: 440px) {
  /* On the card, not the root – a container query only reaches what's inside the container */
  .ui-cr__card { --ui-cr-col: 44px; --ui-cr-file: 96px; }
  .ui-cr__head { padding: 0 4px; }
  .ui-cr__hname, .ui-cr__dir, .ui-cr__legend[data-place="head"] { display: none; }
  .ui-cr__legend[data-place="foot"] { display: flex; height: 32px; padding: 0 16px; border-top: 1px solid var(--ui-cr-line); }
  .ui-cr__bar-s { width: 22px; }
  .ui-cr__pick { height: 242px; }
  .ui-cr__ways { grid-template-columns: minmax(0, 1fr); grid-auto-columns: auto; grid-auto-flow: row; gap: 6px; }
  .ui-cr__way { flex: none; }
  .ui-cr__way { gap: 2px; height: 56px; padding: 10px 12px; }
  .ui-cr__summary { margin-left: 26px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; -webkit-line-clamp: 1; line-height: 16px; display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-cr *, .ui-cr *::before, .ui-cr *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cr {
  --ui-cr-tray: #1a1a1c;
  --ui-cr-card: #232326;
  --ui-cr-strong: #f5f5f5;
  --ui-cr-ink: #f0f0f0;
  --ui-cr-text: #a1a1a1;
  --ui-cr-muted: #8a8a8a;
  --ui-cr-faint: #5c5c5c;
  --ui-cr-line: #2e2e31;
  --ui-cr-fill: rgba(255, 255, 255, 0.07);
  --ui-cr-hover: #28282b;
  --ui-cr-select: #2c2c30;
  --ui-cr-zebra: #252528;
  --ui-cr-pressed: #2f2f33;
  --ui-cr-edit-bg: #1d2b4d;
  --ui-cr-edit-edge: #3c5fb3;
  --ui-cr-edit-ink: #8aaeff;
  --ui-cr-hit-bg: #432614;
  --ui-cr-hit-edge: #b06a35;
  --ui-cr-hit: #ffa057;
  --ui-cr-hit-row: #2d241e;
  --ui-cr-ok-bg: #15321f;
  --ui-cr-ok-edge: #2f7a4b;
  --ui-cr-ok: #55d68c;
  --ui-cr-ok-tag: #6fe3a0;
  --ui-cr-ok-tag-bg: #183524;
  --ui-cr-accent: #6d93ff;
  --ui-cr-focus: rgba(255, 255, 255, 0.3);
  --ui-cr-chip: #f5f5f5;
  --ui-cr-chip-ink: #171717;
  --ui-cr-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-cr-pop: 0 0 0 1px #2e2e31, 0 10px 28px -6px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-cr__bar-s[data-active]::after { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent); }
`;
