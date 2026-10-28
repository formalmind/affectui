"use client";

import { useState, type ReactNode } from "react";
import { ArrowUpRight01Icon, CommandLineIcon, Globe02Icon, MoreHorizontalIcon, NoteEditIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { AppShell, Icon, type AppShellProps } from "@/components/ui/app-shell";

/*
 * App Shell Workspace Inset – App Shell Inset with a work area on the right, like the side pane in Claude or Codex:
 * tools (terminal, browser, notes) and suggested sources next to the page. It's resizable like the sidebar (drag its
 * edge, between a minimum and a maximum), folds away with its icon, and slides in as a drawer on narrow screens.
 * WorkspacePanel is the pane's default content – pass your own `panel` to show something else there.
 */

export type WorkspaceTool = { id: string; label: string; icon: Parameters<typeof Icon>[0]["icon"]; shortcut?: string };
export type WorkspaceSource = { id: string; title: string; source: string; mark?: ReactNode };

export const defaultTools: WorkspaceTool[] = [
  { id: "terminal", label: "Terminal", icon: CommandLineIcon, shortcut: "⌃`" },
  { id: "browser", label: "Browser", icon: Globe02Icon, shortcut: "⌘⇧B" },
  { id: "notes", label: "Notes", icon: NoteEditIcon, shortcut: "⌘⇧N" },
];

export const defaultSources: WorkspaceSource[] = [
  { id: "geo", title: "GEO: Generative Engine Optimization", source: "arxiv.org", mark: "A" },
  { id: "tokens", title: "Design tokens – naming guide", source: "notion.so", mark: "N" },
  { id: "q3", title: "Q3 launch checklist", source: "linear.app", mark: "L" },
];

export type WorkspacePanelProps = {
  tools?: WorkspaceTool[];
  sources?: WorkspaceSource[];
  /** A tool or a suggestion was opened */
  onOpen?: (id: string) => void;
};

/** The pane's content: an address field, the tools, and suggested sources – each row opens its item */
export function WorkspacePanel({ tools = defaultTools, sources = defaultSources, onOpen }: WorkspacePanelProps) {
  const [query, setQuery] = useState("");
  return (
    <div className="ui-asw">
      <style href="ui-app-shell-workspace" precedence="default">
        {css}
      </style>
      <label className="ui-asw__address">
        <Icon icon={Search01Icon} size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search or enter URL" aria-label="Search or enter URL" />
      </label>

      <section className="ui-asw__section" aria-label="Tools">
        <h3 className="ui-asw__label">Tools</h3>
        <div className="ui-asw__list">
          {tools.map((tool) => (
            <div key={tool.id} className="ui-asw__row">
              <button type="button" className="ui-asw__open" onClick={() => onOpen?.(tool.id)}>
                <span className="ui-asw__tile">
                  <Icon icon={tool.icon} size={15} />
                </span>
                <span className="ui-asw__name">{tool.label}</span>
                {tool.shortcut && <kbd className="ui-asw__kbd">{tool.shortcut}</kbd>}
              </button>
              <button type="button" className="ui-asw__more" aria-label={`More for ${tool.label}`}>
                <Icon icon={MoreHorizontalIcon} size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-asw__section" aria-label="Suggested">
        <h3 className="ui-asw__label">Suggested</h3>
        <div className="ui-asw__list">
          {sources.map((item) => (
            <button key={item.id} type="button" className="ui-asw__row ui-asw__open ui-asw__source" onClick={() => onOpen?.(item.id)}>
              <span className="ui-asw__tile ui-asw__tile--mark">{item.mark ?? item.title[0]}</span>
              <span className="ui-asw__text">
                <span className="ui-asw__name">{item.title}</span>
                <span className="ui-asw__meta">{item.source}</span>
              </span>
              <span className="ui-asw__go">
                <Icon icon={ArrowUpRight01Icon} size={14} />
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export type AppShellWorkspaceProps = AppShellProps & WorkspacePanelProps;

export function AppShellWorkspace({ panel, panelTitle = "Workspace", tools, sources, onOpen, ...props }: AppShellWorkspaceProps) {
  return <AppShell {...props} panelTitle={panelTitle} panel={panel ?? <WorkspacePanel tools={tools} sources={sources} onOpen={onOpen} />} />;
}

const css = /* css */ `
.ui-asw { display: flex; flex-direction: column; gap: 22px; padding: 0 2px; }

/* Address field: a white pill with a hairline, like the search fields in the screens */
.ui-asw__address {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 12px;
  border-radius: 10px;
  background: var(--card);
  box-shadow: inset 0 0 0 1px var(--line), var(--shadow);
  color: var(--faint);
  cursor: text;
}
.ui-asw__address:focus-within { box-shadow: inset 0 0 0 1px var(--line-strong), 0 0 0 3px var(--accent-soft); }
.ui-asw__address input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
}
.ui-asw__address input::placeholder { color: var(--placeholder); }

.ui-asw__section { display: flex; flex-direction: column; gap: 8px; }
.ui-asw__label { margin: 0; padding: 0 4px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--muted); }

/* Rows sit on one white card, split by hairlines – the same card style as the screens */
.ui-asw__list {
  display: flex;
  flex-direction: column;
  padding: 4px;
  border-radius: 12px;
  background: var(--card);
  box-shadow: inset 0 0 0 1px var(--line), var(--shadow);
}
.ui-asw__row { position: relative; display: flex; align-items: center; border-radius: 8px; transition: background-color 140ms ease; }
.ui-asw__row + .ui-asw__row::before {
  content: "";
  position: absolute;
  top: -0.5px;
  left: 44px;
  right: 8px;
  height: 1px;
  background: var(--line-soft);
}
.ui-asw__open {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 8px;
  border-radius: 8px;
  text-align: left;
  transition: background-color 140ms ease;
}
/* The hover fills the whole row, the ⋯ button at its end included */
.ui-asw__row:hover { background: var(--hover); }
.ui-asw__source { height: 48px; flex: none; }

.ui-asw__tile {
  display: grid;
  flex: none;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 7px;
  background: var(--chip);
  color: var(--text);
}
.ui-asw__tile--mark { font-size: 11.5px; font-weight: 600; color: var(--muted); }

.ui-asw__text { display: flex; flex: 1; min-width: 0; flex-direction: column; }
.ui-asw__name { overflow: hidden; font-size: 13px; line-height: 18px; font-weight: 450; color: var(--ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-asw__open > .ui-asw__name { flex: 1; }
.ui-asw__meta { font-size: 12px; line-height: 16px; color: var(--muted); }

.ui-asw__kbd {
  flex: none;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--chip);
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.ui-asw__more {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  margin: 0 4px 0 2px;
  border-radius: 7px;
  color: var(--faint);
  opacity: 0;
  transition: opacity 140ms ease, background-color 140ms ease;
}
.ui-asw__row:hover .ui-asw__more, .ui-asw__more:focus-visible { opacity: 1; }
.ui-asw__more:hover { background: var(--hover); color: var(--text); }
.ui-asw__go { flex: none; color: var(--faint); opacity: 0; translate: -2px 0; transition: opacity 140ms ease, translate 200ms var(--ease); }
.ui-asw__source:hover .ui-asw__go { opacity: 1; translate: 0 0; }
`;
