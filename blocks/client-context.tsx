"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Client Context – one client's numbers, reports and shared context, in a single self-contained file.
 * Switch or create clients, refresh the sync, open a metric, regenerate a report, and keep a timeline of notes
 * and files the whole team writes into: search it, filter it, mention reports with "@" and attach files.
 * The styles are injected below, so no extra files are needed.
 */

export type ContextPerson = { name: string; avatar?: string };
export type ContextFile = { name: string; type: "pdf" | "xlsx" | "csv" | "doc" };
export type ContextEntry =
  /** A note – "@Report name" of one of the client's reports becomes a mention */
  | { id: string; kind: "note"; author: ContextPerson; when: string; text: string }
  | { id: string; kind: "report"; author: ContextPerson; when: string; report: string }
  | { id: string; kind: "files"; author: ContextPerson; when: string; files: ContextFile[]; text?: string }
  | { id: string; kind: "integration"; when: string; app: string; connected: boolean };
export type ContextKpi = { label: string; value: string; previous: string; delta: number; points: number[]; color: string };
export type ContextReport = { name: string; when: string; summary: string };
export type ContextClient = {
  id: string;
  name: string;
  /** Second line under the name, e.g. legal name, currency and fiscal year end */
  meta: string;
  /** Initial and colors of the client's mark */
  mark: { letter: string; bg: string; fg: string };
  kpis: ContextKpi[];
  reports: ContextReport[];
  context: ContextEntry[];
};

export type ClientContextProps = {
  clients?: ContextClient[];
  /** The signed-in person – author of new context */
  me?: ContextPerson;
  /** Called when context is added, with the client, the text and any attached files */
  onAddContext?: (clientId: string, text: string, files: ContextFile[]) => void;
  /** Called when a client is created from the switcher */
  onCreateClient?: (name: string) => void;
  className?: string;
};

type Kind = ContextEntry["kind"];
type Tab = "context" | "reports" | "financials" | "settings";

const people = {
  lena: { name: "Lena Hart", avatar: "/avatars/lena.jpg" },
  jonas: { name: "Jonas Weber", avatar: "/avatars/jonas.jpg" },
  mara: { name: "Mara Novak", avatar: "/avatars/mara.jpg" },
  theo: { name: "Theo Brandt", avatar: "/avatars/theo.jpg" },
};

const defaultClients: ContextClient[] = [
  {
    id: "northwind",
    name: "Northwind Logistics",
    meta: "Northwind Logistics GmbH · EUR · Fiscal year ends Dec 31",
    mark: { letter: "N", bg: "#1d4ed8", fg: "#ffffff" },
    kpis: [
      { label: "MRR", value: "€48.2k", previous: "€44.9k", delta: 7.4, points: [31, 33, 32, 35, 36, 35, 38, 40, 41, 44], color: "#2f6bff" },
      { label: "Cash", value: "€612k", previous: "€648k", delta: -5.6, points: [44, 43, 43, 41, 40, 41, 38, 37, 36, 35], color: "#0ea5e9" },
      { label: "Gross margin", value: "64.1%", previous: "62.8%", delta: 1.3, points: [30, 31, 30, 32, 31, 33, 32, 33, 34, 34], color: "#8b5cf6" },
      { label: "Net burn", value: "€36.0k", previous: "€41.5k", delta: -13.3, points: [42, 41, 43, 40, 39, 38, 39, 36, 35, 33], color: "#ec4899" },
    ],
    reports: [
      { name: "Monthly P&L", when: "1d ago", summary: "Revenue up 7% on the new Hamburg routes; freight costs flat, so margin improved by 1.3 points." },
      { name: "Cash runway", when: "6d ago", summary: "17 months at the current burn. The Q1 fleet lease pushes it to 15 if signed in January." },
      { name: "Board pack Q3", when: "2w ago", summary: "Highlights, KPIs and the three decisions for the board: pricing, fleet lease and the Nordics pilot." },
    ],
    context: [
      {
        id: "n1",
        kind: "note",
        author: people.lena,
        when: "today",
        text: "CFO wants every figure in the @Monthly P&L in EUR, also for the Danish entity – no converted totals.",
      },
      { id: "n2", kind: "report", author: people.jonas, when: "1d ago", report: "Monthly P&L" },
      {
        id: "n3",
        kind: "files",
        author: people.jonas,
        when: "2d ago",
        files: [
          { name: "budget-2027.pdf", type: "pdf" },
          { name: "fleet-costs-Q3.xlsx", type: "xlsx" },
        ],
      },
      {
        id: "n4",
        kind: "note",
        author: people.lena,
        when: "4d ago",
        text: "Renewal talks start in November. They'll ask for a lower rate if the Nordics pilot slips – keep the @Cash runway current.",
      },
      { id: "n5", kind: "integration", when: "1w ago", app: "Stripe", connected: true },
    ],
  },
  {
    id: "lumen",
    name: "Lumen Labs",
    meta: "Lumen Labs, Inc. · GBP · Fiscal year ends Mar 31",
    mark: { letter: "L", bg: "#f97316", fg: "#ffffff" },
    kpis: [
      { label: "ARR", value: "£1.84m", previous: "£1.62m", delta: 13.6, points: [20, 22, 23, 25, 27, 28, 30, 33, 35, 38], color: "#2f6bff" },
      { label: "Cash", value: "£980k", previous: "£1.06m", delta: -7.5, points: [46, 45, 43, 42, 41, 40, 38, 37, 36, 35], color: "#0ea5e9" },
      { label: "Gross margin", value: "78.0%", previous: "77.2%", delta: 0.8, points: [36, 36, 37, 36, 37, 37, 38, 37, 38, 38], color: "#8b5cf6" },
      { label: "Runway", value: "17 mo", previous: "18 mo", delta: -5.6, points: [40, 39, 39, 38, 37, 37, 36, 35, 35, 34], color: "#ec4899" },
    ],
    reports: [{ name: "Runway forecast", when: "today", summary: "Hiring four engineers in Q1 shortens the runway from 19 to 17 months." }],
    context: [
      { id: "l1", kind: "report", author: people.mara, when: "today", report: "Runway forecast" },
      {
        id: "l2",
        kind: "note",
        author: people.mara,
        when: "2d ago",
        text: "Hiring plan adds four engineers in Q1 – reflect it in the @Runway forecast before the board meeting.",
      },
      { id: "l3", kind: "files", author: people.theo, when: "4d ago", files: [{ name: "hiring-plan.doc", type: "doc" }] },
    ],
  },
  {
    id: "halcyon",
    name: "Halcyon Health",
    meta: "Halcyon Health Ltd · USD · Fiscal year ends Jun 30",
    mark: { letter: "H", bg: "#0f766e", fg: "#ffffff" },
    kpis: [
      { label: "Revenue", value: "$212k", previous: "$198k", delta: 7.1, points: [30, 29, 31, 33, 32, 34, 35, 34, 36, 37], color: "#2f6bff" },
      { label: "Cash", value: "$1.21m", previous: "$1.19m", delta: 1.7, points: [38, 38, 39, 38, 39, 40, 39, 40, 41, 41], color: "#0ea5e9" },
      { label: "Gross margin", value: "58.3%", previous: "59.0%", delta: -0.7, points: [36, 35, 36, 35, 35, 34, 35, 34, 34, 33], color: "#8b5cf6" },
      { label: "Net profit", value: "$18.4k", previous: "$12.0k", delta: 53.3, points: [20, 21, 19, 22, 24, 23, 26, 27, 29, 31], color: "#ec4899" },
    ],
    reports: [{ name: "Clinic margins", when: "3d ago", summary: "Two of nine clinics run below 40% margin; both opened this year." }],
    context: [
      {
        id: "h1",
        kind: "note",
        author: people.theo,
        when: "yesterday",
        text: "New clinics need 12 months before they count in the @Clinic margins comparison.",
      },
      { id: "h2", kind: "integration", when: "2w ago", app: "Stripe", connected: true },
    ],
  },
];

