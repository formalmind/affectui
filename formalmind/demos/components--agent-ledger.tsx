import { AgentLedger, type AgentLedgerProps } from "../../components/agent-ledger";

const now = Date.now();
const min = 60_000;
export const props: AgentLedgerProps = {
	agent: "Prover",
	entries: [
		{ id: "1", action: "Created", target: "formal/Pool/Swap.lean", system: "Files", at: now - 12 * min, reversible: true },
		{ id: "2", action: "Ran", target: "lake build", system: "Shell", at: now - 9 * min, detail: "2 goals left" },
		{ id: "3", action: "Edited", target: "formal/Pool/Swap.lean", system: "Files", at: now - 5 * min, change: ["sorry", "by omega"], reversible: true, dependsOn: ["1"] },
		{ id: "4", action: "Filed finding", target: "withdraw rounds in the caller's favour", system: "Bugs", at: now - 2 * min, reversible: true },
	],
};

export default function Demo() {
	return <AgentLedger {...props} />;
}
