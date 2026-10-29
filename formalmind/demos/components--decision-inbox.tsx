import { DecisionInbox, type DecisionInboxProps } from "../../components/decision-inbox";

export const props: DecisionInboxProps = {
	decisions: [
		{ id: "1", title: "Accept the swap spec?", detail: "Prover wrote it; lake build passes.", primary: "Accept", secondary: "Ask for changes" },
		{ id: "2", title: "File withdraw rounding as High?", detail: "Foundry PoC drains 1 wei per call.", primary: "File", secondary: "Dismiss" },
	],
};

export default function Demo() {
	return <DecisionInbox {...props} />;
}
