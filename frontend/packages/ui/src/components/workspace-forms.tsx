"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Connection, Inventory, Project } from "./workspace-types";
import { API, api, stageLabels, WorkspaceError } from "./workspace-types";
import { ReviewAssistant, reviewText, type ReviewReport } from "./review-assistant";
import { markNewProjectReturn, useFormDraft } from "./workspace-drafts";
import { SelectField } from "./form-controls";
import { DateField } from "./date-field";
import { RESTORE_FIELD } from "./field-events";

export type Save = (
  path: string,
  data: unknown,
  message: string,
  onFailure?: (error: unknown) => void,
) => Promise<boolean>;
const data = (event: FormEvent<HTMLFormElement>) =>
  Object.fromEntries(new FormData(event.currentTarget));

export function NewProjectForm({
  accountId, save, busy, setWorking, onError,
}: {
  accountId: string;
  save: Save;
  busy: boolean;
  setWorking: (working: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const draft = useFormDraft(formRef, accountId, "new-project-v2", connection);
  useEffect(() => {
    let ignore = false;
    void api<Connection>("/v1/session").then(result => {
      if (!ignore) {
        setConnection(result);
        setConnectionError(result.connectionError);
      }
    }).catch(error => {
      if (!ignore) setConnectionError(error.message);
    }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; };
  }, [accountId]);

  async function refreshRepositories() {
    draft.capture();
    setLoading(true);
    setConnectionError(null);
    setRefreshNotice("Checking GitHub connection…");
    try {
      const result = await api<Connection>("/v1/session");
      setConnection(result);
      setConnectionError(result.connectionError);
      setRefreshNotice(result.connectionError ? null : result.githubLogin
        ? "Repository list refreshed."
        : result.connectEnabled
          ? "GitHub isn’t connected yet. Use Connect GitHub to authorize repository access."
          : "GitHub connection is being set up. Please try again later.");
    } catch (error) {
      setConnectionError((error as Error).message);
      setRefreshNotice(null);
    } finally { setLoading(false); }
  }
  function connect() {
    draft.capture();
    markNewProjectReturn(accountId);
  }
  const connected = Boolean(connection?.githubLogin);
  const ready = connected && !connectionError && !loading;
  return (
    <form
      ref={formRef}
      onInput={draft.capture}
      onChange={draft.capture}
      className="portal-form simple-project-form"
      onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = data(event);
        const repositoryUrl = String(values.repositoryUrl || values.repositoryLink || "").trim();
        if (!ready) return;
        if (!repositoryUrl) {
          setFormError("Choose a repository or paste its GitHub link.");
          const link = form.elements.namedItem("repositoryLink") as HTMLInputElement | null;
          const details = link?.closest("details");
          if (details) details.open = true;
          link?.focus();
          return;
        }
        setFormError(null);
        const idField = form.elements.namedItem("draftRequestId") as HTMLInputElement;
        idField.value ||= crypto.randomUUID();
        draft.capture();
        setChecking(true);
        setWorking(true);
        try {
          const report = await api<Inventory & { id: string }>("/v1/github/inspect", { repositoryUrl });
          setChecking(false);
          if (await save("/v1/projects", {
            id: idField.value,
            inspectionId: report.id,
            reviewConsent: "ai-review-v1",
            summary: values.summary,
            consent: true,
          }, "Request sent. We’ll review your repository and what you want next.")) {
            draft.clear();
          } else await refreshRepositories();
        } catch (error) {
          if (error instanceof WorkspaceError && error.code === "GITHUB_RECONNECT")
            setConnectionError(error.message);
          else onError(error);
        } finally {
          setChecking(false);
          setWorking(false);
        }
      }}
    >
      <input type="hidden" name="draftRequestId" />
      <div className="project-repository-step">
        <p className="portal-kicker">01 / YOUR REPOSITORY</p>
        {loading || refreshNotice ? <p className="portal-muted" role="status">{refreshNotice || "Loading GitHub connection…"}</p> : null}
        {connected ? (
          <p className="portal-muted">Connected as <strong>@{connection!.githubLogin}</strong></p>
        ) : null}
        {!loading && (!connected || connectionError) ? (
          connection?.connectEnabled ? <a className="button outline" href={`${API}/v1/github/connect?flow=repositories`} onClick={connect}>
            {connected ? "Reconnect GitHub" : "Connect GitHub"} <span aria-hidden="true">↗</span>
          </a> : connection ? <p className="portal-notice">GitHub connection is being set up. Please try again later.</p> : null
        ) : null}
        {!connected ? <p className="portal-muted">Read-only access. You choose which repositories to share.</p> : null}
        {connectionError ? <p className="portal-error" role="alert">{connectionError}</p> : null}
        {connected && !loading && !connection!.repositories.length && !connectionError ? <p className="portal-notice">No repositories shared yet. Choose your app in GitHub, then refresh below.</p> : null}
        {connected && Boolean(connection?.repositories.length) ? <div>
          <label htmlFor="project-repository">GitHub repository</label>
          <SelectField id="project-repository" name="repositoryUrl" aria-label="GitHub repository" defaultValue="" placeholder="Choose your app’s repository" repository required={!connection?.truncated} disabled={busy || !ready || !connection?.repositories.length} onValueChange={() => {
            const link = formRef.current?.elements.namedItem("repositoryLink") as HTMLInputElement | null;
            if (link) link.value = "";
            setFormError(null);
          }} options={connection!.repositories.map(repo => ({ value: repo.url, label: repo.name, detail: repo.private ? "private" : "public" }))} />
        </div> : null}
        {connected ? <div className="project-repository-actions">
          {connection?.installUrl ? <a href={connection.installUrl} target="_blank" rel="noopener noreferrer" onClick={draft.capture}>Choose repositories in GitHub ↗</a> : null}
          <button type="button" className="portal-plain" disabled={busy || loading} onClick={() => void refreshRepositories()}>Refresh repositories</button>
        </div> : <button type="button" className="portal-plain" disabled={busy || loading} onClick={() => void refreshRepositories()}>Refresh connection</button>}
        {connected && connection?.truncated ? <details>
          <summary>Repository not listed?</summary>
          <label>GitHub repository link<input name="repositoryLink" type="url" autoComplete="off" spellCheck={false} maxLength={500} placeholder="https://github.com/you/your-app" disabled={busy || !ready} aria-invalid={Boolean(formError)} aria-describedby={formError ? "repository-choice-error" : undefined} onChange={event => {
            const field = event.currentTarget.form?.elements.namedItem("repositoryUrl") as HTMLInputElement | null;
            if (field && event.currentTarget.value.trim()) field.dispatchEvent(new CustomEvent(RESTORE_FIELD, { detail: "" }));
            setFormError(null);
          }} /></label>
          <p className="portal-muted">Only repositories shared with the App can be read.</p>
        </details> : null}
      </div>
      <div>
        <p className="portal-kicker">02 / WHAT’S NEXT</p>
        <label htmlFor="project-request">How can we help move it forward?</label>
        <textarea id="project-request" name="summary" required minLength={10} maxLength={5000} rows={5} disabled={busy}
          placeholder="What do you want to fix, add, or improve? Tell us in your own words." />
      </div>
      {formError ? <p id="repository-choice-error" role="alert" className="portal-error">{formError}</p> : null}
      <button className="button" disabled={busy || !ready || !connection?.repositories.length && !connection?.truncated}>
        {checking ? "Checking repository…" : busy ? "Sending…" : "Send for review"} <span aria-hidden="true">↗</span>
      </button>
      <p className="portal-muted project-submit-note">By sending, you authorize read-only, AI-assisted review using OpenAI or Anthropic under our <a href="/privacy" target="_blank" rel="noopener noreferrer">privacy & access terms</a>. Any paid work is agreed separately.</p>
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
          <SelectField name="kind" aria-label="Request type" defaultValue="ISSUE" options={[
              ["ISSUE", "Issue / bug"],
              ["FEATURE", "Feature request"],
              ["SUGGESTION", "Suggestion"],
              ["PRD", "PRD / requirements"],
              ["QUESTION", "Question / scope change"],
            ].map(([value, label]) => ({ value: value!, label: label! }))} />
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
          type="url" autoComplete="off" spellCheck={false}
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
  const [pendingImport, setPendingImport] = useState<{ report: ReviewReport; target: "review" | "proposal" } | null>(null);
  const [importNotice, setImportNotice] = useState("");
  const prefix = `/v1/operator/projects/${project.id}`;
  const operatorFormRef = useRef<HTMLFormElement>(null);
  const operatorDraft = useFormDraft(
    operatorFormRef,
    accountId,
    `operator:${project.id}:${tab}`,
  );
  useEffect(() => {
    if (!pendingImport || !operatorFormRef.current || tab !== pendingImport.target) return;
    const r = pendingImport.report;
    const values = pendingImport.target === "review" ? { summary: reviewText(r) } : { scope: r.scope, acceptance: r.acceptance, assumptions: r.assumptions };
    const entries = Object.entries(values).map(([name, value]) => ({ field: operatorFormRef.current!.elements.namedItem(name) as HTMLTextAreaElement, value }));
    if (entries.some(({ field, value }) => (field.value ? field.value + "\n\n" + value : value).length > field.maxLength)) {
      // Explicit user import: preserve the complete existing draft when there is no room.
      setImportNotice("There isn’t room to append the full draft. Shorten your current form, then add it again.");
    } else {
      for (const { field, value } of entries) field.value = field.value ? field.value + "\n\n" + value : value;
      operatorDraft.capture();
      setImportNotice("Added to your editable draft below. Check it before publishing.");
      entries[0]?.field.focus();
    }
    setPendingImport(null);
  }, [pendingImport, tab, operatorDraft]);
  return (
    <section id="operator-tools" className="portal-card operator-tools">
      <ReviewAssistant key={`${accountId}:${project.id}`} accountId={accountId} project={project} save={save} busy={busy} onApply={(report, target) => { setTab(target); setPendingImport({ report, target }); }} />
      {importNotice && <p role="status" className="portal-notice">{importNotice}</p>}
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
                type="number" inputMode="decimal"
                min="1"
                max="1000000"
                step="0.01"
                required
              />
            </label>
            <label>
              Currency
              <SelectField name="currency" aria-label="Currency" options={["USD", "EUR", "GBP", "CAD", "AUD"].map(currency => ({ value: currency, label: currency }))} />
            </label>
          </div>
          <label>
            Payment schedule
            <SelectField name="paymentMode" aria-label="Payment schedule" defaultValue="UPFRONT" options={[
              { value: "UPFRONT", label: "Full payment upfront" },
              { value: "DEPOSIT_FINAL", label: "50% deposit + 50% before handover" },
              { value: "THREE_STAGES", label: "40% deposit + 40% build + 20% handover" },
              { value: "CUSTOM", label: "Custom installments" },
            ]} />
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
                      type="number" inputMode="decimal"
                      min="1"
                      max="1000000"
                      step="0.01"
                    />
                  </label>
                  <label>
                    Installment {i + 1} due
                    <SelectField
                      name={`paymentGate${i}`}
                      aria-label={`Installment ${i + 1} due`}
                      defaultValue={
                        i === 0 ? "BEFORE_BUILD" : "BEFORE_HANDOVER"
                      }
                      options={[
                        { value: "BEFORE_BUILD", label: "Before building" },
                        { value: "BEFORE_VERIFY", label: "Before verification" },
                        { value: "BEFORE_HANDOVER", label: "Before handover" },
                      ]}
                    />
                  </label>
                </div>
              </div>
            ))}
          </details>
          <label>
            Estimated delivery date
            <DateField
              name="deliveryDate"
              aria-label="Estimated delivery date"
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
            <SelectField name="stage" aria-label="Project stage" defaultValue={project.stage} options={Object.entries(stageLabels).map(([value, label]) => ({ value, label }))} />
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
