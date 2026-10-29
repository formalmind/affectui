import { ModelPicker, type ModelPickerProps } from "../../components/model-picker";

export const props: ModelPickerProps = {
	defaultValue: "opus",
	models: [
		{ id: "opus", name: "Opus", description: "Hard proofs", quality: 3, speed: 1, cost: 3 },
		{ id: "sonnet", name: "Sonnet", description: "Reviews and specs", quality: 2, speed: 2, cost: 2 },
		{ id: "haiku", name: "Haiku", description: "Quick lake build fixes", quality: 1, speed: 3, cost: 1 },
	],
};

export default function Demo() {
	return <ModelPicker {...props} />;
}
