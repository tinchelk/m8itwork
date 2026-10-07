import { CustomerAuthPage } from "@/components/customer-auth";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Sign in — m8itwork", robots: { index: false, follow: false } };
export default function Login() { return <CustomerAuthPage mode="login" />; }
