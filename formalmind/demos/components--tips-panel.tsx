import { TipsPanel, type TipsPanelProps } from "../../components/tips-panel";

export const props: TipsPanelProps = {
	tips: [
		{ id: "1", title: "Pick functions", description: "Choose which functions the swarm proves first.", action: "Pick", primary: true },
		{ id: "2", title: "Read the findings", description: "Each finding has a Foundry PoC you can run.", action: "Open Bugs", doneLabel: "Read" },
	],
};

export default function Demo() {
	return <TipsPanel {...props} />;
}
