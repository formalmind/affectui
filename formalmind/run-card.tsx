import { BookCheck, Bug, FilePen, FileText, FolderSearch, Gavel, ListTree, NotebookPen, Search, SquareTerminal, Sparkle } from "lucide-react";
import { useState } from "react";
import type { Ev, Row } from "@/desktop/src/swarm-panel";
import { ROLE_COLORS, roleName } from "@/lib/swarm-roles";
import { AgentSteering, type SteerNote, type SteerStep } from "../components/agent-steering-clean";
import { AgentTree, type TreeAgent, type TreeAgentStatus } from "../components/agent-tree-clean";
import { ToolCallCard, ToolCallGroup, type ToolCallStatus } from "../components/tool-call-card-clean";

/** The chat's type scale for the tool cards: body text 14px like the messages, labels 12px like an agent's name. */
const scale = /* css */ `
.fm-run { font-size: 14px; line-height: 20px; }
.fm-run .ui-tcc-group__label, .fm-run .ui-tcc-group__failed, .fm-run .ui-tcc-group__time,
.fm-run .ui-tcc__summary, .fm-run .ui-tcc__error, .fm-run .ui-tcc__error-text { font-size: 14px; line-height: 20px; }
.fm-run .ui-tcc__name { font-size: 13px; line-height: 20px; }
.fm-run .ui-tcc__status, .fm-run .ui-tcc__time, .fm-run .ui-tcc__label { font-size: 12px; line-height: 16px; }
.fm-run .ui-tcc__code { font-size: 12px; line-height: 18px; }
/* Each step one plain line ("Ran a command ▾"): no box, no icon tile, no mono name; it opens to its details. */
.fm-run .ui-tcc { background: none; box-shadow: none; border-radius: 0; }
.fm-run .ui-tcc__head { padding: 2px 0; min-height: 0; }
/* The group line keeps its stack of tool icons; the step lines have none. */
.fm-run .ui-tcc__head .ui-tcc__icon { display: none; }
.fm-run .ui-tcc__name { font-family: inherit; color: hsl(var(--muted-foreground)); }
.fm-run .ui-tcc__head:hover .ui-tcc__name { color: hsl(var(--foreground)); }
/* A failed step: "Failed" on its line, and opened, its details in red instead of a separate error box. */
.fm-run .ui-tcc[data-status="error"] .ui-tcc__error { display: none; }
.fm-run .ui-tcc[data-status="error"] .ui-tcc__code { background: rgb(220 38 38 / 0.06); color: rgb(185 28 28); }
/* An opened step has no line between its row and its details. */
.fm-run .ui-tcc__sections { border-top: 0; padding-top: 4px; }
/* No hover background on a step or the group line: hover only darkens the text. */
.fm-run .ui-tcc__head, .fm-run .ui-tcc__head:hover, .fm-run .ui-tcc-group__head, .fm-run .ui-tcc-group__head:hover, .fm-run .ui-tcc:hover { background: none !important; box-shadow: none !important; }
.fm-run .ui-tcc-group__list { gap: 0; padding-left: 0; }
`;

/** What a step did, in words: the line it shows before it is opened. */
const VERBS: Record<string, string> = {
	run: "Ran a command",
	read_file: "Read a file",
	write_file: "Wrote a file",
	search: "Searched the code",
	find: "Found files",
	functions: "Listed the functions",
	function: "Looked up a function",
	record_finding: "Recorded a finding",
	record_property: "Recorded a property",
	record_report: "Recorded a report",
	report_bug: "Reported a bug",
	verdict: "Gave a verdict",
};
const verbOf = (tool: string) => VERBS[tool] ?? `Used ${tool.replace(/_/g, " ")}`;

/** A step that failed: a command's non-zero exit or a tool's error (as the app's own run card decides). */
const failed = (r?: Ev) => Boolean(r && /^(exit [1-9]|error:)/m.test(r.text));

