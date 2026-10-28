import type { ContextUse } from "@/desktop/src/context-panel";
import { ContextWindow, type ContextPart } from "../components/context-window";

/**
 * One agent's context window on AffectUI's Context Window: the system prompt and the tools (locked), the task, and
 * the messages with Compact, which asks the swarm to summarize the older steps. On Claude Code and Codex the fixed
 * parts are estimates from their text (`use.estimated`).
 */
export function ContextCard({ role, use, onCompact }: { role: string; color?: string; use: ContextUse; onCompact?: () => Promise<unknown> }) {
	const fixed = use.system + use.tools + use.task;
	const est = use.estimated ? " (≈)" : "";
	const parts: ContextPart[] = [
		{ id: "system", label: `System prompt${est}`, tokens: use.system, locked: true },
		{ id: "tools", label: `Tools${est}`, tokens: use.tools, locked: true },
		{ id: "task", label: `Task${est}`, tokens: use.task, locked: true },
		{ id: "messages", label: "Messages", tokens: Math.max(0, use.used - fixed), compact: onCompact ? true : undefined },
	];
	return (
		<ContextWindow
			parts={parts}
			limit={use.window}
			title={`Context · ${role}`}
			warnAt={use.window ? use.compact_at / use.window : 0.75}
			onCompact={onCompact ? async () => void (await onCompact()) : undefined}
		/>
	);
}
