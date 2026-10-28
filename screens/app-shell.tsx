"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  ArrowUpDownIcon,
  Cancel01Icon,
  DashboardSquare02Icon,
  File02Icon,
  FilterIcon,
  Folder01Icon,
  FolderOpenIcon,
  GridViewIcon,
  LeftToRightListBulletIcon,
  PencilEdit02Icon,
  Search01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
  Tick02Icon,
  PlusSignIcon,
  UserIcon,
  Settings01Icon,
  HelpCircleIcon,
  Logout01Icon,
} from "@hugeicons/core-free-icons";
import { FilterMenu, type FilterGroup, type FilterValue } from "@/components/ui/filter-menu";
import { SetupGuide, type SetupGroup } from "@/components/ui/setup-guide";

/*
 * App Shell – the frame every affectUI screen sits in, in a single file.
 * A sidebar on a gray page (workspace, menu, projects, what's new, onboarding progress, user) and the main
 * area as a rounded white panel. The sidebar collapses completely; its icon then waits in the top left corner.
 * Drag the sidebar's edge to make it wider or narrower (between a minimum and a maximum; double-click resets it).
 * Optional: a work area on the right (`panel`) – tools, a preview, files – resizable and collapsible the same way.
 * Also exports the small parts the screens share: icon, tabs, search, toolbar tools, section heads,
 * empty state and file cards. Icons: Hugeicons free set (stroke, rounded).
 */

/** Hugeicons, stroke + rounded with a slightly heavier stroke */
export const Icon = ({ icon, size = 16, stroke = 1.9, color = "currentColor" }: { icon: IconSvgElement; size?: number; stroke?: number; color?: string }) => (
  <HugeiconsIcon icon={icon} size={size} strokeWidth={stroke} color={color} aria-hidden />
);

export type ShellNavItem = { label: string; icon: IconSvgElement; /** Small number at the end, e.g. unread items */ count?: number };
/** A labelled list under the menu – replaces Projects when given */
export type ShellGroup = { label: string; items: ShellNavItem[]; /** Text shown while the list is empty */ empty?: string };

export const defaultNav: ShellNavItem[] = [
  { label: "New chat", icon: PencilEdit02Icon },
  { label: "Folders", icon: Folder01Icon },
  { label: "Integrations", icon: DashboardSquare02Icon },
];

export const defaultProjects = ["Q3 Campaign", "Brand assets", "Hiring", "Research"];

/** Onboarding behind "Getting started" – shown in the library's Setup Guide */
export const defaultSetup: SetupGroup[] = [
  {
    id: "workspace",
    title: "Set up your workspace",
    tasks: [
      { id: "name", label: "Name your workspace", done: true },
      { id: "invite", label: "Invite your teammates" },
      { id: "connect", label: "Connect your first app" },
    ],
  },
  {
    id: "work",
    title: "Start working",
    tasks: [
      { id: "folder", label: "Create a folder" },
      { id: "chat", label: "Start your first chat" },
      { id: "upload", label: "Upload a file" },
    ],
  },
  {
    id: "profile",
    title: "Make it yours",
    tasks: [
      { id: "avatar", label: "Add a profile picture" },
      { id: "notify", label: "Choose your notifications" },
    ],
  },
];

/** Up to this width (of the app itself, not the window) the sidebar becomes a drawer */
const NARROW = 900;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const cheer = (pct: number) => (pct >= 100 ? "All done!" : pct >= 60 ? "Almost there!" : pct > 0 ? "Great start!" : "Let's go!");

export type AppShellProps = {
  children: ReactNode;
  /** Label of the menu item or project that is open */
  active?: string;
  /** Called with the label of a menu item or project when it is clicked */
  onNavigate?: (label: string) => void;
  workspace?: string;
  user?: { name: string; avatar?: string };
  nav?: ShellNavItem[];
  projects?: string[];
  /** Lists under the menu instead of Projects, e.g. Tools or Pipelines */
  groups?: ShellGroup[];
  /** Tasks behind "Getting started" */
  setup?: SetupGroup[];
  /** Sidebar width in px – drag its edge between min and max; double-click the edge for the default again */
  sidebarWidth?: { default?: number; min?: number; max?: number };
  /** A work area on the right of the main area, e.g. tools or a preview – resizable and collapsible */
  panel?: ReactNode;
  /**
   * A header across the whole app, like Claude's: the sidebar toggle and search over the sidebar, the page's title and
   * actions over the page, and the work area's title over the work area – one bar, one line under it
   */
  header?: { title: ReactNode; actions?: ReactNode } | false;
  /** Heading of the right work area */
  panelTitle?: string;
  /** Width of the right work area in px, like sidebarWidth */
  panelWidth?: { default?: number; min?: number; max?: number };
  className?: string;
};

