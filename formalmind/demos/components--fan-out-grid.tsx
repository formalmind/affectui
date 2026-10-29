import { FanoutGrid, type FanoutGridProps } from "../../components/fan-out-grid";

const fns = ["swap", "deposit", "withdraw", "mint", "burn", "flashLoan", "skim", "sync", "redeem", "previewDeposit", "transfer", "approve"];
export const props: FanoutGridProps = {
	job: "Prove Pool.sol",
	workers: 4,
	now: 300_000,
	tasks: fns.map((label, i) => {
		const status = i < 6 ? "done" : i === 6 ? "failed" : i < 10 ? "running" : "queued";
		return { id: label, label, status, worker: `Prover ${(i % 4) + 1}`, start: i < 10 ? i * 20_000 : undefined, end: i < 7 ? i * 20_000 + 60_000 : undefined, cost: 0.1 + (i % 3) * 0.05, error: status === "failed" ? "unsolved goals" : undefined };
	}),
};

export default function Demo() {
	return <FanoutGrid {...props} />;
}
