import { PromptLibrary, type PromptLibraryProps } from "../../components/prompt-library";

export const props: PromptLibraryProps = {
	templates: [
		{ id: "prove", title: "Prove a function", category: "Prover", tone: "violet", body: "Write a Lean 4 proof that {{fn}} in {{contract}} keeps its money invariant, then run lake build.", variables: { fn: { default: "swap" }, contract: { default: "Pool.sol" } } },
		{ id: "review", title: "Review a spec", category: "Reviewer", tone: "blue", body: "Check that the spec for {{fn}} says what the Solidity does.", variables: { fn: { default: "deposit" } } },
		{ id: "poc", title: "Write a PoC", category: "Auditor", tone: "amber", body: "Write a Foundry test that shows {{finding}}." },
	],
};

export default function Demo() {
	return <PromptLibrary {...props} />;
}
