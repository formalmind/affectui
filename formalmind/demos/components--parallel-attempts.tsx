import { ParallelAttempts, type ParallelAttemptsProps } from "../../components/parallel-attempts";

export const props: ParallelAttemptsProps = {
	task: "Prove swap preserves k",
	attempts: [
		{ id: "a", name: "Prover 1", approach: "Induction on reserves", model: "Opus", status: "done", score: 0.9, took: 7 * 60_000, cost: 0.6 },
		{ id: "b", name: "Prover 2", approach: "nlinarith on the product", model: "Sonnet", status: "running", progress: 0.5, step: "lake build" },
		{ id: "c", name: "Prover 3", approach: "Rewrite with fee lemma", model: "Opus", status: "failed", note: "unsolved goals" },
	],
};

export default function Demo() {
	return <ParallelAttempts {...props} />;
}
