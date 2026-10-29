import { MemoryPanel, type MemoryPanelProps } from "../../components/memory-panel";

export const props: MemoryPanelProps = {
	memories: [
		{ id: "1", text: "Proofs live in formal/, one file per function.", category: "Project", source: "Lead" },
		{ id: "2", text: "Use omega for reserve arithmetic before simp.", category: "Tactics", source: "Prover" },
		{ id: "3", text: "Findings need a Foundry PoC before filing.", category: "Process", source: "Auditor" },
	],
};

export default function Demo() {
	return <MemoryPanel {...props} />;
}
