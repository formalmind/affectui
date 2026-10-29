import { CommentThread, type CommentThreadProps } from "../../components/comment-thread";

const now = Date.now();
const min = 60_000;
const reviewer = { name: "Reviewer", assistant: true };
const you = { name: "You" };
export const props: CommentThreadProps = {
	title: "withdraw rounding",
	currentUser: you,
	assistant: reviewer,
	messages: [
		{ id: "1", author: reviewer, createdAt: now - 30 * min, text: "convertToAssets rounds up on withdraw, so the caller can take 1 wei more than their share.", details: ["Foundry PoC passes", "Lean goal unsolved"] },
		{ id: "2", author: you, createdAt: now - 12 * min, text: "Confirmed. Can the prover add the fix and re-run lake build?" },
	],
};

export default function Demo() {
	return <CommentThread {...props} />;
}
