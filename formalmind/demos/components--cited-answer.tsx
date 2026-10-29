import { CitedAnswer, type CitedAnswerProps } from "../../components/cited-answer";

export const props: CitedAnswerProps = {
	pagesRead: 4,
	segments: [
		{ text: "swap keeps the constant product: reserves after the trade multiply to at least k.", cite: ["pool"] },
		{ text: "The Lean proof checks this for every input amount, including zero.", cite: ["lean"] },
		{ text: "Fees are taken before the check, so k only grows.", cite: ["pool", "lean"], paragraph: true },
	],
	sources: [
		{ id: "pool", title: "Pool.sol", site: "src/Pool.sol", quote: "require(balance0 * balance1 >= k)" },
		{ id: "lean", title: "Swap.lean", site: "formal/Pool/Swap.lean", quote: "theorem swap_preserves_k" },
	],
};

export default function Demo() {
	return <CitedAnswer {...props} />;
}
