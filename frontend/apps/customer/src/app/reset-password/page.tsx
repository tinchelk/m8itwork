import { CustomerAuthPage } from "@/components/customer-auth";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Reset password — m8itwork", robots: { index: false, follow: false } };
export default function ResetPassword() { return <CustomerAuthPage mode="reset" />; }