export function AppShell({
  children,
  active,
  onNavigate,
  workspace = "Acme",
  user = { name: "Alex Morgan" },
  nav = defaultNav,
  projects = defaultProjects,
  groups,
  setup = defaultSetup,
  sidebarWidth,
  panel,
  panelTitle = "Workspace",
  panelWidth,
  header,
  className,
}: AppShellProps) {
  const [news, setNews] = useState(2);
  const [collapsed, setCollapsed] = useState(false);
  const side = { default: 272, min: 220, max: 380, ...sidebarWidth };
  const pane = { default: 360, min: 280, max: 560, ...panelWidth };
  const [sideW, setSideW] = useState(side.default);
  const [paneW, setPaneW] = useState(pane.default);
  const [paneOpen, setPaneOpen] = useState(true);
  // While an edge is dragged the columns follow the pointer directly, without their glide
  const [resizing, setResizing] = useState(false);
  // Narrow (tablet, phone): the sidebar waits off screen and slides in as a drawer over the main area
  const root = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [drawer, setDrawer] = useState(false);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    // Same width as the @container ui-as (max-width: 900px) rules below – measured in layout pixels, so a scaled preview stays wide
    const measure = () => setNarrow(el.offsetWidth <= NARROW);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!narrow) setDrawer(false);
    // Narrow: the right work area waits closed and slides in over the page when asked for
    setPaneOpen(!narrow);
  }, [narrow]);
  const sideHidden = narrow ? !drawer : collapsed;
  const go = (label: string) => {
    setDrawer(false);
    onNavigate?.(label);
  };
  // closed → open → closing → closed: while closing the guide stays, fades and the card shrinks, then the summary returns
  const [guide, setGuide] = useState<"closed" | "open" | "closing">("closed");
  const guideOpen = guide === "open";
  const setGuideOpen = (open: boolean) => {
    if (open) return setGuide("open");
    setGuide((g) => (g === "open" ? "closing" : g));
  };
  useEffect(() => {
    if (guide !== "closing") return;
    const t = window.setTimeout(() => setGuide("closed"), 420);
    return () => window.clearTimeout(t);
  }, [guide]);
  const guideInner = useRef<HTMLDivElement>(null);
  const [guideHeight, setGuideHeight] = useState(0);
  const [closedHeight, setClosedHeight] = useState(0);
  // Read the content's height right when the state changes (not a frame later), so no step ever uses an old height;
  // the closed card's height is kept for the slot and for shrinking back
  useLayoutEffect(() => {
    const el = guideInner.current;
    if (!el) return;
    setGuideHeight(el.offsetHeight);
    if (guide === "closed") setClosedHeight(el.offsetHeight);
  }, [guide]);

  // The card's height follows its content, so opening, closing and folding groups all glide
  useLayoutEffect(() => {
    const el = guideInner.current;
    if (!el) return;
    const measure = () => setGuideHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!guideOpen) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setGuideOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [guideOpen]);
  // Escape closes the drawer – unless the setup guide is open, then it closes the guide first
  useEffect(() => {
    if (!drawer || guide !== "closed") return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [drawer, guide]);
  // Narrow: Escape closes the work area that slid in from the right
  useEffect(() => {
    if (!narrow || !paneOpen) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setPaneOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [narrow, paneOpen]);
  const [done, setDone] = useState(() => setup.flatMap((g) => g.tasks.filter((t) => t.done).map((t) => t.id)));
  const total = setup.reduce((n, g) => n + g.tasks.length, 0);
  const pct = total ? Math.round((done.length / total) * 100) : 0;
  const initials = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("");

  return (
    <div
      ref={root}
      className={["ui-as", "ui-as-app", className].filter(Boolean).join(" ")}
      style={{ "--side-w": `${sideW}px`, "--panel-w": `${paneW}px` } as CSSProperties}
      data-collapsed={(collapsed && !narrow) || undefined}
      data-drawer={(narrow && drawer) || undefined}
      data-panel={panel ? (paneOpen ? "open" : "closed") : undefined}
      data-resizing={resizing || undefined}
      data-header={header ? "" : undefined}
    >
      <style href="ui-app-shell" precedence="default">
        {css}
      </style>
      {/* With the sidebar hidden, the same icon sits in the top left corner of the main area to bring it back */}
      <button
        className="ui-as-icon-btn ui-as-side-open"
        type="button"
        aria-label="Open sidebar"
        tabIndex={sideHidden ? 0 : -1}
        onClick={() => (narrow ? setDrawer(true) : setCollapsed(false))}
      >
        <Icon icon={SidebarLeftIcon} size={16} />
      </button>
      {/* The same for the work area on the right: its icon waits in the top right corner while it's closed */}
      {panel && (
        <button
          className="ui-as-icon-btn ui-as-panel-open"
          type="button"
          aria-label={`Open ${panelTitle.toLowerCase()}`}
          tabIndex={paneOpen ? -1 : 0}
          onClick={() => setPaneOpen(true)}
        >
          <Icon icon={SidebarRightIcon} size={16} />
        </button>
      )}
      {/* Narrow only: dims the main area behind the open drawer; a tap closes it */}
      <div
        className="ui-as-scrim"
        aria-hidden="true"
        onClick={() => {
          setDrawer(false);
          if (narrow) setPaneOpen(false);
        }}
      />
      {/* Drag handles on the edges of the main area – wide screens only */}
      {!sideHidden && !narrow && (
        <Resizer edge="left" label="Resize sidebar" value={sideW} {...side} onChange={setSideW} onDrag={setResizing} root={root} />
      )}
      {panel && paneOpen && !narrow && (
        <Resizer edge="right" label={`Resize ${panelTitle.toLowerCase()}`} value={paneW} {...pane} onChange={setPaneW} onDrag={setResizing} root={root} />
      )}
      {header && (
        <>
          <div className="ui-as-bar ui-as-bar--side" inert={sideHidden}>
            <button className="ui-as-icon-btn" type="button" aria-label="Collapse sidebar" onClick={() => setCollapsed(true)}>
              <Icon icon={SidebarLeftIcon} size={16} />
            </button>
            <button className="ui-as-icon-btn" type="button" aria-label="Search">
              <Icon icon={Search01Icon} size={16} />
            </button>
          </div>
          <div className="ui-as-bar ui-as-bar--main">
            <div className="ui-as-bar__title">{header.title}</div>
            {header.actions && <div className="ui-as-bar__actions">{header.actions}</div>}
          </div>
          {panel && (
            <div className="ui-as-bar ui-as-bar--panel" inert={!paneOpen}>
              <span className="ui-as-panel__title">{panelTitle}</span>
              <button className="ui-as-icon-btn" type="button" aria-label={`Close ${panelTitle.toLowerCase()}`} onClick={() => setPaneOpen(false)}>
                <Icon icon={SidebarRightIcon} size={16} />
              </button>
            </div>
          )}
        </>
      )}
      <aside className="ui-as-side" inert={sideHidden}>
        <header className="ui-as-side__head">
          <Dropdown
            title="Workspaces"
            items={[
              { label: workspace, description: "Pro · 8 members", checked: true },
              { label: "Personal", description: "Free", checked: false },
              { label: "Create workspace", icon: PlusSignIcon },
            ]}
            trigger={({ open, toggle }) => (
              <button className="ui-as-side__workspace" type="button" aria-expanded={open} onClick={toggle}>
                <span className="ui-as-side__logo">{workspace[0]}</span>
                {workspace}
                <Icon icon={ArrowDown01Icon} size={13} />
              </button>
            )}
          />
          <span className="ui-as-side__tools">
            <button className="ui-as-icon-btn" type="button" aria-label="Search">
              <Icon icon={Search01Icon} size={16} />
            </button>
            <button className="ui-as-icon-btn" type="button" aria-label={narrow ? "Close sidebar" : "Collapse sidebar"} onClick={() => (narrow ? setDrawer(false) : setCollapsed(true))}>
              <Icon icon={SidebarLeftIcon} size={16} />
            </button>
          </span>
        </header>

        <nav className="ui-as-side__nav" aria-label="Main menu">
          <div className="ui-as-side__group">
            {nav.map((item) => (
              <button
                key={item.label}
                type="button"
                className="ui-as-side__item"
                aria-current={active === item.label ? "page" : undefined}
                onClick={() => go(item.label)}
              >
                <Icon icon={item.icon} size={16} />
                {item.label}
                {item.count !== undefined && <span className="ui-as-side__count">{item.count}</span>}
              </button>
            ))}
          </div>
          {groups ? (
            groups.map((group) => (
              <div key={group.label} className="ui-as-side__group">
                <span className="ui-as-side__label">{group.label}</span>
                {group.items.length === 0 && group.empty && <span className="ui-as-side__empty">{group.empty}</span>}
                {group.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="ui-as-side__item"
                    aria-current={active === item.label ? "page" : undefined}
                    onClick={() => go(item.label)}
                  >
                    <Icon icon={item.icon} size={16} />
                    {item.label}
                    {item.count !== undefined && <span className="ui-as-side__count">{item.count}</span>}
                  </button>
                ))}
              </div>
            ))
          ) : (
            <>
          <span className="ui-as-side__label">Projects</span>
          {projects.map((name) => (
            <button
              key={name}
              type="button"
              className="ui-as-side__item"
              aria-current={active === name ? "page" : undefined}
              onClick={() => go(name)}
            >
              <Icon icon={FolderOpenIcon} size={16} />
              {name}
            </button>
          ))}
            </>
          )}
        </nav>

        <div className="ui-as-side__foot">
          {news > 0 && (
            <div className="ui-as-news" data-count={news}>
              <div className="ui-as-news__card ui-as-news__card--back" aria-hidden="true">
                <span className="ui-as-news__kicker">New in {workspace}</span>
                <Icon icon={Cancel01Icon} size={13} />
              </div>
              <div className="ui-as-news__card">
                <div className="ui-as-news__top">
                  <span className="ui-as-news__kicker">New in {workspace}</span>
                  <button type="button" className="ui-as-news__close" aria-label="Dismiss" onClick={() => setNews((n) => n - 1)}>
                    <Icon icon={Cancel01Icon} size={13} />
                  </button>
                </div>
                <b className="ui-as-news__title">{news > 1 ? "Shared folders" : "Scheduled chats"}</b>
                <button type="button" className="ui-as-news__more">
                  Full changelog
                  <Icon icon={ArrowRight01Icon} size={13} />
                </button>
              </div>
            </div>
          )}

          {/* The card itself grows upward into the full setup guide – one block that morphs, no second panel */}
          {/* The slot keeps the closed card's height in the sidebar; the open card grows over the cards above it */}
          <div className="ui-as-guide-slot" style={closedHeight ? { height: closedHeight } : undefined}>
          <div
            className="ui-as-guide"
            data-open={guide !== "closed" || undefined}
            data-state={guide}
            style={{ height: (guide === "open" ? guideHeight : closedHeight) || undefined }}
          >
            <div ref={guideInner} className="ui-as-guide__inner">
              {guide !== "closed" ? (
                <div className="ui-as-guide__content" key="guide">
                  <SetupGuide
                    title="Getting started"
                    groups={setup.map((g) => ({ ...g, tasks: g.tasks.map((t) => ({ ...t, done: done.includes(t.id) })) }))}
                    onChange={setDone}
                    onClose={() => setGuideOpen(false)}
                  />
                </div>
              ) : (
                <button type="button" className="ui-as-steps ui-as-guide__content" key="summary" aria-expanded={false} onClick={() => setGuideOpen(true)}>
                  <span className="ui-as-steps__title">
                    Getting started
                    <Icon icon={ArrowRight01Icon} size={13} />
                  </span>
                  <span className="ui-as-steps__sub">
                    {pct}% done · <span className="ui-as-steps__cheer">{cheer(pct)}</span>
                  </span>
                  <span className="ui-as-steps__bar">
                    <i style={{ width: `${Math.max(pct, 4)}%` }} />
                  </span>
                </button>
              )}
            </div>
          </div>
          </div>


          <Dropdown
            side="top"
            className="ui-as-user-menu"
            items={[
              { label: "Profile", icon: UserIcon },
              { label: "Settings", icon: Settings01Icon },
              { label: "Help & feedback", icon: HelpCircleIcon },
              { label: "Log out", icon: Logout01Icon, danger: true },
            ]}
            trigger={({ open, toggle }) => (
              <button type="button" className="ui-as-user" aria-expanded={open} onClick={toggle}>
                {user.avatar ? <img src={user.avatar} alt="" width={21} height={21} /> : <span className="ui-as-user__initials">{initials}</span>}
                {user.name}
                <Icon icon={ArrowDown01Icon} size={13} />
              </button>
            )}
          />
        </div>
      </aside>
      <main className="ui-as-main">{children}</main>
      {panel && (
        <aside className="ui-as-panel" aria-label={panelTitle} inert={!paneOpen}>
          <header className="ui-as-panel__head">
            <span className="ui-as-panel__title">{panelTitle}</span>
            <button className="ui-as-icon-btn" type="button" aria-label={`Close ${panelTitle.toLowerCase()}`} onClick={() => setPaneOpen(false)}>
              <Icon icon={SidebarRightIcon} size={16} />
            </button>
          </header>
          <div className="ui-as-panel__body">{panel}</div>
        </aside>
      )}
    </div>
  );
}

/**
 * The edge between the main area and a sidebar: drag it, use the arrow keys, or double-click it for the default width.
 * On hover the whole edge of the page darkens. The pointer's travel is divided by the app's scale, so a scaled-down
 * preview still follows the pointer exactly.
 */
function Resizer({
  edge,
  label,
  value,
  default: initial,
  min,
  max,
  onChange,
  onDrag,
  root,
}: {
  edge: "left" | "right";
  label: string;
  value: number;
  default: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onDrag: (dragging: boolean) => void;
  root: RefObject<HTMLDivElement | null>;
}) {
  const start = useRef<{ x: number; width: number; scale: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const sign = edge === "left" ? 1 : -1;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = root.current;
    const scale = el && el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
    start.current = { x: e.clientX, width: value, scale: scale || 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setDragging(true);
    onDrag(true);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    onChange(clamp(Math.round(s.width + ((e.clientX - s.x) / s.scale) * sign), min, max));
  };
  const up = () => {
    if (!start.current) return;
    start.current = null;
    setDragging(false);
    onDrag(false);
  };
  const key = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      onChange(clamp(value + (e.key === "ArrowRight" ? step : -step) * sign, min, max));
    }
    if (e.key === "Home") onChange(min);
    if (e.key === "End") onChange(max);
  };
  return (
    <div
      className="ui-as-resizer"
      data-edge={edge}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-dragging={dragging || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={key}
    />
  );
}

