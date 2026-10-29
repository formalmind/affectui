import { ExperimentCard, type ExperimentCardProps } from "../../components/experiment-card";

export const props: ExperimentCardProps = {
	title: "Prover prompt: tactic hints",
	status: { label: "Running", tone: "blue" },
	metrics: [
		{ id: "proved", label: "Proved", format: (v) => `${Math.round(v * 100)}%` },
		{ id: "minutes", label: "Minutes per proof", lowerIsBetter: true },
	],
	variants: [
		{ id: "a", key: "A", name: "Current", control: true, visitors: 120, values: { proved: 0.71, minutes: 9.4 } },
		{ id: "b", key: "B", name: "With hints", visitors: 118, values: { proved: 0.82, minutes: 7.1 }, confidence: { proved: 0.94, minutes: 0.9 } },
	],
};

export default function Demo() {
	return <ExperimentCard {...props} />;
}
