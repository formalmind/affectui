import { AgentQueue, type AgentQueueProps } from "../../components/agent-queue";

const now = Date.now();
const min = 60_000;
export const props: AgentQueueProps = {
	title: "Queue",
	now,
	workers: [
		{ id: "w1", name: "Prover 1" },
		{ id: "w2", name: "Prover 2" },
	],
	jobs: [
		{ id: "1", name: "Prove swap", kind: "agent", status: "running", worker: "w1", enqueuedAt: now - 8 * min, startedAt: now - 6 * min, estimate: 10 * min, progress: 0.6 },
		{ id: "2", name: "lake build", kind: "tool", status: "running", worker: "w2", enqueuedAt: now - 2 * min, startedAt: now - min, estimate: 2 * min },
		{ id: "3", name: "Prove withdraw", kind: "agent", status: "queued", priority: "high", enqueuedAt: now - 3 * min },
		{ id: "4", name: "Review deposit", kind: "human", status: "queued", enqueuedAt: now - min },
		{ id: "5", name: "Prove deposit", kind: "agent", status: "done", worker: "w1", enqueuedAt: now - 20 * min, startedAt: now - 18 * min, endedAt: now - 9 * min },
		{ id: "6", name: "Prove flashLoan", kind: "agent", status: "failed", worker: "w2", enqueuedAt: now - 15 * min, startedAt: now - 14 * min, endedAt: now - 4 * min, attempt: 3, maxAttempts: 3, error: "unsolved goals" },
	],
};

export default function Demo() {
	return <AgentQueue {...props} />;
}