/* ---------- Shared parts ---------- */


/** Value that works controlled (value + onChange) or on its own (defaultValue) */
function useControlled<T>(value: T | undefined, fallback: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState(fallback);
  return [value ?? inner, (v: T) => (setInner(v), onChange?.(v))];
}

/** Segmented tabs: a soft gray pill slides to the active tab */
export function Tabs({
  items,
  value,
  defaultValue,
  onChange,
}: {
  items: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
}) {
  const [current, setCurrent] = useControlled(value, defaultValue ?? items[0], onChange);
  const list = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  // The pill follows the active tab; measured from the layout, so it is right at any size
  useLayoutEffect(() => {
    const tab = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (tab) setPill({ x: tab.offsetLeft, w: tab.offsetWidth });
  }, [current, items.join("|")]);

  return (
    <div ref={list} className="ui-as-tabs" role="tablist">
      {pill && <span className="ui-as-tabs__pill" style={{ transform: `translateX(${pill.x}px)`, width: pill.w }} aria-hidden="true" />}
      {items.map((item) => (
        <button key={item} type="button" role="tab" aria-selected={current === item} className="ui-as-tabs__tab" onClick={() => setCurrent(item)}>
          {item}
        </button>
      ))}
    </div>
  );
}

/** The page's title in the header, with a chevron – a button, so it can open a menu (rename, move, delete…) */
export function BarTitle({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button type="button" className="ui-as-bar__pick" onClick={onClick}>
      <span>{children}</span>
      <Icon icon={ArrowDown01Icon} size={13} />
    </button>
  );
}

export function IconButton({ icon, label, onClick, pressed }: { icon: IconSvgElement; label: string; onClick?: () => void; pressed?: boolean }) {
  return (
    <button type="button" className="ui-as-tool" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      <Icon icon={icon} size={15} />
    </button>
  );
}

export type SortDir = "asc" | "desc";

/** Flips between A–Z and Z–A; the icon turns with it */
export function SortButton({ value, onChange }: { value?: SortDir; onChange?: (dir: SortDir) => void }) {
  const [dir, setDir] = useControlled<SortDir>(value, "asc", onChange);
  return (
    <button
      type="button"
      className="ui-as-tool ui-as-sort"
      data-dir={dir}
      aria-label={dir === "asc" ? "Sorted A to Z – sort Z to A" : "Sorted Z to A – sort A to Z"}
      title={dir === "asc" ? "A–Z" : "Z–A"}
      onClick={() => setDir(dir === "asc" ? "desc" : "asc")}
    >
      <Icon icon={ArrowUpDownIcon} size={15} />
    </button>
  );
}

export type ViewMode = "grid" | "list";

export function ViewToggle({ value, onChange }: { value?: ViewMode; onChange?: (view: ViewMode) => void }) {
  const [view, setView] = useControlled<ViewMode>(value, "grid", onChange);
  return (
    <div className="ui-as-view" role="radiogroup" aria-label="View" data-view={view}>
      <span className="ui-as-view__pill" aria-hidden="true" />
      {(
        [
          ["grid", GridViewIcon, "Grid"],
          ["list", LeftToRightListBulletIcon, "List"],
        ] as const
      ).map(([id, icon, label]) => (
        <button key={id} type="button" role="radio" aria-checked={view === id} aria-label={label} className="ui-as-view__btn" onClick={() => setView(id)}>
          <Icon icon={icon} size={15} />
        </button>
      ))}
    </div>
  );
}

export function SearchField({
  placeholder,
  width = 175,
  value,
  onChange,
}: {
  placeholder: string;
  width?: number;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const [text, setText] = useControlled(value, "", onChange);
  return (
    <label className="ui-as-search" style={{ width }}>
      <Icon icon={Search01Icon} size={15} />
      <input type="search" placeholder={placeholder} aria-label={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setText("")} />
      {text && (
        <button type="button" className="ui-as-search__clear" aria-label="Clear search" onClick={() => setText("")}>
          <Icon icon={Cancel01Icon} size={12} />
        </button>
      )}
    </label>
  );
}

/** The nearest ancestor that cuts off what sticks out (a scroll area), or the screen itself */
function clipBox(el: HTMLElement) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowY + style.overflowX) || node.classList.contains("ui-as")) return node.getBoundingClientRect();
  }
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/**
 * Small floating panel attached to its trigger. Opens on the preferred side and flips to the other side
 * (or edge) when it would stick out of the screen or its scroll area – it is always fully reachable.
 * Closes on a click outside or Escape; fades and scales in from the side it is attached to.
 */
export function Popover({
  open,
  onClose,
  children,
  align = "start",
  side = "bottom",
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top" | "right";
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ side, align });

  // Measure before paint: flip up when there is no room below, flip sideways at the right or left edge
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    let next = { side, align };
    el.dataset.side = side;
    el.dataset.align = align;
    const box = clipBox(el);
    const r = el.getBoundingClientRect();
    if (side === "bottom" && r.bottom > box.bottom - 6) next = { ...next, side: "top" };
    if (side === "top" && r.top < box.top + 6) next = { ...next, side: "bottom" };
    if (align === "start" && r.right > box.right - 6) next = { ...next, align: "end" };
    if (align === "end" && r.left < box.left + 6) next = { ...next, align: "start" };
    // Still sticking out on a narrow screen (neither edge fits): slide it sideways until it is inside
    el.dataset.side = next.side;
    el.dataset.align = next.align;
    el.style.translate = "";
    const r2 = el.getBoundingClientRect();
    const scale = r2.width / el.offsetWidth || 1;
    let dx = 0;
    if (r2.right > box.right - 6) dx = box.right - 6 - r2.right;
    if (r2.left + dx < box.left + 6) dx = box.left + 6 - r2.left;
    if (dx) el.style.translate = `${dx / scale}px 0`;
    setPlace(next);
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const anchor = ref.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} className={["ui-as-popover", className].filter(Boolean).join(" ")} data-align={place.align} data-side={place.side} role="dialog">
      {children}
    </div>
  );
}

export type MenuItem = {
  label: string;
  /** Second line in a lighter color */
  description?: string;
  icon?: IconSvgElement;
  /** Shows a check – for choices like a model or a period */
  checked?: boolean;
  /** Red text, e.g. Delete */
  danger?: boolean;
  onSelect?: () => void;
};

/** List of actions or choices inside a popover */
export function MenuList({ items, onPick }: { items: MenuItem[]; onPick: () => void }) {
  return (
    <div role="menu" className="ui-as-menu__list">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role={item.checked === undefined ? "menuitem" : "menuitemradio"}
          aria-checked={item.checked}
          className="ui-as-menu__item"
          data-danger={item.danger || undefined}
          data-rich={item.description ? true : undefined}
          onClick={() => {
            item.onSelect?.();
            onPick();
          }}
        >
          {item.icon && <Icon icon={item.icon} size={15} />}
          <span className="ui-as-menu__label">
            {item.label}
            {item.description && <small>{item.description}</small>}
          </span>
          {item.checked && <Icon icon={Tick02Icon} size={14} />}
        </button>
      ))}
    </div>
  );
}

/** Any trigger with a menu: the trigger gets the open state and a toggle */
export function Dropdown({
  trigger,
  items,
  align = "start",
  side = "bottom",
  title,
  className,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  side?: "bottom" | "top";
  /** Small heading above the items */
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span className={["ui-as-anchor", className].filter(Boolean).join(" ")}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      <Popover open={open} onClose={() => setOpen(false)} align={align} side={side} className="ui-as-menu">
        {title && <span className="ui-as-menu__title">{title}</span>}
        <MenuList items={items} onPick={() => setOpen(false)} />
      </Popover>
    </span>
  );
}

/** Opens the library's Filter Menu in a popover; the button shows how many filters are on */
export function FilterButton({
  label,
  groups,
  value,
  onChange,
  align = "end",
}: {
  label: string;
  groups: FilterGroup[];
  value: FilterValue;
  onChange: (value: FilterValue) => void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const count = Object.values(value).reduce((n, ids) => n + ids.length, 0);
  return (
    <span className="ui-as-anchor">
      <button type="button" className="ui-as-tool ui-as-tool--label" aria-expanded={open} data-active={count > 0 || undefined} onClick={() => setOpen((o) => !o)}>
        <Icon icon={FilterIcon} size={15} />
        {label}
        {count > 0 ? <span className="ui-as-tool__count">{count}</span> : <Icon icon={ArrowDown01Icon} size={13} />}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align={align} className="ui-as-popover--filter">
        <FilterMenu groups={groups} value={value} onChange={onChange} defaultOpen={groups.map((g) => g.id)} hints={false} title={label} />
      </Popover>
    </span>
  );
}

/** Plain menu of choices in a popover, e.g. a period picker */
export function MenuButton<T extends string>({
  value,
  options,
  onChange,
  icon,
  align = "end",
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  icon?: IconSvgElement;
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <span className="ui-as-anchor">
      <button type="button" className={["ui-as-tool ui-as-tool--label", className].filter(Boolean).join(" ")} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        {icon && <Icon icon={icon} size={15} />}
        {current?.label}
        <Icon icon={ArrowDown01Icon} size={13} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align={align} className="ui-as-menu">
        <MenuList items={options.map((o) => ({ label: o.label, checked: o.value === value, onSelect: () => onChange(o.value) }))} onPick={() => setOpen(false)} />
      </Popover>
    </span>
  );
}

/** Short confirmation at the bottom of the main area – "Saved to Reports" */
export function useToast() {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(t);
  }, [toast]);
  const show = (text: string) => setToast({ id: Date.now(), text });
  const node = toast ? (
    <div key={toast.id} className="ui-as-toast" role="status">
      <Icon icon={Tick02Icon} size={14} />
      {toast.text}
    </div>
  ) : null;
  return [node, show] as const;
}

