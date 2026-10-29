import { SetupGuide, type SetupGuideProps } from "../../components/setup-guide";

export const props: SetupGuideProps = {
	groups: [
		{ id: "repo", title: "Project", tasks: [{ id: "1", label: "Pick a Solidity repo", done: true }, { id: "2", label: "Choose functions in scope", done: true }] },
		{ id: "swarm", title: "Swarm", tasks: [{ id: "3", label: "Sign in to Claude" }, { id: "4", label: "Start the swarm" }] },
	],
};

export default function Demo() {
	return <SetupGuide {...props} />;
}
