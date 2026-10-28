"use client";

/*
 * Agent Run – one autonomous agent run as a full app view, in a single file.
 * In the middle the plan ticks through its steps, with the tool calls of each step in an activity feed below it.
 * On the right "Needs your input": the run pauses on an approval before it sends anything, then the draft
 * it wrote as an inline diff and a few run details. Comes with a built-in simulation, so it runs on its own.
 * Sits in the affectUI App Shell; uses Agent Plan, Tool Call Card, Approval Card, Inline Diff, Thinking Loader
 * and Button from the library, icons from the Hugeicons free set.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  AiBrain01Icon,
  Analytics01Icon,
  BubbleChatIcon,
  Calendar03Icon,
  CheckListIcon,
  Clock01Icon,
  Coins01Icon,
  Dollar01Icon,
  FileEditIcon,
  Folder01Icon,
  Home01Icon,
  Mail01Icon,
  MoreHorizontalIcon,
  PlayCircleIcon,
  PresentationBarChart01Icon,
  RepeatIcon,
  Search01Icon,
  SidebarRightIcon,
  StopCircleIcon,
  UserGroupIcon,
  WorkflowSquare03Icon,
  Copy01Icon,
  Share08Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { AgentPlan, type PlanStep } from "@/components/ui/agent-plan";
import { ToolCallCard, ToolCallGroup } from "@/components/ui/tool-call-card";
import { ApprovalCard, type ApprovalDetail, type ApprovalRisk, type ApprovalStatus } from "@/components/ui/approval-card";
import { InlineDiff } from "@/components/ui/inline-diff";
import { ThinkingLoader } from "@/components/ui/thinking-loader";
import { AppShell, Dropdown, Icon, type AppShellProps, type ShellGroup, type ShellNavItem } from "@/components/ui/app-shell";

/* ---------- Types ---------- */

export type RunCall = {
  /** Tool name in mono, e.g. "stripe.query" */
  name: string;
  /** Short human summary of the call */
  summary: string;
  /** Icon in the tile – picked from the tool name when left out */
  icon?: IconSvgElement;
  args?: unknown;
  result?: unknown;
  /** How long the call takes in the simulation, in ms */
  duration: number;
};

export type RunApproval = {
  title: string;
  description?: string;
  risk?: ApprovalRisk;
  details?: ApprovalDetail[];
};

export type RunStep = {
  id: string;
  title: string;
  detail?: string;
  /** Tool chip on the plan step */
  tool?: string;
  /** Tool calls made during the step, in order */
  calls: RunCall[];
  /** The run pauses at the start of this step until someone approves it */
  approval?: RunApproval;
};

export type RunDraft = {
  original: string;
  suggested: string;
  label?: string;
};

/* ---------- Sample content – replace with your own data ---------- */

const nav: ShellNavItem[] = [
  { label: "Home", icon: Home01Icon },
  { label: "Chat", icon: BubbleChatIcon },
  { label: "Runs", icon: PlayCircleIcon, count: 3 },
  { label: "Analytics", icon: Analytics01Icon },
  { label: "Deliverables", icon: Folder01Icon },
];
const groups: ShellGroup[] = [
  {
    label: "Agents",
    items: [
      { label: "Board prep", icon: PresentationBarChart01Icon },
      { label: "Revenue ops", icon: Dollar01Icon },
      { label: "Inbox triage", icon: Mail01Icon },
      { label: "Workflows", icon: WorkflowSquare03Icon },
    ],
  },
];