export function SectionHead({ title, left, right }: { title: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <div className="ui-as-section-head" data-inline={!left || undefined}>
      <h2 className="ui-as-section-head__title">{title}</h2>
      {(left || right) && (
        <div className="ui-as-toolbar">
          <div className="ui-as-toolbar__left">{left}</div>
          <div className="ui-as-toolbar__right">{right}</div>
        </div>
      )}
    </div>
  );
}

/** `bare`: without the dashed frame – the page's only content, e.g. inside .ui-as-center */
export function EmptyState({ title, text, action, tall, bare }: { title: string; text: string; action?: ReactNode; tall?: boolean; bare?: boolean }) {
  return (
    <div className="ui-as-empty" data-tall={tall || undefined} data-bare={bare || undefined}>
      <span className="ui-as-empty__icon">
        <Icon icon={File02Icon} size={18} />
      </span>
      <b className="ui-as-empty__title">{title}</b>
      <p className="ui-as-empty__text">{text}</p>
      {action}
    </div>
  );
}

/* ---------- File cards ---------- */

export type FileType = "DOC" | "PDF" | "XLS";
export type FileItem = { name: string; type: FileType; edited?: string };

/** Badge color and label per file type */
const colors: Record<FileType, "blue" | "rose" | "emerald"> = { DOC: "blue", PDF: "rose", XLS: "emerald" };
export const fileKind: Record<FileType, string> = { DOC: "Document", PDF: "PDF", XLS: "Spreadsheet" };

/** A file as a card: preview on a gray stage, name and one line of details below */
export function FileCard({ file, meta }: { file: FileItem; meta: ReactNode }) {
  return (
    <button type="button" className="ui-as-template">
      <span className="ui-as-template__preview">
        <DocPreview type={file.type} color={colors[file.type]} />
      </span>
      <b className="ui-as-template__name">{file.name}</b>
      <span className="ui-as-meta">{meta}</span>
    </button>
  );
}

/**
 * File illustration in the style of the Glass Folder: a tinted sheet behind, a paper page with the file's content,
 * and a small frosted glass tag with the type at its corner. On hover the sheets fan out a little.
 */
