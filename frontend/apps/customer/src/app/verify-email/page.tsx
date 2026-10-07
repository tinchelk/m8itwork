import { CustomerAuthPage } from "@/components/customer-auth";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Verify email — m8itwork", robots: { index: false, follow: false } };
export default function VerifyEmail() { return <CustomerAuthPage mode="verify" />; }
