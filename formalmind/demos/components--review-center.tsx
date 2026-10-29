import { ReviewCenter, type ReviewCenterProps } from "../../components/review-center";

const now = Date.now();
const min = 60_000;
export const props: ReviewCenterProps = {
	now,
	items: [
		{ id: "1", title: "Spec for swap", agent: "Prover", model: "Opus", type: "Spec", risk: "medium", confidence: 0.86, createdAt: now - 20 * min, reasoning: "Matches the Solidity, fees included.", format: "code", body: "theorem swap_preserves_k (s : State) : k (swap s a) ≥ k s", files: [{ path: "formal/Pool/Swap.lean", added: 42 }] },
		{ id: "2", title: "withdraw rounding", agent: "Auditor", type: "Finding", risk: "high", confidence: 0.64, createdAt: now - 8 * min, fields: [{ label: "Severity", value: "High" }], body: "convertToAssets rounds up on withdraw.", sources: [{ label: "Vault.sol" }] },
	],
};

export default function Demo() {
	return <ReviewCenter {...props} />;
}
