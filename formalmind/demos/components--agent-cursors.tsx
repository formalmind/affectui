import { AgentCursors, type AgentCursorsProps } from "../../components/agent-cursors";

export const props: AgentCursorsProps = {
	title: "Vault.sol – spec",
	agents: [
		{ id: "prover", name: "Prover", color: "#7c3aed", cost: 0.42 },
		{ id: "reviewer", name: "Reviewer", color: "#0ea5e9", cost: 0.18 },
	],
	blocks: [
		{ id: "t", kind: "title", text: "Vault money invariants" },
		{ id: "h1", kind: "heading", text: "deposit" },
		{ id: "p1", kind: "paragraph", text: "After deposit(amount), totalAssets grows by exactly amount and the caller's shares grow by convertToShares(amount)." },
		{ id: "h2", kind: "heading", text: "withdraw" },
		{ id: "p2", kind: "paragraph", text: "withdraw never sends more than the caller's balance; the sum of balances equals totalSupply." },
		{ id: "c1", kind: "code", text: "theorem withdraw_le_balance : out ≤ balanceOf s caller := by\n  simp [withdraw]" },
	],
	suggestions: [{ id: "s1", agent: "reviewer", block: "p2", at: 0, insert: "For every caller, ", note: "Quantify over callers" }],
	comments: [{ id: "c1", agent: "reviewer", block: "c1", text: "lake build passes, but the rounding case is missing.", open: true }],
	cursors: { prover: { block: "p1", at: 40, doing: "Writing deposit spec", typing: true }, reviewer: { block: "p2", at: 10, doing: "Reviewing" } },
};

export default function Demo() {
	return <AgentCursors {...props} />;
}
