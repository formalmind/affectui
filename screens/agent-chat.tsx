"use client";

/*
 * Agent Chat – a chat with an orchestrating agent and a brief beside it, in a single file.
 * The thread shows the agent's answer and which agents are working; the composer sits at the bottom.
 * On the right a brief to fill in: selling angle, palette and formats, then one button to generate.
 * Sits in the affectUI App Shell with the same composer as Assistant Home; Button from the library, icons from the Hugeicons free set.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  AiBrain01Icon,
  Analytics01Icon,
  ArrowRight01Icon,
  BubbleChatIcon,
  Cancel01Icon,
  CheckListIcon,
  Folder01Icon,
  Home01Icon,
  Image01Icon,
  Megaphone01Icon,
  MoreHorizontalIcon,
  PaintBoardIcon,
  SidebarRightIcon,
  SlackIcon,
  Target02Icon,
  TaskDaily01Icon,
  TShirtIcon,
  UserGroupIcon,
  WorkflowSquare03Icon,
  InstagramIcon,
  TiktokIcon,
  Facebook01Icon,
  Calendar03Icon,
  Dollar01Icon,
  Location01Icon,
  CheckmarkCircle02Icon,
  ShoppingBag01Icon,
  SparklesIcon,
  PinIcon,
  PencilEdit02Icon,
  Share08Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { ChatMessages, Composer, useChatThread, type ChatReply } from "@/components/ui/assistant-home";
import { AppShell, Dropdown, Icon, type AppShellProps, type ShellGroup, type ShellNavItem } from "@/components/ui/app-shell";

/** Sample content – replace with your own data */
const nav: ShellNavItem[] = [
  { label: "Home", icon: Home01Icon },
  { label: "Chat", icon: BubbleChatIcon },
  { label: "Analytics", icon: Analytics01Icon },
  { label: "Plan", icon: TaskDaily01Icon },
  { label: "Deliverables", icon: Folder01Icon },
  { label: "On Slack", icon: SlackIcon },
];
const groups: ShellGroup[] = [
  {
    label: "Tools",
    items: [
      { label: "Campaign", icon: Megaphone01Icon },
      { label: "Creatives", icon: Image01Icon },
      { label: "Briefs", icon: CheckListIcon },
      { label: "Workflows", icon: WorkflowSquare03Icon },
    ],
  },
  { label: "Chats", items: [], empty: "No chats yet" },
];

const agents = [
  { label: "Campaign manager", icon: Megaphone01Icon },
  { label: "Brand research", icon: Target02Icon },
  { label: "Creative pipeline", icon: PaintBoardIcon },
  { label: "Audience research", icon: UserGroupIcon },
  { label: "Creative direction", icon: AiBrain01Icon },
];

const angles = [
  { label: "Desire-driven", note: "The first warm evening", signal: 3 },
  { label: "Problem–solution", note: "Heat, itchy fabrics", signal: 2 },
  { label: "Social proof", note: "412 sold, top reviews", signal: 1 },
];
const palette = [
  { name: "Sand", hex: "#e3d3b8" },
  { name: "Olive", hex: "#7c8458" },
  { name: "Off-white", hex: "#f4f1ea" },
  { name: "Ink", hex: "#1f2328" },
];
const formats = [
  { label: "Feed", ratio: "1 / 1" },
  { label: "Story", ratio: "9 / 16" },
  { label: "Banner", ratio: "16 / 9" },
];
const sections = ["Brief", "Assets", "Activity"];
const ads = [
  { title: "The first warm evening", format: "Feed", channel: "Instagram", ratio: "1 / 1", bg: "#e3d3b8", ink: "#1f2328" },
  { title: "Made for July", format: "Story", channel: "TikTok", ratio: "1 / 1", bg: "#7c8458", ink: "#f4f1ea" },
  { title: "Linen, finally", format: "Feed", channel: "Instagram", ratio: "1 / 1", bg: "#f4f1ea", ink: "#1f2328" },
  { title: "412 people can't be wrong", format: "Story", channel: "Instagram", ratio: "1 / 1", bg: "#1f2328", ink: "#f4f1ea" },
  { title: "Breathe out", format: "Banner", channel: "Facebook", ratio: "1 / 1", bg: "#c9b48f", ink: "#1f2328" },
  { title: "Summer, unbuttoned", format: "Feed", channel: "TikTok", ratio: "1 / 1", bg: "#a3a77f", ink: "#1f2328" },
];
const audience = ["Women 25–34", "Urban", "Warm climates", "Linen & natural fabrics"];
const channels = [
  { label: "Instagram", note: "Feed and Stories", icon: InstagramIcon, on: true },
  { label: "TikTok", note: "Story format only", icon: TiktokIcon, on: true },
  { label: "Facebook", note: "Feed and Banner", icon: Facebook01Icon, on: false },
];
const details = [
  { label: "Launch", value: "Mon, Jun 2", icon: Calendar03Icon },
  { label: "Budget", value: "$2,400 / week", icon: Dollar01Icon },
  { label: "Markets", value: "US, UK, AU", icon: Location01Icon },
];

