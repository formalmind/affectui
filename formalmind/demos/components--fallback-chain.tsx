import { FallbackChain, type FallbackChainProps } from "../../components/fallback-chain";

export const props: FallbackChainProps = {
	title: "Prover request",
	route: "Prove swap",
	request: { name: "Prover", text: "Write the Lean proof for swap" },
	attempts: [
		{ id: "1", model: "Opus", provider: "Anthropic", status: "failed", duration: 30_000, timeout: 30_000, reason: "Timed out" },
		{ id: "2", model: "Sonnet", provider: "Anthropic", status: "answered", duration: 12_000, cost: 0.04 },
	],
	response: { name: "Swap.lean", text: "theorem swap_preserves_k …" },
};

export default function Demo() {
	return <FallbackChain {...props} />;
}
