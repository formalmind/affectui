import { AgentTree, type AgentTreeProps } from "../../components/agent-tree";

const now = Date.now();
const min = 60_000;
export const props: AgentTreeProps = {
	now,
	root: {
		id: "lead", name: "Lead", task: "Prove Pool.sol", status: "running", started: now - 20 * min, cost: 0.4,
		children: [
			{ id: "p1", name: "Prover", task: "Prove swap", status: "running", started: now - 12 * min, cost: 1.1 },
			{ id: "p2", name: "Prover", task: "Prove deposit", status: "done", started: now - 19 * min, ended: now - 10 * min, cost: 0.8,
				children: [{ id: "r1", name: "Reviewer", task: "Review deposit", status: "waiting", ask: "Approve the spec?", started: now - 9 * min }] },
			{ id: "a1", name: "Auditor", task: "PoC for withdraw", status: "failed", error: "forge test failed", started: now - 8 * min, ended: now - 3 * min },
		],
	},
};

export default function Demo() {
	return <AgentTree {...props} />;
}