export const defaultRunSteps: RunStep[] = [
  {
    id: "revenue",
    title: "Pull Q3 revenue and churn",
    detail: "From Stripe, July to September",
    tool: "stripe.query",
    calls: [
      {
        name: "stripe.query",
        summary: "Revenue by month, Q3",
        args: { metric: "revenue", from: "2026-07-01", to: "2026-09-30", group_by: "month" },
        result: { total: 4310000, months: [1380000, 1420000, 1510000], growth: 0.21 },
        duration: 700,
      },
      {
        name: "stripe.query",
        summary: "Customer churn, Q3",
        args: { metric: "churn_rate", period: "quarter" },
        result: { churn_rate: 0.018, previous: 0.021 },
        duration: 500,
      },
    ],
  },
  {
    id: "memo",
    title: "Read last quarter's board memo",
    detail: "Keeps the structure the board knows",
    tool: "search",
    calls: [
      {
        name: "search",
        summary: "Drive: “board memo Q2”",
        args: { query: "board memo Q2", source: "drive", limit: 5 },
        result: [{ title: "Board memo – Q2 2026", owner: "Maya Chen", edited: "Jul 9" }],
        duration: 900,
      },
      {
        name: "docs.read",
        summary: "Board memo – Q2 2026",
        args: { doc: "Board memo – Q2 2026" },
        result: "6 sections · 1,240 words",
        duration: 700,
      },
    ],
  },
  {
    id: "draft",
    title: "Update the memo draft",
    detail: "Revenue, churn and the Q4 outlook",
    tool: "docs.write",
    calls: [
      {
        name: "docs.write",
        summary: "Rewrote the revenue paragraph",
        args: { doc: "Board memo – Q3 2026", section: "Revenue" },
        result: { changed_words: 21 },
        duration: 1100,
      },
      {
        name: "docs.write",
        summary: "Added the churn chart",
        args: { doc: "Board memo – Q3 2026", insert: "chart", data: "churn_rate" },
        result: { ok: true },
        duration: 600,
      },
    ],
  },
  {
    id: "send",
    title: "Send the draft to Maya",
    detail: "Needs your approval first",
    tool: "gmail.send",
    approval: {
      title: "Send the draft to Maya",
      description: "Emails the Q3 board memo draft for review before Friday.",
      risk: "medium",
      details: [
        { label: "To", value: "Maya Chen (CFO)" },
        { label: "Subject", value: "Q3 board update – draft" },
        { label: "Attachment", value: "Board memo – Q3 2026" },
      ],
    },
    calls: [
      {
        name: "gmail.send",
        summary: "Sent to maya@acme.com",
        args: { to: "maya@acme.com", subject: "Q3 board update – draft", attach: "Board memo – Q3 2026" },
        result: { id: "msg_8f2c", status: "sent" },
        duration: 600,
      },
    ],
  },
  {
    id: "review",
    title: "Book a review with Maya",
    detail: "30 minutes before the board meeting",
    tool: "calendar.create",
    calls: [
      {
        name: "calendar.create",
        summary: "Thu, Oct 15 · 10:00",
        args: { title: "Q3 board memo review", with: ["maya@acme.com"], duration: 30 },
        result: { event: "evt_31a", time: "2026-10-15T10:00" },
        duration: 700,
      },
    ],
  },
];

export const defaultRunDraft: RunDraft = {
  label: "Board memo – Q3 · Revenue",
  original:
    "Revenue grew 18% in Q3 to $4.2M, mostly driven by new enterprise customers. Churn stayed flat at 2.1%, and we expect the pipeline to carry into Q4 without changes to the plan.",
  suggested:
    "Revenue grew 21% in Q3 to $4.3M, driven by six new enterprise customers. Churn fell to 1.8%, and the pipeline supports raising the Q4 target by 5%.",
};

const toolIcon = (name: string): IconSvgElement =>
  name.startsWith("stripe")
    ? Dollar01Icon
    : name.startsWith("search")
      ? Search01Icon
      : name.startsWith("docs")
        ? FileEditIcon
        : name.startsWith("gmail") || name.startsWith("mail")
          ? Mail01Icon
          : name.startsWith("calendar")
            ? Calendar03Icon
            : WorkflowSquare03Icon;

/* ---------- Simulation script ---------- */

type RunEvent = { kind: "step" | "ask" | "call" | "end" | "finish"; s: number; c?: number; delay: number };