function DocPreview({ type, color }: { type: FileType; color: "blue" | "rose" | "emerald" }) {
  return (
    <span className="ui-as-doc" data-color={color} aria-hidden="true">
      <span className="ui-as-doc__art">
        <span className="ui-as-doc__back" />
        <span className="ui-as-doc__page" data-type={type}>
          {type === "XLS" ? (
            <span className="ui-as-sheet">
              {Array.from({ length: 18 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          ) : (
            <>
              {type === "PDF" ? <span className="ui-as-doc__image" /> : <i className="ui-as-doc__title" />}
              {(type === "PDF" ? [100, 82, 92] : [100, 86, 94, 70, 88]).map((w, i) => (
                <i key={i} className="ui-as-doc__line" style={{ width: `${w}%` }} />
              ))}
            </>
          )}
        </span>
        <span className="ui-as-doc__type">{type}</span>
      </span>
    </span>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Design tokens – same values as the affectUI library components */
.ui-as {
  --tray: #f4f4f4;
  --card: #ffffff;
  /* Like the affectUI library: gray page, the main area is a rounded panel on it */
  --page: #f8f8f8;
  --panel: #ffffff;
  --radius-panel: 12px;
  --frame-gap: 8px;
  --line: #ebebeb;
  --line-soft: #f0f0f0;
  --ink: #171717;
  --text: #404040;
  --muted: #737373;
  --faint: #a3a3a3;
  --placeholder: #a3a3a3;
  --chip: #f5f5f5;
  --chip-hover: #eeeeee;
  --hover: rgba(0, 0, 0, 0.035);
  --accent: #4469fc;
  --button: #262626;
  --button-hover: #333333;
  --accent-soft: #eef3ff;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  --line-strong: #dedede;
  /* An edge you can drag, while the pointer is on it */
  --edge-active: #b8b8b8;
  --subtle: #fafafa;
  --disabled: #dcdcdc;
  --on-ink: #ffffff;
  --ink-hover: #3a3a3a;
  --select: rgba(0, 0, 0, 0.055);
  --toggle-off: #e2e2e2;
  --switch-on: #171717;
  --logo-bg: #ffffff;
  --ease: cubic-bezier(0.22, 1, 0.36, 1);
  --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

/* Library components inside a screen follow the shell's scale: 13–13.5px text, 30px buttons, compact rows */
.ui-as .ui-pl { font-size: 13.5px; line-height: 19px; }
.ui-as .ui-pl__title { font-size: 14px; line-height: 20px; }
.ui-as .ui-df__text { font-size: 13.5px; line-height: 1.6; }
.ui-as .ui-df__body { padding: 14px 16px 16px; }
.ui-as .ui-ap__title { font-size: 13.5px; }
.ui-as .ui-ap__btn { height: 30px; }
.ui-as .ui-tc { font-size: 13px; }
.ui-as .ui-tc__head { min-height: 40px; padding-top: 6px; padding-bottom: 6px; }
/* Actions look the same in every card: 30px, radius 10, quiet = white with a hairline, primary = ink; never stretched */
.ui-as .ui-ap__foot .ui-ap__actions { flex: 0 0 auto; margin-left: auto; }
.ui-as .ui-ap__actions .ui-ap__btn { flex: none; padding: 0 12px; border-radius: 10px; }
.ui-as .ui-ap__actions .ui-ap__btn--quiet { background: var(--card); box-shadow: inset 0 0 0 1px var(--line); }
.ui-as .ui-ap__actions .ui-ap__btn--quiet:hover { background: var(--subtle); }
.ui-as .ui-df__head .ui-df__btn, .ui-as .ui-df__head .ui-df__icon { border-radius: 10px; }
.ui-as .ui-ap__actions .ui-ap__btn--primary, .ui-as .ui-df__head .ui-df__btn--primary { background: var(--button); }
.ui-as .ui-um__action { border-radius: 10px; }
/* …and the screens' lighter grays: trays and their hovers a step lighter than the components' own defaults */
.ui-as .ui-ap { --ui-ap-tray: var(--tray); --ui-ap-hover: #ebebeb; }
.ui-as .ui-pl { --ui-pl-tray: var(--tray); --ui-pl-quiet-hover: #ebebeb; --ui-pl-marker: var(--chip); }
.ui-as .ui-df { --ui-df-tray: var(--tray); }
.ui-as .ui-um { --ui-um-tray: var(--tray); }
.ui-as .ui-cb { --ui-cb-tray: var(--tray); }
:where(.dark, [data-theme="dark"]) .ui-as .ui-ap { --ui-ap-tray: #111113; --ui-ap-hover: #222225; }
:where(.dark, [data-theme="dark"]) .ui-as .ui-pl { --ui-pl-tray: #111113; --ui-pl-quiet-hover: #222225; --ui-pl-marker: #26262a; }
:where(.dark, [data-theme="dark"]) .ui-as :is(.ui-df, .ui-um, .ui-cb) { --ui-df-tray: #111113; --ui-um-tray: #111113; --ui-cb-tray: #111113; }

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html>.
   Every screen draws from these tokens, and the library parts inside switch on their own. */
:where(.dark, [data-theme="dark"]) .ui-as {
  --tray: #1d1d20;
  --card: #1b1b1e;
  --page: #0e0e10;
  --panel: #141416;
  --line: #29292d;
  --line-soft: #222225;
  --ink: #f4f4f5;
  --text: #d4d4d8;
  --muted: #a1a1aa;
  --faint: #71717a;
  --placeholder: #71717a;
  --chip: #232326;
  --chip-hover: #2c2c30;
  --hover: rgba(255, 255, 255, 0.05);
  --accent: #6d8bff;
  --button: #f4f4f5;
  --button-hover: #ffffff;
  --accent-soft: rgba(109, 139, 255, 0.14);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --line-strong: #3a3a3f;
  --edge-active: #55555c;
  --subtle: #18181b;
  --disabled: #3a3a3f;
  --on-ink: #111113;
  --ink-hover: #d4d4d8;
  --select: rgba(255, 255, 255, 0.08);
  --toggle-off: #3a3a3f;
  --switch-on: #6d8bff;
  --logo-bg: #2a2a2e;
  color-scheme: dark;
}

.ui-as, .ui-as *, .ui-as *::before, .ui-as *::after { box-sizing: border-box; }
.ui-as {
  font-family: var(--font);
  font-size: 13px;
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
:where(.ui-as) button {
  appearance: none;
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: inherit;
  cursor: pointer;
}
:where(.ui-as) svg { display: block; flex: none; }
.ui-as :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ui-as textarea:focus-visible, .ui-as input:focus-visible { outline: none; }

/* Primary buttons: one flat dark gray, with the soft light edge on top and faint one below from the Figma button 590:4159 */
.ui-as-app .ui-button[data-variant="primary"] {
  border-color: transparent;
  background: var(--button);
  color: var(--on-ink);
  box-shadow:
    inset 0 1px 0.5px rgba(255, 255, 255, 0.16),
    inset 0 -1px 0.5px rgba(19, 20, 27, 0.1),
    0 1px 2px rgba(19, 20, 27, 0.1);
}
.ui-as-app .ui-button[data-variant="primary"]:hover:not(:disabled) { background: var(--button-hover); }

/* App frame shared by all screens: sidebar on the gray page, main area as a rounded white panel */

.ui-as-app {
  /* The layout answers to the app's own width (container queries), not the window – see the end of this file */
  container: ui-as / inline-size;
  position: relative;
  display: grid;
  /* Sidebar · main area · work area on the right (0 when there is none or it's closed); widths come from the drag handles */
  --side-col: var(--side-w, 272px);
  --panel-col: 0px;
  grid-template-columns: var(--side-col) minmax(0, 1fr) var(--panel-col);
  height: 100%;
  min-height: 560px;
  background: var(--page);
  transition: grid-template-columns 420ms var(--ease);
}
.ui-as-app[data-panel="open"] { --panel-col: var(--panel-w, 360px); }
/* Collapsed: the sidebar is gone completely, the main area keeps the same gap on all sides */
.ui-as-app[data-collapsed] { --side-col: 0px; }
.ui-as-app[data-collapsed] .ui-as-main { margin-left: var(--frame-gap); }
/* Dragging an edge: the columns follow the pointer at once */
.ui-as-app[data-resizing] { transition: none; cursor: col-resize; user-select: none; }
.ui-as-app[data-resizing] :is(.ui-as-main, .ui-as-side, .ui-as-panel) { transition: none; }

/* ---------- Sidebar ---------- */

.ui-as-side {
  display: flex;
  flex-direction: column;
  width: var(--side-w, 272px);
  min-height: 0;
  padding: 10px 8px 8px 10px;
  transition: opacity 260ms ease, translate 420ms var(--ease), visibility 0s;
}
.ui-as-app[data-collapsed] .ui-as-side {
  visibility: hidden;
  opacity: 0;
  translate: -16px 0;
  transition: opacity 200ms ease, translate 420ms var(--ease), visibility 0s 420ms;
}

/* The icon to bring the sidebar back, in the top left corner of the main area */
.ui-as-side-open {
  position: fixed;
  z-index: 20;
  top: calc(var(--frame-gap) + 9px);
  left: calc(var(--frame-gap) + 9px);
  visibility: hidden;
  opacity: 0;
  transition: opacity 200ms ease, visibility 0s 200ms;
}
.ui-as-app[data-collapsed] .ui-as-side-open {
  visibility: visible;
  opacity: 1;
  transition: opacity 260ms ease 160ms, visibility 0s;
}

.ui-as-side__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
}
.ui-as-side__workspace {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.ui-as-side__workspace svg { color: var(--faint); }
.ui-as-side__workspace:hover { background: var(--hover); }
.ui-as-user-menu { display: flex; }
.ui-as-user-menu > .ui-as-user { flex: 1; }
.ui-as-user-menu .ui-as-menu { width: 100%; }
/* Workspace logo on a white tile with a small, tight shadow below */
.ui-as-side__logo {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-right: 1px;
  border-radius: 5px;
  background: var(--logo-bg);
  box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 1px 1px rgba(0, 0, 0, 0.12);
}
.ui-as-side__logo svg { width: 11px; height: auto; }
.ui-as-side__tools { display: flex; gap: 2px; }

.ui-as-icon-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  color: var(--muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-as-icon-btn:hover { background: var(--hover); color: var(--ink); }

.ui-as-side__nav {
  display: flex;
  flex-direction: column;
  margin-top: 16px;
}
.ui-as-side__group { display: flex; flex-direction: column; }
.ui-as-side__group + .ui-as-side__group { margin-top: 10px; }
.ui-as-side__group + .ui-as-side__group > .ui-as-side__label:first-child { margin-top: 6px; }
.ui-as-side__count { margin-left: auto; font-size: 12px; color: var(--faint); font-variant-numeric: tabular-nums; }
.ui-as-side__empty { padding: 4px 6px; font-size: 13px; color: var(--faint); }
.ui-as-side__item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: 30px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--text);
  text-align: left;
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-as-side__item svg { color: var(--muted); }
.ui-as-side__item:hover { background: var(--hover); color: var(--ink); }
.ui-as-side__item[aria-current="page"] { background: var(--select); color: var(--ink); font-weight: 500; }
.ui-as-side__item[aria-current="page"] svg { color: var(--ink); }
a.ui-as-side__item { text-decoration: none; cursor: pointer; }
.ui-as-side__label {
  margin: 16px 0 4px;
  padding: 0 6px;
  font-size: 12.5px;
  line-height: 16px;
  color: var(--faint);
}

.ui-as-side__foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}

/* "What's new" – two cards stacked, the second one peeks out above */
.ui-as-news { position: relative; padding-top: 30px; }
.ui-as-news__card {
  position: relative;
  z-index: 1;
  padding: 10px 10px 0;
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), 0 2px 6px rgba(0, 0, 0, 0.04);
}
.ui-as-news__card--back {
  position: absolute;
  z-index: 0;
  top: 0;
  left: 10px;
  right: 10px;
  height: 48px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 9px 9px 0;
  background: var(--card);
  color: var(--faint);
}
.ui-as-news[data-count="1"] { padding-top: 0; }
.ui-as-news[data-count="1"] .ui-as-news__card--back { display: none; }
.ui-as-news__top { display: flex; align-items: center; justify-content: space-between; }
.ui-as-news__kicker { font-size: 11.5px; line-height: 15px; font-weight: 500; color: var(--accent); }
.ui-as-news__close {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin: -2px -2px 0 0;
  border-radius: 6px;
  color: var(--faint);
}
.ui-as-news__close:hover { background: var(--hover); color: var(--ink); }
.ui-as-news__title { display: block; margin-top: 4px; font-size: 13.5px; line-height: 18px; font-weight: 600; color: var(--ink); }
.ui-as-news__more {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% + 20px);
  height: 34px;
  margin: 10px -10px 0;
  padding: 0 10px;
  border-top: 1px solid var(--line-soft);
  border-radius: 0 0 12px 12px;
  font-size: 12.5px;
  color: var(--muted);
}
.ui-as-news__more:hover { background: var(--subtle); color: var(--ink); }

/* Onboarding progress */
/* Getting started: one card that morphs between the short summary and the full Setup Guide */
.ui-as-guide-slot { position: relative; flex: none; }
.ui-as-guide {
  position: absolute;
  z-index: 6;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), 0 2px 6px rgba(0, 0, 0, 0.04);
  transition: height 480ms var(--ease), border-radius 480ms var(--ease), box-shadow 200ms ease;
}
.ui-as-guide:not([data-open]):hover { box-shadow: 0 0 0 1px var(--line-strong), 0 2px 6px rgba(0, 0, 0, 0.05); }
.ui-as-guide[data-open] { border-radius: 14px; box-shadow: 0 0 0 1px var(--line), 0 8px 24px -10px rgba(0, 0, 0, 0.14); }
.ui-as-guide__content { animation: ui-as-guide-in 360ms var(--ease) both; }
/* Closing: the guide fades out while the card shrinks back to the summary's height */
.ui-as-guide[data-state="closing"] .ui-as-guide__content { animation: ui-as-guide-out 260ms ease both; }
.ui-as-guide[data-state="closing"] { border-radius: 12px; box-shadow: 0 0 0 1px var(--line), 0 2px 6px rgba(0, 0, 0, 0.04); }
@keyframes ui-as-guide-out { to { opacity: 0; } }
@keyframes ui-as-guide-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.ui-as-steps {
  display: grid;
  gap: 3px;
  width: 100%;
  padding: 10px 10px 9px;
  text-align: left;
}
/* The library's Setup Guide inside the card: its own frame drops away, the card is the frame */
/* Opening and closing belong to the card, so the guide's own minimize button is left out */
.ui-as-guide .ui-sg__icon-btn[aria-expanded] { display: none; }
.ui-as-guide .ui-sg { zoom: 0.86; max-width: none; padding: 12px 4px 4px; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
.ui-as-steps__title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13.5px;
  line-height: 18px;
  font-weight: 600;
  color: var(--ink);
}
.ui-as-steps__title svg { color: var(--faint); }
.ui-as-steps__sub { font-size: 12.5px; line-height: 17px; color: var(--muted); }
.ui-as-steps__cheer { color: var(--accent); }
.ui-as-steps__bar {
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--tray);
}
.ui-as-steps__bar i { display: block; min-width: 6px; height: 100%; border-radius: inherit; background: var(--accent); transition: width 600ms var(--ease); }

.ui-as-user {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--ink);
}
.ui-as-user img { width: 21px; height: 21px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06); }
.ui-as-user svg { margin-left: auto; color: var(--faint); }
.ui-as-user:hover { background: var(--hover); }

/* ---------- Main ---------- */

/* Main area as a rounded panel, like the affectUI library */
.ui-as-main {
  /* Screens reflow their content by the width of this panel */
  container: ui-as-main / inline-size;
  position: relative;
  min-width: 0;
  margin: var(--frame-gap) var(--frame-gap) var(--frame-gap) 0;
  overflow-y: auto;
  /* No rubber-band bounce at the ends – sticky headers stay put */
  overscroll-behavior: none;
  transition: margin-left 420ms var(--ease);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--panel);
}


/* Shared page parts: headings, toolbars, tabs, search, empty states – affectUI tokens */

.ui-as-page {
  padding: 46px 32px 56px;
}
.ui-as-page-title {
  margin: 0;
  font-size: 22px;
  line-height: 28px;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.ui-as-page-sub {
  margin: 6px 0 0;
  font-size: 13.5px;
  line-height: 20px;
  color: var(--muted);
}
.ui-as-page-sub a { color: var(--text); text-decoration: underline; text-decoration-color: var(--line-strong); text-underline-offset: 3px; }
.ui-as-page-sub a:hover { color: var(--ink); text-decoration-color: currentColor; }

.ui-as-section-head { margin-top: 38px; }
/* Without tabs the tools sit on the same line as the title */
.ui-as-section-head[data-inline] { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.ui-as-section-head[data-inline] .ui-as-toolbar { margin-top: 0; }
.ui-as-section-head__title {
  margin: 0;
  font-size: 16px;
  line-height: 22px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.ui-as-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
}
.ui-as-toolbar__left, .ui-as-toolbar__right { display: flex; align-items: center; gap: 6px; }

/* Segmented tabs: the active one gets a soft gray fill */
.ui-as-tabs { position: relative; display: flex; gap: 2px; }
/* The gray pill glides under the active tab */
.ui-as-tabs__pill {
  position: absolute;
  top: 0;
  left: 0;
  height: 32px;
  border-radius: 9px;
  background: var(--chip);
  transition: transform 340ms var(--ease), width 340ms var(--ease);
}
.ui-as-tabs__tab {
  position: relative;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-as-tabs__tab:hover { color: var(--ink); }
.ui-as-tabs__tab[aria-selected="true"] { color: var(--ink); }

/* Small outlined tools */
.ui-as-tool {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  color: var(--text);
  transition: box-shadow 140ms ease, color 140ms ease;
}
.ui-as-tool svg { color: var(--muted); }
.ui-as-tool:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow); color: var(--ink); }
.ui-as-tool--label { padding: 0 10px; font-size: 13px; }

.ui-as-view {
  position: relative;
  display: flex;
  gap: 2px;
  height: 32px;
  padding: 2px;
  border-radius: 9px;
  background: var(--chip);
}
.ui-as-view__btn {
  display: grid;
  place-items: center;
  width: 30px;
  border-radius: 7px;
  color: var(--faint);
}
.ui-as-view__btn:hover { color: var(--ink); }
.ui-as-view__btn { position: relative; transition: color 160ms ease; }
.ui-as-view__btn[aria-checked="true"] { color: var(--ink); }
/* White pill that slides between grid and list */
.ui-as-view__pill {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 2px;
  width: 30px;
  border-radius: 7px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  transition: transform 320ms var(--ease);
}
.ui-as-view[data-view="list"] .ui-as-view__pill { transform: translateX(32px); }

.ui-as-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 10px;
  border-radius: 9px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  color: var(--faint);
  cursor: text;
  transition: box-shadow 140ms ease;
}
.ui-as-search:focus-within { box-shadow: 0 0 0 1px var(--line-strong), 0 0 0 3px rgba(0, 0, 0, 0.04); }
.ui-as-search input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: var(--ink);
}
.ui-as-search input::placeholder { color: var(--placeholder); }
.ui-as-search__clear {
  display: grid;
  flex: none;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--chip);
  color: var(--muted);
  animation: ui-as-pop 220ms var(--ease);
}
.ui-as-search__clear:hover { color: var(--ink); }

/* Sort: the arrows turn half a circle for Z–A */
.ui-as-sort svg { transition: transform 360ms var(--ease); }
.ui-as-sort[data-dir="desc"] svg { transform: rotate(180deg); }
.ui-as-tool[data-active] { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow); color: var(--ink); }
.ui-as-tool__count {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--ink);
  font-size: 11px;
  font-weight: 600;
  color: var(--on-ink);
  animation: ui-as-pop 220ms var(--ease);
}

