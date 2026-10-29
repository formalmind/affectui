import { PlanVsActual } from "../../components/plan-vs-actual-clean";

const m = 60_000;
export default function Demo() {
	return (
		<PlanVsActual
			task="Prove Vault.sol"
			now={22 * m}
			steps={[
				{ id: "read", title: "Read Vault.sol", plan: 2 * m, start: 0, end: 3 * m },
				{ id: "spec", title: "Write specs", plan: 6 * m, deps: ["read"], start: 3 * m, end: 11 * m },
				{ id: "prove", title: "Prove deposit and withdraw", plan: 10 * m, deps: ["spec"], start: 11 * m },
				{ id: "review", title: "Review", plan: 4 * m, deps: ["prove"] },
			]}
		/>
	);
}
