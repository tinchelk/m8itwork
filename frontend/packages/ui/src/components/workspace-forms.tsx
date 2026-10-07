"use client";
import { useRef, useState, type FormEvent } from "react";
import type { Project } from "./workspace-types";
import { stageLabels } from "./workspace-types";
import { useFormDraft } from "./workspace-drafts";

export type Save = (
  path: string,
  data: unknown,
  message: string,
) => Promise<boolean>;
const data = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget));

export function NewProjectForm({
  accountId,
  save,
  busy,
}: {
  accountId: string;
  save: Save;
  busy: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(formRef, accountId, "new-project");
  return (
    <form
      ref={formRef}
      onInput={draft.capture}
      onChange={draft.capture}
      className="portal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const idField = form.elements.namedItem(
          "draftRequestId",
        ) as HTMLInputElement;
        idField.value ||= crypto.randomUUID();
        draft.capture();
        const { draftRequestId, ...values } = data(event);
        if (
          await save(
            "/v1/projects",
            {
              ...values,
              id: draftRequestId,
              consent: values.consent === "on",
            },
            "Project started.",
          )
        ) {
          form.reset();
          draft.clear();
        }
      }}
    >
      <input type="hidden" name="draftRequestId" />
      <label>
        Project name
        <input
          name="name"
          required
          maxLength={120}
          placeholder="Your app’s name"
        />
      </label>
      <div className="portal-form-row">
        <label>
          Contact email
          <input
            name="contactEmail"
            type="email"
            required
            autoComplete="email"
            maxLength={254}
          />
        </label>
        <label>
          Started with
          <select name="platform" required defaultValue="">
            <option value="" disabled>
              Choose a tool
            </option>
            {["Lovable", "Base44", "Bolt", "Replit", "Other"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        What would you like to fix or add?
        <textarea
          name="summary"
          required
          minLength={20}
          maxLength={5000}
          rows={4}
          placeholder="What you’ve built, what gets in the way, and what you want next."
        />
      </label>
      <label>
        Demo link <span className="portal-muted">(optional)</span>
        <input
          name="demoUrl"
          type="url"
          maxLength={500}
          placeholder="https://"
        />
      </label>
      <details>
        <summary>Review without connecting GitHub</summary>
        <label>
          Tell us about access constraints
          <textarea
            name="accessNote"
            maxLength={1000}
            rows={3}
            placeholder="For example, your code is still inside the app builder."
          />
        </label>
        <p className="portal-muted">
          We’ll review the available access before scoping the work.
        </p>
      </details>
      <label className="portal-check">
        <input type="checkbox" name="consent" required />
        <span>
          I’m authorized to share this project and agree to the{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            privacy & access terms (opens in a new tab)
          </a>
          .
        </span>
      </label>
      <p className="portal-muted">
        Leave out passwords, API keys, and customer data. Starting a project is
        free; any paid work is agreed separately.
      </p>
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : "Start project"}
        <span aria-hidden="true">↗</span>
      </button>
    </form>
  );
}

