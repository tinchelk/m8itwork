"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3121";
const workflows = [
  "Login & permissions",
  "Payments",
  "Data & dashboards",
  "External integrations",
  "Build & launch",
  "New features",
  "Other",
];
interface Report {
  id: string;
  repository: string;
  url: string;
  branch: string;
  commit: string;
  stack: string[];
  fileCount: number;
  complete: boolean;
  evidence: {
    title: string;
    detail: string;
    paths: string[];
    kind: "observed" | "verify";
  }[];
  limitations: string[];
  nextSteps: string[];
  assessmentEffort: {
    minDays: number;
    maxDays: number;
    confidence: string;
    basis: string;
  };
}
interface Session {
  connectEnabled: boolean;
  installUrl: string | null;
  githubLogin: string | null;
  truncated: boolean;
  connectionError: string | null;
  repositories: { name: string; url: string; private: boolean }[];
  inspection: Report | null;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      credentials: "include",
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error(
      "The review service is unavailable. Your information is still here; please try again.",
    );
  }
  const result = (await response.json()) as {
    error?: { message?: string };
  } & T;
  if (!response.ok)
    throw new Error(
      result.error?.message ??
        "We couldn't complete that request. Please try again.",
    );
  return result;
}
const DRAFT_KEY = "m8itwork-brief-v1";
const WORKFLOW_REQUIRED = "Choose at least one workflow you need help with.";

