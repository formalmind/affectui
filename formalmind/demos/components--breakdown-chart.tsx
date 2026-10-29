import { BreakdownChart, type BreakdownChartProps } from "../../components/breakdown-chart";

const fns = ["swap", "deposit", "withdraw", "flashLoan"];
const roles = ["Prover", "Reviewer", "Auditor"];
export const props: BreakdownChartProps = {
	title: "Agent time by function",
	dimensions: [
		{ key: "fn", label: "Function", values: fns },
		{ key: "role", label: "Role", values: roles },
	],
	measures: [
		{ key: "minutes", label: "Minutes", unit: "min" },
		{ key: "cost", label: "Cost", unit: "$" },
	],
	records: fns.flatMap((fn, i) => roles.map((role, j) => ({ fn, role, minutes: 4 + ((i * 7 + j * 5) % 13), cost: 0.2 + ((i + j) % 4) * 0.3 }))),
};

export default function Demo() {
	return <BreakdownChart {...props} />;
}
