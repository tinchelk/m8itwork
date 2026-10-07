import { CustomerAuthPage } from "@/components/customer-auth";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Recover account — m8itwork", robots: { index: false, follow: false } };
export default function ForgotPassword() { return <CustomerAuthPage mode="forgot" />; }
