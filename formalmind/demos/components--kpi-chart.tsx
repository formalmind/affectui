import { KpiChart, type KpiChartProps } from "../../components/kpi-chart";

export const props: KpiChartProps = {
	title: "Functions proved",
	value: "48",
	delta: 0.14,
	labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
	series: [
		{ label: "Proved", color: "#7c3aed", values: [4, 7, 5, 9, 8, 6, 9] },
		{ label: "Findings", color: "#f59e0b", values: [1, 0, 2, 1, 0, 1, 2] },
	],
};

export default function Demo() {
	return <KpiChart {...props} />;
}
