import { CommentsPanel, type CommentsPanelProps } from "../../components/comments-panel";

const now = Date.now();
const min = 60_000;
export const props: CommentsPanelProps = {
	title: "Comments",
	currentUser: { name: "You" },
	comments: [
		{ id: "1", author: { name: "Auditor" }, createdAt: now - 40 * min, text: "flashLoan doesn't check the fee was repaid." },
		{ id: "2", author: { name: "Prover" }, createdAt: now - 20 * min, text: "The swap proof is in; lake build passes." },
	],
};

export default function Demo() {
	return <CommentsPanel {...props} />;
}
