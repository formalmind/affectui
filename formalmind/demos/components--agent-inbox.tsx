import { AgentInbox, type AgentInboxProps } from "../../components/agent-inbox";

const now = Date.now();
const min = 60_000;
export const props: AgentInboxProps = {
	title: "Proofs",
	tasks: [
		{ id: "1", title: "Prove swap", description: "Pool.sol – output never exceeds reserves", agent: "Prover", status: "running", startedAt: now - 6 * min, tools: 4, steps: [{ label: "Read swap" }, { label: "Wrote spec" }, { label: "lake build" }] },
		{ id: "2", title: "Review deposit proof", agent: "Reviewer", status: "waiting", description: "Approve the spec before it lands" },
		{ id: "3", title: "Prove withdraw", agent: "Prover", status: "done", elapsed: 9 * min, sources: 3 },
		{ id: "4", title: "Audit flashLoan", agent: "Auditor", status: "failed", elapsed: 2 * min, description: "Foundry PoC didn't compile" },
	],
};

export default function Demo() {
	return <AgentInbox {...props} />;
}
