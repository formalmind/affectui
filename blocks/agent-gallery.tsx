"use client";

import { useEffect, useState, type KeyboardEvent } from "react";

/*
 * Agent Gallery – a showcase block, in a single self-contained file.
 * Slim vertical panels sit side by side, each with the same soft gradient artwork in its own colors.
 * The panel in the middle is open and shows a product screen; pick a side panel (or use the arrows)
 * and it glides open in the middle while the current one folds into a slim panel at the side.
 * The styles are injected below, so no extra files are needed.
 */

export type GalleryItem = {
  id: string;
  name: string;
  description: string;
  /** Two colors for the gradient artwork – strong, then soft */
  colors: [string, string];
  /** What the agent reacts to */
  trigger: string;
  /** Steps shown under Instructions */
  steps: string[];
  /** Skills shown as chips */
  skills: string[];
  /** A rule shown under Guardrails */
  guardrail: string;
};

export type AgentGalleryProps = {
  title?: string;
  subtitle?: string;
  items?: GalleryItem[];
  /** Item to open first – by default the middle one */
  defaultIndex?: number;
  className?: string;
};

const defaultItems: GalleryItem[] = [
  {
    id: "triage",
    name: "Support triage",
    description: "Sorts new tickets by urgency and routes them to the right team.",
    colors: ["#8b5cf6", "#e9d5ff"],
    trigger: "Ticket created",
    steps: ["Read the ticket and detect the product area.", "Set priority from customer plan and sentiment.", "Assign the team and post a summary in the thread."],
    skills: ["Classify ticket", "Summarize thread"],
    guardrail: "Cannot close tickets",
  },
  {
    id: "enrich",
    name: "Lead enrichment",
    description: "Fills in company data for every new lead before sales picks it up.",
    colors: ["#2f6bff", "#c7d7ff"],
    trigger: "Lead added",
    steps: ["Look up the company by email domain.", "Add size, industry and location to the record.", "Score the lead and notify the owner above 80."],
    skills: ["Find company", "Score lead"],
    guardrail: "Cannot change lead owner",
  },
  {
    id: "recap",
    name: "Meeting recap",
    description: "Turns call transcripts into notes, decisions and next steps.",
    colors: ["#ec4899", "#fbcfe8"],
    trigger: "Call ended",
    steps: ["Pull the transcript from the recording.", "Write a short recap with decisions and owners.", "Create follow-up tasks and share the notes."],
    skills: ["Write recap", "Create tasks"],
    guardrail: "Cannot email external guests",
  },
  {
    id: "churn",
    name: "Churn watch",
    description: "Spots accounts that go quiet and suggests a save play.",
    colors: ["#f97316", "#fed7aa"],
    trigger: "Usage drops 30%",
    steps: ["Compare weekly usage against the last quarter.", "Check open tickets and recent NPS answers.", "Draft a check-in for the account manager."],
    skills: ["Read usage", "Draft check-in"],
    guardrail: "Cannot offer discounts",
  },
  {
    id: "onboard",
    name: "Onboarding coach",
    description: "Guides new customers through setup and nudges when they get stuck.",
    colors: ["#14b8a6", "#ccfbf1"],
    trigger: "Workspace created",
    steps: ["Send a welcome note with the first three steps.", "Watch for steps that stay open for two days.", "Offer a short call when setup stalls."],
    skills: ["Send nudge", "Book call"],
    guardrail: "Cannot change billing",
  },
  {
    id: "review",
    name: "Content review",
    description: "Checks drafts for tone, claims and brand terms before they ship.",
    colors: ["#6366f1", "#e0e7ff"],
    trigger: "Draft submitted",
    steps: ["Check tone against the brand guide.", "Flag claims that need a source.", "Suggest fixes inline and tag the author."],
    skills: ["Check tone", "Flag claims"],
    guardrail: "Cannot publish",
  },
  {
    id: "release",
    name: "Release notes",
    description: "Writes customer-facing notes from merged pull requests.",
    colors: ["#d946ef", "#f5d0fe"],
    trigger: "Release tagged",
    steps: ["Collect merged pull requests since the last tag.", "Group them into features, fixes and changes.", "Draft notes in plain language for review."],
    skills: ["Group changes", "Write notes"],
    guardrail: "Cannot post without review",
  },
];

