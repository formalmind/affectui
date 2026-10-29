import { PermissionRequest, type PermissionRequestProps } from "../../components/permission-request";

export const props: PermissionRequestProps = {
	agent: { name: "Auditor", model: "Opus" },
	action: "Run forge test",
	target: "test/WithdrawRounding.t.sol",
	risk: "risky",
	reason: "To confirm the withdraw rounding finding with a PoC.",
	preview: [
		{ id: "1", label: "forge test --match-test testWithdrawRounding" },
		{ id: "2", label: "Forks mainnet at block 21000000" },
	],
};

export default function Demo() {
	return <PermissionRequest {...props} />;
}
