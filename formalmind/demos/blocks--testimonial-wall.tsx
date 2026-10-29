import { TestimonialWall } from "../../blocks/testimonial-wall";

export default function Demo() {
	return (
		<TestimonialWall
			label="What auditors say"
			items={[
				{ quote: "The swarm proved our vault's withdraw invariant overnight and found the rounding bug.", name: "Lead auditor", company: "Vault team", rating: 5, verified: true },
				{ quote: "Every finding came with a Foundry PoC that ran first time.", name: "Security engineer", company: "AMM protocol", rating: 5 },
				{ quote: "Lean proofs per function made review simple.", name: "Protocol dev", rating: 4 },
			]}
		/>
	);
}
