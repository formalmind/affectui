import { AgentLanes, type AgentLanesProps } from "../../components/agent-lanes";

const now = Date.now();
const min = 60_000;
export const props: AgentLanesProps = {
	title: "Swarm",
	agents: [
		{ id: "prover", name: "Prover", model: "Opus" },
		{ id: "reviewer", name: "Reviewer", model: "Sonnet" },
		{ id: "auditor", name: "Auditor", model: "Opus" },
	],
	tasks: [
		{ id: "1", agentId: "prover", title: "Prove deposit", status: "done", start: now - 25 * min, end: now - 14 * min, handoffTo: "reviewer" },
		{ id: "2", agentId: "reviewer", title: "Review deposit", status: "done", start: now - 14 * min, end: now - 9 * min },
		{ id: "3", agentId: "prover", title: "Prove swap", status: "running", start: now - 12 * min, summary: ["Spec written", "lake build: 2 goals left"] },
		{ id: "4", agentId: "auditor", title: "PoC for withdraw rounding", status: "waiting", start: now - 6 * min, ask: "Run forge test on the fork?" },
	],
};

export default function Demo() {
	return <AgentLanes {...props} />;
}
