import { DataTable, type DataTableProps } from "../../components/data-table";

export const props: DataTableProps = {
	title: "Functions",
	columns: [
		{ key: "name", label: "Function", type: "title" },
		{ key: "contract", label: "Contract", type: "text" },
		{ key: "status", label: "Status", type: "tag", options: ["Proved", "Proving", "Finding"] },
		{ key: "lines", label: "Lean lines", type: "number" },
	],
	tagTones: { Proved: "green", Proving: "blue", Finding: "amber" },
	rows: [
		{ id: "1", name: "swap", contract: "Pool", status: "Proved", lines: 142 },
		{ id: "2", name: "deposit", contract: "Vault", status: "Proving", lines: 88 },
		{ id: "3", name: "withdraw", contract: "Vault", status: "Finding", lines: 61 },
	],
};

export default function Demo() {
	return <DataTable {...props} />;
}
