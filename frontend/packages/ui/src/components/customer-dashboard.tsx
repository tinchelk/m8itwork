import { displayDate, stageLabels, type ProjectListItem } from "./workspace-types";
import { isPaid, paymentNeedsReview } from "./project-payments";

const nextSteps: Record<string, string> = {
  DRAFT: "Share a demo or repository and tell us what you want next.",
  IN_REVIEW: "We’re reviewing your app and requests.",
  AWAITING_APPROVAL: "Review your scope, estimated delivery, and cost.",
  APPROVED: "Check your agreed payment plan and next step.",
  BUILDING: "Follow the work and talk with the team.",
  VERIFYING: "Follow the checks before your handover.",
  WITHDRAWN: "Request withdrawn. Your history is retained.",
  DECLINED: "The team declined this request. See the reason and conversation.",
  CANCELLED: "Cancellation settled. See the retained payment history.",
  CLOSED: "This project is closed. See its history.",
  COMPLETE: "See your verification summary and handover.",
};

export function CustomerDashboard({
  projects,
  select,
  start,
  busy,
}: {
  projects: ProjectListItem[];
  select: (id: string) => void;
  start: () => void;
  busy: boolean;
}) {
  return (
    <section className="customer-dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="portal-kicker">YOUR DASHBOARD</p>
          <h1>Your apps. Their next chapter.</h1>
          <p className="portal-muted">
            Follow each project from your first request to a verified handover.
          </p>
        </div>
        <button className="button" onClick={start} disabled={busy}>
          Start a project <span aria-hidden="true">↗</span>
        </button>
      </div>
      {projects.length ? (
        <>
          <div className="dashboard-summary" aria-label="Project summary">
            <div><strong>{projects.filter((p) => !["COMPLETE", "WITHDRAWN", "DECLINED", "CANCELLED", "CLOSED"].includes(p.stage)).length}</strong><span>Active projects</span></div>
            <div><strong>{projects.filter((p) => p.stage === "AWAITING_APPROVAL").length}</strong><span>Proposals to review</span></div>
            <div><strong>{projects.filter((p) => p.stage === "COMPLETE").length}</strong><span>Completed</span></div>
          </div>
          <div className="dashboard-projects">
            {projects.map((project) => {
              const proposal = project.proposals?.find((p) => p.id === project.currentProposalId);
              const paused = Boolean(project.cancellationRequestedAt || ["WITHDRAWN", "DECLINED", "CANCELLED", "CLOSED"].includes(project.stage));
              const payment = !paused && proposal?.approvedAt
                ? proposal.milestones?.find((m) => m.releasedAt && (!isPaid(m, project.billingMode) || paymentNeedsReview(m, project.billingMode)))
                : undefined;
              const paymentHold = payment && paymentNeedsReview(payment, project.billingMode);
              const checkingPayment = payment?.attempts?.[0]?.status === "PROCESSING";
              const nextStep = project.cancellationRequestedAt && project.stage !== "CANCELLED" ? "Cancellation requested. Review the settlement with the team." : paymentHold
                ? "Payment needs team review. Open your payment plan."
                : payment && project.billingMode === "unconfigured"
                  ? "Payment collection is being set up. Talk with the team."
                  : checkingPayment
                    ? "Payment confirmation is pending. Check its status."
                    : payment
                      ? `Your ${payment.label.toLowerCase()} payment is requested. Review the payment plan.`
                      : nextSteps[project.stage] ?? "Open your project to see the next step.";
              const unread = Boolean(
                project.teamLastMessageAt &&
                (!project.customerReadAt || project.teamLastMessageAt > project.customerReadAt),
              );
              return (
                <a
                  key={project.id}
                  className="dashboard-project"
                  href={`/dashboard?project=${encodeURIComponent(project.id)}`}
                  onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); if (!busy) select(project.id); } }}
                >
                  <div className="dashboard-project-top">
                    <span className="portal-stage">{stageLabels[project.stage] ?? project.stage}</span>
                    {unread && <span className="dashboard-unread">New team message</span>}
                  </div>
                  <h2>{project.name}</h2>
                  <p>{nextStep}</p>
                  <div className="dashboard-project-foot">
                    <span>Updated {displayDate(project.updatedAt)}</span>
                    <strong>Open project <span aria-hidden="true">↗</span></strong>
                  </div>
                </a>
              );
            })}
          </div>
          <p className="portal-muted">Shows your latest 100 projects.</p>
        </>
      ) : (
        <div className="portal-card dashboard-empty">
          <span className="dashboard-empty-icon" aria-hidden="true">↗</span>
          <h2>Let’s move your first app forward.</h2>
          <p className="portal-lead">
            Start a project with what you’ve built and what you want to fix or add.
            Your plan, conversations, and progress will live here.
          </p>
          <ol className="portal-login-steps">
            <li><b>01</b><div><strong>Share your app</strong><span>Connect your repository and tell us what you want to fix, add, or improve.</span></div></li>
            <li><b>02</b><div><strong>Review & agree</strong><span>Our review, scoped work, estimated delivery, and cost.</span></div></li>
            <li><b>03</b><div><strong>Build & follow</strong><span>Messages, payments, progress, and verified handover.</span></div></li>
          </ol>
          <p className="portal-muted">Starting a project is free. Paid work is scoped and agreed with you first.</p>
        </div>
      )}
    </section>
  );
}
