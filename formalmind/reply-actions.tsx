import { MessageActions } from "../components/message-actions";

/** Under an agent's reply: AffectUI's Message Actions with Copy and thumbs up or down (with a reason on down). */
export function ReplyActions({ text }: { text: string }) {
	return <MessageActions text={text} actions={["copy", "feedback"]} reasons={["Wrong", "Not what I asked", "Too long", "Other"]} />;
}
