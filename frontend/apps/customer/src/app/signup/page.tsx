import { CustomerAuthPage } from "@/components/customer-auth";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Create account — m8itwork", robots: { index: false, follow: false } };
export default function Signup() { return <CustomerAuthPage mode="signup" />; }
