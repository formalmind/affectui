import { DelegateBoard, type DelegateBoardProps } from "../../components/delegate-board";

export const props: DelegateBoardProps = {
	agents: [
		{ id: "p1", name: "Prover", model: "Opus", current: 6, rate: 0.08 },
		{ id: "r1", name: "Reviewer", model: "Sonnet", rate: 0.03 },
	],
	tasks: [
		{ id: "1", title: "Prove swap", estimate: 12, agentId: "p1" },
		{ id: "2", title: "Prove deposit", estimate: 8 },
		{ id: "3", title: "Review withdraw", estimate: 4, agentId: "r1" },
	],
	suggestion: { taskId: "2", agentId: "p1" },
};

export default function Demo() {
	return <DelegateBoard {...props} />;
}
