import { TraceWaterfall, type TraceWaterfallProps } from "../../components/trace-waterfall";

export const props: TraceWaterfallProps = {
	now: 60_000,
	root: {
		id: "root", name: "Prove swap", kind: "agent", status: "running", start: 0,
		children: [
			{ id: "llm1", name: "Write spec", kind: "llm", status: "done", start: 0, end: 18_000, model: "Opus", tokensIn: 24_000, tokensOut: 1_800, cost: 0.12 },
			{ id: "t1", name: "lake build", kind: "tool", status: "failed", start: 18_000, end: 39_000, error: "unsolved goals" },
			{ id: "sub", name: "Reviewer", kind: "subagent", status: "running", start: 40_000, children: [{ id: "llm2", name: "Check spec", kind: "llm", status: "running", start: 41_000, model: "Sonnet" }] },
		],
	},
};

export default function Demo() {
	return <TraceWaterfall {...props} />;
}