const MOVE = 620; // ms – width and track glide together

export function AgentGallery({
  title = "Agents that run your playbook",
  subtitle = "Give each agent its steps, tools and limits – then let it work inside the tools your team already uses.",
  items = defaultItems,
  defaultIndex,
  className,
}: AgentGalleryProps) {
  const n = items.length;
  // The list is laid out three times in a row and the track slides so the open panel sits in the middle.
  // Moving any distance is one smooth glide; afterwards the position quietly jumps back into the middle copy.
  const [pos, setPos] = useState(n + (defaultIndex ?? Math.floor(n / 2)));
  const [snap, setSnap] = useState(false);
  const active = ((pos % n) + n) % n;
  const current = items[active];
  const strip = [...items, ...items, ...items];

  useEffect(() => {
    if (pos >= n && pos < 2 * n) return;
    const t = window.setTimeout(() => {
      setSnap(true);
      setPos((p) => (p < n ? p + n : p - n));
    }, MOVE + 40);
    return () => window.clearTimeout(t);
  }, [pos, n]);

  useEffect(() => {
    if (!snap) return;
    // Two frames: the jump renders without transitions, then they switch back on
    let raf = requestAnimationFrame(() => (raf = requestAnimationFrame(() => setSnap(false))));
    return () => cancelAnimationFrame(raf);
  }, [snap]);

  const go = (next: number) => setPos(Math.max(0, Math.min(3 * n - 1, next)));

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(pos + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(pos - 1);
    }
  };

  return (
    <section className={["ui-ag", className].filter(Boolean).join(" ")} aria-roledescription="carousel" aria-label={title}>
      <style href="ui-agent-gallery" precedence="default">
        {css}
      </style>

      <header className="ui-ag__head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>

      <div className="ui-ag__viewport" onKeyDown={onKey}>
        <div className="ui-ag__track" data-snap={snap ? "" : undefined} style={{ ["--pos" as string]: pos }}>
          {strip.map((item, j) => {
            const open = j === pos;
            const distance = Math.abs(j - pos);
            return (
              <div
                key={`${Math.floor(j / n)}-${item.id}`}
                className="ui-ag__panel"
                data-open={open ? "" : undefined}
                data-far={distance >= 2 ? "" : undefined}
                style={{ ["--a" as string]: item.colors[0], ["--b" as string]: item.colors[1] }}
                aria-hidden={distance > 3 || undefined}
              >
                <span className="ui-ag__art" aria-hidden="true" />
                {/* Nearby panels keep their screen, so it can fade out as a panel folds and fade in as it opens */}
                {distance <= 3 && <Screen item={item} hidden={!open} />}
                {!open && (
                  <button
                    type="button"
                    className="ui-ag__pick"
                    aria-label={`Show ${item.name}`}
                    tabIndex={distance > 3 ? -1 : undefined}
                    onClick={() => go(j)}
                  >
                    <span className="ui-ag__label">{item.name}</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-ag__foot">
        <p className="ui-ag__caption" aria-live="polite" key={current.id}>
          <b>{current.name}.</b> {current.description}
        </p>
        <div className="ui-ag__arrows">
          <button type="button" aria-label="Previous agent" onClick={() => go(pos - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
            </svg>
          </button>
          <button type="button" aria-label="Next agent" onClick={() => go(pos + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14m0 0-6-6m6 6-6 6" />
            </svg>
          </button>
        </div>
      </div>
    </section>
  );
}

/* ---------- The product screen inside the open panel: the agent's workspace with its context feed ---------- */

// Stable sample numbers per agent, so every panel shows something different
const seed = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 997, 7);

/** A tiny sparkline: a wavy line ending in a dot */
function Spark({ n, color }: { n: number; color: string }) {
  const pts = Array.from({ length: 10 }, (_, i) => [i * 8, 15 - ((n * (i + 5) * 7 + i * 3) % 13)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className="ui-ag__spark" viewBox="-2 -2 78 20" aria-hidden="true">
      <path d={d} style={{ stroke: color }} />
      <circle cx={lx} cy={ly} r="2.2" style={{ fill: color }} />
    </svg>
  );
}

const Avatar = ({ name }: { name: string }) => (
  <span className="ui-ag__avatar" aria-hidden="true">
    {name
      .split(" ")
      .map((p) => p[0])
      .join("")}
  </span>
);

const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);
const G = {
  note: "M5 6.5A1.5 1.5 0 0 1 6.5 5h11A1.5 1.5 0 0 1 19 6.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4 3v-3h-.5A.5.5 0 0 1 5 15.5Z",
  chart: "M6 18V11M10 18V7M14 18v-5M18 18V9",
  file: "M8 3.5h6l4 4v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1ZM14 3.5v4h4",
  plug: "M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v4",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM20 20l-4.5-4.5",
  clip: "m15.5 7.5-6.4 6.4a1.8 1.8 0 0 0 2.5 2.5l6.7-6.7a3.5 3.5 0 0 0-5-5l-6.9 6.9a5.2 5.2 0 0 0 7.4 7.4l6-6",
  sync: "M19 12a7 7 0 0 1-12.3 4.6M5 12a7 7 0 0 1 12.3-4.6M17.5 4v3.5H14M6.5 20v-3.5H10",
  filter: "M5 7h14M8 12h8M11 17h2",
};

function Screen({ item, hidden }: { item: GalleryItem; hidden: boolean }) {
  const n = seed(item.id);
  const kpis: [string, string, string][] = [
    ["Runs", `${40 + (n % 160)}`, "#22a06b"],
    ["Success", `${94 + (n % 6)}%`, "#2f9bd6"],
    ["Time saved", `${(2 + (n % 70) / 10).toFixed(1)}h`, "#8b5cf6"],
    ["Escalated", `${1 + (n % 7)}`, "#ec4899"],
  ];
  return (
    <div className="ui-ag__screen" aria-label={`${item.name} workspace`} aria-hidden={hidden || undefined} inert={hidden || undefined}>
      {/* App bar */}
      <div className="ui-ag__bar">
        <span className="ui-ag__brand" aria-hidden="true" />
        <span className="ui-ag__switch">
          <span className="ui-ag__mark" aria-hidden="true" />
          {item.name}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m8 10 4-4 4 4M8 14l4 4 4-4" />
          </svg>
        </span>
        <span className="ui-ag__new">+ New agent</span>
        <Avatar name="Lena Hart" />
      </div>

      <div className="ui-ag__page">
        {/* Header: mark, name, sync and a row of numbers with sparklines */}
        <div className="ui-ag__hero">
          <span className="ui-ag__logo" aria-hidden="true" />
          <span className="ui-ag__sync">
            3m ago
            <Glyph d={G.sync} />
          </span>
        </div>
        <h3>{item.name}</h3>
        <p className="ui-ag__sub">Triggered by “{item.trigger}” · Owner Lena Hart</p>
        <div className="ui-ag__kpis">
          {kpis.map(([label, value, color], i) => (
            <div key={label}>
              <span>{label}</span>
              <b>{value}</b>
              <Spark n={n + i * 13} color={color} />
            </div>
          ))}
        </div>
        <div className="ui-ag__tabs">
          <span>Runs</span>
          <span>Tools</span>
          <b>Context</b>
          <span>Settings</span>
        </div>

        {/* Context feed */}
        <h4>Agent context</h4>
        <p className="ui-ag__hint">Goals, files and rules the agent uses on every run.</p>
        <div className="ui-ag__toolbar">
          <span className="ui-ag__search">
            <Glyph d={G.search} />
            Search context…
          </span>
          <span className="ui-ag__filter">
            <Glyph d={G.filter} />
            All
          </span>
        </div>
        <ol className="ui-ag__feed">
          <li className="ui-ag__compose">
            <Avatar name="Lena Hart" />
            <div className="ui-ag__box">
              <span>Add context, e.g. “{item.guardrail}”</span>
              <span className="ui-ag__box-foot">
                <Glyph d={G.clip} />
                <b>Add context</b>
              </span>
            </div>
          </li>
          <li>
            <span className="ui-ag__dot">
              <Glyph d={G.note} />
            </span>
            <div>
              <p className="ui-ag__line">
                <Avatar name="Jonas Weber" />
                <b>Jonas Weber</b> added context · today
              </p>
              <p className="ui-ag__card">{item.steps[0]}</p>
            </div>
          </li>
          <li>
            <span className="ui-ag__dot">
              <Glyph d={G.chart} />
            </span>
            <p className="ui-ag__line">
              <Avatar name="Mara Lindqvist" />
              <b>Mara Lindqvist</b> generated a <u>Weekly summary</u> · 1d ago
            </p>
          </li>
          <li>
            <span className="ui-ag__dot">
              <Glyph d={G.file} />
            </span>
            <p className="ui-ag__line">
              <Avatar name="Mara Lindqvist" />
              <b>Mara Lindqvist</b> added <u>playbook.pdf</u>
              <i className="ui-ag__ext" data-kind="pdf" /> and <u>accounts.csv</u>
              <i className="ui-ag__ext" data-kind="csv" /> · 2d ago
            </p>
          </li>
          <li>
            <span className="ui-ag__dot">
              <Glyph d={G.note} />
            </span>
            <div>
              <p className="ui-ag__line">
                <Avatar name="Jonas Weber" />
                <b>Jonas Weber</b> added context · 2d ago
              </p>
              <p className="ui-ag__card">
                {item.steps[1]} {item.steps[2]}
              </p>
            </div>
          </li>
          <li>
            <span className="ui-ag__dot ui-ag__dot--app">
              <Glyph d={G.plug} />
            </span>
            <p className="ui-ag__line">
              Connected <u>Slack</u> and <u>HubSpot</u> · 3d ago
            </p>
          </li>
        </ol>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-ag {
  --ui-ag-ink: #171717;
  --ui-ag-text: #404040;
  --ui-ag-muted: #8f8f8f;
  --ui-ag-base-top: #f4f4f6;
  --ui-ag-base-bottom: #e9e9ee;
  --ui-ag-screen: #ffffff;
  --ui-ag-page: #fafafa;
  --ui-ag-screen-line: #ececec;
  --ui-ag-chip: #ffffff;
  --ui-ag-chip-line: #e5e5e5;
  --ui-ag-soft: #f5f5f5;
  --ui-ag-btn: #ffffff;
  --ui-ag-shine: rgba(255, 255, 255, 0.75);
  --ui-ag-ok: #2f7d32;
  --ui-ag-ok-bg: #e8f5e6;
  --ui-ag-height: 560px;
  --ui-ag-side: 104px;
  --ui-ag-gap: 14px;
  --ui-ag-open: min(70cqw, 1120px);
  --ui-ag-ease: cubic-bezier(0.65, 0, 0.25, 1);
  container-type: inline-size;
  overflow: hidden;
  padding: 8px 0 4px;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-ag-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-ag *, .ui-ag *::before, .ui-ag *::after { box-sizing: border-box; }
.ui-ag button { font: inherit; color: inherit; margin: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-ag button:focus-visible { outline: 2px solid #2f6bff; outline-offset: 3px; }

.ui-ag__head { max-width: 620px; margin: 0 auto 36px; padding: 0 20px; text-align: center; }
.ui-ag__head h2 { margin: 0; font-size: 30px; font-weight: 600; letter-spacing: -0.025em; line-height: 1.15; }
.ui-ag__head p { margin: 12px 0 0; font-size: 16px; line-height: 1.5; color: var(--ui-ag-muted); }

/* ---------- Track: slim panels, one open in the middle ---------- */

.ui-ag__viewport { overflow: hidden; }
/* The track slides so the open panel's centre lands in the middle of the block */
.ui-ag__track {
  display: flex;
  gap: var(--ui-ag-gap);
  width: max-content;
  height: var(--ui-ag-height);
  transform: translateX(calc(50cqw - var(--pos) * (var(--ui-ag-side) + var(--ui-ag-gap)) - var(--ui-ag-open) / 2));
  transition: transform 620ms var(--ui-ag-ease);
}
.ui-ag__track[data-snap],
.ui-ag__track[data-snap] * { transition: none !important; animation: none !important; }
.ui-ag__panel {
  position: relative;
  flex: 0 0 var(--ui-ag-side);
  overflow: hidden;
  border-radius: 20px;
  transition: flex-basis 620ms var(--ui-ag-ease);
}
.ui-ag__panel[data-open] { flex-basis: var(--ui-ag-open); }
/* Hovering a side panel only brings its color up – the width stays */

/* One artwork for every panel – only the two colors change. Side panels are muted until hovered */
.ui-ag__art {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(118deg, transparent 38%, var(--ui-ag-shine) 47%, transparent 57%),
    radial-gradient(110% 80% at 0% 0%, color-mix(in srgb, var(--a) 70%, transparent) 0%, transparent 60%),
    radial-gradient(90% 70% at 100% 100%, var(--b) 0%, transparent 72%),
    radial-gradient(60% 50% at 30% 100%, color-mix(in srgb, var(--a) 28%, transparent) 0%, transparent 70%),
    linear-gradient(180deg, var(--ui-ag-base-top), var(--ui-ag-base-bottom));
  filter: saturate(0.35);
  transition: filter 500ms ease, transform 900ms var(--ui-ag-ease);
}
.ui-ag__panel:hover .ui-ag__art { filter: none; }
.ui-ag__panel[data-open] .ui-ag__art { filter: none; }
.ui-ag__panel[data-far] .ui-ag__art { filter: saturate(0.12); }

.ui-ag__pick {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 0 0 22px 16px;
  border: 0;
  background: none;
  animation: ui-ag-fade 400ms ease 200ms both;
}
.ui-ag__label {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font-size: 17px;
  font-weight: 500;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: color-mix(in srgb, var(--a) 70%, var(--ui-ag-text));
  opacity: 0.85;
}
.ui-ag__panel[data-far] .ui-ag__label { color: var(--ui-ag-muted); }

/* ---------- Screen ---------- */

.ui-ag__screen {
  position: absolute;
  top: 44px;
  left: 44px;
  /* Fits the open panel side to side (cut only at the bottom); on small screens it runs off the right edge */
  width: max(640px, calc(100% - 88px));
  min-height: 620px;
  overflow: hidden;
  border-radius: 16px;
  background: var(--ui-ag-page);
  box-shadow: 0 0 0 1px var(--ui-ag-screen-line), 0 20px 50px -20px rgba(0, 0, 0, 0.18);
  font-size: 11.5px;
  color: var(--ui-ag-text);
  /* Folding away: fades and drifts off quickly while the panel narrows */
  opacity: 0;
  transform: translate(28px, 14px) scale(0.98);
  transition: opacity 260ms ease, transform 420ms var(--ui-ag-ease);
}
/* Opening: comes in once the panel has mostly widened */
.ui-ag__panel[data-open] .ui-ag__screen {
  opacity: 1;
  transform: none;
  transition: opacity 420ms ease 260ms, transform 620ms var(--ui-ag-ease) 220ms;
}
.ui-ag__screen svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.ui-ag__screen u { text-decoration: underline; text-decoration-color: var(--ui-ag-chip-line); text-underline-offset: 3px; text-decoration-thickness: 1.5px; color: var(--ui-ag-ink); }

/* App bar */
.ui-ag__bar { display: flex; align-items: center; gap: 12px; height: 48px; padding: 0 14px; background: var(--ui-ag-screen); }
.ui-ag__brand { width: 18px; height: 18px; border-radius: 5px; background: var(--ui-ag-ink); }
.ui-ag__switch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 8px 0 6px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ui-ag-ink);
}
.ui-ag__switch svg { width: 12px; height: 12px; color: var(--ui-ag-muted); }
.ui-ag__mark, .ui-ag__logo { border-radius: 5px; background: linear-gradient(135deg, var(--a), var(--b)); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35); }
.ui-ag__mark { width: 16px; height: 16px; }
.ui-ag__new {
  margin-left: auto;
  padding: 5px 10px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line), 0 1px 1px rgba(0, 0, 0, 0.04);
  font-size: 11px;
  font-weight: 500;
  color: var(--ui-ag-ink);
}
.ui-ag__avatar {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: 50%;
  background: var(--ui-ag-soft);
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line);
  font-size: 7.5px;
  font-weight: 600;
  color: var(--ui-ag-text);
}
.ui-ag__bar .ui-ag__avatar { width: 26px; height: 26px; font-size: 9px; }

/* Page */
.ui-ag__page { padding: 16px max(28px, calc((100% - 560px) / 2)) 24px; }
.ui-ag__hero { display: flex; align-items: flex-start; justify-content: space-between; }
.ui-ag__logo { width: 30px; height: 30px; border-radius: 8px; }
.ui-ag__sync { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ui-ag-muted); }
.ui-ag__page h3 { margin: 8px 0 2px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; color: var(--ui-ag-ink); }
.ui-ag__sub { margin: 0 0 12px; font-size: 11px; color: var(--ui-ag-muted); }
.ui-ag__kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 12px; }
.ui-ag__kpis > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 54px;
  grid-template-areas: "label spark" "value spark";
  column-gap: 8px;
  padding: 0 12px;
  border-left: 1px solid var(--ui-ag-screen-line);
}
.ui-ag__kpis > div:first-child { padding-left: 0; border-left: 0; }
.ui-ag__kpis span { grid-area: label; font-size: 10.5px; color: var(--ui-ag-muted); white-space: nowrap; }
.ui-ag__kpis b { grid-area: value; font-size: 15px; font-weight: 600; letter-spacing: -0.02em; color: var(--ui-ag-ink); font-variant-numeric: tabular-nums; }
.ui-ag__screen .ui-ag__spark { grid-area: spark; align-self: end; width: 54px; height: 20px; margin-bottom: 2px; overflow: visible; }
.ui-ag__spark path { fill: none; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.ui-ag__tabs { display: flex; gap: 16px; margin: 0 -400px 14px; padding: 0 400px; border-bottom: 1px solid var(--ui-ag-screen-line); }
.ui-ag__tabs > * { padding: 0 1px 8px; font-size: 11.5px; color: var(--ui-ag-muted); }
.ui-ag__tabs b { font-weight: 500; color: var(--ui-ag-ink); box-shadow: inset 0 -1.5px 0 var(--ui-ag-ink); }
.ui-ag__page h4 { margin: 0; font-size: 13px; font-weight: 600; color: var(--ui-ag-ink); }
.ui-ag__hint { margin: 3px 0 12px; font-size: 11px; color: var(--ui-ag-muted); }
.ui-ag__toolbar { display: flex; gap: 6px; margin-bottom: 14px; }
.ui-ag__search, .ui-ag__filter {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border-radius: 10px;
  background: var(--ui-ag-screen);
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line);
  font-size: 11px;
  color: var(--ui-ag-muted);
}
.ui-ag__search { flex: 1; }
.ui-ag__filter { color: var(--ui-ag-ink); }

/* Feed: a thin line connects the icons on the left */
.ui-ag__feed { position: relative; display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
.ui-ag__feed::before { content: ""; position: absolute; left: 12px; top: 24px; bottom: 8px; width: 1px; background: var(--ui-ag-screen-line); }
.ui-ag__feed li { position: relative; display: grid; grid-template-columns: 25px 1fr; gap: 10px; align-items: start; }
.ui-ag__compose .ui-ag__avatar { width: 25px; height: 25px; font-size: 8.5px; }
.ui-ag__box {
  display: grid;
  gap: 18px;
  padding: 10px 10px 8px 12px;
  border-radius: 12px;
  background: var(--ui-ag-screen);
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  color: var(--ui-ag-muted);
}
.ui-ag__box-foot { display: flex; align-items: center; justify-content: space-between; }
.ui-ag__box-foot b { padding: 4px 9px; border-radius: 8px; background: var(--ui-ag-soft); font-size: 10.5px; font-weight: 500; color: var(--ui-ag-ink); }
.ui-ag__dot {
  display: grid;
  place-items: center;
  width: 25px;
  height: 25px;
  border-radius: 50%;
  background: var(--ui-ag-page);
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line);
  color: var(--ui-ag-muted);
}
.ui-ag__dot svg { width: 12px; height: 12px; }
.ui-ag__dot--app { background: linear-gradient(135deg, var(--a), var(--b)); box-shadow: none; color: #fff; }
.ui-ag__line { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 5px 0 0; color: var(--ui-ag-muted); }
.ui-ag__line b { font-weight: 500; color: var(--ui-ag-ink); }
.ui-ag__ext { width: 9px; height: 11px; border-radius: 2px; background: #e5484d; }
.ui-ag__ext[data-kind="csv"] { background: #30a46c; }
.ui-ag__card {
  margin: 7px 0 0;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--ui-ag-screen);
  box-shadow: inset 0 0 0 1px var(--ui-ag-chip-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  line-height: 1.5;
  color: var(--ui-ag-ink);
}

/* ---------- Caption and arrows ---------- */

.ui-ag__foot {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  width: var(--ui-ag-open);
  margin: 26px auto 0;
}
.ui-ag__caption {
  max-width: 520px;
  margin: 0;
  font-size: 19px;
  line-height: 1.45;
  letter-spacing: -0.01em;
  color: var(--ui-ag-muted);
  animation: ui-ag-fade 420ms ease both;
}
.ui-ag__caption b { font-weight: 500; color: var(--ui-ag-ink); }
.ui-ag__arrows {
  display: flex;
  flex: none;
  border-radius: 12px;
  background: var(--ui-ag-btn);
  box-shadow: 0 0 0 1px var(--ui-ag-chip-line), 0 1px 2px rgba(0, 0, 0, 0.05);
}
.ui-ag__arrows button {
  display: grid;
  place-items: center;
  width: 42px;
  height: 38px;
  padding: 0;
  border: 0;
  background: none;
  transition: background-color 160ms ease;
}
.ui-ag__arrows button:first-child { border-radius: 12px 0 0 12px; box-shadow: 1px 0 0 var(--ui-ag-chip-line); }
.ui-ag__arrows button:last-child { border-radius: 0 12px 12px 0; }
.ui-ag__arrows button:hover { background: var(--ui-ag-soft); }
.ui-ag__arrows svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

@keyframes ui-ag-fade { from { opacity: 0; } }

/* ---------- Narrow: the open panel takes most of the width, one slim panel peeks on each side ---------- */

@container (max-width: 760px) {
  .ui-ag { --ui-ag-height: 400px; --ui-ag-side: 56px; --ui-ag-gap: 10px; }
  .ui-ag { --ui-ag-open: calc(100cqw - 2 * (var(--ui-ag-side) + var(--ui-ag-gap)) - 24px); }
  .ui-ag__label { font-size: 14px; }
  .ui-ag__pick { padding: 0 0 16px 10px; }
  .ui-ag__screen { top: 40px; left: 22px; }
  .ui-ag__foot { width: calc(100cqw - 40px); }
  .ui-ag__caption { font-size: 16px; }
  .ui-ag__head h2 { font-size: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-ag__track, .ui-ag__panel, .ui-ag__art { transition: none; }
  .ui-ag__caption, .ui-ag__pick { animation: none; }
  .ui-ag__screen, .ui-ag__panel[data-open] .ui-ag__screen { transition: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ag {
  --ui-ag-ink: #ededed;
  --ui-ag-text: #c4c4c4;
  --ui-ag-muted: #8f8f8f;
  --ui-ag-base-top: #232326;
  --ui-ag-base-bottom: #1a1a1c;
  --ui-ag-screen: #232326;
  --ui-ag-page: #1c1c1f;
  --ui-ag-screen-line: rgba(255, 255, 255, 0.08);
  --ui-ag-chip: #2a2a2d;
  --ui-ag-chip-line: rgba(255, 255, 255, 0.08);
  --ui-ag-soft: #2a2a2d;
  --ui-ag-btn: #232326;
  --ui-ag-shine: rgba(255, 255, 255, 0.08);
  --ui-ag-ok: #6fd27a;
  --ui-ag-ok-bg: rgba(111, 210, 122, 0.14);
}
`;