/* Popovers: attached to their trigger, they fade and scale in from that side */
.ui-as-anchor { position: relative; display: inline-flex; }
.ui-as-popover {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  left: 0;
  transform-origin: top left;
  animation: ui-as-popover 220ms var(--ease);
}
.ui-as-popover[data-align="end"] { right: 0; left: auto; transform-origin: top right; }
.ui-as-popover[data-side="top"] { top: auto; bottom: calc(100% + 6px); transform-origin: bottom left; animation-name: ui-as-popover-up; }
.ui-as-popover[data-side="top"][data-align="end"] { transform-origin: bottom right; }
.ui-as-popover[data-side="right"] { top: auto; bottom: 0; left: calc(100% + 12px); transform-origin: bottom left; }
@keyframes ui-as-popover-up { from { opacity: 0; transform: scale(0.96) translateY(4px); } to { opacity: 1; transform: none; } }
.ui-as-popover--filter .ui-fm { zoom: 0.9; width: 340px; }

.ui-as-menu {
  min-width: 168px;
  padding: 4px;
  border-radius: 12px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), 0 12px 32px -8px rgba(0, 0, 0, 0.16);
}
.ui-as-menu__title { display: block; padding: 6px 10px 4px; font-size: 12px; font-weight: 500; color: var(--faint); }
.ui-as-menu__list { display: grid; gap: 1px; }
.ui-as-menu__item {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  min-height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text);
  text-align: left;
  white-space: nowrap;
  transition: background-color 120ms ease, color 120ms ease;
}
.ui-as-menu__item[data-rich] { min-height: 44px; padding: 6px 10px; }
.ui-as-menu__item > svg { flex: none; color: var(--muted); }
.ui-as-menu__item > svg:last-child:not(:first-child) { margin-left: auto; color: var(--ink); }
.ui-as-menu__label { display: grid; flex: 1; gap: 1px; min-width: 0; }
.ui-as-menu__label small { font-size: 12px; line-height: 16px; color: var(--faint); }
.ui-as-menu__item:hover { background: var(--hover); color: var(--ink); }
.ui-as-menu__item[aria-checked="true"] { color: var(--ink); font-weight: 500; }
.ui-as-menu__item[aria-checked="true"] small { font-weight: 400; }
.ui-as-menu__item[data-danger] { color: #dc2626; }
.ui-as-menu__item[data-danger] > svg { color: #dc2626; }

.ui-as-toast {
  position: absolute;
  z-index: 40;
  left: 50%;
  bottom: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px 0 12px;
  border-radius: 999px;
  background: var(--ink);
  font-size: 13px;
  color: var(--on-ink);
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.35);
  translate: -50% 0;
  animation: ui-as-toast 2200ms var(--ease) both;
}

/* Shared motion: content that changes (tabs, filters, new messages) rises in; --i staggers a list */
.ui-as-rise { animation: ui-as-rise 420ms var(--ease) both; animation-delay: calc(var(--i, 0) * 35ms); }
@keyframes ui-as-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes ui-as-pop { from { opacity: 0; transform: scale(0.6); } to { opacity: 1; transform: none; } }
@keyframes ui-as-popover { from { opacity: 0; transform: scale(0.96) translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes ui-as-toast {
  0% { opacity: 0; transform: translateY(12px) scale(0.96); }
  12%, 85% { opacity: 1; transform: none; }
  100% { opacity: 0; transform: translateY(6px); }
}
@media (prefers-reduced-motion: reduce) {
  .ui-as *, .ui-as *::before, .ui-as *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}
.ui-as-search input::-webkit-search-cancel-button { display: none; }

/* Empty state in a dashed drop area */
.ui-as-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-top: 16px;
  padding: 48px 24px 52px;
  border: 1px dashed var(--line-strong);
  border-radius: 14px;
  text-align: center;
}
.ui-as-empty[data-tall] { padding: 48px 24px 48px; }
.ui-as-empty__icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 11px;
  background: var(--chip);
  color: var(--muted);
}
.ui-as-empty__title { margin-top: 16px; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--ink); }
.ui-as-empty__text { max-width: 430px; margin: 6px 0 0; font-size: 13px; line-height: 19px; color: var(--muted); text-wrap: balance; }
.ui-as-empty > .ui-button { margin-top: 18px; }

/* Glass Folder from the library at icon size; hovering the whole card or row opens it like hovering the folder itself */
.ui-as-folder-card__icon, .ui-as-folder-head__icon {
  position: relative;
  flex: none;
  width: 30px;
  height: 25px;
}
.ui-as-folder-card__icon .ui-fd, .ui-as-folder-head__icon .ui-fd {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 75px;
  translate: -50% -50%;
}
:is(.ui-as-folder-card, .ui-as-folder-head):hover .ui-fd-icon { transform: translate(-50%, -48%) scale(1.03); }
:is(.ui-as-folder-card, .ui-as-folder-head):hover .ui-fd-doc--left { transform: translate(32px, 70px) rotate(9deg); }
:is(.ui-as-folder-card, .ui-as-folder-head):hover .ui-fd-doc--right { transform: translate(286px, 76px) rotate(5deg); }
:is(.ui-as-folder-card, .ui-as-folder-head):hover .ui-fd-doc--middle { transform: translate(166px, 52px) rotate(-7deg); }
:is(.ui-as-folder-card, .ui-as-folder-head):hover .ui-fd-front {
  top: 24.8%;
  border-radius: 3cqw 3cqw 6.333cqw 6.333cqw;
  transform: translateZ(2.33cqw) rotateX(-9deg);
}