/** Turns the steps into a timeline: start a step, ask (if needed), call each tool, finish */
function buildScript(steps: RunStep[]): RunEvent[] {
  const out: RunEvent[] = [];
  steps.forEach((st, s) => {
    out.push({ kind: "step", s, delay: s === 0 ? 150 : 300 });
    if (st.approval) out.push({ kind: "ask", s, delay: 450 });
    st.calls.forEach((call, c) => {
      out.push({ kind: "call", s, c, delay: 200 });
      out.push({ kind: "end", s, c, delay: call.duration });
    });
    out.push({ kind: "finish", s, delay: 250 });
  });
  return out;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const whole = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

export type AgentRunScreenProps = Pick<AppShellProps, "onNavigate" | "workspace" | "user" | "className"> & {
  /** Goal of the run, shown in the header and above the plan */
  title?: string;
  steps?: RunStep[];
  /** The text the agent wrote, shown as an inline diff on the right */
  draft?: RunDraft;
  /** Run name of the agent, shown in the details */
  agent?: string;
  /** Play the built-in simulation on mount */
  autoRun?: boolean;
  onApprove?: (stepId: string) => void;
  onDeny?: (stepId: string) => void;
  onStop?: () => void;
  onDone?: () => void;
};

export function AgentRunScreen({
  title = "Prepare the Q3 board update",
  steps = defaultRunSteps,
  draft = defaultRunDraft,
  agent = "Board prep",
  autoRun = true,
  onApprove,
  onDeny,
  onStop,
  onDone,
  ...shell
}: AgentRunScreenProps) {
  const script = useMemo(() => buildScript(steps), [steps]);
  const [cursor, setCursor] = useState(0);
  const [runKey, setRunKey] = useState(0);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [stopped, setStopped] = useState<"user" | "denied" | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ApprovalStatus>>({});
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const [, setTick] = useState(0);
  // On a narrow panel the side panel opens as a layer over the run, so it starts closed there
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if ((root.current?.offsetWidth ?? Infinity) <= 1000) setPanelOpen(false);
  }, []);

  /* ---------- What has happened so far, read from the applied part of the script ---------- */

  const applied = script.slice(0, cursor);
  const started = new Set(applied.filter((e) => e.kind === "step").map((e) => e.s));
  const finished = new Set(applied.filter((e) => e.kind === "finish").map((e) => e.s));
  const asked = new Set(applied.filter((e) => e.kind === "ask").map((e) => e.s));
  const callState = (s: number, c: number) =>
    applied.some((e) => e.kind === "end" && e.s === s && e.c === c)
      ? "success"
      : applied.some((e) => e.kind === "call" && e.s === s && e.c === c)
        ? "running"
        : null;
  const activeStep = steps.findIndex((_, s) => started.has(s) && !finished.has(s));
  const last = applied[applied.length - 1];
  const waitingOn = last?.kind === "ask" && decisions[last.s] !== "approved" && !stopped ? last.s : -1;
  const done = cursor >= script.length;
  const phase: "running" | "waiting" | "done" | "stopped" = done ? "done" : stopped ? "stopped" : waitingOn >= 0 ? "waiting" : "running";

  // Plays the script: one event after another, holding at an approval until it's given
  useEffect(() => {
    if (!autoRun || stopped || cursor >= script.length) return;
    if (last?.kind === "ask" && decisions[last.s] !== "approved") return;
    const t = window.setTimeout(() => setCursor((n) => n + 1), script[cursor].delay);
    return () => window.clearTimeout(t);
  }, [autoRun, cursor, stopped, decisions, script, runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!done || endedAt !== null) return;
    setEndedAt(Date.now());
    onDone?.();
  }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  // The header clock ticks while the run is live
  useEffect(() => {
    if (phase === "done" || phase === "stopped") return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [phase]);

  const planSteps: PlanStep[] = steps.map((st, s) => {
    const failed = stopped && s === activeStep;
    return {
      id: st.id,
      title: st.title,
      detail: st.detail,
      tool: st.tool,
      status: finished.has(s) ? "done" : failed ? "failed" : started.has(s) ? "active" : "pending",
      error: failed ? (stopped === "denied" ? "You denied this step" : "Stopped by you") : undefined,
    };
  });

  /* ---------- Actions ---------- */

  const restart = () => {
    setCursor(0);
    setStopped(null);
    setDecisions({});
    setOpenGroups({});
    setEndedAt(null);
    setStartedAt(Date.now());
    setRunKey((k) => k + 1);
  };
  const stop = () => {
    setStopped("user");
    setEndedAt(Date.now());
    onStop?.();
  };
  // Picks the run up again at the start of a failed step
  const retryFrom = (id: string) => {
    const s = steps.findIndex((st) => st.id === id);
    const at = script.findIndex((e) => e.kind === "step" && e.s === s);
    if (at < 0) return;
    setDecisions((d) => {
      const next = { ...d };
      delete next[s];
      return next;
    });
    setStopped(null);
    setEndedAt(null);
    setCursor(at);
  };
  const decide = (s: number, status: ApprovalStatus) => {
    setDecisions((d) => ({ ...d, [s]: status }));
    if (status === "approved") {
      // Approving a stopped run picks it up again
      setStopped(null);
      setEndedAt(null);
      onApprove?.(steps[s].id);
    }
    if (status === "denied") {
      setStopped("denied");
      setEndedAt(Date.now());
      onDeny?.(steps[s].id);
    }
  };

  const elapsed = (endedAt ?? Date.now()) - startedAt;
  const startedLabel = new Date(startedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const pill: Record<typeof phase, string> = {
    running: "Running",
    waiting: "Needs input",
    done: "Done",
    stopped: "Stopped",
  };
  const askedSteps = steps.map((_, s) => s).filter((s) => asked.has(s)).reverse();
  const live = phase === "running" || phase === "waiting";
  const toolCount = steps.reduce((n, st) => n + st.calls.length, 0);

  return (
    <AppShell active="Runs" nav={nav} groups={groups} {...shell}>
      <style href="ui-agent-run" precedence="default">
        {css}
      </style>
      <div ref={root} className="ui-ar" data-panel={panelOpen || undefined}>
        <section className="ui-ar__main">
          <header className="ui-ar__bar">
            <span className="ui-ar__crumbs">
              <Icon icon={PlayCircleIcon} size={15} />
              Runs <i>/</i> <b>{title}</b>
              <span className="ui-ar__pill" data-phase={phase}>
                <span aria-hidden="true" />
                {pill[phase]}
              </span>
            </span>
            <span className="ui-ar__tools">
              <span className="ui-ar__time">
                <Icon icon={Clock01Icon} size={14} />
                {phase === "done" ? `Done in ${whole(elapsed)}` : `Started ${startedLabel} · ${clock(elapsed)}`}
              </span>
              {live ? (
                <Button size="sm" variant="secondary" icon={<Icon icon={StopCircleIcon} size={14} />} onClick={stop}>
                  Stop run
                </Button>
              ) : (
                <Button size="sm" icon={<Icon icon={RepeatIcon} size={14} />} onClick={restart}>
                  Run again
                </Button>
              )}
              <Dropdown
                align="end"
                items={[
                  { label: "Copy run link", icon: Copy01Icon },
                  { label: "Share", icon: Share08Icon },
                  { label: "View in Chat", icon: BubbleChatIcon, onSelect: () => shell.onNavigate?.("Chat") },
                ]}
                trigger={({ open, toggle }) => (
                  <button type="button" className="ui-as-icon-btn" aria-label="Run options" aria-expanded={open} onClick={toggle}>
                    <Icon icon={MoreHorizontalIcon} size={15} />
                  </button>
                )}
              />
              <button
                type="button"
                className="ui-as-icon-btn"
                aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
                aria-pressed={panelOpen}
                onClick={() => setPanelOpen((o) => !o)}
              >
                <Icon icon={SidebarRightIcon} size={16} />
              </button>
            </span>
          </header>

          <div className="ui-ar__scroll">
            <div className="ui-ar__column">
              <AgentPlan
                key={runKey}
                title={title}
                steps={planSteps}
                status={done ? "done" : "running"}
                onRetry={retryFrom}
              />

              <div className="ui-ar__feed">
                <span className="ui-ar__label">Activity</span>
                {steps.map((st, s) => {
                  if (!started.has(s)) return null;
                  const calls = st.calls.map((call, c) => ({ call, c, state: callState(s, c) })).filter((x) => x.state);
                  const isActive = s === activeStep;
                  return (
                    <div key={`${runKey}-${st.id}`} className="ui-ar__entry ui-as-rise">
                      <span className="ui-ar__entry-head">
                        <span className="ui-ar__num" data-done={finished.has(s) || undefined}>
                          {s + 1}
                        </span>
                        {st.title}
                      </span>
                      {asked.has(s) && (
                        <span className="ui-ar__note" data-state={decisions[s] ?? "pending"}>
                          <Icon icon={CheckListIcon} size={14} />
                          {decisions[s] === "approved"
                            ? "You approved this step"
                            : decisions[s] === "denied"
                              ? "You denied this step"
                              : "Waiting for your approval"}
                          {waitingOn === s && !panelOpen && (
                            <button type="button" onClick={() => setPanelOpen(true)}>
                              Review
                            </button>
                          )}
                        </span>
                      )}
                      {calls.length > 0 && (
                        <ToolCallGroup
                          open={openGroups[s] ?? isActive}
                          onOpenChange={(o) => setOpenGroups((g) => ({ ...g, [s]: o }))}
                          runningLabel="Using tools…"
                        >
                          {calls.map(({ call, c, state }) => (
                            <ToolCallCard
                              key={c}
                              name={call.name}
                              summary={call.summary}
                              icon={<Icon icon={call.icon ?? toolIcon(call.name)} size={14} />}
                              status={state === "running" && stopped ? "error" : (state as "running" | "success")}
                              error={stopped ? "Stopped before it finished" : undefined}
                              openOnError={false}
                              args={call.args}
                              result={state === "success" ? call.result : undefined}
                              duration={state === "success" ? call.duration : undefined}
                            />
                          ))}
                        </ToolCallGroup>
                      )}
                    </div>
                  );
                })}
                {phase !== "stopped" && (
                  <ThinkingLoader
                    key={runKey}
                    className="ui-ar__loader"
                    size="sm"
                    phases={[...steps.map((st) => st.title), "Waiting for your approval"]}
                    phase={waitingOn >= 0 ? steps.length : Math.max(0, activeStep)}
                    done={done}
                    doneLabel={`Done in ${whole(elapsed)}`}
                  />
                )}
              </div>
            </div>
          </div>
        </section>

        {panelOpen && <div className="ui-ar__scrim" aria-hidden="true" onClick={() => setPanelOpen(false)} />}
        {panelOpen && (
          <aside className="ui-ar__panel" aria-label="Run details">
            <header className="ui-ar__bar">
              <span className="ui-ar__crumbs">
                <b>Needs your input</b>
                {waitingOn >= 0 && <span className="ui-ar__count">1</span>}
              </span>
            </header>

            <div className="ui-ar__panel-body">
              <section className="ui-ar__section">
                {askedSteps.length ? (
                  askedSteps.map((s) => {
                    const a = steps[s].approval!;
                    return (
                      <ApprovalCard
                        key={`${runKey}-${s}`}
                        className="ui-as-rise"
                        title={a.title}
                        description={a.description}
                        risk={a.risk}
                        icon={<Icon icon={Mail01Icon} size={15} />}
                        details={a.details}
                        status={decisions[s] ?? "pending"}
                        allowAlways={false}
                        label={`Step ${s + 1}${steps[s].tool ? ` · ${steps[s].tool}` : ""}`}
                        actions="card"
                        onApprove={() => decide(s, "approved")}
                        onDeny={() => decide(s, "denied")}
                      />
                    );
                  })
                ) : (
                  <Quiet icon={<Icon icon={AiBrain01Icon} size={16} />} title="Nothing needs you yet">
                    The agent asks here before it sends or books anything.
                  </Quiet>
                )}
              </section>

              <section className="ui-ar__section">
                <span className="ui-ar__label">Draft</span>
                <InlineDiff key={runKey} label={draft.label} original={draft.original} suggested={draft.suggested} />
              </section>

              <section className="ui-ar__section">
                <span className="ui-ar__label">Details</span>
                <dl className="ui-ar__details">
                  {[
                    { label: "Agent", value: agent, icon: AiBrain01Icon },
                    { label: "Triggered by", value: shell.user?.name ?? "Alex Morgan", icon: UserGroupIcon },
                    { label: "Tool calls", value: String(toolCount), icon: WorkflowSquare03Icon },
                    { label: "Cost", value: "$0.14", icon: Coins01Icon },
                  ].map((d) => (
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
            </div>
          </aside>
        )}
      </div>
    </AppShell>
  );
}

function Quiet({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="ui-ar__quiet">
      <span>{icon}</span>
      <b>{title}</b>
      <p>{children}</p>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Agent run: the plan and its activity in the middle, what needs you on the right – each scrolls on its own */
.ui-ar { display: flex; height: 100%; min-height: 0; }
.ui-ar__main { display: flex; flex: 1; flex-direction: column; min-width: 0; }

.ui-ar__bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  padding: 0 12px 0 20px;
  border-bottom: 1px solid var(--line-soft);
  color: var(--muted);
}
.ui-ar__crumbs { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13.5px; white-space: nowrap; }
.ui-ar__crumbs i { font-style: normal; color: var(--faint); }
.ui-ar__crumbs b { overflow: hidden; font-weight: 500; color: var(--ink); text-overflow: ellipsis; }
.ui-ar__tools { display: flex; flex: none; align-items: center; gap: 6px; }
.ui-ar__tools .ui-as-icon-btn[aria-pressed="true"] { background: var(--chip); color: var(--ink); }
.ui-ar__time { display: flex; align-items: center; gap: 6px; margin-right: 6px; font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }

/* Status pill: a soft dot that breathes while the run is live */
.ui-ar__pill {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 22px;
  margin-left: 4px;
  padding: 0 9px 0 8px;
  border-radius: 999px;
  background: var(--accent-soft);
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}
.ui-ar__pill span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.ui-ar__pill[data-phase="running"] span { animation: ui-ar-breathe 1.4s ease-in-out infinite; }
.ui-ar__pill[data-phase="waiting"] { background: rgba(217, 119, 6, 0.1); color: #b45309; }
.ui-ar__pill[data-phase="waiting"] span { animation: ui-ar-breathe 1.4s ease-in-out infinite; }
.ui-ar__pill[data-phase="done"] { background: rgba(22, 163, 74, 0.1); color: #15803d; }
.ui-ar__pill[data-phase="stopped"] { background: var(--chip); color: var(--muted); }
@keyframes ui-ar-breathe { 50% { opacity: 0.35; } }

.ui-ar__scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 32px 32px 40px; }
.ui-ar__column { display: flex; flex-direction: column; gap: 28px; max-width: 680px; margin: 0 auto; }
/* The plan fills the column instead of its own 460px default */
.ui-ar__column .ui-pl { max-width: none; }

.ui-ar__label { display: block; padding-bottom: 12px; font-size: 12.5px; font-weight: 500; line-height: 16px; color: var(--faint); }
.ui-ar__feed { display: flex; flex-direction: column; }
.ui-ar__feed > .ui-ar__label { padding-bottom: 14px; }
.ui-ar__entry { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 0 0 20px 34px; }
/* A fine line joins the step numbers into a timeline */
.ui-ar__entry::before { content: ""; position: absolute; top: 26px; bottom: 4px; left: 11px; width: 1px; background: var(--line); }
.ui-ar__entry-head { display: flex; align-items: center; min-height: 22px; font-size: 13.5px; font-weight: 500; color: var(--ink); }
.ui-ar__num {
  position: absolute;
  top: 0;
  left: 0;
  display: grid;
  place-items: center;
  width: 23px;
  height: 23px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px var(--line);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  transition: background-color 200ms ease, color 200ms ease;
}
.ui-ar__num[data-done] { background: var(--chip); box-shadow: none; color: var(--ink); }
.ui-ar__note { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--muted); }
.ui-ar__note[data-state="pending"] { color: #b45309; }
.ui-ar__note[data-state="approved"] { color: #15803d; }
.ui-ar__note button { margin-left: 4px; font-weight: 500; color: var(--ink); text-decoration: underline; text-underline-offset: 2px; }
.ui-ar__loader { align-self: flex-start; margin-left: 34px; }

/* Side panel: flat sections divided by fine lines */
.ui-ar__panel { display: flex; flex: none; flex-direction: column; width: 360px; min-height: 0; border-left: 1px solid var(--line-soft); }
.ui-ar__panel-body { flex: 1; min-height: 0; overflow-y: auto; }
.ui-ar__section { display: flex; flex-direction: column; padding: 20px; }
.ui-ar__section + .ui-ar__section { border-top: 1px solid var(--line-soft); }
.ui-ar__section > .ui-ap + .ui-ap { margin-top: 12px; }
.ui-ar__count {
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #d97706;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  animation: ui-as-pop 320ms var(--ease) both;
}
.ui-ar__quiet { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 14px 12px 16px; border-radius: 14px; background: var(--subtle); box-shadow: inset 0 0 0 1px var(--line-soft); text-align: center; }
.ui-ar__quiet > span { display: grid; place-items: center; width: 34px; height: 34px; margin-bottom: 6px; border-radius: 10px; background: var(--chip); color: var(--muted); }
.ui-ar__quiet b { font-size: 13.5px; font-weight: 500; color: var(--ink); }
.ui-ar__quiet p { max-width: 240px; margin: 0; font-size: 12.5px; line-height: 18px; color: var(--muted); }

.ui-ar__details { display: grid; gap: 12px; margin: 0; }
.ui-ar__details div { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.ui-ar__details dt { display: flex; align-items: center; gap: 8px; color: var(--muted); }
.ui-ar__details dd { margin: 0; font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }

:where(.dark, [data-theme="dark"]) .ui-ar__pill[data-phase="waiting"], :where(.dark, [data-theme="dark"]) .ui-ar__note[data-state="pending"] { color: #fbbf24; }
:where(.dark, [data-theme="dark"]) .ui-ar__pill[data-phase="waiting"] { background: rgba(251, 191, 36, 0.12); }
:where(.dark, [data-theme="dark"]) .ui-ar__pill[data-phase="done"], :where(.dark, [data-theme="dark"]) .ui-ar__note[data-state="approved"] { color: #4ade80; }
:where(.dark, [data-theme="dark"]) .ui-ar__pill[data-phase="done"] { background: rgba(74, 222, 128, 0.12); }

/* Room for the sidebar icon while the sidebar is collapsed */
.ui-ar__main > .ui-ar__bar { transition: padding-left 420ms var(--ease); }
.ui-as-app[data-collapsed] .ui-ar__main > .ui-ar__bar { padding-left: 52px; }
.ui-ar__scrim { display: none; }

/* Narrow panels: the side panel becomes a layer that slides in from the right */
@container ui-as-main (max-width: 1000px) {
  .ui-ar__time { display: none; }
  .ui-ar__panel {
    position: absolute;
    z-index: 12;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(360px, calc(100% - 32px));
    border-left: 0;
    border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
    background: var(--panel);
    box-shadow: -1px 0 0 var(--line), -20px 0 40px -16px rgba(0, 0, 0, 0.2);
    animation: ui-ar-panel-in 420ms var(--ease) both;
  }
  .ui-ar__scrim {
    display: block;
    position: absolute;
    z-index: 11;
    inset: 0;
    border-radius: inherit;
    background: rgba(0, 0, 0, 0.18);
    animation: ui-ar-fade 300ms ease both;
  }
}
@keyframes ui-ar-panel-in { from { transform: translateX(40px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes ui-ar-fade { from { opacity: 0; } }
@container ui-as (max-width: 900px) {
  .ui-ar__main > .ui-ar__bar { padding-left: 52px; }
}
@container ui-as (max-width: 600px) {
  .ui-ar__main .ui-ar__crumbs > svg, .ui-ar__main .ui-ar__crumbs > i { display: none; }
  .ui-ar__main .ui-ar__crumbs { font-size: 0; }
  .ui-ar__main .ui-ar__crumbs > b { font-size: 13.5px; }
  .ui-ar__bar { padding-right: 8px; }
  .ui-ar__panel .ui-ar__bar { padding-left: 20px; }
  .ui-ar__scroll { padding: 20px 16px 24px; }
  .ui-ar__panel { width: 100%; border-radius: var(--radius-panel); }
  .ui-ar__section { padding: 16px; }
}
`;
