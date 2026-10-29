import { LogoMarquee } from "../../blocks/logo-marquee";

const names = ["Uniswap", "Aave", "Morpho", "Euler", "Balancer", "Curve", "Async Swap"];
export default function Demo() {
	return <LogoMarquee label="Contracts proved with Formal Mind" labels="beside" logos={names.map((name) => ({ name }))} />;
}
