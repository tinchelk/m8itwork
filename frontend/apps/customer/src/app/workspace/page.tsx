import { Workspace } from "@/components/workspace";
import { WorkshopBackdrop } from "@/components/workshop-backdrop";
import "@m8itwork/ui/styles/portal.css";
export const metadata = { title: "Your workspace — m8itwork" };
export default function WorkspacePage() {
  return (
    <div className="workshop-shell portal-shell">
      <WorkshopBackdrop />
      <Workspace />
    </div>
  );
}
