import { KpiBoard, type KpiBoardData } from "../../blocks/kpi-board";

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const week: KpiBoardData = {
	stats: [
		{ id: "proved", label: "Functions proved", kind: "count", labels: days, values: [4, 7, 5, 9, 8, 6, 9], previous: 38 },
		{ id: "findings", label: "Findings", kind: "count", labels: days, values: [1, 0, 2, 1, 0, 1, 2], previous: 5, lowerIsBetter: true },
		{ id: "spend", label: "Agent spend", kind: "money", labels: days, values: [12, 18, 15, 22, 19, 9, 14], previous: 96, lowerIsBetter: true },
	],
	overview: { title: "Proofs per day", labels: days, current: [4, 7, 5, 9, 8, 6, 9], previous: [3, 5, 6, 6, 7, 4, 7] },
	focus: { title: "lake build pass rate", metric: "Pass rate", unit: "%", labels: days, values: [62, 70, 68, 75, 79, 81, 84], previous: 66 },
};

export default function Demo() {
	return <KpiBoard title="Swarm" ranges={[{ id: "7d", label: "7 days" }]} data={{ "7d": week }} />;
}