.ui-as-meta { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; line-height: 17px; color: var(--muted); }
.ui-as-meta svg { color: var(--faint); }


/* File card – used for templates and for the files inside a folder */
.ui-as-template { display: grid; width: 239px; text-align: left; }
.ui-as-template__preview {
  display: block;
  height: 158px;
  padding: 7px;
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  transition: box-shadow 160ms ease;
}
.ui-as-template:hover .ui-as-template__preview { box-shadow: 0 0 0 1px var(--line-strong), 0 2px 8px rgba(0, 0, 0, 0.05); }
.ui-as-template__name { margin-top: 10px; font-size: 13.5px; line-height: 18px; font-weight: 500; color: var(--ink); }
.ui-as-template .ui-as-meta { margin-top: 2px; }

/* File illustration in the Glass Folder style: tinted back sheet, paper page, frosted type badge */
.ui-as-doc {
  --doc-back: #5bb7ea;
  --doc-glass-1: rgba(120, 200, 245, 0.72);
  --doc-glass-2: rgba(52, 150, 212, 0.78);
  --doc-shade: 60, 130, 180;
  --doc-paper: #eaf2f8;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  border-radius: 10px;
  background: var(--card);
}
.ui-as-doc[data-color="rose"] {
  --doc-back: #f27b90;
  --doc-glass-1: rgba(250, 150, 170, 0.74);
  --doc-glass-2: rgba(222, 70, 100, 0.8);
  --doc-shade: 190, 60, 88;
  --doc-paper: #f9eef1;
}
.ui-as-doc[data-color="emerald"] {
  --doc-back: #4cc591;
  --doc-glass-1: rgba(110, 215, 165, 0.74);
  --doc-glass-2: rgba(30, 160, 102, 0.8);
  --doc-shade: 40, 140, 96;
  --doc-paper: #edf7f2;
}
.ui-as-doc__art { position: relative; display: block; width: 72px; height: 92px; }

/* Tinted sheet peeking out behind the page, like the back of the folder */
.ui-as-doc__back {
  position: absolute;
  inset: 0;
  border-radius: 11px;
  background: var(--doc-back);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45), 0 10px 18px -8px rgba(var(--doc-shade), 0.45);
  transform: translate(10px, -4px) rotate(8deg);
  transition: transform 420ms var(--ease);
}

/* The page: white fading into a hint of the file's colour, like the documents in the folder */
.ui-as-doc__page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 11px;
  border-radius: 11px;
  background: linear-gradient(180deg, var(--doc-page, #fff) 0%, var(--doc-paper) 100%);
  box-shadow: 0 0 0 1px var(--doc-edge, rgba(0, 0, 0, 0.1)), 0 3px 5px rgba(var(--doc-shade), 0.16);
  transform: rotate(-3deg);
  transition: transform 420ms var(--ease);
}
.ui-as-doc__title { display: block; width: 58%; height: 5px; margin-bottom: 3px; border-radius: 3px; background: var(--doc-ink-strong, rgba(0, 0, 0, 0.2)); }
.ui-as-doc__line { display: block; height: 4px; border-radius: 2px; background: var(--doc-ink, rgba(0, 0, 0, 0.1)); }
.ui-as-doc__image {
  display: block;
  height: 26px;
  margin-bottom: 2px;
  border-radius: 5px;
  background: linear-gradient(160deg, var(--doc-glass-1), var(--doc-glass-2));
  opacity: 0.55;
}

/* Spreadsheet: a 3 × 6 grid with a darker header row */
.ui-as-sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; }
.ui-as-sheet i { height: 8px; border-radius: 2px; background: var(--doc-cell, rgba(0, 0, 0, 0.07)); }
.ui-as-sheet i:nth-child(-n + 3) { background: rgba(var(--doc-shade), 0.35); }

/* Small frosted glass tag at the lower right corner, the same recipe as the folder's front pocket */
.ui-as-doc__type {
  position: absolute;
  right: -12px;
  bottom: 10px;
  z-index: 2;
  padding: 3px 6px;
  border-radius: 5px;
  background:
    linear-gradient(180deg, rgba(0, 0, 0, 0) 55%, rgba(var(--doc-shade), 0.25) 100%),
    linear-gradient(180deg, var(--doc-glass-1), var(--doc-glass-2));
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.35),
    inset 0 1px 0 rgba(255, 255, 255, 0.6),
    0 6px 12px -4px rgba(var(--doc-shade), 0.45);
  -webkit-backdrop-filter: blur(4px) saturate(1.15);
  backdrop-filter: blur(4px) saturate(1.15);
  font-size: 10px;
  line-height: 13px;
  font-weight: 600;
  color: #fff;
  text-shadow: 0 1px 2px rgba(var(--doc-shade), 0.45);
  transition: transform 420ms var(--ease);
}
.ui-as-template:hover .ui-as-doc__back { transform: translate(14px, -7px) rotate(12deg); }
.ui-as-template:hover .ui-as-doc__page { transform: translateY(-4px) rotate(-5deg); }
.ui-as-template:hover .ui-as-doc__type { transform: translate(2px, -2px); }

/* Workspace initial and user initials */
.ui-as-side__logo { font-size: 10.5px; font-weight: 600; color: var(--ink); }
.ui-as-user__initials {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--accent-soft);
  font-size: 9.5px;
  font-weight: 600;
  color: var(--accent);
}

/* File illustrations in dark mode: dark paper tinted by the file's color, light lines */
:where(.dark, [data-theme="dark"]) .ui-as-doc {
  --doc-page: #303238;
  --doc-edge: rgba(255, 255, 255, 0.1);
  --doc-ink: rgba(255, 255, 255, 0.14);
  --doc-ink-strong: rgba(255, 255, 255, 0.3);
  --doc-cell: rgba(255, 255, 255, 0.08);
}
:where(.dark, [data-theme="dark"]) .ui-as-doc { --doc-paper: #263039; }
:where(.dark, [data-theme="dark"]) .ui-as-doc[data-color="rose"] { --doc-paper: #36282d; }
:where(.dark, [data-theme="dark"]) .ui-as-doc[data-color="emerald"] { --doc-paper: #243530; }

/* Scrim behind the drawer – only used on narrow screens */
.ui-as-scrim { display: none; }

/* ---------- Resizing ---------- */

/* A 12px strip centred on the main area's edge; on hover a darker line runs along the page's edge, fading to nothing
   at both ends – so it meets the rounded corners of the inset panel softly */
.ui-as-resizer {
  position: absolute;
  z-index: 15;
  top: calc(var(--bar-h, 0px) + var(--frame-gap));
  bottom: var(--frame-gap);
  width: 12px;
  cursor: col-resize;
  touch-action: none;
  outline: none;
}
.ui-as-resizer[data-edge="left"] { left: calc(var(--side-w, 272px) - 6px); }
.ui-as-resizer[data-edge="right"] { right: calc(var(--panel-w, 360px) - 6px); }
.ui-as-resizer::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(to bottom, transparent, var(--edge-active) 22%, var(--edge-active) 78%, transparent);
  opacity: 0;
  transition: opacity 180ms ease;
}
/* Exactly on the page's border: its left edge on the left, its right edge on the right */
.ui-as-resizer[data-edge="left"]::after { left: 6px; }
.ui-as-resizer[data-edge="right"]::after { left: 5px; }
.ui-as-resizer:hover::after { opacity: 1; transition-delay: 100ms; }
.ui-as-resizer:focus-visible::after, .ui-as-resizer[data-dragging]::after { opacity: 1; transition-delay: 0ms; }

/* ---------- Work area on the right ---------- */

/* Sits on the gray page like the sidebar, mirrored; the main area gives up its right gap to it */
.ui-as-app[data-panel] > .ui-as-main { grid-column: 2; }
.ui-as-app[data-panel="open"] > .ui-as-main { margin-right: 0; }
.ui-as-panel {
  grid-column: 3;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  width: var(--panel-w, 360px);
  min-height: 0;
  padding: 10px 10px 10px 8px;
  overflow: hidden;
  transition: opacity 260ms ease, translate 420ms var(--ease), visibility 0s;
}
.ui-as-app[data-panel="closed"] > .ui-as-panel {
  visibility: hidden;
  opacity: 0;
  translate: 16px 0;
  transition: opacity 200ms ease, translate 420ms var(--ease), visibility 0s 420ms;
}
.ui-as-panel__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding-left: 6px;
}
.ui-as-panel__title { font-size: 13px; font-weight: 500; color: var(--ink); }
.ui-as-panel__body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; margin: 0 -2px; padding: 12px 2px 4px; }

/* Its icon waits in the top right corner of the main area while it's closed */
.ui-as-panel-open {
  position: fixed;
  z-index: 20;
  top: calc(var(--frame-gap) + 9px);
  right: calc(var(--frame-gap) + 9px);
  visibility: hidden;
  opacity: 0;
  transition: opacity 200ms ease, visibility 0s 200ms;
}
.ui-as-app[data-panel="closed"] > .ui-as-panel-open {
  visibility: visible;
  opacity: 1;
  transition: opacity 260ms ease 160ms, visibility 0s;
}

/* ---------- Header across the app ---------- */