export type AgentChatScreenProps = Pick<AppShellProps, "onNavigate" | "workspace" | "user" | "className">;

export function AgentChatScreen(props: AgentChatScreenProps) {
  const [angle, setAngle] = useState(angles[0].label);
  const [section, setSection] = useState(sections[0]);
  const [briefOpen, setBriefOpen] = useState(true);
  const [pinned, setPinned] = useState(false);
  const [generated, setGenerated] = useState<"no" | "busy" | "yes">("no");
  const thread = useRef<HTMLDivElement>(null);
  // On a narrow panel the brief opens as a layer over the chat, so it starts closed there
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if ((root.current?.offsetWidth ?? Infinity) <= 900) setBriefOpen(false);
  }, []);

  // Prepared answers of the orchestrator – they pick up the angle chosen in the brief
  const chat = useChatThread((prompt): ChatReply => ({
    steps: [
      { kind: "step", label: "Reading the brief" },
      { kind: "step", label: "Checking 412 orders of the Linen Overshirt" },
      { kind: "step", label: "Lining up the creative pipeline" },
    ],
    paragraphs: /angle|desire|problem|proof/i.test(prompt)
      ? [
          `Good call. I'll go with ${angle.toLowerCase()} – it fits the bestseller and the summer launch.`,
          "Copy will lead with the moment, the product follows; every ad ends on the same offer.",
          "Hit Generate ads in the brief when you're ready – six ads take about two minutes.",
        ]
      : [
          `Noted: “${prompt}”. I've added it to the brief for the creative pipeline.`,
          `The angle stays ${angle.toLowerCase()}; Brand research is checking that the copy stays on brand.`,
          "Anything else before I generate the ads?",
        ],
  }));

  const generate = () => {
    if (generated === "busy") return;
    setGenerated("busy");
    window.setTimeout(() => {
      setGenerated("yes");
      setSection("Assets");
    }, 1600);
  };

  const [active, setActive] = useState(() => new Set(channels.filter((c) => c.on).map((c) => c.label)));
  const toggle = (label: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <AppShell active="Chat" nav={nav} groups={groups} {...props}>
      <style href="ui-screen-agent-chat" precedence="default">
        {css}
      </style>
      <div ref={root} className="ui-as-chat" data-brief={briefOpen || undefined}>
        <section className="ui-as-chat__main">
          <header className="ui-as-chat__bar">
            <span className="ui-as-chat__crumbs">
              <Icon icon={BubbleChatIcon} size={15} />
              Chat <i>/</i> <b>Generate on-brand creative</b>
              <Dropdown
                items={[
                  { label: pinned ? "Unpin chat" : "Pin chat", icon: PinIcon, onSelect: () => setPinned((p) => !p) },
                  { label: "Rename", icon: PencilEdit02Icon },
                  { label: "Share", icon: Share08Icon },
                  { label: "Delete chat", icon: Delete02Icon, danger: true },
                ]}
                trigger={({ open, toggle }) => (
                  <button type="button" className="ui-as-icon-btn" aria-label="Chat options" aria-expanded={open} onClick={toggle}>
                    <Icon icon={MoreHorizontalIcon} size={15} />
                  </button>
                )}
              />
            </span>
            <span className="ui-as-chat__tools">
              <button type="button" className="ui-as-icon-btn" aria-label="Tasks">
                <Icon icon={CheckListIcon} size={16} />
              </button>
              <button
                type="button"
                className="ui-as-icon-btn"
                aria-label={briefOpen ? "Hide brief" : "Show brief"}
                aria-pressed={briefOpen}
                onClick={() => setBriefOpen((o) => !o)}
              >
                <Icon icon={SidebarRightIcon} size={16} />
              </button>
            </span>
          </header>

          <div ref={thread} className="ui-as-chat__thread">
            <div className="ui-as-chat__column">
              <p className="ui-as-chat__user">Desire-driven</p>

              <div className="ui-as-chat__answer">
                <span className="ui-as-chat__who">
                  <span className="ui-as-chat__avatar">
                    <Icon icon={AiBrain01Icon} size={12} />
                  </span>
                  Orchestrator
                </span>
                <p>I&apos;ll pull your bestseller first, then line up the creative generation.</p>
                <span className="ui-as-chat__worked">
                  <Icon icon={ArrowRight01Icon} size={13} />
                  Worked for 3m 38s
                </span>
                <p>
                  Your bestseller is the Linen Overshirt (the only product synced so far – Shopify is still importing, so
                  treat that ranking as provisional).
                </p>
                <p>
                  Before I brief and generate the ads, I need one thing I can&apos;t infer, because it drives the whole copy
                  structure: how should we sell this shirt?
                </p>

                <span className="ui-as-chat__label">Agents working</span>
                <div className="ui-as-chat__agents">
                  {agents.map((a, i) => (
                    <span key={a.label} className="ui-as-chat__agent" data-active={i === 0 || undefined}>
                      <Icon icon={a.icon} size={14} />
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>
              <ChatMessages messages={chat.messages} name="Orchestrator" scroller={thread} onDone={chat.finish} />
            </div>
          </div>

          <div className="ui-as-chat__composer">
            <span className="ui-as-chat__route">
              <span className="ui-as-chat__avatar">
                <Icon icon={AiBrain01Icon} size={12} />
              </span>
              <b>Orchestrator</b> Routes each request
            </span>
            <Composer placeholder="Ask anything or @ to add context" onSend={chat.send} busy={chat.busy} />
          </div>
        </section>

        {/* Narrow only: dims the chat behind the brief layer; a tap closes it */}
        {briefOpen && <div className="ui-as-chat__scrim" aria-hidden="true" onClick={() => setBriefOpen(false)} />}
        {briefOpen && (
          <aside className="ui-as-brief" aria-label="Brief">
            <header className="ui-as-chat__bar">
              <span className="ui-as-chat__crumbs">
                Brief <i>/</i> <b>Summer launch</b>
              </span>
              <button type="button" className="ui-as-icon-btn" aria-label="Close brief" onClick={() => setBriefOpen(false)}>
                <Icon icon={Cancel01Icon} size={15} />
              </button>
            </header>

            <div className="ui-as-brief__body">
              <div className="ui-as-brief__seg" role="tablist" aria-label="Brief sections">
                {sections.map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={section === s} onClick={() => setSection(s)}>
                    {s}
                  </button>
                ))}
              </div>

              {section === "Brief" && (
                <div className="ui-as-brief__panel" key="brief">
              <div className="ui-as-brief__product">
                    <span className="ui-as-brief__thumb">
                      <Icon icon={TShirtIcon} size={18} />
                    </span>
                    <span className="ui-as-brief__pinfo">
                      <b>Linen Overshirt</b>
                      <span>$89 · 412 sold this month</span>
                    </span>
                    <span className="ui-as-brief__chip">Bestseller</span>
                  </div>

                  <section className="ui-as-brief__section">
                    <span className="ui-as-brief__label">Selling angle</span>
                    {angles.map((a) => (
                      <button
                        key={a.label}
                        type="button"
                        role="radio"
                        aria-checked={angle === a.label}
                        className="ui-as-brief__option"
                        onClick={() => setAngle(a.label)}
                      >
                        <span className="ui-as-brief__radio" aria-hidden="true" />
                        <span className="ui-as-brief__name">
                          {a.label}
                          <small>{a.note}</small>
                        </span>
                        <span className="ui-as-brief__signal" aria-label={`Signal ${a.signal} of 3`}>
                          {[1, 2, 3].map((n) => (
                            <i key={n} data-on={n <= a.signal || undefined} />
                          ))}
                        </span>
                      </button>
                    ))}
                  </section>

                  <section className="ui-as-brief__section">
                    <span className="ui-as-brief__label">Audience</span>
                    <div className="ui-as-brief__pills">
                      {audience.map((a) => (
                        <span key={a}>{a}</span>
                      ))}
                    </div>
                  </section>

                  <section className="ui-as-brief__section">
                    <span className="ui-as-brief__label">Channels</span>
                    {channels.map((c) => (
                      <label key={c.label} className="ui-as-brief__channel">
                        <Icon icon={c.icon} size={16} />
                        <span className="ui-as-brief__name">
                          {c.label}
                          <small>{c.note}</small>
                        </span>
                        <input type="checkbox" className="ui-as-switch" checked={active.has(c.label)} onChange={() => toggle(c.label)} />
                      </label>
                    ))}
                  </section>

                  <section className="ui-as-brief__section ui-as-brief__section--split">
                    <div>
                      <span className="ui-as-brief__label">Palette</span>
                      <div className="ui-as-brief__swatches">
                        {palette.map((c) => (
                          <span key={c.name}>
                            <i style={{ background: c.hex }} />
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="ui-as-brief__label">Formats</span>
                      <div className="ui-as-brief__formats">
                        {formats.map((f) => (
                          <span key={f.label}>
                            <i style={{ aspectRatio: f.ratio }} />
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </section>

                  <section className="ui-as-brief__section">
                    <span className="ui-as-brief__label">Details</span>
                    <dl className="ui-as-brief__details">
                      {details.map((d) => (
                        <div key={d.label}>
                          <dt>
                            <Icon icon={d.icon} size={14} />
                            {d.label}
                          </dt>
                          <dd>{d.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>

                  <div className="ui-as-brief__go">
                    <span className="ui-as-brief__tags">
                      <span>6 ads</span>
                      <span>~2 min</span>
                    </span>
                    <Button size="sm" onClick={generate} disabled={generated === "busy"}>
                      {generated === "busy" ? "Generating…" : generated === "yes" ? "Generate again" : "Generate ads"}
                    </Button>
                  </div>
                </div>
              )}

              {section === "Assets" && (
                <div className="ui-as-brief__panel ui-as-brief__assets" key="assets">
                  {generated === "yes" ? (
                    <>
                      <span className="ui-as-brief__label">6 ads · {angle}</span>
                      <div className="ui-as-ads">
                        {ads.map((ad, i) => (
                          <figure key={ad.title} className="ui-as-ad ui-as-rise" style={{ "--i": i, "--ad": ad.bg, "--ad-ink": ad.ink } as CSSProperties}>
                            <span className="ui-as-ad__art" style={{ aspectRatio: ad.ratio }}>
                              <Icon icon={TShirtIcon} size={22} />
                              <b>{ad.title}</b>
                            </span>
                            <figcaption>
                              {ad.format}
                              <span>{ad.channel}</span>
                            </figcaption>
                          </figure>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="ui-as-brief__empty ui-as-rise">
                      <span>
                        <Icon icon={SparklesIcon} size={18} />
                      </span>
                      <b>{generated === "busy" ? "Generating your ads…" : "No assets yet"}</b>
                      <p>{generated === "busy" ? "The creative pipeline is on it – this takes a moment." : "Fill in the brief and generate ads – they show up here."}</p>
                      {generated === "no" && (
                        <Button size="sm" variant="secondary" onClick={generate}>
                          Generate ads
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {section === "Activity" && (
                <ol className="ui-as-brief__panel ui-as-activity" key="activity">
                  {[
                    ...(generated === "yes" ? [{ icon: SparklesIcon, text: `6 ads generated · ${angle}`, time: "Just now" }] : []),
                    { icon: CheckmarkCircle02Icon, text: `Angle set to ${angle}`, time: "2 min ago" },
                    { icon: Target02Icon, text: "Brand research checked the palette", time: "3 min ago" },
                    { icon: ShoppingBag01Icon, text: "Linen Overshirt picked as bestseller", time: "4 min ago" },
                    { icon: Megaphone01Icon, text: "Shopify import started", time: "6 min ago" },
                    { icon: CheckListIcon, text: "Brief “Summer launch” created", time: "7 min ago" },
                  ].map((item, i) => (
                    <li key={item.text} className="ui-as-rise" style={{ "--i": i } as CSSProperties}>
                      <span className="ui-as-activity__icon">
                        <Icon icon={item.icon} size={14} />
                      </span>
                      <span className="ui-as-activity__text">
                        {item.text}
                        <small>{item.time}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Agent chat: thread and composer on the left, the brief as a panel on the right */
.ui-as-chat { display: flex; height: 100%; min-height: 0; }
.ui-as-chat__main { display: flex; flex: 1; flex-direction: column; min-width: 0; }

.ui-as-chat__bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
}
.ui-as-chat__crumbs { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
.ui-as-chat__crumbs i { font-style: normal; color: var(--faint); }
.ui-as-chat__crumbs b { font-weight: 500; color: var(--ink); }
.ui-as-chat__crumbs .ui-as-icon-btn { width: 24px; height: 24px; margin-left: -2px; }
.ui-as-chat__tools { display: flex; gap: 2px; }
.ui-as-chat__tools .ui-as-icon-btn[aria-pressed="true"] { background: var(--chip); color: var(--ink); }

.ui-as-chat__thread { flex: 1; min-height: 0; overflow-y: auto; padding: 40px 32px 16px; }
.ui-as-chat__column { display: flex; flex-direction: column; gap: 22px; max-width: 680px; margin: 0 auto; }
.ui-as-chat__user {
  align-self: flex-end;
  margin: 0;
  padding: 8px 14px;
  border-radius: 14px;
  background: var(--chip);
  font-size: 14px;
  color: var(--ink);
}
.ui-as-chat__answer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--ink);
}
.ui-as-chat__answer p { margin: 0; }
.ui-as-chat__who, .ui-as-chat__route { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.ui-as-chat__avatar {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--chip);
  color: var(--ink);
}
.ui-as-chat__worked { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--muted); }
.ui-as-chat__label { padding-top: 4px; font-size: 12.5px; color: var(--muted); }
.ui-as-chat__agents { display: flex; flex-wrap: wrap; gap: 6px; margin-top: -6px; }
.ui-as-chat__agent {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px 0 10px;
  border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--line);
  font-size: 13px;
  color: var(--text);
}
.ui-as-chat__agent svg { color: var(--muted); }
.ui-as-chat__agent[data-active] { background: var(--chip); box-shadow: none; color: var(--ink); }
.ui-as-chat__agent[data-active] svg { color: var(--ink); }

.ui-as-chat__composer { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 744px; margin: 0 auto; padding: 8px 32px 24px; }
.ui-as-chat__route { font-size: 13px; font-weight: 400; color: var(--muted); }
.ui-as-chat__route b { font-weight: 500; color: var(--ink); }

/* Brief panel: flat sections divided by fine lines, the generate row pinned to the bottom */
.ui-as-brief { display: flex; flex: none; flex-direction: column; width: 400px; border-left: 1px solid var(--line-soft); }
.ui-as-brief__body { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow-y: auto; }
.ui-as-brief__seg { display: flex; gap: 2px; margin: 20px 20px 0; padding: 3px; border-radius: 10px; background: var(--chip); }
.ui-as-brief__seg button {
  flex: 1;
  height: 28px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-as-brief__seg button:hover { color: var(--ink); }
.ui-as-brief__seg button[aria-selected="true"] { background: var(--card); box-shadow: 0 0 0 1px var(--line), var(--shadow); color: var(--ink); }

.ui-as-brief__product { display: flex; align-items: center; gap: 12px; margin: 18px 20px 6px; }
.ui-as-brief__thumb {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #efe7da;
  color: #7c6a4f;
}
.ui-as-brief__pinfo { display: flex; flex: 1; flex-direction: column; min-width: 0; font-size: 12.5px; line-height: 17px; color: var(--muted); }
.ui-as-brief__pinfo b { font-size: 14px; font-weight: 500; line-height: 20px; color: var(--ink); }
.ui-as-brief__chip { padding: 2px 8px; border-radius: 999px; background: rgba(22, 163, 74, 0.1); font-size: 12px; font-weight: 500; color: #15803d; }

.ui-as-brief__section { display: flex; flex-direction: column; padding: 18px 20px; border-top: 1px solid var(--line-soft); }
.ui-as-brief__product + .ui-as-brief__section { margin-top: 14px; }
.ui-as-brief__section--split { flex-direction: row; justify-content: space-between; gap: 16px; }
.ui-as-brief__label { padding-bottom: 12px; font-size: 12.5px; font-weight: 500; line-height: 16px; color: var(--faint); }

.ui-as-brief__option {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
  margin: 0 -10px;
  padding: 0 10px;
  border-radius: 10px;
  color: var(--muted);
  text-align: left;
  transition: background-color 140ms ease, color 140ms ease, box-shadow 140ms ease;
}
.ui-as-brief__option:hover { background: var(--hover); color: var(--ink); }
.ui-as-brief__option[aria-checked="true"] { background: var(--chip); color: var(--ink); }
.ui-as-brief__radio { flex: none; width: 14px; height: 14px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--line-strong); transition: box-shadow 160ms ease; }
.ui-as-brief__option[aria-checked="true"] .ui-as-brief__radio { box-shadow: inset 0 0 0 4px var(--ink); }
.ui-as-brief__name { display: flex; flex: 1; flex-direction: column; min-width: 0; font-size: 13.5px; font-weight: 500; line-height: 18px; color: var(--ink); }
.ui-as-brief__option .ui-as-brief__name { color: inherit; }
.ui-as-brief__name small { font-size: 12.5px; font-weight: 400; line-height: 17px; color: var(--faint); }
.ui-as-brief__signal { display: flex; align-items: flex-end; gap: 2px; height: 11px; }
.ui-as-brief__signal i { width: 3px; border-radius: 1px; background: #d9d9d9; }
.ui-as-brief__signal i:nth-child(1) { height: 5px; }
.ui-as-brief__signal i:nth-child(2) { height: 8px; }
.ui-as-brief__signal i:nth-child(3) { height: 11px; }
.ui-as-brief__signal i[data-on] { background: #16a34a; }

.ui-as-brief__pills { display: flex; flex-wrap: wrap; gap: 8px; }
.ui-as-brief__pills span { padding: 4px 10px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); font-size: 12.5px; color: var(--text); }

.ui-as-brief__channel { display: flex; align-items: center; gap: 12px; min-height: 44px; cursor: pointer; }
.ui-as-brief__channel > svg { color: var(--muted); }
/* Small switch, drawn on the checkbox itself */
.ui-as-switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  margin: 0;
  border-radius: 999px;
  background: var(--toggle-off);
  cursor: pointer;
  transition: background-color 180ms ease;
}
.ui-as-switch::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: translate 220ms var(--ease);
}
.ui-as-switch:checked { background: var(--switch-on); }
.ui-as-switch:checked::after { translate: 12px 0; }
.ui-as-switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.ui-as-brief__swatches, .ui-as-brief__formats { display: flex; gap: 14px; font-size: 12px; line-height: 16px; color: var(--muted); }
.ui-as-brief__swatches span, .ui-as-brief__formats span { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.ui-as-brief__swatches i { width: 22px; height: 22px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08); }
.ui-as-brief__formats span { justify-content: flex-end; height: 44px; }
.ui-as-brief__formats i { height: 24px; max-width: 36px; border: 1.5px solid var(--faint); border-radius: 4px; }
.ui-as-brief__formats span:nth-child(3) i { width: 36px; height: auto; }

.ui-as-brief__details { display: grid; gap: 12px; margin: 0; }
.ui-as-brief__details div { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.ui-as-brief__details dt { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.ui-as-brief__details dd { margin: 0; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }

.ui-as-brief__panel { display: flex; flex: 1 0 auto; flex-direction: column; animation: ui-as-rise 380ms var(--ease) both; }
.ui-as-brief__assets { padding: 16px; }
.ui-as-ads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ui-as-ad { margin: 0; }
.ui-as-ad__art {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  border-radius: 12px;
  background: var(--ad);
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.06);
  color: var(--ad-ink);
}
.ui-as-ad__art b { font-size: 15px; font-weight: 600; line-height: 1.2; letter-spacing: -0.01em; }
.ui-as-ad figcaption { display: flex; justify-content: space-between; margin-top: 6px; font-size: 12.5px; font-weight: 500; color: var(--ink); }
.ui-as-ad figcaption span { font-weight: 400; color: var(--muted); }
.ui-as-brief__empty { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; }
.ui-as-brief__empty > span { display: grid; place-items: center; width: 42px; height: 42px; margin-bottom: 8px; border-radius: 12px; background: var(--chip); color: var(--muted); }
.ui-as-brief__empty b { font-size: 14px; font-weight: 500; color: var(--ink); }
.ui-as-brief__empty p { max-width: 240px; margin: 0 0 10px; font-size: 13px; line-height: 19px; color: var(--muted); }
.ui-as-activity { margin: 0; padding: 16px; list-style: none; }
.ui-as-activity li { position: relative; display: flex; gap: 12px; padding-bottom: 18px; }
/* A fine line joins the icons into a timeline */
.ui-as-activity li:not(:last-child)::before { content: ""; position: absolute; top: 28px; bottom: 2px; left: 13px; width: 1px; background: var(--line); }
.ui-as-activity__icon { display: grid; flex: none; place-items: center; width: 27px; height: 27px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--line); color: var(--muted); }
.ui-as-activity__text { display: flex; flex-direction: column; padding-top: 3px; font-size: 13.5px; line-height: 19px; color: var(--ink); }
.ui-as-activity__text small { font-size: 12.5px; color: var(--faint); }

.ui-as-brief__go {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding: 16px 20px 20px;
  border-top: 1px solid var(--line-soft);
  /* Stays in view at the bottom when the brief is taller than the panel */
  position: sticky;
  bottom: 0;
  z-index: 1;
  background: var(--panel);
}
.ui-as-brief__tags { display: flex; gap: 4px; }
.ui-as-brief__tags span { padding: 3px 9px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--line); font-size: 12.5px; font-weight: 500; color: var(--text); }

:where(.dark, [data-theme="dark"]) .ui-as-brief__thumb { background: #3a3329; color: #d9c6a5; }
:where(.dark, [data-theme="dark"]) .ui-as-brief__signal i:not([data-on]) { background: #3a3a3f; }

/* Room for the sidebar icon while the sidebar is collapsed */
.ui-as-chat__main > .ui-as-chat__bar { transition: padding-left 420ms var(--ease); }
.ui-as-app[data-collapsed] .ui-as-chat__main > .ui-as-chat__bar { padding-left: 52px; }
.ui-as-chat__scrim { display: none; }

/* Narrow panels: the brief becomes a layer that slides in from the right over the chat */
@container ui-as-main (max-width: 900px) {
  .ui-as-brief {
    position: absolute;
    z-index: 12;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(400px, calc(100% - 32px));
    border-left: 0;
    border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
    background: var(--panel);
    box-shadow: -1px 0 0 var(--line), -20px 0 40px -16px rgba(0, 0, 0, 0.2);
    animation: ui-as-brief-in 420ms var(--ease) both;
  }
  .ui-as-chat__scrim {
    display: block;
    position: absolute;
    z-index: 11;
    inset: 0;
    border-radius: inherit;
    background: rgba(0, 0, 0, 0.18);
    animation: ui-as-brief-fade 300ms ease both;
  }
}
@keyframes ui-as-brief-in { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ui-as-brief-fade { from { opacity: 0; } }
@container ui-as (max-width: 900px) {
  .ui-as-chat__main > .ui-as-chat__bar { padding-left: 52px; }
}
@container ui-as (max-width: 600px) {
  /* Only the chat's name stays in the bar */
  .ui-as-chat__main .ui-as-chat__crumbs { min-width: 0; }
  .ui-as-chat__main .ui-as-chat__crumbs > svg, .ui-as-chat__main .ui-as-chat__crumbs > i { display: none; }
  .ui-as-chat__main .ui-as-chat__crumbs { font-size: 0; }
  .ui-as-chat__main .ui-as-chat__crumbs > b { overflow: hidden; font-size: 13.5px; white-space: nowrap; text-overflow: ellipsis; }
  .ui-as-chat__bar { padding-right: 8px; }
  .ui-as-brief .ui-as-chat__bar { padding-left: 52px; }
  .ui-as-chat__thread { padding: 24px 16px 12px; }
  .ui-as-chat__composer { padding: 6px 8px 8px; }
  .ui-as-chat__route { padding-left: 6px; }
  .ui-as-brief { width: 100%; border-radius: var(--radius-panel); }
  .ui-as-brief__seg { margin: 16px 16px 0; }
  .ui-as-brief__product { margin: 16px 16px 6px; }
  .ui-as-brief__section { padding: 16px; }
  .ui-as-brief__section--split { flex-wrap: wrap; }
  .ui-as-brief__go { padding: 14px 16px 16px; }
}
`;
