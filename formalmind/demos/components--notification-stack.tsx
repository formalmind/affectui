import { NotificationStack, type NotificationStackProps } from "../../components/notification-stack";

export const props: NotificationStackProps = {
	notices: [
		{ id: "1", badge: "Proved", title: "swap is proved", text: "lake build passed for Pool.swap.", pattern: "orbit" },
		{ id: "2", badge: "Finding", title: "withdraw rounding", text: "The auditor filed a High with a Foundry PoC.", pattern: "rays" },
	],
};

export default function Demo() {
	return <NotificationStack {...props} />;
}
