import { TaskBoard } from "../../blocks/task-board";

export default function Demo() {
	return (
		<TaskBoard
			path={["Formal Mind", "Vault.sol"]}
			statuses={[
				{ id: "todo", label: "To prove", icon: <span>○</span> },
				{ id: "doing", label: "Proving", icon: <span>◐</span> },
				{ id: "done", label: "Proved", icon: <span>●</span> },
			]}
			labels={[
				{ id: "money", label: "Moves money", color: "#f59e0b" },
				{ id: "finding", label: "Finding", color: "#ef4444" },
			]}
			people={[
				{ id: "prover", name: "Prover" },
				{ id: "reviewer", name: "Reviewer" },
				{ id: "auditor", name: "Auditor" },
			]}
			tasks={[
				{ id: "1", key: "FM-1", title: "Prove deposit", status: "done", priority: 2, estimate: "M", labels: ["money"], assignee: "prover", created: "2026-10-27" },
				{ id: "2", key: "FM-2", title: "Prove withdraw", status: "doing", priority: 1, estimate: "L", labels: ["money", "finding"], assignee: "prover", subtasks: [1, 3], created: "2026-10-27" },
				{ id: "3", key: "FM-3", title: "Review swap spec", status: "todo", priority: 3, estimate: "S", labels: [], assignee: "reviewer", dueIn: 2, created: "2026-10-28" },
				{ id: "4", key: "FM-4", title: "PoC for withdraw rounding", status: "todo", priority: 1, labels: ["finding"], assignee: "auditor", created: "2026-10-28" },
			]}
		/>
	);
}
