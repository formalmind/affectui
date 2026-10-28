"use client";

/*
 * Files – folders and file templates, in a single file.
 * Folder cards with the Glass Folder (it opens on hover) and document previews for templates.
 * Sits in the affectUI App Shell; icons from the Hugeicons free set.
 */

import { useState, type CSSProperties } from "react";
import { PlusSignIcon, SquareLock02Icon, UserMultiple02Icon } from "@hugeicons/core-free-icons";
import type { FilterGroup, FilterValue } from "@/components/ui/filter-menu";
import { Button } from "@/components/ui/button";
import { GlassFolder } from "@/components/ui/glass-folder";
import {
  AppShell,
  EmptyState,
  FileCard,
  FilterButton,
  Icon,
  SearchField,
  SectionHead,
  SortButton,
  Tabs,
  ViewToggle,
  fileKind,
  type AppShellProps,
  type SortDir,
  type ViewMode,
  type FileItem,
} from "@/components/ui/app-shell";

/** Sample content – replace with your own data */
type Folder = { name: string; access: "Shared" | "Private"; files: FileItem[] };

const folders: Folder[] = [
  {
    name: "Q3 Campaign",
    access: "Shared",
    files: [
      { name: "Campaign-Brief", type: "DOC", edited: "2 hours ago" },
      { name: "Launch-Plan", type: "PDF", edited: "Yesterday" },
      { name: "Media-Budget", type: "XLS", edited: "Yesterday" },
      { name: "Ad-Copy", type: "DOC", edited: "3 days ago" },
      { name: "Results-Q2", type: "XLS", edited: "Last week" },
    ],
  },
  {
    name: "Brand assets",
    access: "Shared",
    files: [
      { name: "Brand-Guidelines", type: "PDF", edited: "4 days ago" },
      { name: "Tone-of-Voice", type: "DOC", edited: "Last week" },
      { name: "Logo-Usage", type: "PDF", edited: "2 weeks ago" },
    ],
  },
  {
    name: "Hiring",
    access: "Private",
    files: [
      { name: "Job-Description", type: "DOC", edited: "Today" },
      { name: "Candidates", type: "XLS", edited: "Yesterday" },
      { name: "Interview-Guide", type: "PDF", edited: "5 days ago" },
      { name: "Offer-Template", type: "DOC", edited: "Last month" },
    ],
  },
  {
    name: "Research",
    access: "Private",
    files: [
      { name: "Market-Study", type: "PDF", edited: "3 days ago" },
      { name: "Survey-Results", type: "XLS", edited: "Last week" },
    ],
  },
];


type Template = FileItem & { owner: string; shared?: boolean };

const templates: Template[] = [
  { name: "Design-Book", type: "DOC", owner: "Alex Morgan" },
  { name: "Brand-Guidelines", type: "PDF", owner: "Jonas Weber", shared: true },
  { name: "Campaign-Budget", type: "XLS", owner: "Jonas Weber", shared: true },
  { name: "Weekly-Report", type: "XLS", owner: "Alex Morgan" },
];

const typeFilter: FilterGroup[] = [
  {
    id: "type",
    label: "Type",
    options: [
      { id: "DOC", label: "Document" },
      { id: "PDF", label: "PDF" },
      { id: "XLS", label: "Spreadsheet" },
    ],
  },
];

const byName = (dir: SortDir) => (a: { name: string }, b: { name: string }) => (dir === "asc" ? 1 : -1) * a.name.localeCompare(b.name);
const matches = (name: string, query: string) => name.toLowerCase().includes(query.trim().toLowerCase());

export type FilesScreenProps = Pick<AppShellProps, "onNavigate" | "workspace" | "user" | "className">;

