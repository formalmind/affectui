"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Conflict Radar – several agents working on their own branches at once, and where they get in each other's way,
 * in a single self-contained file.
 * One white card: a row per file and a column per agent. A short bar fills in as soon as an agent touches a file. When
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
  <span className="ui-crc__legend" data-place={place} aria-hidden="true">
    {(
      [
        ["edit", "Changed"],
        ["conflict", "Conflict"],
        ["kept", "Kept"],
      ] as const
    ).map(([role, label]) => (
      <span key={role}>
        <span className="ui-crc__bar-s" data-role={role} data-key="" />
        {label}
      </span>
    ))}
  </span>
);

const Avatar = ({ agent }: { agent?: RadarAgent }) => (
  <span className="ui-crc__avatar" data-logo={agent?.avatar ? "" : undefined}>
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
    <div className={["ui-crc", className].filter(Boolean).join(" ")}>
      <style href="ui-conflict-radar-clean" precedence="default">
        {css}
      </style>
      <div className="ui-crc__card" style={{ ["--ui-crc-n" as string]: agents.length }}>
        <header className="ui-crc__bar">
          <span className="ui-crc__radar">
            <Radar />
          </span>
          <span className="ui-crc__title">{title}</span>
          <button type="button" className="ui-crc__merge" data-ready={ready || undefined} disabled={!ready} onClick={onMerge}>
            <span key={ready ? "ready" : open.length ? `open${open.length}` : "wait"}>
              {open.length ? `${plural(open.length, "conflict")} to settle` : running ? `Waiting for ${plural(running, "agent")}` : branches ? `Merge ${plural(branches, "branch", "branches")}` : "Nothing to merge"}
            </span>
          </button>
        </header>

        <div className="ui-crc__grid" role="table" aria-label="Files by agent">
          <div className="ui-crc__row" data-head="" role="row">
            <span className="ui-crc__file" role="columnheader">
              <span className="ui-crc__sr">File</span>
              <Legend place="head" />
            </span>
            <span className="ui-crc__cells">
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
                  <span key={a.id} className="ui-crc__head" role="columnheader" data-status={working ? "running" : "done"} data-last={i === agents.length - 1 || undefined}>
                    <Avatar agent={a} />
                    <span className="ui-crc__hname" title={a.name}>
                      {a.name}
                    </span>
                    <span className="ui-crc__sr">{working ? ", working" : ", done"}</span>
                    <span className="ui-crc__kpi" aria-hidden="true">
                      <span className="ui-crc__kpitop">
                        <Avatar agent={a} />
                        <b>{a.name}</b>
                        <span className="ui-crc__kpistate">{working ? "Working" : "Done"}</span>
                      </span>
                      {a.model && <span className="ui-crc__kpimodel">{a.model}</span>}
                      <span className="ui-crc__kpis">
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
                <span className="ui-crc__file" role="cell">
                  <span className="ui-crc__dot" data-state={state} aria-hidden="true" />
                  <span className="ui-crc__sr">{state === "conflict" ? "Conflict: " : state === "settled" ? "Settled: " : ""}</span>
                  <span className="ui-crc__path" title={file.path}>
                    <span className="ui-crc__dir">{dir}</span>
                    <span className="ui-crc__fname">{name}</span>
                  </span>
                </span>
                <span className="ui-crc__cells">
                  {cols.length > 1 && (
                    <span key={conflict!.agents.join()} className="ui-crc__link" style={{ ["--a" as string]: Math.min(...cols), ["--b" as string]: Math.max(...cols) }} aria-hidden="true" />
                  )}
                  {agents.map((ag, i) => {
                    const e = file.edits.find((x) => x.agentId === ag.id);
                    const inConflict = conflict?.agents.includes(ag.id);
                    const role = !e ? "none" : kept && inConflict ? (kept === ag.id ? "kept" : "lost") : inConflict ? "conflict" : "edit";
                    const writing = e?.active && !kept;
                    const others = inConflict && !kept ? conflict!.agents.filter((id) => id !== ag.id).map((id) => agentOf(id)?.name ?? id) : [];
                    return (
                      <span key={ag.id} className="ui-crc__cell" role="cell" data-last={i === agents.length - 1 || undefined}>
                        <span className="ui-crc__bar-s" data-role={role} data-active={writing || undefined} />
                        {e && (
                          // Pointing at a bar: who, what happened there and which lines
                          <span className="ui-crc__tip" data-role={role}>
                            <span className="ui-crc__tiptop">
                              <b>{ag.name}</b>
                              <span className="ui-crc__tipstate">{writing ? "Writing…" : LABEL[role as Exclude<typeof role, "none">]}</span>
                            </span>
                            <span className="ui-crc__tipmeta">
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
              <button key={file.path} type="button" role="row" className="ui-crc__row" data-state={state} data-alt={r % 2 === 1 || undefined} aria-pressed={shown?.file.path === file.path} onClick={() => setFocus(file.path)}>
                {inner}
              </button>
            ) : (
              <div key={file.path} role="row" className="ui-crc__row" data-state={state} data-alt={r % 2 === 1 || undefined}>
                {inner}
              </div>
            );
          })}
          <Legend place="foot" />
        </div>

        <section className="ui-crc__pick" aria-live="polite">
          {shown?.conflict ? (
            <>
              <div className="ui-crc__phead" key={shown.file.path}>
                <span className="ui-crc__ptitle">{shown.state === "settled" ? "Settled" : "Pick a way"}</span>
                <span className="ui-crc__where">
                  {split(shown.file.path)[1]} · lines {shown.conflict.from}–{shown.conflict.to}
                </span>
              </div>
              <div className="ui-crc__ways" key={`${shown.file.path}-ways`} role="radiogroup" aria-label={`Ways to settle ${shown.file.path}`}>
                {shown.conflict.agents.map((id) => {
                  const ag = agentOf(id);
                  const e = shown.file.edits.find((x) => x.agentId === id);
                  const kept = shown.pick === id;
                  return (
                    <button key={id} type="button" role="radio" aria-checked={kept} className="ui-crc__way" data-lost={(shown.pick && !kept) || undefined} onClick={() => pick(shown.file.path, id)}>
                      <span className="ui-crc__wtop">
                        <Avatar agent={ag} />
                        <span className="ui-crc__wname" title={ag?.name ?? id}>
                          {ag?.name ?? id}
                        </span>
                        {kept && (
                          <span className="ui-crc__kept">
                            <Check /> Kept
                          </span>
                        )}
                      </span>
                      <span className="ui-crc__summary">{e?.summary ?? (e ? `Changes lines ${e.lines[0]}–${e.lines[1]}` : "")}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="ui-crc__calm">{running ? `Watching ${plural(running, "agent")} for overlaps` : branches ? "No overlaps – the branches merge cleanly" : "No changes yet"}</div>
          )}
        </section>
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-crc */
.ui-crc {
  --ui-crc-card: #ffffff;
  --ui-crc-strong: #000000;
  --ui-crc-ink: rgba(0, 0, 0, 0.88);
  --ui-crc-text: rgba(0, 0, 0, 0.61);
  --ui-crc-muted: rgba(0, 0, 0, 0.45);
  --ui-crc-faint: rgba(0, 0, 0, 0.27);
  --ui-crc-line: rgba(0, 0, 0, 0.06);
  --ui-crc-fill: rgba(0, 0, 0, 0.06);
  --ui-crc-hover: rgba(0, 0, 0, 0.025);
  --ui-crc-select: rgba(0, 0, 0, 0.04);
  --ui-crc-zebra: rgba(0, 0, 0, 0.011);
  --ui-crc-pressed: rgba(0, 0, 0, 0.055);
  /* Bars after Trace Waterfall: a light tint with a hairline edge */
  --ui-crc-edit-bg: rgba(0, 96, 226, 0.12);
  --ui-crc-edit-edge: rgba(0, 96, 226, 0.32);
  --ui-crc-hit-bg: rgba(204, 78, 0, 0.22);
  --ui-crc-hit-edge: rgba(204, 78, 0, 0.6);
  --ui-crc-hit: #cc4e00;
  --ui-crc-hit-row: rgba(204, 78, 0, 0.06);
  --ui-crc-ok-bg: rgba(31, 138, 76, 0.2);
  --ui-crc-ok-edge: rgba(31, 138, 76, 0.4);
  --ui-crc-ok: #1f8a4c;
  --ui-crc-ok-tag: #2ea866;
  --ui-crc-ok-tag-bg: rgba(46, 168, 102, 0.1);
  --ui-crc-focus: rgba(0, 96, 226, 0.35);
  --ui-crc-chip: rgba(0, 0, 0, 0.88);
  --ui-crc-chip-ink: #fcfcfc;
  --ui-crc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-crc-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 4px 12px -2px rgba(0, 0, 0, 0.12), 0 1px 3px rgba(0, 0, 0, 0.06);
  --ui-crc-edit-ink: rgba(0, 72, 170, 0.9);
  --ui-crc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 560px;
  container: ui-crc / inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-crc-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-crc *, .ui-crc *::before, .ui-crc *::after { box-sizing: border-box; }
:where(.ui-crc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-crc button:focus-visible { outline: 2px solid var(--ui-crc-focus); outline-offset: -2px; }
.ui-crc svg { display: block; flex: none; }
.ui-crc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.ui-crc__card { --ui-crc-col: 104px; --ui-crc-file: 216px; border-radius: 10px; background: var(--ui-crc-card); box-shadow: var(--ui-crc-shadow); overflow: hidden; }

/* ----- Bar: what it is, and Merge saying what it waits for ----- */
.ui-crc__bar { display: flex; align-items: center; gap: 10px; min-width: 0; height: 52px; padding: 0 12px 0 16px; border-bottom: 0.5px solid var(--ui-crc-line); }
.ui-crc__radar { display: grid; flex: none; place-items: center; width: 16px; color: rgba(0, 96, 226, 0.765); }
.ui-crc__title { flex: 1; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-crc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-crc__merge { flex: none; height: 24px; padding: 0 8px; border-radius: 6px; font-size: 12px; line-height: 16px; background: var(--ui-crc-card); box-shadow: var(--ui-crc-shadow); font-weight: 500; color: var(--ui-crc-muted); white-space: nowrap; transition: background-color 240ms ease, color 240ms ease, box-shadow 240ms ease; }
.ui-crc__merge > span { display: block; animation: ui-crc-swap 320ms var(--ui-crc-ease); }
.ui-crc__merge:disabled { cursor: default; }
.ui-crc__merge[data-ready] { background: var(--ui-crc-chip); box-shadow: none; color: var(--ui-crc-chip-ink); }
.ui-crc__merge[data-ready]:hover { opacity: 0.9; }

/* ----- Files × agents: one fixed row per file ----- */
.ui-crc__grid { display: grid; }
/* A table: hairlines between the rows and the columns, every second row on a light gray */
/* The file column keeps room for its names (and the legend above them); the agent columns give way when there are many */
.ui-crc__row { display: grid; grid-template-columns: minmax(var(--ui-crc-file), 1fr) minmax(0, calc(var(--ui-crc-n) * var(--ui-crc-col))); align-items: center; width: 100%; height: 36px; border-top: 0.5px solid var(--ui-crc-line); transition: background-color 160ms ease; }
.ui-crc__row[data-head] { height: 32px; border-top: 0; }
.ui-crc__row[data-alt] { background: var(--ui-crc-zebra); }
button.ui-crc__row:hover { background: var(--ui-crc-select); }
button.ui-crc__row[aria-pressed="true"] { background: var(--ui-crc-pressed); }
/* The open conflict whose ways are below: a light wash of the conflict color */
button.ui-crc__row[aria-pressed="true"][data-state="conflict"] { background: var(--ui-crc-hit-row); }
.ui-crc__file { display: flex; align-items: center; gap: 10px; min-width: 0; height: 100%; padding: 0 12px 0 16px; }
.ui-crc__dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-crc-fill); transition: background-color 300ms ease; }
.ui-crc__dot[data-state="conflict"] { background: var(--ui-crc-hit); }
.ui-crc__dot[data-state="settled"] { background: var(--ui-crc-ok); }
.ui-crc__path { display: flex; min-width: 0; color: var(--ui-crc-ink); white-space: nowrap; }
/* A long path gives up its folders first, so the file name stays readable */
.ui-crc__dir, .ui-crc__fname { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-crc__dir { flex: 0 1000 auto; }
.ui-crc__fname { flex: 0 1 auto; }
.ui-crc__dir { color: var(--ui-crc-faint); }
.ui-crc__row[data-state="clean"] .ui-crc__path { color: var(--ui-crc-text); }

.ui-crc__cells { position: relative; display: grid; grid-template-columns: repeat(var(--ui-crc-n), minmax(0, 1fr)); align-items: center; height: 100%; }
.ui-crc__cells > :is(.ui-crc__head, .ui-crc__cell) { height: 100%; border-left: 0.5px solid var(--ui-crc-line); }
.ui-crc__head { display: flex; align-items: center; justify-content: center; gap: 6px; min-width: 0; padding: 0 12px; }
.ui-crc__hname { min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-crc-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Pointing at an agent: a small card below its name with its numbers */
.ui-crc__head { position: relative; cursor: default; }
/* Each head measures itself: in a column too narrow for the name, only the mark stays (the name is on hover) */
.ui-crc__row[data-head] .ui-crc__head { container: ui-crc-head / inline-size; }
@container ui-crc-head (max-width: 72px) { .ui-crc__hname { display: none; } }
.ui-crc__head:hover { z-index: 4; }
.ui-crc__kpi {
  position: absolute;
  top: calc(100% - 2px);
  left: 50%;
  display: grid;
  gap: 2px;
  width: 232px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  background: var(--ui-crc-card);
  box-shadow: var(--ui-crc-pop);
  text-align: left;
  opacity: 0;
  transform: translate(-50%, -3px);
  pointer-events: none;
  transition: opacity 140ms ease, transform 180ms var(--ui-crc-ease);
}
.ui-crc__head[data-last] .ui-crc__kpi { left: auto; right: 6px; transform: translateY(-3px); }
.ui-crc__head:hover .ui-crc__kpi { opacity: 1; transform: translate(-50%, 0); transition-delay: 80ms; }
.ui-crc__head[data-last]:hover .ui-crc__kpi { transform: none; }
.ui-crc__kpitop { display: flex; align-items: flex-start; gap: 8px; min-width: 0; font-size: 13px; line-height: 20px; color: var(--ui-crc-ink); white-space: nowrap; }
.ui-crc__kpitop b { flex: 1; min-width: 0; font-weight: 500; white-space: normal; }
.ui-crc__kpistate { flex: none; height: 18px; padding: 0 6px; border-radius: 5px; background: var(--ui-crc-edit-bg); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-crc-edit-ink); }
.ui-crc__head[data-status="done"] .ui-crc__kpistate { background: var(--ui-crc-fill); color: var(--ui-crc-text); }
.ui-crc__kpimodel { overflow: hidden; padding-left: 26px; font-size: 11px; line-height: 16px; color: var(--ui-crc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-crc__kpis { display: flex; gap: 6px; margin-top: 8px; }
.ui-crc__kpis > span { display: flex; flex: 1 1 auto; align-items: baseline; justify-content: center; gap: 4px; height: 24px; padding: 0 6px; border-radius: 6px; background: var(--ui-crc-hover); box-shadow: inset 0 0 0 0.5px var(--ui-crc-line); font-size: 11px; line-height: 24px; color: var(--ui-crc-muted); white-space: nowrap; }
.ui-crc__kpis b { font-size: 12px; font-weight: 500; color: var(--ui-crc-ink); font-variant-numeric: tabular-nums; }
.ui-crc__kpis [data-kpi="conflicts"]:not([data-zero]) b { color: var(--ui-crc-hit); }
.ui-crc__kpis [data-kpi="kept"]:not([data-zero]) b { color: var(--ui-crc-ok-tag); }
/* Still working: its mark breathes */
.ui-crc__head[data-status="running"] > .ui-crc__avatar { animation: ui-crc-breathe 1400ms ease-in-out infinite alternate; }
.ui-crc__avatar { display: grid; flex: none; place-items: center; width: 18px; height: 18px; overflow: hidden; border-radius: 5px; background: var(--ui-crc-fill); font-size: 9px; font-weight: 500; letter-spacing: 0.3px; color: var(--ui-crc-text); }
.ui-crc__avatar[data-logo] { background: var(--ui-crc-card); box-shadow: var(--ui-crc-shadow); }
.ui-crc__avatar > svg { width: 11px; height: 11px; }

/* A touched file: a short tinted bar that grows in from the left */
.ui-crc__cell { position: relative; z-index: 1; display: grid; place-items: center; height: 100%; }
.ui-crc__bar-s {
  position: relative;
  width: 32px;
  height: 8px;
  overflow: hidden;
  border-radius: 4px;
  /* The tint sits on the card color, so a conflict line behind it never shows through */
  background: linear-gradient(var(--ui-crc-tint), var(--ui-crc-tint)) var(--ui-crc-card);
  box-shadow: inset 0 0 0 0.5px var(--ui-crc-edge);
  --ui-crc-tint: var(--ui-crc-edit-bg);
  --ui-crc-edge: var(--ui-crc-edit-edge);
  animation: ui-crc-grow 520ms var(--ui-crc-ease) both;
  transition: box-shadow 300ms ease, width 300ms var(--ui-crc-ease);
}
.ui-crc__bar-s[data-role="none"] { width: 4px; height: 4px; border-radius: 50%; --ui-crc-tint: var(--ui-crc-fill); --ui-crc-edge: transparent; animation: none; }
.ui-crc__bar-s[data-role="conflict"] { --ui-crc-tint: var(--ui-crc-hit-bg); --ui-crc-edge: var(--ui-crc-hit-edge); }
.ui-crc__bar-s[data-role="kept"] { --ui-crc-tint: var(--ui-crc-ok-bg); --ui-crc-edge: var(--ui-crc-ok-edge); }
.ui-crc__bar-s[data-role="lost"] { width: 12px; --ui-crc-tint: var(--ui-crc-fill); --ui-crc-edge: transparent; }
/* Still writing there: a sheen sweeps over it */
.ui-crc__bar-s[data-active]::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 14px; background: linear-gradient(90deg, transparent, var(--ui-crc-card), transparent); opacity: 0.8; animation: ui-crc-sheen 1300ms linear infinite; }

/* Pointing at a bar: a small card above it – who, what happened there and which lines */
.ui-crc__cell:hover { z-index: 3; }
.ui-crc__tip {
  position: absolute;
  bottom: calc(50% + 10px);
  left: 50%;
  display: grid;
  gap: 3px;
  width: max-content;
  max-width: 240px;
  padding: 7px 10px 8px;
  border-radius: 8px;
  background: var(--ui-crc-card);
  box-shadow: var(--ui-crc-pop);
  text-align: left;
  opacity: 0;
  transform: translate(-50%, 3px);
  pointer-events: none;
  transition: opacity 140ms ease, transform 180ms var(--ui-crc-ease);
}
.ui-crc__cell[data-last] .ui-crc__tip { left: auto; right: 8px; transform: translateY(3px); }
.ui-crc__cell:hover .ui-crc__tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 80ms; }
.ui-crc__cell[data-last]:hover .ui-crc__tip { transform: none; }
.ui-crc__tiptop { display: flex; align-items: center; gap: 8px; font-size: 12px; line-height: 16px; color: var(--ui-crc-ink); white-space: nowrap; }
.ui-crc__tiptop b { min-width: 0; overflow: hidden; font-weight: 500; text-overflow: ellipsis; }
.ui-crc__tipstate { flex: none; }
/* The state as a small tag in its color */
.ui-crc__tipstate { height: 18px; margin-right: -3px; padding: 0 6px; border-radius: 5px; background: var(--ui-crc-edit-bg); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-crc-edit-ink); }
.ui-crc__tip[data-role="conflict"] .ui-crc__tipstate { background: var(--ui-crc-hit-bg); color: var(--ui-crc-hit); }
.ui-crc__tip[data-role="kept"] .ui-crc__tipstate { background: var(--ui-crc-ok-tag-bg); color: var(--ui-crc-ok-tag); }
.ui-crc__tip[data-role="lost"] .ui-crc__tipstate { background: var(--ui-crc-fill); color: var(--ui-crc-text); }
.ui-crc__tipmeta { font-size: 11px; line-height: 16px; color: var(--ui-crc-muted); }

/* The legend: the same bars, small, each with its word */
.ui-crc__legend { display: flex; align-items: center; gap: 12px; min-width: 0; overflow: hidden; font-size: 11px; line-height: 16px; color: var(--ui-crc-muted); white-space: nowrap; }
.ui-crc__legend > span { display: inline-flex; align-items: center; gap: 5px; }
.ui-crc__bar-s[data-key] { width: 12px; height: 6px; border-radius: 3px; animation: none; }
.ui-crc__legend[data-place="foot"] { display: none; }

/* The conflict: a line between the agents that touch the same lines – drawn out from the middle, a glow running along it */
.ui-crc__link {
  position: absolute;
  top: 50%;
  left: calc((var(--a) + 0.5) * 100% / var(--ui-crc-n));
  width: calc((var(--b) - var(--a)) * 100% / var(--ui-crc-n));
  height: 1.5px;
  margin-top: -0.75px;
  overflow: hidden;
  background: var(--ui-crc-hit-edge);
  animation: ui-crc-draw 560ms var(--ui-crc-ease) both;
  transition: opacity 300ms ease;
}
.ui-crc__link::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 32px; background: linear-gradient(90deg, transparent, var(--ui-crc-hit), transparent); animation: ui-crc-run 1600ms ease-in-out infinite alternate; }
.ui-crc__row[data-state="settled"] .ui-crc__link { opacity: 0; }

/* ----- The conflict in focus: a card per way, side by side – click one to keep it ----- */
.ui-crc__pick { height: 164px; border-top: 0.5px solid var(--ui-crc-line); }
.ui-crc__phead { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding: 14px 16px 8px; animation: ui-crc-swap 320ms var(--ui-crc-ease); }
.ui-crc__ptitle { flex: none; font-weight: 500; color: var(--ui-crc-ink); }
.ui-crc__where { min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-crc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-crc__pick { display: flex; flex-direction: column; }
/* Many ways: they keep a readable width and scroll sideways (stacked, on narrow screens, they scroll down) */
.ui-crc__ways { display: grid; flex: 1; grid-auto-columns: minmax(120px, 1fr); grid-auto-flow: column; gap: 8px; min-height: 0; padding: 2px 12px 12px; overflow: auto; scrollbar-width: thin; animation: ui-crc-swap 360ms var(--ui-crc-ease); }
.ui-crc__way { display: flex; flex-direction: column; gap: 8px; min-width: 0; height: 104px; padding: 12px; border-radius: 8px; background: linear-gradient(var(--ui-crc-hover), var(--ui-crc-hover)) var(--ui-crc-card); box-shadow: var(--ui-crc-shadow); transition: box-shadow 200ms ease, opacity 300ms ease, background-color 160ms ease; }
/* Every way sits on a light gray until it's picked; pointing makes it a touch darker */
.ui-crc__way:hover { background: linear-gradient(var(--ui-crc-select), var(--ui-crc-select)) var(--ui-crc-card); }
/* The kept one: plain white */
.ui-crc__way[aria-checked="true"] { background: var(--ui-crc-card); cursor: default; }
.ui-crc__way[data-lost] { opacity: 0.5; }
.ui-crc__way[data-lost]:hover { opacity: 0.8; }
.ui-crc__wtop { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-crc__wname { flex: 1; min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-crc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-crc__summary { display: -webkit-box; overflow: hidden; font-size: 12px; line-height: 18px; color: var(--ui-crc-text); -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
/* Kept: the same tag as on the bars, rising in from below */
.ui-crc__kept { display: inline-flex; flex: none; align-items: center; gap: 3px; height: 18px; margin-right: -3px; padding: 0 6px 0 4px; border-radius: 5px; background: var(--ui-crc-ok-tag-bg); font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-crc-ok-tag); animation: ui-crc-rise 380ms var(--ui-crc-ease) both; }
.ui-crc__calm { display: grid; place-items: center; height: 100%; font-size: 12px; color: var(--ui-crc-muted); animation: ui-crc-swap 320ms var(--ui-crc-ease); }

@keyframes ui-crc-grow { from { clip-path: inset(0 100% 0 0 round 4px); } to { clip-path: inset(0 0 0 0 round 4px); } }
@keyframes ui-crc-draw { from { clip-path: inset(0 50% 0 50%); } to { clip-path: inset(0 0 0 0); } }
@keyframes ui-crc-run { from { transform: translateX(-32px); } to { transform: translateX(calc(var(--ui-crc-col) * 2)); } }
@keyframes ui-crc-sheen { from { transform: translateX(-14px); } to { transform: translateX(40px); } }
@keyframes ui-crc-breathe { from { opacity: 0.5; } to { opacity: 1; } }
@keyframes ui-crc-swap { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-crc-rise { from { opacity: 0; transform: translateY(6px); } }

/* Narrow: agent names and folders go, the columns get smaller, a way's sentence moves under its name */
@container ui-crc (max-width: 440px) {
  /* On the card, not the root – a container query only reaches what's inside the container */
  .ui-crc__card { --ui-crc-col: 44px; --ui-crc-file: 96px; }
  .ui-crc__head { padding: 0 4px; }
  .ui-crc__hname, .ui-crc__dir, .ui-crc__legend[data-place="head"] { display: none; }
  .ui-crc__legend[data-place="foot"] { display: flex; height: 32px; padding: 0 16px; border-top: 0.5px solid var(--ui-crc-line); }
  .ui-crc__bar-s { width: 22px; }
  .ui-crc__pick { height: 238px; }
  .ui-crc__ways { grid-template-columns: minmax(0, 1fr); grid-auto-columns: auto; grid-auto-flow: row; gap: 6px; }
  .ui-crc__way { flex: none; }
  .ui-crc__way { gap: 2px; height: 56px; padding: 10px 12px; }
  .ui-crc__summary { margin-left: 26px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; -webkit-line-clamp: 1; line-height: 16px; display: block; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-crc *, .ui-crc *::before, .ui-crc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-crc {
  --ui-crc-card: #1c1c1f;
  --ui-crc-strong: #ffffff;
  --ui-crc-ink: rgba(255, 255, 255, 0.9);
  --ui-crc-text: rgba(255, 255, 255, 0.62);
  --ui-crc-muted: rgba(255, 255, 255, 0.45);
  --ui-crc-faint: rgba(255, 255, 255, 0.28);
  --ui-crc-line: rgba(255, 255, 255, 0.08);
  --ui-crc-fill: rgba(255, 255, 255, 0.1);
  --ui-crc-hover: rgba(255, 255, 255, 0.04);
  --ui-crc-select: rgba(255, 255, 255, 0.06);
  --ui-crc-zebra: rgba(255, 255, 255, 0.016);
  --ui-crc-pressed: rgba(255, 255, 255, 0.08);
  --ui-crc-edit-bg: rgba(112, 184, 255, 0.2);
  --ui-crc-edit-edge: rgba(112, 184, 255, 0.5);
  --ui-crc-hit-bg: rgba(255, 160, 87, 0.2);
  --ui-crc-hit-edge: rgba(255, 160, 87, 0.55);
  --ui-crc-hit: #ffa057;
  --ui-crc-hit-row: rgba(255, 160, 87, 0.08);
  --ui-crc-ok-bg: rgba(84, 214, 140, 0.18);
  --ui-crc-ok-edge: rgba(84, 214, 140, 0.5);
  --ui-crc-ok: #3fbf74;
  --ui-crc-ok-tag: #7beaa9;
  --ui-crc-ok-tag-bg: rgba(84, 214, 140, 0.12);
  --ui-crc-focus: rgba(91, 154, 255, 0.45);
  --ui-crc-chip: rgba(255, 255, 255, 0.92);
  --ui-crc-chip-ink: #111113;
  --ui-crc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-crc-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 6px 16px -2px rgba(0, 0, 0, 0.55);
  --ui-crc-edit-ink: #9ccbff;
}
:where(.dark, [data-theme="dark"]) .ui-crc__radar { color: #70b8ff; }
:where(.dark, [data-theme="dark"]) .ui-crc__bar-s[data-active]::after { background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent); }
`;
