import { DecisionTree, type DecisionTreeProps } from "../../components/decision-tree";

export const props: DecisionTreeProps = {
	decisions: [
		{
			id: "1",
			question: "How should the prover handle withdraw rounding?",
			context: "convertToAssets rounds up, so the invariant fails by 1 wei.",
			agent: "Prover",
			model: "Opus",
			risk: "high",
			options: [
				{ label: "File a finding and stop", effects: ["Auditor writes a Foundry PoC"], pick: true },
				{ label: "Prove a weaker invariant", effects: ["Allows 1 wei of slack per call"] },
			],
		},
	],
};

export default function Demo() {
	return <DecisionTree {...props} />;
}
