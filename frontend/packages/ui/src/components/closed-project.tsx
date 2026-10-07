"use client";
import { displayDate, money, type Project } from "./workspace-types";
import { ProjectConversation } from "./project-conversation";
import { ProjectDelivery } from "./project-delivery";
import { ProjectHandover, SettlementRecord } from "./project-completion";
import { ProposalConditions } from "./proposal-conditions";
import { ProjectPayments } from "./project-payments";
import type { Save } from "./workspace-forms";
export function ClosedProject({
  project,
  accountId,
  onError,
  save,
  refresh,
}: {
  project: Project;
  accountId: string;
  onError: (reason: unknown) => void;
  save: Save;
  refresh: () => Promise<void>;
}) {
  return (
    <>
      <div className="portal-project-heading">
        <div>
          <h1>{project.name}</h1>
          <p className="portal-muted">
            Customer account closed · {displayDate(project.accountClosedAt!)}
          </p>
        </div>
        <span className="portal-stage">Closed account</span>
      </div>
      <section className="portal-card">
        <h2>This project is read-only</h2>
        <p>
          The customer closed their account. Unagreed requests and agent reviews
          were withdrawn. Saved project and payment records remain available
          here.
        </p>
        <h3>Project brief</h3>
        <p className="portal-preserve">{project.summary}</p>
      </section>
      <ProjectConversation
        projectId={project.id}
        accountId={accountId}
        team
        readOnly
        onError={onError}
      />
      <section className="portal-card">
        <h2>Requests</h2>
        {project.requests.length ? (
          project.requests.map((request) => (
            <div key={request.id}>
              <h3>{request.title}</h3>
              <p className="portal-preserve">{request.detail}</p>
            </div>
          ))
        ) : (
          <p>No saved requests.</p>
        )}
      </section>
      <section className="portal-card">
        <h2>Scope & estimates</h2>
        {project.proposals.length ? (
          project.proposals.map((proposal) => (
            <div key={proposal.id}>
              <h3>
                Version {proposal.version} · {money(proposal)}
              </h3>
              <p>
                {proposal.approvedAt
                  ? `Approved ${displayDate(proposal.approvedAt)}`
                  : "Not approved"}
                {proposal.id === project.currentProposalId
                  ? " · Current scope"
                  : " · Earlier version"}
              </p>
              <p>Estimated delivery: {displayDate(proposal.deliveryDate)}</p>
              <p className="portal-preserve">{proposal.scope}</p>
              <p className="portal-preserve">{proposal.acceptance}</p>
              <h4>Assumptions</h4>
              <p className="portal-preserve">{proposal.assumptions}</p>
              <ProposalConditions proposal={proposal} />
            </div>
          ))
        ) : (
          <p>No proposal was agreed.</p>
        )}
      </section>
      {project.settledAt && (
        <section className="portal-card">
          <SettlementRecord project={project} />
        </section>
      )}
      <ProjectHandover
        project={project}
        accountId={accountId}
        team
        busy={false}
        save={save}
        readOnly
      />
      <ProjectPayments
        project={project}
        team
        readOnly
        save={save}
        refresh={refresh}
        onError={onError}
        saving={false}
      />
      <ProjectDelivery
        project={project}
        team={false}
        accountId={accountId}
        save={save}
        busy={false}
      />
      {!!project.notes?.length && (
        <section className="portal-card">
          <h2>Team notes</h2>
          {project.notes.map((note) => (
            <p key={note.id} className="portal-preserve">
              {note.body}
            </p>
          ))}
        </section>
      )}
      <section className="portal-card">
        <h2>Project history</h2>
        {project.updates.map((update) => (
          <div key={update.id}>
            <h3>{update.title}</h3>
            <p className="portal-preserve">{update.detail}</p>
          </div>
        ))}
      </section>
    </>
  );
}
