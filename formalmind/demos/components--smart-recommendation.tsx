import { SmartRecommendation, type SmartRecommendationProps } from "../../components/smart-recommendation";

export const props: SmartRecommendationProps = {
	title: "Prove next",
	options: [
		{ id: "withdraw", label: "withdraw", reason: "Moves money and has an open finding", signal: 3 },
		{ id: "deposit", label: "deposit", reason: "Its spec is already reviewed", signal: 2 },
		{ id: "sync", label: "sync", reason: "Small, no transfers", signal: 1 },
	],
};

export default function Demo() {
	return <SmartRecommendation {...props} />;
}