const kindLabels: Record<"all" | Kind, string> = {
  all: "All",
  note: "Notes",
  files: "Files",
  report: "Reports",
  integration: "Integrations",
};

const tabs: { id: Tab; label: string }[] = [
  { id: "context", label: "Context" },
  { id: "reports", label: "Reports" },
  { id: "financials", label: "Financials" },
  { id: "settings", label: "Settings" },
];

/** Files the attach button adds in turn */
const attachable: ContextFile[] = [
  { name: "board-deck-Q3.pdf", type: "pdf" },
  { name: "pipeline-export.csv", type: "csv" },
  { name: "headcount.xlsx", type: "xlsx" },
];

const palette = ["#7c3aed", "#db2777", "#0891b2", "#65a30d"];

export function ClientContext({
  clients: initialClients = defaultClients,
  me = { name: "Sofia Lind", avatar: "/avatars/sofia.jpg" },
  onAddContext,
  onCreateClient,
  className,
}: ClientContextProps) {
  const uid = "ui-cx" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [clients, setClients] = useState(initialClients);
  const [clientId, setClientId] = useState(initialClients[0]?.id);
  const [timeline, setTimeline] = useState<Record<string, ContextEntry[]>>(() =>
    Object.fromEntries(initialClients.map((c) => [c.id, c.context])),
  );
  const [reportTimes, setReportTimes] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("context");
  const [metric, setMetric] = useState<string | null>(null);
  const [openReport, setOpenReport] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [draft, setDraft] = useState("");
  const [caret, setCaret] = useState(0);
  const [files, setFiles] = useState<ContextFile[]>([]);
  const [menu, setMenu] = useState<"client" | "filter" | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [synced, setSynced] = useState<Record<string, "3m ago" | "syncing" | "just now">>({});
  const [settings, setSettings] = useState<Record<string, Record<string, boolean>>>({});
  const [fresh, setFresh] = useState<string | null>(null);
  const [mentionAt, setMentionAt] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const client = clients.find((c) => c.id === clientId) ?? clients[0];
  const entries = timeline[client.id] ?? [];
  const reportNames = client.reports.map((r) => r.name);
  const shown = entries.filter((e) => (filter === "all" || e.kind === filter) && matches(e, query));
  const sync = synced[client.id] ?? "3m ago";
  const setting = (key: string, fallback: boolean) => settings[client.id]?.[key] ?? fallback;
  const stripe = entries.find((e) => e.kind === "integration" && e.app === "Stripe") as
    | Extract<ContextEntry, { kind: "integration" }>
    | undefined;
  const stripeOn = stripe?.connected ?? false;

  // Mention suggestions: "@" plus what follows it, up to the caret
  const mentionQuery = mentionAt !== null ? draft.slice(mentionAt + 1, caret) : null;
  const suggestions =
    mentionQuery !== null && !/\n/.test(mentionQuery)
      ? reportNames.filter((n) => n.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 4)
      : [];

  // Menus close on outside click and Escape
  useEffect(() => {
    if (!menu) return;
    const close = () => {
      setMenu(null);
      setCreating(false);
    };
    const away = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.("[data-cx-menu]")) close();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);

  const push = (entry: ContextEntry) => {
    setTimeline((t) => ({ ...t, [client.id]: [entry, ...(t[client.id] ?? [])] }));
    setFresh(entry.id);
  };

  const pickClient = (id: string) => {
    setClientId(id);
    setMenu(null);
    setCreating(false);
    setQuery("");
    setFilter("all");
    setMetric(null);
    setOpenReport(null);
  };

  const createClient = () => {
    const name = newName.trim();
    if (!name) return;
    const id = `client-${Date.now()}`;
    const created: ContextClient = {
      id,
      name,
      meta: "New client · connect their books under Settings",
      mark: { letter: name.charAt(0).toUpperCase(), bg: palette[clients.length % palette.length], fg: "#ffffff" },
      kpis: client.kpis.map((k) => ({ ...k, value: "–", previous: "–", delta: 0, points: k.points.map(() => 1) })),
      reports: [],
      context: [],
    };
    setClients((c) => [...c, created]);
    setTimeline((t) => ({ ...t, [id]: [] }));
    onCreateClient?.(name);
    setNewName("");
    pickClient(id);
    setTab("context");
  };

  const refresh = () => {
    if (sync === "syncing") return;
    const id = client.id;
    setSynced((s) => ({ ...s, [id]: "syncing" }));
    setTimeout(() => setSynced((s) => ({ ...s, [id]: "just now" })), 900);
  };

  const add = () => {
    const text = draft.trim();
    if (!text && !files.length) return;
    const id = `new-${Date.now()}`;
    push(
      files.length
        ? { id, kind: "files", author: me, when: "just now", files, text: text || undefined }
        : { id, kind: "note", author: me, when: "just now", text },
    );
    onAddContext?.(client.id, text, files);
    setDraft("");
    setFiles([]);
    setFilter("all");
    setQuery("");
    setMentionAt(null);
  };

  const remove = (id: string) =>
    setTimeline((t) => ({ ...t, [client.id]: (t[client.id] ?? []).filter((e) => e.id !== id) }));

  const attach = () => {
    const next = attachable.find((f) => !files.some((x) => x.name === f.name));
    if (next) setFiles((f) => [...f, next]);
  };

  const onDraft = (value: string, at: number) => {
    setDraft(value);
    setCaret(at);
    // An "@" at the start or after a space opens the suggestions
    const before = value.slice(0, at);
    const sign = before.lastIndexOf("@");
    setMentionAt(sign >= 0 && (sign === 0 || /\s/.test(before[sign - 1])) && !/\n|\s\s/.test(before.slice(sign)) ? sign : null);
  };

  const insertMention = (name: string) => {
    if (mentionAt === null) return;
    const next = `${draft.slice(0, mentionAt)}@${name} ${draft.slice(caret)}`;
    const at = mentionAt + name.length + 2;
    setDraft(next);
    setCaret(at);
    setMentionAt(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(at, at);
    });
  };

  const showReport = (name: string) => {
    setTab("reports");
    setOpenReport(name);
  };

  const mentionInContext = (name: string) => {
    setTab("context");
    setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}@${name} `);
    requestAnimationFrame(() => textarea.current?.focus());
  };

  const regenerate = (name: string) => {
    if (regenerating) return;
    setRegenerating(name);
    setTimeout(() => {
      setRegenerating(null);
      setReportTimes((t) => ({ ...t, [`${client.id}:${name}`]: "just now" }));
      push({ id: `rep-${Date.now()}`, kind: "report", author: me, when: "just now", report: name });
    }, 1100);
  };

  const toggleStripe = () =>
    push({ id: `int-${Date.now()}`, kind: "integration", when: "just now", app: "Stripe", connected: !stripeOn });

  const openMetric = (label: string) => {
    setMetric(label);
    setTab("financials");
  };

  const tabIndex = tabs.findIndex((t) => t.id === tab);

  return (
    <section className={["ui-cx", className].filter(Boolean).join(" ")}>
      <style href="ui-client-context" precedence="default">
        {css}
      </style>

      {/* Header on the tray */}
      <header className="ui-cx__head">
        <div className="ui-cx__who" key={client.id}>
          <Mark client={client} size={36} />
          <div className="ui-cx__who-text">
            <h2 className="ui-cx__name">{client.name}</h2>
            <p className="ui-cx__meta">{client.meta}</p>
          </div>
        </div>
        <div className="ui-cx__actions">
          <button type="button" className="ui-cx__chip-btn ui-cx__sync" onClick={refresh} aria-label="Sync now">
            <span className="ui-cx__sync-dot" data-state={sync} aria-hidden="true" />
            <span>{sync === "syncing" ? "Syncing…" : `Synced ${sync}`}</span>
            <span className="ui-cx__spin" data-spinning={sync === "syncing" || undefined}>
              <RefreshIcon />
            </span>
          </button>
          <div className="ui-cx__pop" data-cx-menu="">
            <button
              type="button"
              className="ui-cx__chip-btn"
              aria-haspopup="listbox"
              aria-expanded={menu === "client"}
              onClick={() => {
                setMenu(menu === "client" ? null : "client");
                setCreating(false);
              }}
            >
              Switch client
              <ChevronsIcon />
            </button>
            {menu === "client" && (
              <div className="ui-cx__menu ui-cx__menu--end">
                <ul role="listbox" aria-label="Client">
                  {clients.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={c.id === client.id}
                        className="ui-cx__menu-item"
                        onClick={() => pickClient(c.id)}
                      >
                        <Mark client={c} size={20} />
                        <span className="ui-cx__menu-label">{c.name}</span>
                        <span className="ui-cx__menu-check">{c.id === client.id && <CheckIcon />}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="ui-cx__menu-sep" />
                {creating ? (
                  <form
                    className="ui-cx__create"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createClient();
                    }}
                  >
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Client name"
                      aria-label="New client name"
                      maxLength={40}
                    />
                    <button type="submit" className="ui-cx__primary" disabled={!newName.trim()}>
                      Add
                    </button>
                  </form>
                ) : (
                  <button type="button" className="ui-cx__menu-item" onClick={() => setCreating(true)}>
                    <span className="ui-cx__menu-plus">
                      <PlusIcon />
                    </span>
                    <span className="ui-cx__menu-label">New client</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* KPI cards – each opens its metric under Financials */}
      <div className="ui-cx__kpis" key={`k-${client.id}`}>
        {client.kpis.map((k, i) => (
          <button
            key={k.label}
            type="button"
            className="ui-cx__kpi"
            aria-pressed={tab === "financials" && metric === k.label}
            onClick={() => openMetric(k.label)}
          >
            <span className="ui-cx__kpi-label">{k.label}</span>
            <span className="ui-cx__kpi-row">
              <span className="ui-cx__kpi-value">{k.value}</span>
              <Spark points={k.points} color={k.color} delay={i * 90} />
            </span>
          </button>
        ))}
      </div>

      {/* Main card */}
      <div className="ui-cx__card">
        <div className="ui-cx__toolbar">
          <div className="ui-cx__seg" role="tablist" aria-label="Client sections" style={{ "--i": tabIndex } as CSSProperties}>
            <span className="ui-cx__seg-thumb" aria-hidden="true" />
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.id}`}
                aria-controls={`${uid}-panel`}
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "context" && (
            <div className="ui-cx__tools">
              <label className="ui-cx__search">
                <SearchIcon />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search context" />
                {query && (
                  <button type="button" className="ui-cx__clear" aria-label="Clear search" onClick={() => setQuery("")}>
                    <CloseIcon />
                  </button>
                )}
              </label>
              <div className="ui-cx__pop" data-cx-menu="">
                <button
                  type="button"
                  className="ui-cx__chip-btn"
                  aria-haspopup="listbox"
                  aria-expanded={menu === "filter"}
                  data-active={filter !== "all" || undefined}
                  onClick={() => setMenu(menu === "filter" ? null : "filter")}
                >
                  <FilterIcon />
                  {kindLabels[filter]}
                </button>
                {menu === "filter" && (
                  <div className="ui-cx__menu ui-cx__menu--end">
                    <ul role="listbox" aria-label="Show">
                      {(Object.keys(kindLabels) as ("all" | Kind)[]).map((k) => (
                        <li key={k}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={filter === k}
                            className="ui-cx__menu-item"
                            onClick={() => {
                              setFilter(k);
                              setMenu(null);
                            }}
                          >
                            <span className="ui-cx__menu-label">{kindLabels[k]}</span>
                            <span className="ui-cx__menu-count">
                              {k === "all" ? entries.length : entries.filter((e) => e.kind === k).length}
                            </span>
                            <span className="ui-cx__menu-check">{filter === k && <CheckIcon />}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className="ui-cx__panel"
          id={`${uid}-panel`}
          role="tabpanel"
          aria-labelledby={`${uid}-tab-${tab}`}
          key={`${tab}-${client.id}`}
        >
          {tab === "context" && (
            <>
              {/* Composer */}
              <div className="ui-cx__compose">
                <Avatar person={me} size={28} />
                <div className="ui-cx__composer">
                  <textarea
                    ref={textarea}
                    value={draft}
                    onChange={(e) => onDraft(e.target.value, e.target.selectionStart)}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onKeyDown={(e) => {
                      if (suggestions.length && (e.key === "Enter" || e.key === "Tab")) {
                        e.preventDefault();
                        insertMention(suggestions[0]);
                        return;
                      }
                      if (e.key === "Escape") setMentionAt(null);
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        add();
                      }
                    }}
                    rows={2}
                    placeholder={
                      client.reports.length
                        ? "Add a goal, request or decision – type @ to mention a report"
                        : "Add a goal, request or decision for this client"
                    }
                    aria-label="New context"
                  />
                  {suggestions.length > 0 && (
                    <ul className="ui-cx__suggest" role="listbox" aria-label="Mention a report">
                      {suggestions.map((n, i) => (
                        <li key={n}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={i === 0}
                            className="ui-cx__menu-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertMention(n)}
                          >
                            <DocIcon />
                            <span className="ui-cx__menu-label">{n}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {files.length > 0 && (
                    <div className="ui-cx__attached">
                      {files.map((f) => (
                        <span key={f.name} className="ui-cx__file-chip">
                          <FileIcon type={f.type} />
                          {f.name}
                          <button
                            type="button"
                            aria-label={`Remove ${f.name}`}
                            onClick={() => setFiles((all) => all.filter((x) => x.name !== f.name))}
                          >
                            <CloseIcon />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="ui-cx__composer-bar">
                    <button
                      type="button"
                      className="ui-cx__icon-btn"
                      aria-label="Attach a file"
                      onClick={attach}
                      disabled={files.length >= attachable.length}
                    >
                      <PaperclipIcon />
                    </button>
                    <span className="ui-cx__hint" aria-hidden="true">
                      <kbd>⌘</kbd>
                      <kbd>Enter</kbd>
                    </span>
                    <button type="button" className="ui-cx__primary" onClick={add} disabled={!draft.trim() && !files.length}>
                      Add context
                    </button>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              {shown.length > 0 ? (
                <ol className="ui-cx__timeline">
                  {shown.map((e) => (
                    <Item
                      key={e.id}
                      entry={e}
                      fresh={e.id === fresh}
                      query={query}
                      reports={reportNames}
                      mine={"author" in e && e.author.name === me.name}
                      onReport={showReport}
                      onRemove={() => remove(e.id)}
                    />
                  ))}
                </ol>
              ) : (
                <div className="ui-cx__empty">
                  {entries.length === 0 ? (
                    <p>No context yet – add the first goal or file above.</p>
                  ) : (
                    <p>
                      Nothing matches{query ? ` “${query}”` : ""}
                      {filter !== "all" ? ` in ${kindLabels[filter].toLowerCase()}` : ""}.{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setQuery("");
                          setFilter("all");
                        }}
                      >
                        Show everything
                      </button>
                    </p>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "reports" &&
            (client.reports.length ? (
              <ul className="ui-cx__list">
                {client.reports.map((r) => {
                  const open = openReport === r.name;
                  const busy = regenerating === r.name;
                  return (
                    <li key={r.name} className="ui-cx__report" data-open={open || undefined}>
                      <button
                        type="button"
                        className="ui-cx__report-head"
                        aria-expanded={open}
                        onClick={() => setOpenReport(open ? null : r.name)}
                      >
                        <span className="ui-cx__row-icon">
                          <ChartIcon />
                        </span>
                        <span className="ui-cx__row-main">
                          <strong>{r.name}</strong>
                          <span>{busy ? "Regenerating…" : `Generated ${reportTimes[`${client.id}:${r.name}`] ?? r.when}`}</span>
                        </span>
                        <span className="ui-cx__chevron">
                          <ChevronIcon />
                        </span>
                      </button>
                      <div className="ui-cx__report-body">
                        <div>
                          <p>{r.summary}</p>
                          <div className="ui-cx__report-actions">
                            <button type="button" className="ui-cx__chip-btn" onClick={() => mentionInContext(r.name)}>
                              <AtIcon />
                              Mention in context
                            </button>
                            <button type="button" className="ui-cx__chip-btn" onClick={() => regenerate(r.name)} disabled={busy}>
                              <span className="ui-cx__spin" data-spinning={busy || undefined}>
                                <RefreshIcon />
                              </span>
                              {busy ? "Regenerating…" : "Regenerate"}
                            </button>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="ui-cx__empty ui-cx__empty--flush">
                <p>No reports yet. Connect the books under Settings to generate the first one.</p>
              </div>
            ))}

          {tab === "financials" && (
            <ul className="ui-cx__list">
              {client.kpis.map((k) => (
                <li key={k.label} className="ui-cx__fin" data-active={metric === k.label || undefined}>
                  <button type="button" onClick={() => setMetric(metric === k.label ? null : k.label)} aria-pressed={metric === k.label}>
                    <span className="ui-cx__fin-dot" style={{ background: k.color }} />
                    <span className="ui-cx__row-main">
                      <strong>{k.label}</strong>
                      <span>Previous month {k.previous}</span>
                    </span>
                    <Spark points={k.points} color={k.color} delay={0} wide />
                    <span className="ui-cx__fin-value">
                      <strong>{k.value}</strong>
                      {k.value !== "–" && (
                        <span data-trend={k.delta >= 0 ? "up" : "down"}>
                          {k.delta >= 0 ? "+" : "−"}
                          {Math.abs(k.delta).toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tab === "settings" && (
            <ul className="ui-cx__list">
              <li className="ui-cx__row">
                <span className="ui-cx__app">
                  <StripeMark />
                </span>
                <span className="ui-cx__row-main">
                  <strong>Stripe</strong>
                  <span>{stripeOn ? "Revenue and payouts sync every hour" : "Not connected"}</span>
                </span>
                <button type="button" className="ui-cx__chip-btn" onClick={toggleStripe}>
                  {stripeOn ? "Disconnect" : "Connect"}
                </button>
              </li>
              {(
                [
                  ["ai", "Use context in AI answers", "Notes and files are read before every answer", true],
                  ["digest", "Daily digest", "A short email when new context or files arrive", false],
                  ["share", "Share reports with the client", "Generated reports show up in their portal", false],
                ] as const
              ).map(([key, label, hint, fallback]) => {
                const on = setting(key, fallback);
                return (
                  <li key={key} className="ui-cx__row">
                    <span className="ui-cx__row-main">
                      <strong>{label}</strong>
                      <span>{hint}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={label}
                      className="ui-cx__toggle"
                      onClick={() => setSettings((s) => ({ ...s, [client.id]: { ...s[client.id], [key]: !on } }))}
                    >
                      <span />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- Timeline entries ---------- */

function Item({
  entry,
  fresh,
  query,
  reports,
  mine,
  onReport,
  onRemove,
}: {
  entry: ContextEntry;
  fresh: boolean;
  query: string;
  reports: string[];
  mine: boolean;
  onReport: (name: string) => void;
  onRemove: () => void;
}) {
  const hl = (text: string) => highlight(text, query);
  const reportLink = (name: string) =>
    reports.includes(name) ? (
      <button type="button" className="ui-cx__ref" onClick={() => onReport(name)}>
        {hl(name)}
      </button>
    ) : (
      <span className="ui-cx__ref">{hl(name)}</span>
    );

  return (
    <li className="ui-cx__item" data-fresh={fresh || undefined}>
      <span className="ui-cx__node" data-kind={entry.kind}>
        {entry.kind === "note" ? (
          <NoteIcon />
        ) : entry.kind === "report" ? (
          <ChartIcon />
        ) : entry.kind === "files" ? (
          <FilesIcon />
        ) : (
          <StripeMark />
        )}
      </span>
      <div className="ui-cx__body">
        <div className="ui-cx__line">
          {entry.kind === "integration" ? (
            <span>
              {entry.connected ? "Connected " : "Disconnected "}
              <strong>{hl(entry.app)}</strong>
            </span>
          ) : (
            <>
              <Avatar person={entry.author} size={20} />
              <span>
                <strong>{hl(entry.author.name)}</strong>
                {entry.kind === "note" && " added context"}
                {entry.kind === "report" && <> generated {reportLink(entry.report)}</>}
                {entry.kind === "files" && (
                  <>
                    {" added "}
                    {entry.files.map((f, i) => (
                      <span key={f.name} className="ui-cx__file">
                        {i > 0 && (i === entry.files.length - 1 ? " and " : ", ")}
                        <FileIcon type={f.type} />
                        <span className="ui-cx__ref">{hl(f.name)}</span>
                      </span>
                    ))}
                  </>
                )}
              </span>
            </>
          )}
          <span className="ui-cx__when">{entry.when}</span>
          {mine && (
            <button type="button" className="ui-cx__remove" aria-label="Remove" onClick={onRemove}>
              <TrashIcon />
            </button>
          )}
        </div>
        {(entry.kind === "note" || (entry.kind === "files" && entry.text)) && (
          <div className="ui-cx__note">{withMentions(entry.text ?? "", reports, query, onReport)}</div>
        )}
      </div>
    </li>
  );
}

/** "@Monthly P&L" for one of the client's reports → a mention chip that opens the report */
function withMentions(text: string, reports: string[], query: string, onReport: (name: string) => void) {
  if (!reports.length) return highlight(text, query);
  const names = [...reports].sort((a, b) => b.length - a.length).map(escapeRe);
  return text.split(new RegExp(`(@(?:${names.join("|")}))`, "g")).map((part, i) => {
    const name = part.startsWith("@") ? part.slice(1) : "";
    return reports.includes(name) ? (
      <button key={i} type="button" className="ui-cx__mention" onClick={() => onReport(name)}>
        <DocIcon />
        {name}
      </button>
    ) : (
      <span key={i}>{highlight(part, query)}</span>
    );
  });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Search matches get a soft marker */
function highlight(text: string, query: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  return text
    .split(new RegExp(`(${escapeRe(q)})`, "ig"))
    .map((p, i) => (p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : p));
}

const matches = (e: ContextEntry, q: string) => {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const hay = [
    "author" in e ? e.author.name : "",
    e.kind === "note" ? e.text : "",
    e.kind === "files" ? `${e.text ?? ""} ${e.files.map((f) => f.name).join(" ")}` : "",
    e.kind === "report" ? e.report : "",
    e.kind === "integration" ? e.app : "",
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(s);
};

/* ---------- Small pieces ---------- */

function Mark({ client, size }: { client: ContextClient; size: number }) {
  return (
    <span
      className="ui-cx__mark"
      style={{ width: size, height: size, background: client.mark.bg, color: client.mark.fg, fontSize: size * 0.5 }}
      aria-hidden="true"
    >
      {client.mark.letter}
    </span>
  );
}

function Avatar({ person, size }: { person: ContextPerson; size: number }) {
  return person.avatar ? (
    <img className="ui-cx__avatar" src={person.avatar} alt="" width={size} height={size} style={{ width: size, height: size }} />
  ) : (
    <span
      className="ui-cx__avatar ui-cx__avatar--initial"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden="true"
    >
      {person.name.charAt(0)}
    </span>
  );
}

/** Sparkline that draws itself in, with a dot on the latest value */
function Spark({ points, color, delay, wide = false }: { points: number[]; color: string; delay: number; wide?: boolean }) {
  const w = wide ? 96 : 64;
  const h = 24;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * (w - 4) + 2, h - 3 - ((p - min) / (max - min || 1)) * (h - 6)]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg className="ui-cx__spark" data-wide={wide || undefined} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d} pathLength={1} stroke={color} style={{ animationDelay: `${delay}ms` }} />
      <circle cx={lx} cy={ly} r="2.4" fill={color} style={{ animationDelay: `${delay + 520}ms` }} />
    </svg>
  );
}

/** File with its type as a small colored tab */
function FileIcon({ type }: { type: ContextFile["type"] }) {
  const color = { pdf: "#e5484d", xlsx: "#1f9d55", csv: "#0ea5e9", doc: "#2f6bff" }[type];
  return (
    <svg className="ui-cx__file-icon" viewBox="0 0 16 18" aria-label={type.toUpperCase()}>
      <path
        d="M3 1.5h6.5l4 4v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"
        fill="var(--ui-cx-card)"
        stroke="var(--ui-cx-line-strong)"
      />
      <path d="M9.5 1.5v3a1 1 0 0 0 1 1h3" fill="none" stroke="var(--ui-cx-line-strong)" />
      <rect x="0.5" y="9.5" width="10" height="5" rx="1.5" fill={color} />
    </svg>
  );
}

/** Stripe's mark (Simple Icons, CC0) on its brand color */
const StripeMark = () => (
  <svg viewBox="0 0 24 24" className="ui-cx__stripe" aria-label="Stripe">
    <rect width="24" height="24" rx="6" fill="#635BFF" />
    <path
      fill="#fff"
      transform="translate(5 5) scale(0.5833)"
      d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"
    />
  </svg>
);

const Svg = ({ children }: { children: ReactNode }) => (
  <svg className="ui-cx__icon" viewBox="0 0 24 24" aria-hidden="true">
    {children}
  </svg>
);
const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
const ChevronsIcon = () => <Svg><path d="m8 9 4-4 4 4M8 15l4 4 4-4" /></Svg>;
const ChevronIcon = () => <Svg><path d="m7 10 5 5 5-5" /></Svg>;
const CheckIcon = () => <Svg><path d="m5 12.5 4.5 4.5L19 7.5" /></Svg>;
const CloseIcon = () => <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>;
const RefreshIcon = () => <Svg><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" /></Svg>;
const SearchIcon = () => <Svg><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></Svg>;
const FilterIcon = () => <Svg><path d="M4 6h16M7 12h10M10 18h4" /></Svg>;
const PaperclipIcon = () => (
  <Svg>
    <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4L15 7" />
  </Svg>
);
const NoteIcon = () => <Svg><path d="M5 5h14v10H9l-4 4V5Z" /></Svg>;
const ChartIcon = () => <Svg><path d="M5 19V11M12 19V5M19 19v-6" /></Svg>;
const FilesIcon = () => <Svg><path d="m12 4 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 16l8 4 8-4" /></Svg>;
const DocIcon = () => <Svg><path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5ZM14 3.5V8h4" /></Svg>;
const AtIcon = () => <Svg><circle cx="12" cy="12" r="3.5" /><path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8" /></Svg>;
const TrashIcon = () => <Svg><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" /></Svg>;

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-cx {
  --ui-cx-tray: #f0f0f0;
  --ui-cx-card: #ffffff;
  --ui-cx-card-line: #e5e5e5;
  --ui-cx-line: #ececec;
  --ui-cx-line-strong: #dcdcdc;
  --ui-cx-inset: #f6f6f6;
  --ui-cx-ink: #171717;
  --ui-cx-text: #404040;
  --ui-cx-muted: #8f8f8f;
  --ui-cx-accent: #2f6bff;
  --ui-cx-good: #1f8a4c;
  --ui-cx-bad: #d92d5c;
  --ui-cx-mark: rgba(47, 107, 255, 0.16);
  --ui-cx-hover: rgba(0, 0, 0, 0.04);
  --ui-cx-track: rgba(0, 0, 0, 0.05);
  --ui-cx-thumb: #ffffff;
  --ui-cx-btn-top: #323137;
  --ui-cx-btn-bottom: #201e25;
  --ui-cx-btn-ring: #0d0d0d;
  --ui-cx-btn-text: #ffffff;
  --ui-cx-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  --ui-cx-pop: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 12px 32px rgba(0, 0, 0, 0.1);
  --ui-cx-ease: cubic-bezier(0.65, 0, 0.25, 1);
  --ui-cx-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-cx-spring: cubic-bezier(0.34, 1.3, 0.64, 1);
  container-type: inline-size;
  width: 100%;
  max-width: 900px;
  padding: 0 6px 6px;
  border-radius: 24px;
  background: var(--ui-cx-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: var(--ui-cx-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-cx *, .ui-cx *::before, .ui-cx *::after { box-sizing: border-box; }
/* Zero specificity, so the spacing set on each part below wins */
.ui-cx :where(button) { margin: 0; font: inherit; color: inherit; }
.ui-cx :where(p, h2, h3, ol, ul) { margin: 0; }
.ui-cx :where(ol, ul) { padding: 0; list-style: none; }
.ui-cx mark { border-radius: 3px; background: var(--ui-cx-mark); color: inherit; }

.ui-cx__icon {
  width: 15px;
  height: 15px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ---------- Header on the tray ---------- */

.ui-cx__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 10px 14px 12px;
}
.ui-cx__who { display: flex; align-items: center; gap: 12px; min-width: 0; animation: ui-cx-in 360ms var(--ui-cx-out); }
.ui-cx__who-text { display: grid; gap: 2px; min-width: 0; }
.ui-cx__name { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
.ui-cx__meta { font-size: 12.5px; color: var(--ui-cx-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-cx__mark {
  display: grid;
  place-items: center;
  flex: none;
  border-radius: 30%;
  font-weight: 650;
  line-height: 1;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.ui-cx__actions { display: flex; align-items: center; gap: 8px; flex: none; }

/* White chip buttons on the tray and in the card */
.ui-cx__chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: var(--ui-cx-card);
  box-shadow: 0 0 0 1px var(--ui-cx-card-line), var(--ui-cx-shadow);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background 160ms ease, box-shadow 160ms ease, transform 120ms ease;
}
.ui-cx__chip-btn:hover:not(:disabled) { background: var(--ui-cx-inset); }
.ui-cx__chip-btn:active:not(:disabled) { transform: scale(0.97); }
.ui-cx__chip-btn:disabled { opacity: 0.6; cursor: default; }
.ui-cx__chip-btn[data-active] { box-shadow: 0 0 0 1px var(--ui-cx-accent), var(--ui-cx-shadow); color: var(--ui-cx-accent); }
.ui-cx__chip-btn > .ui-cx__icon:last-child:not(:first-child) { color: var(--ui-cx-muted); }

.ui-cx__sync { gap: 8px; color: var(--ui-cx-text); }
.ui-cx__sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.16);
  transition: background 200ms ease, box-shadow 200ms ease;
}
.ui-cx__sync-dot[data-state="syncing"] { background: #f59e0b; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.18); }
.ui-cx__spin { display: grid; color: var(--ui-cx-muted); }
.ui-cx__spin[data-spinning] .ui-cx__icon { animation: ui-cx-spin 0.9s linear infinite; }
@keyframes ui-cx-spin { to { transform: rotate(360deg); } }

/* Menus */
.ui-cx__pop { position: relative; }
.ui-cx__menu {
  position: absolute;
  left: 0;
  top: calc(100% + 6px);
  z-index: 5;
  min-width: 230px;
  padding: 5px;
  border-radius: 14px;
  background: var(--ui-cx-card);
  box-shadow: var(--ui-cx-pop);
  transform-origin: top left;
  animation: ui-cx-pop 180ms var(--ui-cx-out);
}
.ui-cx__menu--end { left: auto; right: 0; transform-origin: top right; }
@keyframes ui-cx-pop { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }
.ui-cx__menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 36px;
  padding: 0 10px 0 8px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.ui-cx__menu-item:hover,
.ui-cx__menu-item[aria-selected="true"] { background: var(--ui-cx-hover); }
.ui-cx__menu-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ui-cx__menu-item > .ui-cx__icon { color: var(--ui-cx-muted); }
.ui-cx__menu-count { color: var(--ui-cx-muted); font-variant-numeric: tabular-nums; }
.ui-cx__menu-check { display: grid; width: 15px; color: var(--ui-cx-accent); }
.ui-cx__menu-sep { height: 1px; margin: 5px 4px; background: var(--ui-cx-line); }
.ui-cx__menu-plus {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-text);
}
.ui-cx__menu-plus .ui-cx__icon { width: 12px; height: 12px; }
.ui-cx__create { display: flex; gap: 6px; padding: 3px; }
.ui-cx__create input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  outline: none;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-ink);
  font: inherit;
}
.ui-cx__create input:focus { box-shadow: inset 0 0 0 1px var(--ui-cx-muted); }

/* ---------- KPI cards ---------- */

.ui-cx__kpis {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 6px;
}
.ui-cx__kpi {
  display: grid;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border: 0;
  border-radius: 16px;
  background: var(--ui-cx-card);
  box-shadow: 0 0 0 1px var(--ui-cx-card-line), var(--ui-cx-shadow);
  text-align: left;
  cursor: pointer;
  transition: box-shadow 200ms ease, transform 160ms ease;
  animation: ui-cx-in 360ms var(--ui-cx-out) both;
}
.ui-cx__kpi:nth-child(2) { animation-delay: 40ms; }
.ui-cx__kpi:nth-child(3) { animation-delay: 80ms; }
.ui-cx__kpi:nth-child(4) { animation-delay: 120ms; }
.ui-cx__kpi:hover { box-shadow: 0 0 0 1px var(--ui-cx-line-strong), var(--ui-cx-shadow); }
.ui-cx__kpi:active { transform: scale(0.98); }
.ui-cx__kpi[aria-pressed="true"] { box-shadow: 0 0 0 1.5px var(--ui-cx-accent), var(--ui-cx-shadow); }
.ui-cx__kpi-label { font-size: 12.5px; color: var(--ui-cx-text); }
.ui-cx__kpi-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 8px; }
.ui-cx__kpi-value {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ui-cx__spark { flex: none; width: 56px; height: 22px; overflow: visible; }
.ui-cx__spark[data-wide] { width: 84px; }
.ui-cx__spark path {
  fill: none;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  animation: ui-cx-draw 700ms var(--ui-cx-out) forwards;
}
.ui-cx__spark circle { opacity: 0; animation: ui-cx-fade 240ms ease forwards; }
@keyframes ui-cx-draw { to { stroke-dashoffset: 0; } }
@keyframes ui-cx-fade { to { opacity: 1; } }
@keyframes ui-cx-in { from { opacity: 0; transform: translateY(6px); } }

/* ---------- Main card ---------- */

.ui-cx__card {
  border-radius: 20px;
  background: var(--ui-cx-card);
  box-shadow: 0 0 0 1px var(--ui-cx-card-line), var(--ui-cx-shadow);
}
.ui-cx__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ui-cx-line);
}

/* Segmented tabs with a sliding thumb */
.ui-cx__seg {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 84px);
  padding: 3px;
  border-radius: 10px;
  background: var(--ui-cx-track);
}
.ui-cx__seg-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 84px;
  height: calc(100% - 6px);
  border-radius: 7px;
  background: var(--ui-cx-thumb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04);
  transform: translateX(calc(var(--i, 0) * 100%));
  transition: transform 420ms var(--ui-cx-spring);
}
.ui-cx__seg button {
  position: relative;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ui-cx-muted) !important;
  cursor: pointer;
  transition: color 200ms ease;
}
.ui-cx__seg button[aria-selected="true"] { color: var(--ui-cx-ink) !important; }

.ui-cx__tools { display: flex; align-items: center; gap: 8px; }
.ui-cx__search {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  height: 34px;
  padding: 0 8px 0 11px;
  border-radius: 10px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-muted);
  transition: box-shadow 160ms ease, background 160ms ease;
}
.ui-cx__search:focus-within { background: var(--ui-cx-card); box-shadow: inset 0 0 0 1px var(--ui-cx-muted); }
.ui-cx__search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--ui-cx-ink);
  font: inherit;
}
.ui-cx__search input::placeholder { color: var(--ui-cx-muted); }
.ui-cx__clear {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-cx-muted);
  cursor: pointer;
}
.ui-cx__clear:hover { background: var(--ui-cx-hover); color: var(--ui-cx-ink); }
.ui-cx__clear .ui-cx__icon { width: 12px; height: 12px; }

.ui-cx__panel { padding: 22px 24px 26px; animation: ui-cx-in 300ms var(--ui-cx-out); }

/* ---------- Composer ---------- */

.ui-cx__compose { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 14px; align-items: start; }
.ui-cx__compose > .ui-cx__avatar { margin-top: 6px; }
.ui-cx__composer {
  position: relative;
  border-radius: 14px;
  background: var(--ui-cx-card);
  box-shadow: 0 0 0 1px var(--ui-cx-card-line), var(--ui-cx-shadow);
  transition: box-shadow 160ms ease;
}
.ui-cx__composer:focus-within { box-shadow: 0 0 0 1px var(--ui-cx-muted), var(--ui-cx-shadow); }
.ui-cx__composer textarea {
  display: block;
  width: 100%;
  min-height: 62px;
  max-height: 180px;
  padding: 12px 14px 4px;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  color: var(--ui-cx-ink);
  font: inherit;
  line-height: 1.55;
  field-sizing: content;
}
.ui-cx__composer textarea::placeholder { color: var(--ui-cx-muted); }
.ui-cx__suggest {
  position: absolute;
  left: 10px;
  top: calc(100% - 40px);
  z-index: 4;
  min-width: 220px;
  padding: 5px;
  border-radius: 12px;
  background: var(--ui-cx-card);
  box-shadow: var(--ui-cx-pop);
  animation: ui-cx-pop 160ms var(--ui-cx-out);
}
.ui-cx__attached { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 2px; }
.ui-cx__file-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 4px 0 8px;
  border-radius: 8px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-text);
  font-size: 12px;
  animation: ui-cx-pop 200ms var(--ui-cx-out);
}
.ui-cx__file-chip button {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-cx-muted);
  cursor: pointer;
}
.ui-cx__file-chip button:hover { background: var(--ui-cx-hover); color: var(--ui-cx-ink); }
.ui-cx__file-chip .ui-cx__icon { width: 12px; height: 12px; }
.ui-cx__file-chip .ui-cx__file-icon { margin: 0; }
.ui-cx__composer-bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px 10px; }
.ui-cx__icon-btn {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--ui-cx-muted);
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}
.ui-cx__icon-btn:hover:not(:disabled) { background: var(--ui-cx-hover); color: var(--ui-cx-ink); }
.ui-cx__icon-btn:disabled { opacity: 0.4; cursor: default; }
.ui-cx__hint { display: inline-flex; gap: 3px; margin-left: auto; }
.ui-cx__hint kbd {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-muted);
  font-family: inherit;
  font-size: 11px;
  font-weight: 500;
}
.ui-cx__primary {
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 9px;
  background: linear-gradient(var(--ui-cx-btn-top), var(--ui-cx-btn-bottom));
  box-shadow: 0 0 0 1px var(--ui-cx-btn-ring), inset 0 1px 0 rgba(255, 255, 255, 0.14);
  color: var(--ui-cx-btn-text) !important;
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 160ms ease, transform 120ms ease;
}
.ui-cx__primary:active:not(:disabled) { transform: scale(0.97); }
.ui-cx__primary:disabled { opacity: 0.35; cursor: default; }

/* ---------- Timeline ---------- */

.ui-cx__timeline { position: relative; margin-top: 28px; }
/* The rail runs through the middle of the nodes */
.ui-cx__timeline::before {
  content: "";
  position: absolute;
  left: 13.5px;
  top: 14px;
  bottom: 14px;
  width: 1px;
  background: var(--ui-cx-line);
}
.ui-cx__item {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 14px;
  padding-bottom: 26px;
}
.ui-cx__item:last-child { padding-bottom: 0; }
.ui-cx__item[data-fresh] { animation: ui-cx-new 520ms var(--ui-cx-out); }
@keyframes ui-cx-new { from { opacity: 0; transform: translateY(-8px); } }

.ui-cx__node {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--ui-cx-card);
  box-shadow: 0 0 0 1px var(--ui-cx-line-strong), 0 0 0 5px var(--ui-cx-card);
  color: var(--ui-cx-muted);
}
.ui-cx__node .ui-cx__icon { width: 13px; height: 13px; }
.ui-cx__node[data-kind="integration"] { background: transparent; box-shadow: 0 0 0 5px var(--ui-cx-card); }
.ui-cx__stripe { display: block; width: 26px; height: 26px; }

.ui-cx__body { min-width: 0; padding-top: 4px; }
.ui-cx__line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-height: 20px;
  color: var(--ui-cx-text);
  line-height: 20px;
}
.ui-cx__line > .ui-cx__avatar { margin-top: 0; }
.ui-cx__line > span:not(.ui-cx__when) { flex: 0 1 auto; min-width: 0; }
.ui-cx__line strong { color: var(--ui-cx-ink); font-weight: 500; }
.ui-cx__when { flex: none; color: var(--ui-cx-muted); white-space: nowrap; }
.ui-cx__when::before { content: "·"; margin-right: 8px; }
.ui-cx__ref {
  display: inline;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-cx-ink);
  font-weight: 500;
  text-decoration: underline;
  text-decoration-color: var(--ui-cx-line-strong);
  text-underline-offset: 3px;
  transition: text-decoration-color 160ms ease;
}
button.ui-cx__ref { cursor: pointer; }
button.ui-cx__ref:hover { text-decoration-color: currentColor; }
.ui-cx__file { white-space: nowrap; }
.ui-cx__file-icon { display: inline-block; width: 12px; height: 14px; margin: 0 4px 0 2px; vertical-align: -2px; }
.ui-cx__remove {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  margin: -1px 0 0 auto;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-cx-muted);
  opacity: 0;
  cursor: pointer;
  transition: opacity 160ms ease, background 160ms ease, color 160ms ease;
}
.ui-cx__item:hover .ui-cx__remove,
.ui-cx__remove:focus-visible { opacity: 1; }
.ui-cx__remove:hover { background: var(--ui-cx-hover); color: var(--ui-cx-bad); }
.ui-cx__remove .ui-cx__icon { width: 13px; height: 13px; }
.ui-cx__note {
  margin-top: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-text);
  line-height: 1.6;
}
.ui-cx__mention {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0 1px;
  padding: 0 6px 0 5px;
  border: 0;
  border-radius: 6px;
  background: color-mix(in srgb, var(--ui-cx-accent) 10%, transparent);
  color: var(--ui-cx-accent) !important;
  font-weight: 500;
  line-height: 20px;
  vertical-align: -1px;
  white-space: nowrap;
  cursor: pointer;
  transition: background 160ms ease;
}
.ui-cx__mention:hover { background: color-mix(in srgb, var(--ui-cx-accent) 16%, transparent); }
.ui-cx__mention .ui-cx__icon { width: 12px; height: 12px; }
.ui-cx__avatar { display: block; flex: none; border-radius: 50%; object-fit: cover; }
.ui-cx__avatar--initial { display: grid; place-items: center; background: var(--ui-cx-inset); color: var(--ui-cx-text); font-weight: 600; }

.ui-cx__empty {
  margin-top: 28px;
  padding: 22px;
  border-radius: 14px;
  background: var(--ui-cx-inset);
  color: var(--ui-cx-muted);
  text-align: center;
}
.ui-cx__empty--flush { margin-top: 0; }
.ui-cx__empty button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--ui-cx-ink);
  font-weight: 500;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

/* ---------- Reports, financials, settings ---------- */

.ui-cx__list {
  overflow: hidden;
  border-radius: 14px;
  box-shadow: 0 0 0 1px var(--ui-cx-line);
}
.ui-cx__list > li + li { border-top: 1px solid var(--ui-cx-line); }
.ui-cx__row { display: flex; align-items: center; gap: 14px; min-height: 66px; padding: 12px 16px; }
.ui-cx__row-main { display: grid; gap: 3px; flex: 1; min-width: 0; text-align: left; }
.ui-cx__row-main strong { font-weight: 500; color: var(--ui-cx-ink); }
.ui-cx__row-main span { color: var(--ui-cx-muted); font-size: 12.5px; }
.ui-cx__row-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  background: var(--ui-cx-inset);
  box-shadow: inset 0 0 0 1px var(--ui-cx-line);
  color: var(--ui-cx-muted);
}
.ui-cx__app { display: grid; flex: none; }
.ui-cx__app .ui-cx__stripe { width: 32px; height: 32px; }

.ui-cx__report-head {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 66px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: background 160ms ease;
}
.ui-cx__report-head:hover { background: var(--ui-cx-hover); }
.ui-cx__chevron { display: grid; color: var(--ui-cx-muted); transition: transform 300ms var(--ui-cx-ease); }
.ui-cx__report[data-open] .ui-cx__chevron { transform: rotate(180deg); }
.ui-cx__report-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 320ms var(--ui-cx-ease); }
.ui-cx__report[data-open] .ui-cx__report-body { grid-template-rows: 1fr; }
.ui-cx__report-body > div { overflow: hidden; padding: 0 16px 0 62px; }
.ui-cx__report-body p { color: var(--ui-cx-text); line-height: 1.6; }
.ui-cx__report-actions { display: flex; flex-wrap: wrap; gap: 8px; padding: 14px 0 18px; }

.ui-cx__fin button {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  min-height: 66px;
  padding: 12px 16px;
  border: 0;
  background: transparent;
  cursor: pointer;
  transition: background 200ms ease;
}
.ui-cx__fin button:hover { background: var(--ui-cx-hover); }
.ui-cx__fin[data-active] button { background: color-mix(in srgb, var(--ui-cx-accent) 6%, transparent); }
.ui-cx__fin-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.ui-cx__fin-value { display: grid; justify-items: end; gap: 3px; min-width: 84px; }
.ui-cx__fin-value strong { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ui-cx__fin-value span { font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
.ui-cx__fin-value [data-trend="up"] { color: var(--ui-cx-good); }
.ui-cx__fin-value [data-trend="down"] { color: var(--ui-cx-bad); }

.ui-cx__toggle {
  position: relative;
  flex: none;
  width: 36px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--ui-cx-line-strong);
  cursor: pointer;
  transition: background 200ms ease;
}
.ui-cx__toggle span {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 260ms var(--ui-cx-spring);
}
.ui-cx__toggle[aria-checked="true"] { background: var(--ui-cx-accent); }
.ui-cx__toggle[aria-checked="true"] span { transform: translateX(14px); }

.ui-cx button:focus-visible,
.ui-cx textarea:focus-visible,
.ui-cx input:focus-visible { outline: 2px solid var(--ui-cx-accent); outline-offset: 2px; }

/* ---------- Narrow ---------- */

@container (max-width: 680px) {
  .ui-cx__head { flex-wrap: wrap; }
  .ui-cx__actions { width: 100%; }
  .ui-cx__actions > .ui-cx__pop { margin-left: auto; }
  .ui-cx__kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ui-cx__toolbar { flex-direction: column; align-items: stretch; }
  .ui-cx__seg { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .ui-cx__seg-thumb { width: calc((100% - 6px) / 4); }
  .ui-cx__tools { width: 100%; }
  .ui-cx__search { flex: 1; width: auto; }
  .ui-cx__panel { padding: 18px 16px 20px; }
  .ui-cx__hint { display: none; }
  .ui-cx__composer-bar .ui-cx__primary { margin-left: auto; }
  .ui-cx__fin .ui-cx__spark { display: none; }
  .ui-cx__report-body > div { padding-left: 16px; }
  /* The time drops to its own line under the name, so long file names keep their room */
  .ui-cx__line { flex-wrap: wrap; row-gap: 2px; }
  .ui-cx__line > span:not(.ui-cx__when) { flex: 1 1 calc(100% - 28px); }
  .ui-cx__when { order: 3; margin-left: 28px; }
  .ui-cx__when::before { content: none; }
  .ui-cx__file { white-space: normal; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-cx *, .ui-cx *::before, .ui-cx *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; }
}

/* ---------- Dark ---------- */


/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-cx input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-cx textarea:focus-visible,
.ui-cx [contenteditable]:focus-visible { outline: none; }
:where(.dark, [data-theme="dark"]) .ui-cx {
  --ui-cx-tray: #161618;
  --ui-cx-card: #232326;
  --ui-cx-card-line: rgba(255, 255, 255, 0.08);
  --ui-cx-line: rgba(255, 255, 255, 0.07);
  --ui-cx-line-strong: rgba(255, 255, 255, 0.14);
  --ui-cx-inset: #1c1c1f;
  --ui-cx-ink: #ededed;
  --ui-cx-text: #c4c4c4;
  --ui-cx-muted: #8f8f8f;
  --ui-cx-accent: #6b95ff;
  --ui-cx-good: #4ade80;
  --ui-cx-bad: #fb7185;
  --ui-cx-mark: rgba(107, 149, 255, 0.28);
  --ui-cx-hover: rgba(255, 255, 255, 0.05);
  --ui-cx-track: rgba(255, 255, 255, 0.06);
  --ui-cx-thumb: #313135;
  --ui-cx-btn-top: #f4f4f5;
  --ui-cx-btn-bottom: #e4e4e7;
  --ui-cx-btn-ring: rgba(0, 0, 0, 0.6);
  --ui-cx-btn-text: #121213;
  --ui-cx-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-cx-pop: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 16px 40px rgba(0, 0, 0, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-cx__toggle span { background: #ededed; }
:where(.dark, [data-theme="dark"]) .ui-cx__mark { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
`;
