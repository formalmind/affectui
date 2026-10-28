import { BookCheck, Bug, FilePen, FileText, FolderSearch, Gavel, ListTree, NotebookPen, Search, SquareTerminal, Sparkle } from "lucide-react";
import type { Ev, Row } from "@/desktop/src/swarm-panel";
import { ToolCallCard, ToolCallGroup, type ToolCallStatus } from "../components/tool-call-card";

/** The chat's type scale for the tool cards: body text 14px like the messages, labels 12px like an agent's name. */
const scale = /* css */ `
.fm-run { font-size: 14px; line-height: 20px; }
.fm-run .ui-tc-group__label, .fm-run .ui-tc-group__failed, .fm-run .ui-tc-group__time,
.fm-run .ui-tc__summary, .fm-run .ui-tc__error, .fm-run .ui-tc__error-text { font-size: 14px; line-height: 20px; }
.fm-run .ui-tc__name { font-size: 13px; line-height: 20px; }
.fm-run .ui-tc__status, .fm-run .ui-tc__time, .fm-run .ui-tc__label { font-size: 12px; line-height: 16px; }
.fm-run .ui-tc__code { font-size: 12px; line-height: 18px; }
/* Each step one plain line ("Ran a command ▾"): no box, no icon tile, no mono name; it opens to its details. */
.fm-run .ui-tc { background: none; box-shadow: none; border-radius: 0; }
.fm-run .ui-tc__head { padding: 2px 0; min-height: 0; }
/* The group line keeps its stack of tool icons; the step lines have none. */
.fm-run .ui-tc__head .ui-tc__icon { display: none; }
.fm-run .ui-tc__name { font-family: inherit; color: hsl(var(--muted-foreground)); }
.fm-run .ui-tc__head:hover .ui-tc__name { color: hsl(var(--foreground)); }
/* A failed step says so by its colour: its line in red, no "Failed" label (the group line counts the failures). */
.fm-run .ui-tc[data-status="error"] .ui-tc__status { display: none; }
.fm-run .ui-tc[data-status="error"] .ui-tc__name,
.fm-run .ui-tc[data-status="error"] .ui-tc__head:hover .ui-tc__name { color: rgb(220 38 38); }
/* No hover background on a step or the group line: hover only darkens the text. */
.fm-run .ui-tc__head, .fm-run .ui-tc__head:hover, .fm-run .ui-tc-group__head, .fm-run .ui-tc-group__head:hover, .fm-run .ui-tc:hover { background: none !important; box-shadow: none !important; }
.fm-run .ui-tc-group__list { gap: 0; padding-left: 0; }
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

/**
 * One agent run on AffectUI's Tool Call Card: who and on what, its status, then the steps as one group ("Used 6
 * tools · 2 failed · 1m 05s") that opens to a card per call. A failed card opens on its own and shows its error.
 * The agent's latest note sits under the header. Same props as the app's own `Steps`.
 */
export function RunCard({ steps, running, title, onPause }: { steps: Row[]; running: boolean; title?: string; onPause?: () => void }) {
	const calls = steps.filter((r): r is { call: Ev; result?: Ev } => "call" in r);
	const notes = steps.filter((r): r is { note: Ev } => "note" in r).map((r) => r.note);
	const first = calls[0]?.call ?? notes[0];
	const item = first?.item ?? "";
	const broke = calls.filter((c) => failed(c.result)).length;
	const status = running ? "Working" : calls.some((c) => !c.result) ? "Stopped" : broke ? `${broke} failed` : "Done";
	const tone = running ? "text-violet-700 dark:text-violet-300 bg-violet-500/15" : broke ? "text-red-700 dark:text-red-400 bg-red-500/15" : calls.some((c) => !c.result) ? "text-muted-foreground bg-muted" : "text-emerald-700 dark:text-emerald-400 bg-emerald-500/15";
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
			{calls.length ? (
				<ToolCallGroup runningLabel="Working…" defaultOpen={running || broke > 0}>
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
			) : null}
		</div>
	);
}
