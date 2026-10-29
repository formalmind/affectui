import { ChangeSummary, type ChangeSummaryProps } from "../../components/change-summary";

export const props: ChangeSummaryProps = {
	period: "Since yesterday",
	changes: [
		{ label: "Functions proved", change: "+6", tone: "good", direction: "up" },
		{ label: "Open findings", change: "+2", tone: "bad", direction: "up" },
		{ label: "lake build time", change: "-18%", tone: "good", direction: "down" },
	],
};

export default function Demo() {
	return <ChangeSummary {...props} />;
}