export function FilesScreen(props: FilesScreenProps) {
  const me = props.user?.name ?? "Alex Morgan";

  // Folders: tab, sort, view and search all work on the same list; "Create folder" adds one
  const [folderList, setFolderList] = useState(folders);
  const [folderTab, setFolderTab] = useState("All");
  const [folderSort, setFolderSort] = useState<SortDir>("asc");
  const [view, setView] = useState<ViewMode>("grid");
  const [folderQuery, setFolderQuery] = useState("");
  const shownFolders = folderList
    .filter((f) => folderTab === "All" || f.access === folderTab)
    .filter((f) => matches(f.name, folderQuery))
    .sort(byName(folderSort));
  const createFolder = () => {
    const taken = new Set(folderList.map((f) => f.name));
    let name = "Untitled folder";
    for (let n = 2; taken.has(name); n++) name = `Untitled folder ${n}`;
    setFolderList((list) => [...list, { name, access: "Private", files: [] }]);
    setFolderTab("All");
    setFolderQuery("");
  };

  // Templates: tab by owner, type filter, sort and search; "Add template" adds a blank document
  const [templateList, setTemplateList] = useState(templates);
  const [templateTab, setTemplateTab] = useState("All");
  const [types, setTypes] = useState<FilterValue>({});
  const [templateSort, setTemplateSort] = useState<SortDir>("asc");
  const [templateQuery, setTemplateQuery] = useState("");
  const picked = types.type ?? [];
  const shownTemplates = templateList
    .filter((t) => templateTab === "All" || (templateTab === "Mine" ? t.owner === me : t.owner !== me))
    .filter((t) => !picked.length || picked.includes(t.type))
    .filter((t) => matches(t.name, templateQuery))
    .sort(byName(templateSort));
  const addTemplate = () => {
    const taken = new Set(templateList.map((t) => t.name));
    let name = "Untitled";
    for (let n = 2; taken.has(name); n++) name = `Untitled-${n}`;
    setTemplateList((list) => [...list, { name, type: "DOC", owner: me }]);
    setTemplateTab("All");
    setTypes({});
    setTemplateQuery("");
  };

  return (
    <AppShell active="Folders" {...props}>
      <style href="ui-screen-files" precedence="default">
        {css}
      </style>
      <div className="ui-as-page">
        <h1 className="ui-as-page-title">Files</h1>
        <p className="ui-as-page-sub">
          See files you recently used in chats and manage files saved in folders. <a href="#learn-more">Learn more</a>
        </p>

        <SectionHead
          title="Folders"
          left={<Tabs items={["All", "Shared", "Private"]} value={folderTab} onChange={setFolderTab} />}
          right={
            <>
              <SortButton value={folderSort} onChange={setFolderSort} />
              <ViewToggle value={view} onChange={setView} />
              <SearchField placeholder="Search folders..." width={172} value={folderQuery} onChange={setFolderQuery} />
              <Button size="sm" icon={<Icon icon={PlusSignIcon} size={15} />} onClick={createFolder}>
                Create folder
              </Button>
            </>
          }
        />
        {shownFolders.length ? (
          <div className="ui-as-folders" data-view={view} key={`${folderTab}|${folderSort}|${view}|${folderQuery}`}>
            {shownFolders.map((f, i) => (
              <button
                key={f.name}
                type="button"
                className="ui-as-folder-card ui-as-rise"
                style={{ "--i": i } as CSSProperties}
                onClick={() => props.onNavigate?.(f.name)}
              >
                <span className="ui-as-folder-card__icon">
                  <GlassFolder label="" />
                </span>
                <span className="ui-as-folder-card__text">
                  <b>{f.name}</b>
                  <span className="ui-as-meta">
                    <Icon icon={f.access === "Shared" ? UserMultiple02Icon : SquareLock02Icon} size={12} />
                    {f.access} · {f.files.length} {f.files.length === 1 ? "file" : "files"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="ui-as-rise ui-as-files-empty">
            <EmptyState title="No folders found" text={folderQuery ? `Nothing matches “${folderQuery}”.` : `There are no ${folderTab.toLowerCase()} folders yet.`} />
          </div>
        )}

        <SectionHead
          title="File templates"
          left={<Tabs items={["All", "Mine", "Shared with me"]} value={templateTab} onChange={setTemplateTab} />}
          right={
            <>
              <FilterButton label="Type" groups={typeFilter} value={types} onChange={setTypes} />
              <SortButton value={templateSort} onChange={setTemplateSort} />
              <SearchField placeholder="Search templates..." width={172} value={templateQuery} onChange={setTemplateQuery} />
              <Button size="sm" variant="secondary" icon={<Icon icon={PlusSignIcon} size={15} />} onClick={addTemplate}>
                Add template
              </Button>
            </>
          }
        />
        {shownTemplates.length ? (
          <div className="ui-as-templates ui-as-file-grid" key={`${templateTab}|${picked.join()}|${templateSort}|${templateQuery}`}>
            {shownTemplates.map((t, i) => (
              <div key={t.name} className="ui-as-rise" style={{ "--i": i } as CSSProperties}>
                <FileCard
                  file={t}
                  meta={
                    <>
                      {fileKind[t.type]} · {t.owner} · <Icon icon={t.shared ? UserMultiple02Icon : SquareLock02Icon} size={12} /> {t.shared ? "Shared" : "Private"}
                    </>
                  }
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="ui-as-rise ui-as-files-empty">
            <EmptyState title="No templates found" text="Try another tab, type or search." />
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Files overview – folders and file templates */

.ui-as-folders {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 11px;
  margin-top: 16px;
}
.ui-as-folder-card {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 59px;
  padding: 0 14px 0 12px;
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  text-decoration: none;
  transition: box-shadow 160ms ease;
}
.ui-as-folder-card:hover { box-shadow: 0 0 0 1px var(--line-strong), 0 2px 8px rgba(0, 0, 0, 0.05); }
.ui-as-folder-card__text { display: grid; gap: 2px; min-width: 0; }
.ui-as-folder-card__text b { overflow: hidden; font-size: 13.5px; line-height: 18px; font-weight: 500; color: var(--ink); white-space: nowrap; text-overflow: ellipsis; }

.ui-as-templates { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
.ui-as-files-empty { margin-top: 16px; }

/* List view: one folder per row */
.ui-as-folders[data-view="list"] { grid-template-columns: minmax(0, 1fr); gap: 6px; }
.ui-as-folders[data-view="list"] .ui-as-folder-card { height: 52px; }

/* Narrow panels: folders 4 → 2 → 1 per row */
@container ui-as-main (max-width: 760px) {
  .ui-as-folders { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container ui-as-main (max-width: 760px) {
  .ui-as-folder-card { text-align: left; }
  .ui-as-folder-card__text { flex: 1; }
}
@container ui-as-main (max-width: 480px) {
  .ui-as-folders { grid-template-columns: minmax(0, 1fr); gap: 8px; }
}
`;
