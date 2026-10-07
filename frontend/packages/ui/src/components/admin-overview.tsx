"use client";
import { useState } from "react";
import { SelectField } from "./form-controls";
import {
  displayDate,
  money,
  stageLabels,
  type ProjectListItem,
} from "./workspace-types";

export function AdminOverview({
  projects,
  select,
}: {
  projects: ProjectListItem[];
  select: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const unread = (project: ProjectListItem) =>
    Boolean(
      project.customerLastMessageAt &&
        (!project.teamReadAt ||
          project.customerLastMessageAt > project.teamReadAt),
    );
  const queue = projects.filter(
    (project) =>
      `${project.name} ${project.account?.githubLogin ?? ""} ${project.account?.displayName ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "ALL" ||
        (filter === "MESSAGES" ? unread(project) : project.stage === filter)),
  );
  return (
    <section className="admin-overview">
      <p className="portal-kicker">YOUR BACKOFFICE · CUSTOMER REQUESTS</p>
      <h1>Help the next app move forward.</h1>
      <p className="portal-muted">
        Review the brief, agree the work, collect its payments, and keep the
        customer in the loop.
      </p>
      <div className="admin-metrics">
        <button onClick={() => setFilter("IN_REVIEW")}>
          <strong>
            {projects.filter((p) => p.stage === "IN_REVIEW").length}
          </strong>
          <span>Ready for review</span>
        </button>
        <button onClick={() => setFilter("MESSAGES")}>
          <strong>{projects.filter(unread).length}</strong>
          <span>Unread conversations</span>
        </button>
        <button onClick={() => setFilter("BUILDING")}>
          <strong>
            {projects.filter((p) => p.stage === "BUILDING").length}
          </strong>
          <span>Building</span>
        </button>
        <button onClick={() => setFilter("VERIFYING")}>
          <strong>
            {projects.filter((p) => p.stage === "VERIFYING").length}
          </strong>
          <span>Ready to verify</span>
        </button>
      </div>
      <div className="portal-form-row admin-filters">
        <label>
          Find a project
          <input
            name="projectSearch" autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Project or GitHub account"
          />
        </label>
        <label>
          Show
          <SelectField aria-label="Show" value={filter} onValueChange={setFilter} options={[
            { value: "ALL", label: "All projects" },
            { value: "MESSAGES", label: "Unread conversations" },
            ...Object.entries(stageLabels).map(([value, label]) => ({ value, label })),
          ]} />
        </label>
      </div>
      <div className="admin-queue">
        {queue.length ? (
          queue.map((project) => {
            const proposal = project.proposals?.[0];
            const payments = proposal?.milestones ?? [];
            const outstanding = payments.reduce(
              (sum, p) =>
                sum +
                Math.max(
                  0,
                  p.amountCents -
                    (p.disputed ||
                    !p.attempts?.some(
                      (a) =>
                        a.status === "PAID" && a.mode === project.billingMode,
                    )
                      ? 0
                      : p.paidCents - p.refundedCents),
                ),
              0,
            );
            return (
              <button
                key={project.id}
                className="admin-project-row"
                onClick={() => select(project.id)}
              >
                <div>
                  <strong>{project.name}</strong>
                  <span>
                    {project.account?.displayName || (project.account?.githubLogin ? `@${project.account.githubLogin}` : "Customer")} · Updated{" "}
                    {displayDate(project.updatedAt)}
                  </span>
                </div>
                <div>
                  <span className="portal-stage">
                    {stageLabels[project.stage]}
                  </span>
                  {unread(project) && (
                    <span className="admin-unread">New customer message</span>
                  )}
                </div>
                <span>
                  {proposal?.approvedAt && payments.length
                    ? `${money({ amountCents: outstanding, currency: proposal.currency })} outstanding`
                    : "Scope & payment pending"}
                </span>
                <b aria-hidden="true">↗</b>
              </button>
            );
          })
        ) : (
          <p className="portal-empty">
            {projects.length
              ? "No projects match this view."
              : "Customer submissions will appear here. You can review, reply, and agree their next step."}
          </p>
        )}
      </div>
      <p className="portal-muted">
        Shows the latest 100 projects. Unread status is shared by the project
        team.
      </p>
    </section>
  );
}
