import { UsageMeter, type UsageMeterProps } from "../../components/usage-meter";

export const props: UsageMeterProps = {
	title: "Credits",
	plan: "Pro",
	total: 100,
	used: [
		{ label: "Prover", value: 38 },
		{ label: "Reviewer", value: 12 },
		{ label: "Auditor", value: 17 },
	],
	limits: [{ label: "Swarm runs", used: 14, total: 50 }],
	daily: ["M", "T", "W", "T", "F", "S", "S"].map((label, i) => ({ label, value: i < 5 ? 6 + i * 3 : null })),
};

export default function Demo() {
	return <UsageMeter {...props} />;
}
