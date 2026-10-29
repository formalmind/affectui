import { AgentGraph, type AgentGraphProps } from "../../components/agent-graph";

const now = Date.now();
const min = 60_000;
export const props: AgentGraphProps = {
	title: "Swarm",
	now,
	nodes: [
		{ id: "you", name: "You", kind: "user" },
		{ id: "lead", name: "Lead", kind: "agent", lead: true, status: "working", doing: "Assigning functions", cost: 0.31 },
		{ id: "prover", name: "Prover", kind: "agent", status: "working", doing: "Proving swap", cost: 1.12 },
		{ id: "reviewer", name: "Reviewer", kind: "agent", status: "waiting", doing: "Waiting on swap proof" },
		{ id: "lake", name: "lake build", kind: "tool", status: "idle" },
	],
	calls: [
		{ id: "1", from: "you", to: "lead", label: "Prove Pool.sol", status: "ok", at: now - 4 * min },
		{ id: "2", from: "lead", to: "prover", label: "swap", status: "ok", at: now - 3 * min },
		{ id: "3", from: "prover", to: "lake", label: "lake build", status: "error", at: now - 90_000, ms: 41_000 },
		{ id: "4", from: "prover", to: "lake", label: "lake build", status: "pending", at: now - 10_000 },
	],
	edges: [["prover", "reviewer"]],
};

export default function Demo() {
	return <AgentGraph {...props} />;
}