/** Each tool's icon in its card and in the group's stack (AffectUI's default is a wrench). */
const ICONS: Record<string, typeof Search> = {
	run: SquareTerminal,
	read_file: FileText,
	write_file: FilePen,
	search: Search,
	find: FolderSearch,
	functions: ListTree,
	function: ListTree,
	record_finding: NotebookPen,
	record_property: BookCheck,
	record_report: NotebookPen,
	report_bug: Bug,
	verdict: Gavel,
};
const iconOf = (tool: string) => {
	const Icon = ICONS[tool] ?? Sparkle;
	return <Icon className="size-3.5" strokeWidth={2} />;
};

/** The error line a failed step shows: its first line that says so. */
const errorOf = (r: Ev) => r.text.split("\n").find((l) => /^(exit [1-9]|error:)/.test(l)) ?? r.text.split("\n")[0];

type Call = { call: Ev; result?: Ev };

/** A note you sent the working agent: when (to place it after the step it reached) and whether it interrupted. */
export type Steer = { id: string; text: string; at: number; now?: boolean };
/** Steering the working agent: what you sent it, and sending more (`now` interrupts it; `queued`, with a note it has). */
export type Steering = {
	notes: Steer[];
	send: (text: string, now: boolean, queued?: string) => void;
};

/**
 * The working agent's steps on AffectUI's Agent Steering, with a field to steer it. A note waits in the queue until
 * the agent's next step starts after it (the swarm reads your messages between steps), then glides into that step.
 */
function SteerCard({ calls, title, role, steering, onPause }: { calls: Call[]; title: string; role: string; steering: Steering; onPause?: () => void }) {
	const after = (n: Steer) => calls.findIndex((c) => (c.call.at ?? 0) > n.at);
	const steps: SteerStep[] = calls.map((c, i) => ({
		id: `${c.call.at ?? 0}-${i}`,
		title: verbOf(c.call.text.split(" ")[0]),
		status: c.result ? "done" : "active",
		duration: c.call.at && c.result?.at ? c.result.at - c.call.at : undefined,
		startedAt: c.call.at,
		notes: steering.notes
			.filter((n) => after(n) === i)
			.map((n): SteerNote => ({
				id: n.id,
				text: n.text,
				picked: n.now ? "now" : "next",
			})),
	}));
	const queue = steering.notes.filter((n) => after(n) < 0).map((n): SteerNote => ({ id: n.id, text: n.text }));
	return (
		<div
			className="fm-steer"
			style={{
				["--fm-role" as string]: (ROLE_COLORS as Record<string, string>)[role],
			}}
		>
			<style href="fm-team-card" precedence="default">
				{team}
			</style>
			<AgentSteering
				title={title}
				agent={roleName(role)}
				steps={steps}
				queue={queue}
				startedAt={calls[0]?.call.at}
				onQueue={(text) => steering.send(text, false)}
				onInterrupt={(text, queued) => steering.send(text, true, queued)}
				onPause={onPause}
				placeholder={`Steer the ${roleName(role)}…`}
			/>
		</div>
	);
}

/** 12s, 1m 05s, 2h 05m, 3d 4h. */
const took = (ms: number) => {
	const t = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(t / 60);
	const h = Math.floor(m / 60);
	if (t < 60) return `${t}s`;
	if (m < 60) return `${m}m ${String(t % 60).padStart(2, "0")}s`;
	return h < 24 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};

/** The steps as one group ("Used 6 tools · 2 failed · 1m 05s") that opens to a card per call. */
function StepGroup({ calls, running }: { calls: Call[]; running: boolean }) {
	return (
		<ToolCallGroup runningLabel="Working…" defaultOpen>
			{calls.map((c, i) => {
				const [tool] = c.call.text.split(" ");
				const bad = failed(c.result);
				const state: ToolCallStatus = !c.result ? (running && i === calls.length - 1 ? "running" : "error") : bad ? "error" : "success";
				return (
					<ToolCallCard
						key={i}
						name={verbOf(tool)}
						icon={iconOf(tool)}
						status={state}
						args={c.call.text}
						result={c.result?.text}
						error={bad && c.result ? errorOf(c.result) : !c.result && state === "error" ? "no result: the session stopped before it finished" : undefined}
						startedAt={c.call.at}
						duration={c.call.at && c.result?.at ? c.result.at - c.call.at : undefined}
						defaultOpen={state === "running"}
					/>
				);
			})}
		</ToolCallGroup>
	);
}

