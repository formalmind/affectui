import { IntegrationSettings, type IntegrationSettingsProps } from "../../components/integration-settings";

export const props: IntegrationSettingsProps = {
	name: "GitHub",
	logo: <span style={{ fontWeight: 600 }}>GH</span>,
	meta: "formalmind/contracts",
	defaultValues: { enabled: true, siteUrl: "https://github.com/formalmind/contracts", timeZone: "UTC" },
	timeZones: ["UTC", "Europe/London", "America/New_York"],
};

export default function Demo() {
	return <IntegrationSettings {...props} />;
}