export function Intake() {
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [repoUrl, setRepoUrl] = useState("");
  const [busy, setBusy] = useState<"inspect" | "submit" | "connection" | null>(
    null,
  );
  const [scanError, setScanError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    id: string;
    message: string;
  } | null>(null);
  const brief = useRef<HTMLFormElement>(null);
  const reportTitle = useRef<HTMLHeadingElement>(null);
  const successTitle = useRef<HTMLHeadingElement>(null);
  const workflowGroup = useRef<HTMLFieldSetElement>(null);

  async function loadSession() {
    setConnectionError(null);
    try {
      const result = await request<Session>("/v1/session");
      setSession(result);
      setConnectionError(result.connectionError);
    } catch (error) {
      setConnectionError((error as Error).message);
    }
  }
  useEffect(() => {
    let ignore = false;
    const params = new URLSearchParams(window.location.search);
    const callbackError =
      params.get("github") === "error"
        ? "GitHub connection wasn't completed. Please connect again, or use a public repository link."
        : null;
    void request<Session>("/v1/session")
      .then((result) => {
        if (ignore) return;
        setSession(result);
        setConnectionError(result.connectionError ?? callbackError);
        if (result.inspection) {
          setReport(result.inspection);
          setRepoUrl(result.inspection.url);
        }
      })
      .catch((error: Error) => {
        if (!ignore) setConnectionError(error.message);
      });
    if (params.has("github"))
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}#review`,
      );
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as {
          expires: number;
          values: Record<string, string[]>;
        };
        if (draft.expires > Date.now() && brief.current)
          for (const element of Array.from(brief.current.elements)) {
            if (
              element instanceof HTMLInputElement ||
              element instanceof HTMLTextAreaElement ||
              element instanceof HTMLSelectElement
            ) {
              const values = draft.values[element.name];
              if (values && element.name !== "consent") {
                if (
                  element instanceof HTMLInputElement &&
                  element.type === "checkbox"
                )
                  element.checked = values.includes(element.value);
                else element.value = values[0] ?? "";
              }
            }
          }
        sessionStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* Browser storage is optional. */
    }
    return () => {
      ignore = true;
    };
  }, []);
  useEffect(() => {
    if (success) successTitle.current?.focus();
  }, [success]);

  function saveDraft() {
    if (!brief.current) return;
    const values: Record<string, string[]> = {};
    for (const [key, value] of new FormData(brief.current)) {
      if (typeof value === "string" && key !== "consent")
        (values[key] ??= []).push(value);
    }
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ expires: Date.now() + 24 * 60 * 60_000, values }),
      );
    } catch {
      /* Browser storage is optional. */
    }
  }
  async function clearSavedInspection(id: string) {
    setSelectionBusy(true);
    try {
      await request("/v1/inspection-selection/remove", { inspectionId: id });
    } catch (error) {
      setScanError(
        `The saved selection could not be cleared. ${(error as Error).message}`,
      );
    } finally {
      setSelectionBusy(false);
    }
  }
  function changeRepository(value: string) {
    setRepoUrl(value);
    if (report) {
      setReport(null);
      void clearSavedInspection(report.id);
    }
  }
  async function removeInspection() {
    if (!report) return;
    const id = report.id;
    setReport(null);
    await clearSavedInspection(id);
  }
  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("inspect");
    setScanError(null);
    // A new attempt must not leave the old repository attached to the brief.
    const previous = report;
    setReport(null);
    try {
      if (previous)
        await request("/v1/inspection-selection/remove", {
          inspectionId: previous.id,
        });
      const result = await request<Report>("/v1/github/inspect", {
        repositoryUrl: repoUrl.trim(),
      });
      setReport(result);
      requestAnimationFrame(() => reportTitle.current?.focus());
    } catch (error) {
      setScanError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function disconnect() {
    setBusy("connection");
    setConnectionError(null);
    try {
      await request("/v1/github/disconnect", {});
      await loadSession();
    } catch (error) {
      setConnectionError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const values = new FormData(event.currentTarget);
    const selected = values.getAll("workflows");
    if (!selected.length) {
      setFormError(WORKFLOW_REQUIRED);
      workflowGroup.current?.focus();
      return;
    }
    setBusy("submit");
    try {
      const result = await request<{ id: string; message: string }>(
        "/v1/intakes",
        {
          name: values.get("name"),
          email: values.get("email"),
          projectName: values.get("projectName"),
          platform: values.get("platform"),
          demoUrl: values.get("demoUrl"),
          problem: values.get("problem"),
          workflows: selected,
          consent: values.get("consent") === "on",
          ...(report ? { inspectionId: report.id } : {}),
        },
      );
      setSuccess(result);
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* Browser storage is optional. */
      }
    } catch (error) {
      setFormError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }
  if (success)
    return (
      <div className="intake-card success-card">
        <span className="success-check" aria-hidden="true">
          ✓
        </span>
        <p className="eyebrow">BRIEF RECEIVED</p>
        <h3 ref={successTitle} tabIndex={-1}>
          You’ve taken the next step.
        </h3>
        <p>{success.message}</p>
        <p className="quiet">
          No payment has been taken and no development work has started. We’ll
          agree on a scope first.
        </p>
        <p className="reference mono">Reference: {success.id}</p>
        <button
          className="text-button"
          onClick={() => {
            setSuccess(null);
            setReport(null);
            setRepoUrl("");
          }}
        >
          Send another project <span aria-hidden="true">↗</span>
        </button>
      </div>
    );
  return (
    <div className="intake-card">
      <div className="form-step">
        <span>01</span>
        <div>
          <h3>Give us a look inside.</h3>
          <p>
            Connect GitHub or paste a public repository link. No exported code?
            Go straight to your brief below.
          </p>
        </div>
      </div>
      <div className="github-panel">
        {session?.githubLogin ? (
          <div className="connection-row">
            <span>
              <span className="live-dot" /> Connected as{" "}
              <b>{session.githubLogin}</b>
            </span>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          </div>
        ) : session?.connectEnabled ? (
          <>
            <a
              className="button github-button"
              href={`${API}/v1/github/connect`}
              onClick={saveDraft}
            >
              Connect GitHub <span aria-hidden="true">↗</span>
            </a>
            <p className="quiet">
              Read-only access. You choose the repositories to share.
            </p>
          </>
        ) : (
          <p className="quiet">
            Public repo inspection is available now. For private repos, send
            your demo and we’ll arrange read-only access during the pilot.
          </p>
        )}
        {connectionError && (
          <div className="error" role="alert">
            <p>{connectionError}</p>
            <button
              className="text-button"
              disabled={Boolean(busy)}
              onClick={() => void loadSession()}
            >
              Retry connection status
            </button>
          </div>
        )}
        {session?.githubLogin &&
          !session.repositories.length &&
          session.installUrl && (
            <p className="quiet">
              No shared repositories yet.{" "}
              <a href={session.installUrl} target="_blank" rel="noreferrer">
                Choose repositories in GitHub
              </a>
              , then{" "}
              <button
                className="inline-button"
                onClick={() => void loadSession()}
              >
                refresh this list
              </button>
              .
            </p>
          )}
        <form
          onSubmit={(event) => void inspect(event)}
          aria-busy={busy === "inspect"}
        >
          {session && session.repositories.length > 0 && (
            <label>
              Choose a connected repository
              <select
                value={
                  session.repositories.some((repo) => repo.url === repoUrl)
                    ? repoUrl
                    : ""
                }
                disabled={Boolean(busy)}
                onChange={(event) => {
                  changeRepository(event.target.value);
                }}
              >
                <option value="">Choose a repository</option>
                {session.repositories.map((repo) => (
                  <option key={repo.name} value={repo.url}>
                    {repo.name}
                    {repo.private ? " · private" : " · public"}
                  </option>
                ))}
              </select>
            </label>
          )}
          {session?.truncated && (
            <p className="quiet">
              Showing a limited repository list. Paste the link if yours isn’t
              listed.
            </p>
          )}
          <label htmlFor="repositoryUrl">
            GitHub repository link
            <input
              id="repositoryUrl"
              name="repositoryUrl"
              type="url"
              placeholder="https://github.com/you/your-app"
              value={repoUrl}
              onChange={(event) => {
                changeRepository(event.target.value);
              }}
              required
              maxLength={500}
              disabled={Boolean(busy)}
            />
          </label>
          <button
            className="button outline"
            type="submit"
            disabled={Boolean(busy) || selectionBusy}
          >
            {busy === "inspect"
              ? "Inspecting the repository…"
              : "Inspect repository"}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="quiet">
            We inspect file structure and package setup. We don’t execute code
            or collect secret files.
          </p>
          {scanError && (
            <p className="error" role="alert">
              {scanError}
            </p>
          )}
        </form>
      </div>
      {report && (
        <section className="inspection" aria-labelledby="inspection-title">
          <div className="report-head">
            <p className="eyebrow">INITIAL REPOSITORY REVIEW</p>
            <span className="report-badge">Static inspection</span>
          </div>
          <h4 id="inspection-title" ref={reportTitle} tabIndex={-1}>
            {report.repository}
          </h4>
          <p className="quiet mono">
            {report.branch} · {report.commit.slice(0, 7)} · {report.fileCount}{" "}
            files in sample
          </p>
          {!report.complete && (
            <p className="sample-notice">
              Partial file inventory. Some paths are outside this scan’s limits;
              review the limitations below before using these findings.
            </p>
          )}
          <div className="stack-tags">
            {report.stack.map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="effort">
            <span>Assessment allowance</span>
            <b>
              {report.assessmentEffort.minDays}–
              {report.assessmentEffort.maxDays} working days
            </b>
            <p>
              Low confidence · human review effort. Project ETA needs workflow
              review.
            </p>
          </div>
          <p className="quiet">{report.assessmentEffort.basis}</p>
          <div className="evidence">
            {report.evidence.map((item) => (
              <details key={item.title}>
                <summary>
                  <span
                    className={
                      item.kind === "observed"
                        ? "evidence-found"
                        : "evidence-check"
                    }
                    aria-hidden="true"
                  >
                    {item.kind === "observed" ? "↳" : "?"}
                  </span>
                  {item.title}
                  <span className="quiet">
                    {item.kind === "observed"
                      ? "Evidence found"
                      : "Needs a check"}
                  </span>
                </summary>
                <p>{item.detail}</p>
                {item.paths.map((path) => (
                  <a
                    className="evidence-path mono"
                    key={path}
                    href={`${report.url}/blob/${report.commit}/${path.split("/").map(encodeURIComponent).join("/")}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {path} ↗
                  </a>
                ))}
              </details>
            ))}
          </div>
          <details className="limitations">
            <summary>What this review can and can’t tell us</summary>
            <ul>
              {report.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </details>
          <div className="next-checks">
            <h5>To turn this into a project estimate</h5>
            <ol>
              {report.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
          <button
            className="text-button"
            type="button"
            disabled={Boolean(busy) || selectionBusy}
            onClick={() => void removeInspection()}
          >
            Remove inspection from this brief
          </button>
        </section>
      )}
      <div className="form-step brief-step">
        <span>02</span>
        <div>
          <h3>Tell us what comes next.</h3>
          <p>Describe what needs fixing or the feature you want to add.</p>
        </div>
      </div>
      <form
        ref={brief}
        onSubmit={(event) => void submit(event)}
        className="brief-form"
        aria-busy={busy === "submit"}
      >
        <fieldset disabled={Boolean(busy) || selectionBusy}>
          <legend className="sr-only">Your project brief</legend>
          <div className="field-grid">
            <label>
              Your name
              <input name="name" autoComplete="name" required maxLength={100} />
            </label>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          </div>
          <div className="field-grid">
            <label>
              App or project name
              <input name="projectName" required maxLength={120} />
            </label>
            <label>
              Started with
              <select name="platform" required defaultValue="">
                <option value="" disabled>
                  Choose a tool
                </option>
                {["Lovable", "Base44", "Bolt", "Replit", "Other"].map(
                  (platform) => (
                    <option key={platform}>{platform}</option>
                  ),
                )}
              </select>
            </label>
          </div>
          <label>
            Demo link <span className="optional">(optional)</span>
            <input
              name="demoUrl"
              type="url"
              placeholder="https://your-app.com"
              maxLength={500}
            />
          </label>
          <fieldset
            className="workflow-options"
            ref={workflowGroup}
            tabIndex={-1}
            aria-invalid={formError === WORKFLOW_REQUIRED}
            aria-describedby={
              formError === WORKFLOW_REQUIRED ? "workflow-error" : undefined
            }
            onChange={() => {
              if (formError === WORKFLOW_REQUIRED) setFormError(null);
            }}
          >
            <legend>What needs help? (choose at least one)</legend>
            {formError === WORKFLOW_REQUIRED && (
              <p
                id="workflow-error"
                className="error workflow-error"
                role="alert"
              >
                {formError}
              </p>
            )}
            <div>
              {workflows.map((workflow) => (
                <label key={workflow}>
                  <input type="checkbox" name="workflows" value={workflow} />
                  {workflow}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            What would you like to fix or add?
            <textarea
              name="problem"
              required
              minLength={20}
              maxLength={5000}
              placeholder="Example: Checkout returns customers to the home page without recording payment. We also want to add team plans and connect our CRM."
            />
          </label>
          <p className="quiet">
            Describe the goal or steps to reproduce the problem. Leave out
            passwords, API keys, and customer data.
          </p>
          <label className="consent">
            <input type="checkbox" name="consent" required />
            <span>
              I’m authorized to share this project and agree to the{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                privacy & access terms
              </a>{" "}
              for reviewing my brief.
            </span>
          </label>
          {report && (
            <p className="attached">
              ↳ Inspection attached: <b>{report.repository}</b>
            </p>
          )}
          {formError && formError !== WORKFLOW_REQUIRED && (
            <p className="error" role="alert">
              {formError}
            </p>
          )}
          <button className="button submit-button" type="submit">
            {busy === "submit"
              ? "Saving your brief…"
              : "Send my app for review"}
            <span aria-hidden="true">↗</span>
          </button>
          <p className="quiet">
            A free first look at fit. We’ll agree on any paid assessment or
            development before starting.
          </p>
        </fieldset>
      </form>
    </div>
  );
}