/** The tree's cards in the chat's type: names in their role colour, no avatar tile, the time beside the name. */
const team = /* css */ `
.fm-team .ui-agtc { --ui-agtc-card-w: 200px; }
.fm-team .ui-agtc__avatar, .fm-team .ui-agtc__cost, .fm-team .ui-agtc__sum-cost { display: none; }
.fm-team .ui-agtc__name { font-weight: 400; }
/* With the cost hidden, a card's footer is only its fold button: without one, no footer. */
.fm-team .ui-agtc__meta:not(:has(.ui-agtc__fold)) { display: none; }
${Object.entries(ROLE_COLORS)
	.map(([role, color]) => `.fm-team .ui-agtc__hang[aria-label^="${roleName(role)}:"] > .ui-agtc__node .ui-agtc__name { color: ${color}; }`)
	.join("\n")}
/* The agent at work: its name in its role colour. */
.fm-steer .ui-stc__agent { color: var(--fm-role); }
.fm-steer .ui-stc__card, .fm-steer .ui-stc { max-width: none; }
`;

/**
 * Steps from several agents (the swarm runs them side by side) on AffectUI's Agent Tree: the swarm on top and a card
 * per agent with its latest note, status, steps and time. Picking a card shows that agent's steps under the tree.
 */
function TeamCard({
	calls,
	notes,
	roles,
	running,
	title,
	onPause,
	onRetry,
	steering,
}: {
	calls: Call[];
	notes: Ev[];
	roles: string[];
	running: boolean;
	title?: string;
	onPause?: () => void;
	onRetry?: (role: string, item?: string) => void;
	steering?: Steering;
}) {
	const latest = calls.at(-1)?.call.role ?? roles[0];
	// "swarm" (the top card) shows every agent's steps.
	const [picked, setPicked] = useState(latest);
	// Failures you dismissed from the tree's "failed" window.
	const [dismissed, setDismissed] = useState<string[]>([]);
	const agents: TreeAgent[] = roles.map((role) => {
		const mine = calls.filter((c) => c.call.role === role);
		const live = running && role === latest;
		const broke = mine.filter((c) => failed(c.result)).at(-1);
		const status: TreeAgentStatus = live ? "running" : mine.some((c) => !c.result) ? "stopped" : broke && !dismissed.includes(role) ? "failed" : "done";
		const from = mine[0]?.call.at;
		const to = live ? Date.now() : mine.at(-1)?.result?.at;
		const steps = `${mine.length} ${mine.length === 1 ? "step" : "steps"}`;
		const item = mine[0]?.call.item;
		return {
			id: role,
			name: roleName(role),
			task: notes.filter((n) => n.role === role).at(-1)?.text ?? (item ? `item ${item}` : ""),
			model: from && to ? `${steps} · ${took(to - from)}` : steps,
			status,
			error: broke?.result?.text.split("\n").slice(0, 3).join("\n"),
			tools: [...new Set(mine.map((c) => c.call.text.split(" ")[0]))].map((tool) => <span key={tool}>{iconOf(tool)}</span>),
		};
	});
	const root: TreeAgent = {
		id: "swarm",
		name: "swarm",
		task: title ?? `${roles.length} agents`,
		status: running ? "running" : agents.some((a) => a.status === "failed") ? "failed" : agents.some((a) => a.status === "stopped") ? "stopped" : "done",
		children: agents,
	};
	const shown = picked === "swarm" ? calls : calls.filter((c) => c.call.role === picked);
	return (
		<div className="fm-run fm-team space-y-2">
			<style href="fm-run-card" precedence="default">
				{scale}
			</style>
			<style href="fm-team-card" precedence="default">
				{team}
			</style>
			{running && onPause && !steering ? (
				<div className="flex justify-end">
					<button type="button" onClick={onPause} className="h-6 shrink-0 rounded-md border bg-background px-2 text-[11px] hover:bg-muted">
						Pause
					</button>
				</div>
			) : null}
			<AgentTree
				root={root}
				title="Agents"
				onSelect={(a) => setPicked(a.id)}
				onResolve={(a, action) => {
					if (action === "dismiss") setDismissed((d) => [...d, a.id]);
					if (action === "retry") onRetry?.(a.id, calls.find((c) => c.call.role === a.id)?.call.item);
				}}
			/>
			{shown.length && running && steering && picked === latest ? (
				<SteerCard calls={shown} title={agents.find((a) => a.id === picked)?.task || title || "Working"} role={picked} steering={steering} onPause={onPause} />
			) : shown.length ? (
				<div className="space-y-1">
					<span style={{ color: (ROLE_COLORS as Record<string, string>)[picked] }}>{picked === "swarm" ? "Every agent" : roleName(picked)}</span>
					<StepGroup calls={shown} running={running && picked === latest} />
				</div>
			) : null}
		</div>
	);
}

