import { ProjectCard, type ProjectCardProps } from "../../components/project-card";

export const props: ProjectCardProps = {
	title: "Vault.sol audit",
	due: "Fri",
	status: "active",
	statuses: [
		{ id: "active", label: "Proving", tone: "blue" },
		{ id: "done", label: "Proved", tone: "green" },
	],
	members: [{ name: "Prover" }, { name: "Reviewer" }, { name: "Auditor" }],
	tasks: [
		{ id: "1", label: "Prove deposit", done: true, assignee: "Prover" },
		{ id: "2", label: "Prove withdraw", assignee: "Prover" },
		{ id: "3", label: "PoC for rounding", assignee: "Auditor" },
	],
};

export default function Demo() {
	return <ProjectCard {...props} />;
}
