"use client";
import { useRef } from "react";
import type { Project } from "./workspace-types";
import type { Save } from "./workspace-forms";
import { useFormDraft } from "./workspace-drafts";
import { SelectField } from "./form-controls";

const labels = {
  TODO: "To do",
  DOING: "In progress",
  BLOCKED: "Blocked",
  DONE: "Verified",
};
export function ProjectDelivery({
  project,
  team,
  accountId,
  busy,
  save,
}: {
  project: Project;
  team: boolean;
  accountId: string;
  busy: boolean;
  save: Save;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(formRef, accountId, `delivery:${project.id}`);
  const items = project.workItems ?? [];
  return (
    <section id="delivery" className="portal-card">
      <p className="portal-kicker">FROM AGREEMENT TO HANDOVER</p>
      <h2>Delivery checklist</h2>
      <p className="portal-muted">
        {items.length
          ? `${items.filter((item) => item.status === "DONE").length} of ${items.length} agreed delivery items verified.`
          : "After scope approval, the team will break the agreed work into visible delivery items."}
      </p>
      <div className="delivery-items">
        {items.map((item) => (
          <article key={item.id}>
            <div className="portal-section-heading">
              <h3>{item.title}</h3>
              <span
                className={`portal-stage delivery-${item.status.toLowerCase()}`}
              >
                {labels[item.status]}
              </span>
            </div>
            <p className="portal-preserve">{item.detail}</p>
            {item.evidence && (
              <p className="portal-preserve portal-muted">
                Checks & results: {item.evidence}
              </p>
            )}
            {item.evidenceUrl && (
              <a
                href={item.evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open delivery evidence ↗
              </a>
            )}
            {team &&
              ["APPROVED", "BUILDING", "VERIFYING"].includes(project.stage) && (
                <details>
                  <summary>Update this item</summary>
                  <form
                    className="portal-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const values = Object.fromEntries(
                        new FormData(event.currentTarget),
                      );
                      void save(
                        `/v1/operator/projects/${project.id}/work/${item.id}`,
                        { ...values, version: project.version },
                        "Delivery item updated.",
                      );
                    }}
                  >
                    <label>
                      Status
                      <SelectField name="status" aria-label="Status" defaultValue={item.status} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} />
                    </label>
                    <label>
                      Checks and result
                      <textarea
                        name="evidence"
                        rows={3}
                        maxLength={3000}
                        defaultValue={item.evidence ?? ""}
                        placeholder="Required to mark the item verified."
                      />
                    </label>
                    <label>
                      Evidence / pull request link (optional)
                      <input
                        type="url" autoComplete="off" spellCheck={false}
                        name="evidenceUrl"
                        maxLength={500}
                        defaultValue={item.evidenceUrl ?? ""}
                      />
                    </label>
                    <button className="button" disabled={busy}>
                      Save delivery item
                    </button>
                  </form>
                </details>
              )}
          </article>
        ))}
      </div>
      {team &&
        ["APPROVED", "BUILDING", "VERIFYING"].includes(project.stage) && (
          <details>
            <summary>Add a delivery item</summary>
            <form
              ref={formRef}
              onInput={draft.capture}
              onChange={draft.capture}
              className="portal-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const id = form.elements.namedItem("id") as HTMLInputElement;
                id.value ||= crypto.randomUUID();
                draft.capture();
                const values = Object.fromEntries(new FormData(form));
                if (
                  await save(
                    `/v1/operator/projects/${project.id}/work`,
                    { ...values, version: project.version },
                    "Delivery item added.",
                  )
                ) {
                  form.reset();
                  draft.clear();
                }
              }}
            >
              <input type="hidden" name="id" />
              <label>
                Delivery item title
                <input name="title" required minLength={3} maxLength={160} />
              </label>
              <label>
                Outcome / acceptance check
                <textarea
                  name="detail"
                  required
                  minLength={10}
                  maxLength={3000}
                  rows={3}
                />
              </label>
              <button className="button" disabled={busy}>
                Add delivery item
              </button>
            </form>
          </details>
        )}
      {project.verificationSummary && (
        <div className="delivery-handover">
          <h3>Verification & handover</h3>
          <p className="portal-preserve">{project.verificationSummary}</p>
        </div>
      )}
    </section>
  );
}
export function TeamNotes({
  project,
  accountId,
  save,
  busy,
}: {
  project: Project;
  accountId: string;
  save: Save;
  busy: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(formRef, accountId, `notes:${project.id}`);
  return (
    <section className="portal-card team-notes">
      <p className="portal-kicker">PRIVATE TO THE TEAM</p>
      <h2>Internal notes</h2>
      <p className="portal-muted">
        These notes are excluded from customer responses. Use the conversation
        for anything the customer needs to see.
      </p>
      <form
        ref={formRef}
        onInput={draft.capture}
        onChange={draft.capture}
        className="portal-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const id = form.elements.namedItem("id") as HTMLInputElement;
          id.value ||= crypto.randomUUID();
          draft.capture();
          if (
            await save(
              `/v1/operator/projects/${project.id}/notes`,
              Object.fromEntries(new FormData(form)),
              "Private team note saved.",
            )
          ) {
            form.reset();
            draft.clear();
          }
        }}
      >
        <input type="hidden" name="id" />
        <label>
          Private note
          <textarea name="body" rows={3} required maxLength={5000} />
        </label>
        <button className="button" disabled={busy}>
          Save private note
        </button>
      </form>
      <ol className="team-note-list">
        {project.notes?.map((note) => (
          <li key={note.id}>
            <strong>@{note.authorName}</strong>
            <p className="portal-preserve">{note.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
