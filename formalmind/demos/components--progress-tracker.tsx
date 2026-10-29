import { ProgressTracker, type ProgressTrackerProps } from "../../components/progress-tracker";

export const props: ProgressTrackerProps = {
	title: "Proving Pool.sol",
	steps: [
		{ id: "1", label: "Compile with solc", done: true },
		{ id: "2", label: "Write specs", done: true },
		{ id: "3", label: "Prove swap" },
		{ id: "4", label: "lake build" },
	],
};

export default function Demo() {
	return <ProgressTracker {...props} />;
}
