import { AgentSteering, type AgentSteeringProps } from "../../components/agent-steering";

const now = Date.now();
const min = 60_000;
export const props: AgentSteeringProps = {
	title: "Prove swap",
	agent: "Prover",
	status: "running",
	startedAt: now - 7 * min,
	steps: [
		{ id: "1", title: "Read Pool.swap", status: "done", duration: 40_000 },
		{ id: "2", title: "Write the spec in Lean", status: "done", duration: 3 * min },
		{ id: "3", title: "Prove it with lake build", status: "active", startedAt: now - 2 * min },
		{ id: "4", title: "Hand off to the reviewer", status: "pending" },
	],
	queue: [{ id: "n1", text: "Cover the zero-amount case too", picked: "next" }],
};

export default function Demo() {
	return <AgentSteering {...props} />;
}