/* One bar over everything: a row of its own on top, split into the sidebar's, the page's and the work area's part */
.ui-as-app[data-header] { --bar-h: 48px; grid-template-rows: var(--bar-h) minmax(0, 1fr); }
.ui-as-app[data-header] > .ui-as-bar--side { grid-area: 1 / 1; }
.ui-as-app[data-header] > .ui-as-bar--main { grid-area: 1 / 2; }
.ui-as-app[data-header] > .ui-as-bar--panel { grid-area: 1 / 3; }
.ui-as-app[data-header] > .ui-as-side { grid-area: 2 / 1; }
.ui-as-app[data-header] > .ui-as-main { grid-area: 2 / 2; margin-top: 0; }
.ui-as-app[data-header] > .ui-as-panel { grid-area: 2 / 3; }
.ui-as-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  height: var(--bar-h);
  overflow: hidden;
  transition: padding 420ms var(--ease), opacity 260ms ease;
}
.ui-as-bar--side { padding: 0 10px; }
.ui-as-bar--side > :last-child { margin-left: auto; }
.ui-as-bar--main { justify-content: space-between; gap: 12px; padding: 0 12px 0 18px; }
.ui-as-bar--panel { justify-content: space-between; padding: 0 10px 0 16px; }
.ui-as-bar__title { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 13.5px; font-weight: 500; color: var(--ink); white-space: nowrap; }
.ui-as-bar__title > * { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-as-bar__actions { display: flex; flex: none; align-items: center; gap: 2px; }
.ui-as-bar__pick { display: flex; align-items: center; gap: 6px; min-width: 0; height: 30px; margin-left: -8px; padding: 0 8px; border-radius: 8px; color: var(--ink); }
.ui-as-bar__pick > span { overflow: hidden; text-overflow: ellipsis; }
.ui-as-bar__pick svg { color: var(--faint); }
.ui-as-bar__pick:hover { background: var(--hover); }
/* The sidebar's own tools move into the bar; the head keeps just the workspace */
.ui-as-app[data-header] > .ui-as-side .ui-as-side__tools,
.ui-as-app[data-header] > .ui-as-panel > .ui-as-panel__head { display: none; }
.ui-as-app[data-header] > .ui-as-panel > .ui-as-panel__body { padding-top: 2px; }
/* Folded away: their part of the bar goes with them, and the icons to bring them back sit in the page's bar */
.ui-as-app[data-header][data-collapsed] > .ui-as-bar--side,
.ui-as-app[data-header][data-panel="closed"] > .ui-as-bar--panel { opacity: 0; }
.ui-as-app[data-header][data-collapsed] > .ui-as-bar--main { padding-left: 50px; }
.ui-as-app[data-header][data-panel="closed"] > .ui-as-bar--main { padding-right: 50px; }
.ui-as-app[data-header] > :is(.ui-as-side-open, .ui-as-panel-open) { top: 10px; }

/* A page that is just one centred block, e.g. an empty state */
.ui-as-center { display: grid; place-items: center; min-height: 100%; padding: 48px 32px; }
.ui-as-empty[data-bare] { margin-top: 0; padding: 0; border: 0; }

/* ---------- Narrow: tablet and phone ---------- */
/* Container queries on the app itself, so a scaled 1440 px preview keeps the desktop layout */

@container ui-as (max-width: 900px) {
  /* The main panel takes the whole width; the sidebar slides in over it as a drawer */
  .ui-as-app > .ui-as-main { grid-row: 1; grid-column: 1 / -1; margin-left: var(--frame-gap); }
  .ui-as-app > .ui-as-side {
    position: absolute;
    z-index: 50;
    top: 0;
    bottom: 0;
    left: 0;
    width: min(264px, calc(100% - 56px));
    padding: 10px 10px 10px 12px;
    border-radius: 0 18px 18px 0;
    background: var(--page);
    box-shadow: 0 0 0 1px var(--line), 0 24px 48px -12px rgba(0, 0, 0, 0.28);
  }
  .ui-as-app:not([data-drawer]) > .ui-as-side {
    visibility: hidden;
    translate: calc(-100% - 24px) 0;
    transition: translate 380ms var(--ease), visibility 0s 380ms;
  }
  .ui-as-app[data-drawer] > .ui-as-side {
    visibility: visible;
    opacity: 1;
    translate: 0 0;
    transition: translate 420ms var(--ease), visibility 0s;
  }
  /* The work area on the right becomes a drawer too, sliding in from the right */
  .ui-as-app[data-panel] { --panel-col: 0px; }
  .ui-as-app[data-panel] > .ui-as-main { grid-column: 1 / -1; margin-right: var(--frame-gap); }
  .ui-as-app > .ui-as-panel {
    position: absolute;
    z-index: 50;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, calc(100% - 56px));
    padding: 10px 12px 10px 10px;
    border-radius: 18px 0 0 18px;
    background: var(--page);
    box-shadow: 0 0 0 1px var(--line), 0 24px 48px -12px rgba(0, 0, 0, 0.28);
  }
  .ui-as-app[data-panel="closed"] > .ui-as-panel {
    translate: calc(100% + 24px) 0;
    transition: translate 380ms var(--ease), visibility 0s 380ms;
  }
  .ui-as-app[data-panel="open"] > .ui-as-panel { visibility: visible; opacity: 1; translate: 0 0; transition: translate 420ms var(--ease), visibility 0s; }
  .ui-as-app[data-panel="open"] > .ui-as-scrim { visibility: visible; opacity: 1; transition: opacity 300ms ease, visibility 0s; }
  .ui-as-app > .ui-as-panel-open { right: calc(var(--frame-gap) + 9px); background: var(--panel); }
  .ui-as-app > .ui-as-panel-open:hover { background: var(--chip); }
  /* With the header: the page's part spans the bar; the sidebar's and work area's parts go into their drawers */
  .ui-as-app[data-header] > .ui-as-main { grid-area: 2 / 1 / 3 / -1; }
  .ui-as-app[data-header] > .ui-as-bar--main { grid-area: 1 / 1 / 2 / -1; padding-left: 50px; }
  .ui-as-app[data-header][data-panel] > .ui-as-bar--main { padding-right: 50px; }
  .ui-as-app[data-header] > :is(.ui-as-bar--side, .ui-as-bar--panel) { display: none; }
  /* The drawers cover the full height, over the bar too – not just their grid row */
  .ui-as-app[data-header] > :is(.ui-as-side, .ui-as-panel) { grid-area: auto; }
  .ui-as-app[data-header] > .ui-as-side .ui-as-side__tools { display: flex; }
  .ui-as-app[data-header] > .ui-as-panel > .ui-as-panel__head { display: flex; }
  .ui-as-app[data-header] > .ui-as-panel > .ui-as-panel__body { padding-top: 12px; }
  .ui-as-app > .ui-as-scrim {
    display: block;
    position: absolute;
    z-index: 45;
    inset: 0;
    background: rgba(0, 0, 0, 0.28);
    visibility: hidden;
    opacity: 0;
    transition: opacity 300ms ease, visibility 0s 300ms;
  }
  .ui-as-app[data-drawer] > .ui-as-scrim { visibility: visible; opacity: 1; transition: opacity 300ms ease, visibility 0s; }
  :where(.dark, [data-theme="dark"]) .ui-as-app > .ui-as-scrim { background: rgba(0, 0, 0, 0.55); }
  /* The icon to open it always waits in the top left corner of the panel */
  .ui-as-app:not([data-drawer]) > .ui-as-side-open {
    visibility: visible;
    opacity: 1;
    transition: opacity 260ms ease 160ms, visibility 0s;
  }
  /* It stays put while the panel scrolls, so it gets the panel's color behind it */
  .ui-as-app > .ui-as-side-open { left: calc(var(--frame-gap) + 9px); background: var(--panel); }
  .ui-as-app > .ui-as-side-open:hover { background: var(--chip); }

  /* Page parts: less padding, toolbars wrap */
  .ui-as-page { padding: 46px 24px 48px; }
  /* File cards fill the cells of the grids the screens switch to */
  .ui-as-main .ui-as-file-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .ui-as-main .ui-as-file-grid .ui-as-template { width: 100%; }
  .ui-as-main .ui-as-file-grid .ui-as-template__name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ui-as-main .ui-as-file-grid .ui-as-meta { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .ui-as-main .ui-as-file-grid .ui-as-meta svg { display: inline-block; vertical-align: -2px; }
  .ui-as-toolbar { flex-wrap: wrap; row-gap: 10px; }
  .ui-as-toolbar__right { flex-wrap: wrap; }
  .ui-as-section-head[data-inline] { flex-wrap: wrap; row-gap: 12px; }
}

@container ui-as (max-width: 600px) {
  .ui-as-app > * { --frame-gap: 6px; }
  .ui-as-app > .ui-as-main { border-radius: 11px; }
  .ui-as-page { padding: 52px 16px 40px; }
  .ui-as-page-title { font-size: 20px; line-height: 26px; }
  .ui-as-section-head { margin-top: 32px; }
  /* Toolbars: tabs on their own line, the tools below; search takes what is left */
  .ui-as-toolbar__left, .ui-as-toolbar__right { width: 100%; }
  .ui-as-toolbar__right .ui-as-search { order: 9; flex: 1 1 100%; width: auto !important; }
  .ui-as-toolbar__right > .ui-button:last-child { margin-left: auto; }
  .ui-as-tabs { max-width: 100%; overflow-x: auto; scrollbar-width: none; }
  .ui-as-tabs__tab { flex: none; }
  .ui-as-empty { padding: 36px 18px 40px; }
  .ui-as-popover--filter .ui-fm { width: 300px; }
  .ui-as-main .ui-as-file-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
  .ui-as-main .ui-as-file-grid .ui-as-template__preview { height: 128px; }
}
`;
