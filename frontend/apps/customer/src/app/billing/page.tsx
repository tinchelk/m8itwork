import { CustomerBilling } from "@/components/customer-billing";
import "@m8itwork/ui/styles/portal.css";
import "@m8itwork/ui/styles/billing.css";
export const metadata = {
  title: "Billing — m8itwork",
  robots: { index: false, follow: false },
};
export default function Billing() {
  return <CustomerBilling />;
}