/**
 * One agent run on AffectUI's Tool Call Card (several agents' steps go to the team card, the agent at work to the
 * steering card, both above): who and on what, its status, then the steps as one group ("Used 6
 * tools · 2 failed · 1m 05s") that opens to a card per call. A failed card opens on its own and shows its error.
 * The agent's latest note sits under the header. Same props as the app's own `Steps`.
 */
export function RunCard({
	steps,
	running,
	title,
	onPause,
	onRetry,
	steering,
}: {
	steps: Row[];
	running: boolean;
	title?: string;
	onPause?: () => void;
	/** Retry from the Agents tree: an agent failed on an item. */
	onRetry?: (role: string, item?: string) => void;
	steering?: Steering;
}) {
	const calls = steps.filter((r): r is Call => "call" in r);
	const notes = steps.filter((r): r is { note: Ev } => "note" in r).map((r) => r.note);
	const roles = [...new Set(calls.map((c) => c.call.role))];
	if (roles.length > 1) return <TeamCard calls={calls} notes={notes} roles={roles} running={running} title={title} onPause={onPause} onRetry={onRetry} steering={steering} />;
	// The agent at work: its steps with a field to steer it.
	if (running && steering && calls.length)
		return (
			<SteerCard
				calls={calls}
				title={title ?? (calls[0].call.item ? `item ${calls[0].call.item}` : "Working")}
				role={calls[0].call.role}
				steering={steering}
				onPause={onPause}
			/>
		);
	const first = calls[0]?.call ?? notes[0];
	const item = first?.item ?? "";
	const broke = calls.filter((c) => failed(c.result)).length;
	const status = running ? "Working" : calls.some((c) => !c.result) ? "Stopped" : broke ? `${broke} failed` : "Done";
	const tone = running
		? "text-violet-700 dark:text-violet-300 bg-violet-500/15"
		: broke
			? "text-red-700 dark:text-red-400 bg-red-500/15"
			: calls.some((c) => !c.result)
				? "text-muted-foreground bg-muted"
				: "text-emerald-700 dark:text-emerald-400 bg-emerald-500/15";
	const note = notes.at(-1)?.text;
	return (
		<div className="fm-run space-y-1.5">
			<style href="fm-run-card" precedence="default">
				{scale}
			</style>
			<div className="flex items-center gap-2">
				{title || item ? <span className="min-w-0 truncate text-foreground">{title ?? `item ${item}`}</span> : null}
				<span className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] leading-4 ${tone}`}>{status}</span>
				{running && onPause ? (
					<button type="button" onClick={onPause} className="ml-auto h-6 shrink-0 rounded-md border bg-background px-2 text-[11px] hover:bg-muted">
						Pause
					</button>
				) : null}
			</div>
			{note ? <p className="line-clamp-2 text-[12px] text-muted-foreground">{note}</p> : null}
			{calls.length ? <StepGroup calls={calls} running={running} /> : null}
		</div>
	);
}
