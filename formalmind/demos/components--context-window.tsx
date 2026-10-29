import { ContextWindow, type ContextWindowProps } from "../../components/context-window";

export const props: ContextWindowProps = {
	limit: 200_000,
	model: "Opus",
	parts: [
		{ id: "sys", label: "Prover role", tokens: 6_000, locked: true },
		{ id: "files", label: "Files", items: [{ id: "pool", label: "Pool.sol", tokens: 22_000 }, { id: "lean", label: "Swap.lean", tokens: 14_000 }] },
		{ id: "chat", label: "Conversation", tokens: 52_000, compact: true },
		{ id: "build", label: "lake build output", tokens: 18_000 },
	],
};

export default function Demo() {
	return <ContextWindow {...props} />;
}
