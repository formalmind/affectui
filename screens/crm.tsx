"use client";

/*
 * CRM – a company list with pipelines, open views as tabs and an editable table, in a single file.
 * A path with a favorite star on top, then the open views as tabs, then the Data Table from the library
 * filling the rest of the panel. Sits in the affectUI App Shell; icons from the Hugeicons free set,
 * company logos from Simple Icons (CC0).
 */

import { useState, type CSSProperties } from "react";
import {
  Analytics01Icon,
  ArrowDown01Icon,
  Building03Icon,
  Calendar03Icon,
  Dollar01Icon,
  FileAddIcon,
  Folder01Icon,
  GridViewIcon,
  Home01Icon,
  KanbanIcon,
  Link01Icon,
  RefreshIcon,
  StarIcon,
  Table01Icon,
  Tag01Icon,
  Target02Icon,
  TextAlignLeftIcon,
  UserIcon,
  UserMultipleIcon,
  Copy01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { DataTable, type DataColumn, type DataRow, type TagTone } from "@/components/ui/data-table";
import { AppShell, Dropdown, FileCard, Icon, fileKind, useToast, type AppShellProps, type FileItem, type ShellGroup, type ShellNavItem } from "@/components/ui/app-shell";

/** Sample content – replace with your own data */
const nav: ShellNavItem[] = [
  { label: "Home", icon: Home01Icon },
  { label: "Companies", icon: Building03Icon, count: 284 },
  { label: "Contacts", icon: UserMultipleIcon },
  { label: "Deals", icon: Dollar01Icon },
  { label: "Reports", icon: Analytics01Icon },
];
const groups: ShellGroup[] = [
  {
    label: "Pipelines",
    items: [
      { label: "New business", icon: Target02Icon },
      { label: "Renewals", icon: RefreshIcon },
      { label: "Partnerships", icon: UserMultipleIcon },
    ],
  },
];

/** Company marks (Simple Icons, CC0): [color, path] on a 24 × 24 grid */
const LOGOS: Record<string, [string, string]> = {
  notion: ["#171717", "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"],
  linear: ["#5E6AD2", "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"],
  figma: ["#F24E1E", "M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-3.117V7.51zm0 1.471H8.148c-2.476 0-4.49-2.014-4.49-4.49S5.672 0 8.148 0h4.588v8.981zm-4.587-7.51c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.02 3.019 3.02h3.117V1.471H8.148zm4.587 15.019H8.148c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM8.148 8.981c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h3.117V8.981H8.148zM8.172 24c-2.489 0-4.515-2.014-4.515-4.49s2.014-4.49 4.49-4.49h4.588v4.441c0 2.503-2.047 4.539-4.563 4.539zm-.024-7.51a3.023 3.023 0 0 0-3.019 3.019c0 1.665 1.365 3.019 3.044 3.019 1.705 0 3.093-1.376 3.093-3.068v-2.97H8.148zm7.704 0h-.098c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h.098c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.49-4.49 4.49zm-.097-7.509c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h.098c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-.098z"],
  stripe: ["#635BFF", "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"],
  shopify: ["#7AB55C", "M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z"],
  airtable: ["#18BFFF", "M11.992 1.966c-.434 0-.87.086-1.28.257L1.779 5.917c-.503.208-.49.908.012 1.116l8.982 3.558a3.266 3.266 0 0 0 2.454 0l8.982-3.558c.503-.196.503-.908.012-1.116l-8.957-3.694a3.255 3.255 0 0 0-1.272-.257zM23.4 8.056a.589.589 0 0 0-.222.045l-10.012 3.877a.612.612 0 0 0-.38.564v8.896a.6.6 0 0 0 .821.552L23.62 18.1a.583.583 0 0 0 .38-.551V8.653a.6.6 0 0 0-.6-.596zM.676 8.095a.644.644 0 0 0-.48.19C.086 8.396 0 8.53 0 8.69v8.355c0 .442.515.737.908.54l6.27-3.006.307-.147 2.969-1.436c.466-.22.43-.908-.061-1.092L.883 8.138a.57.57 0 0 0-.207-.044z"],
  hubspot: ["#FF7A59", "M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"],
  webflow: ["#146EF5", "m24 4.515-7.658 14.97H9.149l3.205-6.204h-.144C9.566 16.713 5.621 18.973 0 19.485v-6.118s3.596-.213 5.71-2.435H0V4.515h6.417v5.278l.144-.001 2.622-5.277h4.854v5.244h.144l2.72-5.244H24Z"],
  vercel: ["#171717", "m12 1.608 12 20.784H0Z"],
  clickup: ["#7B68EE", "M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439zM12.04 6.15l-6.568 5.66-3.036-3.52L12.055 0l9.543 8.296-3.05 3.509z"],
};

const Logo = ({ id }: { id: string }) => (
  <span className="ui-as-crm__logo">
    <svg viewBox="0 0 24 24" fill={LOGOS[id][0]} aria-hidden="true">
      <path d={LOGOS[id][1]} />
    </svg>
  </span>
);

/** Coloured tiles for the view tabs – never white: brand colour with a white mark, or the full-colour mark on black */
const FigmaMark = () => (
  <svg viewBox="0 0 38 57" aria-hidden="true">
    <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0Z" fill="#1ABCFE" />
    <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0Z" fill="#0ACF83" />
    <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19Z" fill="#FF7262" />
    <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#F24E1E" />
    <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#A259FF" />
  </svg>
);
const TabMark = ({ id }: { id: string }) =>
  id === "figma" ? (
    <span className="ui-as-crm__tab-logo" style={{ background: "#1e1e1e" }}>
      <FigmaMark />
    </span>
  ) : (
    <span className="ui-as-crm__tab-logo" style={{ background: id === "notion" ? "#171717" : LOGOS[id][0] }}>
      <svg viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
        <path d={LOGOS[id][1]} />
      </svg>
    </span>
  );

const companies = [
  { id: "notion", name: "Notion", category: "Productivity", domain: "notion.so", owner: "Mara Klein", value: 48000, stage: "Negotiation", contact: "Today" },
  { id: "linear", name: "Linear", category: "Planning", domain: "linear.app", owner: "Jonas Weber", value: 12500, stage: "Proposal", contact: "Yesterday" },
  { id: "figma", name: "Figma", category: "Design", domain: "figma.com", owner: "Mara Klein", value: 86000, stage: "Won", contact: "Mar 6" },
  { id: "stripe", name: "Stripe", category: "Payments", domain: "stripe.com", owner: "Lea Braun", value: 124000, stage: "Qualified", contact: "Mar 5" },
  { id: "shopify", name: "Shopify", category: "E-commerce", domain: "shopify.com", owner: "Jonas Weber", value: 9800, stage: "New", contact: "Mar 4" },
  { id: "vercel", name: "Vercel", category: "Developer Tools", domain: "vercel.com", owner: "Lea Braun", value: 62000, stage: "Proposal", contact: "Mar 3" },
  { id: "airtable", name: "Airtable", category: "Productivity", domain: "airtable.com", owner: "Mara Klein", value: 37500, stage: "Qualified", contact: "Mar 1" },
  { id: "hubspot", name: "HubSpot", category: "CRM", domain: "hubspot.com", owner: "Tom Fischer", value: 21000, stage: "New", contact: "Feb 27" },
  { id: "clickup", name: "ClickUp", category: "Planning", domain: "clickup.com", owner: "Tom Fischer", value: 6400, stage: "Lost", contact: "Feb 25" },
  { id: "webflow", name: "Webflow", category: "Design", domain: "webflow.com", owner: "Lea Braun", value: 18900, stage: "Negotiation", contact: "Feb 24" },
];

const columns: DataColumn[] = [
  { key: "company", label: "Company", icon: <Icon icon={TextAlignLeftIcon} size={15} />, type: "title", width: "16%" },
  { key: "category", label: "Category", icon: <Icon icon={Tag01Icon} size={15} />, type: "tag", width: "14%" },
  { key: "domain", label: "Domain", icon: <Icon icon={Link01Icon} size={15} />, type: "link", width: "14%" },
  { key: "owner", label: "Owner", icon: <Icon icon={UserIcon} size={15} />, type: "text", width: "12%" },
  { key: "value", label: "Value", icon: <Icon icon={Dollar01Icon} size={15} />, type: "number", width: "12%" },
  { key: "stage", label: "Stage", icon: <Icon icon={KanbanIcon} size={15} />, type: "tag", width: "12%" },
  { key: "contact", label: "Last contact", icon: <Icon icon={Calendar03Icon} size={15} />, type: "text" },
];

const rows: DataRow[] = companies.map((c) => ({
  id: c.id,
  company: c.name,
  logo: <Logo id={c.id} />,
  category: c.category,
  domain: `https://${c.domain}`,
  owner: c.owner,
  value: c.value,
  stage: c.stage,
  contact: c.contact,
}));

const tones: Record<string, TagTone> = {
  Productivity: "gray",
  Planning: "blue",
  Design: "pink",
  Payments: "violet",
  "E-commerce": "amber",
  "Developer Tools": "gray",
  CRM: "blue",
  New: "gray",
  Qualified: "blue",
  Proposal: "violet",
  Negotiation: "amber",
  Won: "green",
  Lost: "pink",
};

/** Open views, each marked with the tool it lives in */
const tabs = [
  { label: "Company CRM", logo: "hubspot" },
  { label: "Team strategy", logo: "linear" },
  { label: "Pixel integration", logo: "figma" },
  { label: "Sales docs", logo: "notion" },
];

const stages = ["New", "Qualified", "Proposal", "Negotiation", "Won"];
const money = (n: number) => `$${n.toLocaleString("en-US")}`;

const docs: (FileItem & { owner: string })[] = [
  { name: "Sales-Playbook", type: "DOC", edited: "Today", owner: "Mara Klein" },
  { name: "Pricing-2025", type: "PDF", edited: "Yesterday", owner: "Lea Braun" },
  { name: "Pipeline-Forecast", type: "XLS", edited: "3 days ago", owner: "Jonas Weber" },
  { name: "Objection-Handling", type: "DOC", edited: "Last week", owner: "Tom Fischer" },
];

const snippet = `<script async src="https://cdn.acme.com/pixel.js"></script>
<script>
  window.acme = window.acme || [];
  acme.push(["init", "px_4f9a21"]);
  acme.push(["track", "page_view"]);
</script>`;

export type CrmScreenProps = Pick<AppShellProps, "onNavigate" | "workspace" | "user" | "className">;

export function CrmScreen(props: CrmScreenProps) {
  const [tab, setTab] = useState(tabs[0].label);
  const [starred, setStarred] = useState(false);
  const [view, setView] = useState("Head of Sales");
  const [copied, setCopied] = useState(false);
  const [verify, setVerify] = useState<"idle" | "busy" | "ok">("idle");
  const [toast, showToast] = useToast();

  const copy = () => {
    navigator.clipboard?.writeText(snippet).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const check = () => {
    setVerify("busy");
    window.setTimeout(() => setVerify("ok"), 1400);
  };

  return (
    <AppShell active="Companies" nav={nav} groups={groups} {...props}>
      <style href="ui-screen-crm" precedence="default">
        {css}
      </style>
      <div className="ui-as-crm">
        <header className="ui-as-crm__top">
          <span className="ui-as-crm__path">
            <Icon icon={Folder01Icon} size={15} />
            <span>Sales</span>
            <i>/</i>
            <Dropdown
              title="Views"
              items={["Head of Sales", "Account executive", "Partner manager"].map((v) => ({ label: v, checked: v === view, onSelect: () => setView(v) }))}
              trigger={({ open, toggle }) => (
                <button type="button" className="ui-as-crm__view" aria-expanded={open} onClick={toggle}>
                  {view}
                  <Icon icon={ArrowDown01Icon} size={13} />
                </button>
              )}
            />
          </span>
          <button
            type="button"
            className="ui-as-icon-btn ui-as-crm__star"
            aria-label={starred ? "Remove from favorites" : "Add to favorites"}
            aria-pressed={starred}
            onClick={() => {
              setStarred((s) => !s);
              showToast(starred ? "Removed from favorites" : "Added to favorites");
            }}
          >
            <Icon icon={StarIcon} size={15} />
          </button>
        </header>

        <nav className="ui-as-crm__tabs" aria-label="Open views">
          <button type="button" className="ui-as-icon-btn" aria-label="New view">
            <Icon icon={FileAddIcon} size={16} />
          </button>
          <button type="button" className="ui-as-icon-btn" aria-label="All views">
            <Icon icon={GridViewIcon} size={16} />
          </button>
          <span className="ui-as-crm__sep" />
          {tabs.map((t) => (
            <button
              key={t.label}
              type="button"
              className="ui-as-crm__tab"
              aria-current={tab === t.label ? "page" : undefined}
              onClick={(e) => {
                setTab(t.label);
                // On a narrow screen the views scroll sideways – bring the picked one fully into view
                const el = e.currentTarget;
                const bar = el.parentElement;
                if (!bar || bar.scrollWidth <= bar.clientWidth) return;
                const left = Math.min(el.offsetLeft - 14, Math.max(bar.scrollLeft, el.offsetLeft + el.offsetWidth + 14 - bar.clientWidth));
                bar.scrollTo({ left, behavior: "smooth" });
              }}
            >
              <TabMark id={t.logo} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="ui-as-crm__table" key={tab}>
          {tab === "Company CRM" && (
            <DataTable title="Company CRM" icon={<Icon icon={Table01Icon} size={16} />} columns={columns} rows={rows} tagTones={tones} />
          )}

          {tab === "Team strategy" && (
            <div className="ui-as-board">
              {stages.map((stage, si) => {
                const deals = companies.filter((c) => c.stage === stage);
                return (
                  <section key={stage} className="ui-as-board__col ui-as-rise" style={{ "--i": si } as CSSProperties}>
                    <header>
                      <span className="ui-as-board__dot" data-tone={tones[stage]} />
                      {stage}
                      <span className="ui-as-board__count">{deals.length}</span>
                      <span className="ui-as-board__sum">{money(deals.reduce((n, d) => n + d.value, 0))}</span>
                    </header>
                    {deals.map((d) => (
                      <article key={d.id} className="ui-as-board__card">
                        <span className="ui-as-board__name">
                          <span className="ui-as-board__logo">
                            <Logo id={d.id} />
                          </span>
                          {d.name}
                        </span>
                        <b>{money(d.value)}</b>
                        <span className="ui-as-board__meta">
                          {d.owner} · {d.contact}
                        </span>
                      </article>
                    ))}
                  </section>
                );
              })}
            </div>
          )}

          {tab === "Pixel integration" && (
            <div className="ui-as-pixel">
              <h2 className="ui-as-rise">Install the tracking pixel</h2>
              <p className="ui-as-rise" style={{ "--i": 1 } as CSSProperties}>
                Add this snippet to every page, right before the closing &lt;/head&gt; tag. Visits and sign-ups then show up on each company.
              </p>
              <div className="ui-as-pixel__code ui-as-rise" style={{ "--i": 2 } as CSSProperties}>
                <button type="button" className="ui-as-tool ui-as-tool--label" onClick={copy}>
                  <Icon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
                  {copied ? "Copied" : "Copy"}
                </button>
                <pre>{snippet}</pre>
              </div>
              <div className="ui-as-pixel__status ui-as-rise" style={{ "--i": 3 } as CSSProperties} data-state={verify}>
                <span className="ui-as-pixel__light" />
                <span>
                  <b>{verify === "ok" ? "Pixel is live" : verify === "busy" ? "Checking…" : "Waiting for the first event"}</b>
                  {verify === "ok" ? "Last event: page_view on acme.com, just now" : "Install the snippet, then check the connection."}
                </span>
                <button type="button" className="ui-as-tool ui-as-tool--label" onClick={check} disabled={verify === "busy"}>
                  {verify === "ok" ? "Check again" : "Check connection"}
                </button>
              </div>
            </div>
          )}

          {tab === "Sales docs" && (
            <div className="ui-as-crm-docs ui-as-file-grid">
              {docs.map((d, i) => (
                <div key={d.name} className="ui-as-rise" style={{ "--i": i } as CSSProperties}>
                  <FileCard file={d} meta={<>{fileKind[d.type]} · {d.owner} · {d.edited}</>} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {toast}
    </AppShell>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* CRM: path and tabs on the panel, the table as its own white layer below */
.ui-as-crm { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 0 0 12px; }
.ui-as-crm__top { display: flex; flex: none; align-items: center; gap: 6px; height: 52px; padding: 0 16px 0 20px; }
.ui-as-crm__path { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--muted); }
.ui-as-crm__path i { font-style: normal; color: var(--faint); }
.ui-as-crm__view {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  margin-left: -6px;
  padding: 0 6px;
  border-radius: 7px;
  font-weight: 500;
  color: var(--ink);
  transition: background-color 140ms ease;
}
.ui-as-crm__view:hover { background: var(--hover); }
.ui-as-crm__star { width: 26px; height: 26px; }
.ui-as-crm__star[aria-pressed="true"] { color: #f59e0b; }
.ui-as-crm__star[aria-pressed="true"] path { fill: currentColor; }

.ui-as-crm__tabs { display: flex; flex: none; align-items: center; gap: 4px; padding: 0 14px 12px; }
.ui-as-crm__sep { width: 1px; height: 18px; margin: 0 6px; background: var(--line); }
.ui-as-crm__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 12px 0 10px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-as-crm__tab:hover { color: var(--ink); background: var(--hover); }
.ui-as-crm__tab[aria-current="page"] { background: var(--chip); color: var(--ink); font-weight: 500; }

/* The table as a white layer with a thin edge, inset from the panel */
.ui-as-crm__table {
  flex: 1;
  min-height: 0;
  margin: 0 12px;
  overflow: auto;
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
}
.ui-as .ui-as-crm__table .ui-dt { --ui-dt-card-shadow: none; padding: 0; border-radius: 0; background: transparent; }
.ui-as-crm__table .ui-dt__head { padding: 14px 18px 12px; }
/* A line above the head and one under the last row, so the table ends cleanly before "Add row" */
.ui-as-crm__table .ui-dt__card { border: 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); border-radius: 0; }

.ui-as-crm__table > * { animation: ui-as-rise 380ms var(--ease) both; }

/* Team strategy: deals as a board by stage */
.ui-as-board { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; padding: 16px; }
.ui-as-board__col { display: flex; flex-direction: column; gap: 8px; min-width: 0; padding: 10px; border-radius: 12px; background: var(--chip); }
.ui-as-board__col header { display: flex; align-items: center; gap: 7px; padding: 2px 4px 4px; font-size: 13px; font-weight: 500; color: var(--ink); }
.ui-as-board__dot { width: 7px; height: 7px; border-radius: 50%; background: #a3a3a3; }
.ui-as-board__dot[data-tone="blue"] { background: #2f6bff; }
.ui-as-board__dot[data-tone="violet"] { background: #7c4dff; }
.ui-as-board__dot[data-tone="amber"] { background: #f59e0b; }
.ui-as-board__dot[data-tone="green"] { background: #16a34a; }
.ui-as-board__count { font-weight: 400; color: var(--faint); }
.ui-as-board__sum { margin-left: auto; font-size: 12px; font-weight: 400; color: var(--muted); font-variant-numeric: tabular-nums; }
.ui-as-board__card {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
  transition: box-shadow 160ms ease, transform 200ms var(--ease);
}
.ui-as-board__card:hover { transform: translateY(-1px); box-shadow: 0 0 0 1px var(--line-strong), 0 4px 12px rgba(0, 0, 0, 0.06); }
.ui-as-board__name { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 500; color: var(--ink); }
.ui-as-board__logo { display: block; width: 20px; height: 20px; }
.ui-as-board__card b { font-size: 14px; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }
.ui-as-board__meta { font-size: 12px; color: var(--muted); }

/* Pixel integration: setup steps with a code snippet and a live status */
.ui-as-pixel { padding: 28px 28px 32px; }
/* Text keeps a readable line length; code block and status run the full width */
.ui-as-pixel p { max-width: 640px; }
.ui-as-pixel h2 { margin: 0; font-size: 16px; font-weight: 500; color: var(--ink); }
.ui-as-pixel p { margin: 6px 0 0; font-size: 13.5px; line-height: 20px; color: var(--muted); }
.ui-as-pixel__code { position: relative; margin-top: 18px; border-radius: 12px; background: var(--subtle); box-shadow: inset 0 0 0 1px var(--line); }
.ui-as-pixel__code pre { margin: 0; padding: 16px 18px; overflow-x: auto; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12.5px; line-height: 20px; color: var(--ink); }
.ui-as-pixel__code .ui-as-tool { position: absolute; top: 10px; right: 10px; background: var(--card); }
.ui-as-pixel__status {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px var(--line);
  font-size: 13px;
  color: var(--muted);
}
.ui-as-pixel__status > span:nth-child(2) { display: grid; flex: 1; gap: 1px; }
.ui-as-pixel__status b { font-weight: 500; color: var(--ink); }
.ui-as-pixel__light { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.15); }
.ui-as-pixel__status[data-state="busy"] .ui-as-pixel__light { animation: ui-as-blink 700ms ease-in-out infinite alternate; }
.ui-as-pixel__status[data-state="ok"] .ui-as-pixel__light { background: #16a34a; box-shadow: 0 0 0 4px rgba(22, 163, 74, 0.15); }
@keyframes ui-as-blink { to { opacity: 0.3; } }

/* Sales docs */
.ui-as-crm-docs { display: flex; flex-wrap: wrap; gap: 12px; padding: 18px; }

/* Company mark on a small white tile */
.ui-as-crm__logo {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 5px;
  background: #ffffff;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
}
.ui-as-crm__logo svg { width: 64%; height: 64%; }
.ui-as-crm__tab-logo { display: grid; flex: none; place-items: center; width: 18px; height: 18px; border-radius: 5px; }
.ui-as-crm__tab-logo svg { width: 11px; height: 11px; }

/* Room for the sidebar icon while the sidebar is collapsed */
.ui-as-crm__top { transition: padding-left 420ms var(--ease); }
.ui-as-app[data-collapsed] .ui-as-crm__top { padding-left: 52px; }

/* Narrow: the views scroll sideways, the table and the board scroll inside their layer */
@container ui-as (max-width: 900px) {
  .ui-as-crm__top { padding-left: 52px; }
  .ui-as-crm__tabs { position: relative; overflow-x: auto; scrollbar-width: none; }
  .ui-as-crm__tabs::-webkit-scrollbar { display: none; }
  .ui-as-crm__tabs > * { flex: none; }
  .ui-as-crm__table .ui-dt__table { min-width: 880px; }
  .ui-as-board { grid-template-columns: repeat(5, 232px); width: max-content; }
}
@container ui-as (max-width: 600px) {
  .ui-as-crm { padding-bottom: 6px; }
  .ui-as-crm__top { padding-right: 8px; }
  .ui-as-crm__tabs { padding: 0 8px 10px; }
  .ui-as-crm__table { margin: 0 6px; border-radius: 12px; }
  .ui-as-crm__table .ui-dt__head { padding: 12px 14px 10px; }
  .ui-as-board { grid-template-columns: repeat(5, 216px); padding: 12px; }
  .ui-as-pixel { padding: 20px 16px 24px; }
  .ui-as-pixel__code pre { padding-top: 52px; }
  .ui-as-pixel__status { flex-wrap: wrap; }
  .ui-as-pixel__status > span:nth-child(2) { flex-basis: calc(100% - 30px); }
  .ui-as-crm-docs { padding: 14px; }
}
`;
