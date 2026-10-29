import { ContextMap, type ContextMapProps } from "../../components/context-map";

export const props: ContextMapProps = {
	limit: 200_000,
	model: "Opus",
	status: "Proving swap",
	blocks: [
		{ id: "sys", label: "Prover role", kind: "system", tokens: 6_000 },
		{ id: "tools", label: "Tools", kind: "tools", tokens: 9_000, items: [{ label: "lake build" }, { label: "read_file" }] },
		{ id: "pool", label: "Pool.sol", kind: "file", tokens: 22_000 },
		{ id: "lean", label: "Swap.lean", kind: "file", tokens: 14_000 },
		{ id: "chat", label: "Conversation", kind: "chat", tokens: 41_000 },
		{ id: "build", label: "lake build output", kind: "result", tokens: 18_000 },
	],
};

export default function Demo() {
	return <ContextMap {...props} />;
}