export function RequestForm({
  accountId,
  project,
  save,
  busy,
}: {
  accountId: string;
  project: Project;
  save: Save;
  busy: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const draft = useFormDraft(formRef, accountId, `requests:${project.id}`);
  return (
    <form
      ref={formRef}
      onInput={draft.capture}
      onChange={draft.capture}
      className="portal-form"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        draft.capture();
        if (
          await save(
            `/v1/projects/${project.id}/requests`,
            { ...data(event), version: project.version },
            "Request saved.",
          )
        ) {
          form.reset();
          draft.clear();
        }
      }}
    >
      <div className="portal-form-row">
        <label>
          Request type
          <select name="kind" defaultValue="ISSUE">
            {[
              ["ISSUE", "Issue / bug"],
              ["FEATURE", "Feature request"],
              ["SUGGESTION", "Suggestion"],
              ["PRD", "PRD / requirements"],
              ["QUESTION", "Question / scope change"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            name="title"
            minLength={3}
            maxLength={160}
            required
            placeholder="For example, add recurring bookings"
          />
        </label>
      </div>
      <label>
        Details
        <textarea
          name="detail"
          minLength={10}
          maxLength={20000}
          rows={5}
          required
          placeholder="Describe the goal, requirements, or steps to reproduce the issue. You can paste PRD text here."
        />
      </label>
      <label>
        Reference link <span className="portal-muted">(optional)</span>
        <input
          name="referenceUrl"
          type="url"
          maxLength={500}
          placeholder="https://"
        />
      </label>
      <p className="portal-muted">
        Links are saved for our review. We don’t fetch them automatically. New
        requests need review before they become part of agreed scope.
      </p>
      {["BUILDING", "VERIFYING", "COMPLETE"].includes(project.stage) && (
        <p className="portal-notice">
          Additional work is scoped separately as a follow-on project. Your
          current scope and progress stay as agreed.
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "Saving…" : "Add request"}
      </button>
    </form>
  );
}

export function OperatorForms({
  accountId,
  project,
  save,
  busy,
}: {
  accountId: string;
  project: Project;
  save: Save;
  busy: boolean;
}) {
  const [tab, setTab] = useState<"review" | "proposal" | "progress">("review");
  const prefix = `/v1/operator/projects/${project.id}`;
  const operatorFormRef = useRef<HTMLFormElement>(null);
  const operatorDraft = useFormDraft(
    operatorFormRef,
    accountId,
    `operator:${project.id}:${tab}`,
  );
  return (
    <section id="operator-tools" className="portal-card operator-tools">
      <p className="portal-kicker">PROJECT TEAM</p>
      <h2>Keep the customer in the loop.</h2>
      <div className="portal-tabs" aria-label="Team actions">
        {["review", "proposal", "progress"].map((value) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            aria-pressed={tab === value}
            onClick={() => setTab(value as typeof tab)}
          >
            {value === "review"
              ? "Our review"
              : value === "proposal"
                ? "Scope & estimate"
                : "Progress update"}
          </button>
        ))}
      </div>
      {tab === "review" && (
        <form
          ref={operatorFormRef}
          onInput={operatorDraft.capture}
          onChange={operatorDraft.capture}
          className="portal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const saved = await save(
              `${prefix}/review`,
              { ...data(event), version: project.version },
              "Review published.",
            );
            if (saved) operatorDraft.clear();
          }}
        >
          <label>
            Review summary
            <textarea
              name="summary"
              rows={6}
              minLength={20}
              maxLength={5000}
              defaultValue={project.reviewSummary ?? ""}
              required
              placeholder="What exists, what needs verification, and the recommended next step."
            />
          </label>
          <p className="portal-muted">
            Published reviews are visible to the customer. Review after
            submission, before development begins.
          </p>
          <button className="button" disabled={busy}>
            Publish review
          </button>
        </form>
      )}
      {tab === "proposal" && (
        <form
          ref={operatorFormRef}
          onInput={operatorDraft.capture}
          onChange={operatorDraft.capture}
          className="portal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = data(event);
            const amount = Number(values.amount);
            const cents = Math.round(amount * 100);
            const mode = values.paymentMode;
            const paymentPlan =
              mode === "CUSTOM"
                ? Array.from({ length: 6 }, (_, i) => ({
                    label: values[`paymentLabel${i}`],
                    amountCents: Math.round(
                      Number(values[`paymentAmount${i}`]) * 100,
                    ),
                    dueWhen: values[`paymentGate${i}`],
                  })).filter((row) => row.label || row.amountCents)
                : mode === "DEPOSIT_FINAL"
                  ? [
                      {
                        label: "Deposit",
                        amountCents: Math.floor(cents / 2),
                        dueWhen: "BEFORE_BUILD",
                      },
                      {
                        label: "Final payment",
                        amountCents: cents - Math.floor(cents / 2),
                        dueWhen: "BEFORE_HANDOVER",
                      },
                    ]
                  : mode === "THREE_STAGES"
                    ? [
                        {
                          label: "Deposit",
                          amountCents: Math.floor(cents * 0.4),
                          dueWhen: "BEFORE_BUILD",
                        },
                        {
                          label: "Build checkpoint",
                          amountCents: Math.floor(cents * 0.4),
                          dueWhen: "BEFORE_VERIFY",
                        },
                        {
                          label: "Final payment",
                          amountCents: cents - 2 * Math.floor(cents * 0.4),
                          dueWhen: "BEFORE_HANDOVER",
                        },
                      ]
                    : undefined;
            if (
              await save(
                `${prefix}/proposals`,
                {
                  version: project.version,
                  scope: values.scope,
                  acceptance: values.acceptance,
                  amountCents: Math.round(amount * 100),
                  currency: values.currency,
                  deliveryDate: values.deliveryDate,
                  assumptions: values.assumptions,
                  ...(paymentPlan ? { paymentPlan } : {}),
                },
                "Proposal published. Customer approval is required.",
              )
            ) {
              form.reset();
              operatorDraft.clear();
            }
          }}
        >
          {!project.reviewSummary && (
            <p className="portal-notice">
              Publish the review first. Cost and delivery should follow the
              agreed scope and available evidence.
            </p>
          )}
          <label>
            Proposed scope
            <textarea
              name="scope"
              rows={4}
              minLength={20}
              maxLength={5000}
              required
            />
          </label>
          <label>
            Acceptance checks
            <textarea
              name="acceptance"
              rows={3}
              minLength={20}
              maxLength={3000}
              required
              placeholder="How we’ll demonstrate that the agreed work is complete."
            />
          </label>
          <div className="portal-form-row">
            <label>
              Project cost
              <input
                name="amount"
                type="number"
                min="1"
                max="1000000"
                step="0.01"
                required
              />
            </label>
            <label>
              Currency
              <select name="currency">
                {["USD", "EUR", "GBP", "CAD", "AUD"].map((currency) => (
                  <option key={currency}>{currency}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Payment schedule
            <select name="paymentMode" defaultValue="UPFRONT">
              <option value="UPFRONT">Full payment upfront</option>
              <option value="DEPOSIT_FINAL">
                50% deposit + 50% before handover
              </option>
              <option value="THREE_STAGES">
                40% deposit + 40% build + 20% handover
              </option>
              <option value="CUSTOM">Custom installments</option>
            </select>
          </label>
          <details className="custom-payment-plan">
            <summary>Custom payment installments</summary>
            <p className="portal-muted">
              Choose Custom installments above to use these rows. Leave unused
              rows empty. Amounts must total the project cost, with at least one
              currency unit per installment.
            </p>
            {Array.from({ length: 6 }, (_, i) => (
              <div className="custom-installment" key={i}>
                <label>
                  Installment {i + 1} label
                  <input name={`paymentLabel${i}`} maxLength={80} />
                </label>
                <div className="portal-form-row">
                  <label>
                    Installment {i + 1} amount
                    <input
                      name={`paymentAmount${i}`}
                      type="number"
                      min="1"
                      max="1000000"
                      step="0.01"
                    />
                  </label>
                  <label>
                    Installment {i + 1} due
                    <select
                      name={`paymentGate${i}`}
                      defaultValue={
                        i === 0 ? "BEFORE_BUILD" : "BEFORE_HANDOVER"
                      }
                    >
                      <option value="BEFORE_BUILD">Before building</option>
                      <option value="BEFORE_VERIFY">Before verification</option>
                      <option value="BEFORE_HANDOVER">Before handover</option>
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </details>
          <label>
            Estimated delivery date
            <input
              name="deliveryDate"
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              required
            />
          </label>
          <label>
            Assumptions & conditions
            <textarea
              name="assumptions"
              minLength={20}
              maxLength={3000}
              rows={3}
              required
              placeholder="Start date, access, customer feedback, external dependencies, and what the cost includes."
            />
          </label>
          <p className="portal-muted">
            A revision creates a new proposal and requires fresh approval.
            Payment installments follow this approved version.
          </p>
          <button className="button" disabled={busy || !project.reviewSummary}>
            Publish new proposal
          </button>
        </form>
      )}
      {tab === "progress" && (
        <form
          ref={operatorFormRef}
          onInput={operatorDraft.capture}
          onChange={operatorDraft.capture}
          className="portal-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const values = data(event);
            if (
              await save(
                `${prefix}/progress`,
                {
                  version: project.version,
                  stage: values.stage,
                  title: values.title,
                  detail: values.detail,
                  ...(values.verificationSummary
                    ? { verificationSummary: values.verificationSummary }
                    : {}),
                },
                "Progress update published.",
              )
            ) {
              form.reset();
              operatorDraft.clear();
            }
          }}
        >
          <label>
            Project stage
            <select name="stage" defaultValue={project.stage}>
              {Object.entries(stageLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Update title
            <input name="title" minLength={3} maxLength={160} required />
          </label>
          <label>
            What changed / what happens next
            <textarea
              name="detail"
              rows={4}
              minLength={10}
              maxLength={5000}
              required
            />
          </label>
          <label>
            Verification & handover evidence{" "}
            <span className="portal-muted">(required to complete)</span>
            <textarea
              name="verificationSummary"
              rows={3}
              minLength={20}
              maxLength={5000}
              placeholder="Checks performed, their results, and where to find the handover."
            />
          </label>
          <p className="portal-muted">
            Work begins after scope approval and its agreed payment. Move from
            building to verification before completing the project.
          </p>
          <button className="button" disabled={busy}>
            Publish update
          </button>
        </form>
      )}
    </section>
  );
}
