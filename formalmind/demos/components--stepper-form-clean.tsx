import { StepperField, StepperForm, StepperInput, type StepperFormProps } from "../../components/stepper-form-clean";

type Values = { repo: string; functions: string };
const props: StepperFormProps<Values> = {
	initialValues: { repo: "formalmind/contracts", functions: "swap, deposit, withdraw" },
	submitLabel: "Start the swarm",
	steps: [
		{
			id: "repo",
			title: "Repository",
			render: ({ values, setValues }) => (
				<StepperField name="repo" label="Solidity repo">
					<StepperInput value={values.repo} onChange={(e) => setValues({ repo: e.target.value })} />
				</StepperField>
			),
			validate: (v) => (v.repo ? null : { repo: "Pick a repo" }),
		},
		{
			id: "scope",
			title: "Scope",
			render: ({ values, setValues }) => (
				<StepperField name="functions" label="Functions to prove">
					<StepperInput value={values.functions} onChange={(e) => setValues({ functions: e.target.value })} />
				</StepperField>
			),
		},
	],
};

export default function Demo() {
	return <StepperForm {...props} />;
}
