import { AIAnswer, type AIAnswerProps } from "../../components/ai-answer";

export const props: AIAnswerProps = {
	question: "Can withdraw send more than the caller's balance?",
	answer: "No. The Lean proof `withdraw_le_balance` shows the amount sent is at most `balanceOf caller`, and lake build checks it. The one open case is rounding in `convertToAssets`, filed as a finding.",
	sources: [
		{ title: "Vault.sol", name: "src/Vault.sol", snippet: "function withdraw(uint256 assets, …)" },
		{ title: "Withdraw.lean", name: "formal/Vault/Withdraw.lean" },
	],
	followUps: ["Show the rounding finding", "Prove deposit next"],
};

export default function Demo() {
	return <AIAnswer {...props} />;
}
