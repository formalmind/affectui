import { ConflictRadar, type ConflictRadarProps } from "../../components/conflict-radar";

export const props: ConflictRadarProps = {
	agents: [
		{ id: "p1", name: "Prover", model: "Opus", status: "running" },
		{ id: "p2", name: "Prover 2", model: "Sonnet", status: "running" },
	],
	files: [
		{ path: "formal/Pool/Swap.lean", edits: [{ agentId: "p1", lines: [10, 40], summary: "swap spec", active: true }, { agentId: "p2", lines: [30, 52], summary: "fee lemma" }] },
		{ path: "formal/Vault/Deposit.lean", edits: [{ agentId: "p2", lines: [1, 25], summary: "deposit proof" }] },
	],
};

export default function Demo() {
	return <ConflictRadar {...props} />;
}
