import { AccountSettings } from "@/components/account-settings";
import "@m8itwork/ui/styles/portal.css";
import "@m8itwork/ui/styles/billing.css";
export const metadata = { title: "Your account — m8itwork", robots: { index: false, follow: false } };
export default function Account() { return <AccountSettings />; }
