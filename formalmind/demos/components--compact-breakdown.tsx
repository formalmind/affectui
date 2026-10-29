import { CompactBreakdown, type CompactBreakdownProps } from "../../components/compact-breakdown";

export const props: CompactBreakdownProps = {
	title: "Spend by agent",
	delta: 0.12,
	format: (v) => `$${v.toFixed(2)}`,
	periods: [
		{ id: "day", label: "Today" },
		{ id: "week", label: "This week" },
	],
	items: [
		{ label: "Prover", value: 14.2 },
		{ label: "Reviewer", value: 5.6 },
		{ label: "Auditor", value: 8.1 },
	],
};

export default function Demo() {
	return <CompactBreakdown {...props} />;
}
