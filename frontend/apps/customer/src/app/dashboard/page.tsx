import { Workspace } from "@/components/workspace";
import { WorkshopBackdrop } from "@/components/workshop-backdrop";
import "@m8itwork/ui/styles/portal.css";

export const metadata = {
  title: "Your dashboard — m8itwork",
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <div className="workshop-shell portal-shell">
      <WorkshopBackdrop />
      <Workspace />
    </div>
  );
}
