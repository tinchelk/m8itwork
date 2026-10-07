"use client";
import { SelectField } from "./form-controls";
import { WorkerSetup, AiReviewConsent } from "./review-assistant";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  NewProjectForm,
  OperatorForms,
  RequestForm,
  type Save,
} from "./workspace-forms";
import { AdminOverview } from "./admin-overview";
import { CustomerDashboard } from "./customer-dashboard";
import { ProjectConversation } from "./project-conversation";
import {
  ProjectPayments,
  paymentGateLabels,
  requestedPayment,
} from "./project-payments";
import { ProjectDelivery, TeamNotes } from "./project-delivery";
import { markProjectConnectReturn, consumeProjectConnectReturn, clearAccountDrafts, consumeNewProjectReturn, consumeStartProjectIntent, markStartProjectIntent } from "./workspace-drafts";
import {
  API,
  ADMIN_ORIGIN,
  CUSTOMER_ORIGIN,
  WorkspaceError,
  api,
  displayDate,
  money,
  stageLabels,
  type Auth,
  type Connection,
  type Inventory,
  type Project,
  type ProjectListItem,
} from "./workspace-types";
import { CustomerAuthPanel } from "./customer-auth";

const nextActions: Record<string, [string, string]> = {
  DRAFT: [
    "Tell us where you want to go.",
    "Share your demo and requests, or connect a repository. Submit when you’re ready for our review.",
  ],
  IN_REVIEW: [
    "We’re reviewing your next step.",
    "We’ll check the app and your requests, then share our findings before proposing the work.",
  ],
  AWAITING_APPROVAL: [
    "Your proposal is ready.",
    "Review the scope, cost, estimated delivery, and assumptions below. Approve this version or add a request for changes.",
  ],
  APPROVED: [
    "Scope agreed. Let’s get ready to build.",
    "Check the agreed payment plan below. We’ll confirm your payment, access, and start before work begins.",
  ],
  BUILDING: [
    "Your next chapter is taking shape.",
    "Follow the team’s updates below. New requests need review before joining the agreed scope.",
  ],
  VERIFYING: [
    "Checking the important journeys.",
    "We’re verifying the agreed acceptance checks and preparing your handover.",
  ],
  COMPLETE: [
    "Ready for your next chapter.",
    "The verification summary and handover are below. Share any follow-up questions as a request.",
  ],
};

export function Workspace({ admin = false }: { admin?: boolean }) {
  const [auth, setAuth] = useState<Auth | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const team = admin;
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingProject, setLoadingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRequestId, setSavedRequestId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<
    "returned" | "cancelled" | null
  >(null);
  const [repoUrl, setRepoUrl] = useState("");
  const sequence = useRef(0);
  const contentTitle = useRef<HTMLHeadingElement>(null);
  const prefix = team ? "/v1/operator/projects" : "/v1/projects";
  const duePayment = project ? requestedPayment(project) : undefined;

  const failure = useCallback((reason: unknown) => {
    if (!(reason instanceof WorkspaceError && reason.code === "REQUEST_ALREADY_SAVED")) setSavedRequestId(null);
    if (reason instanceof WorkspaceError && reason.status === 401 && reason.code !== "GITHUB_RECONNECT") {
      sequence.current++;
      setAuth((value) => (value ? { ...value, account: null } : value));
      setProject(null);
      setProjects([]);
      setListLoaded(false);
      setConnection(null);
      setCreating(false);
      setLoadingProject(false);
    }
    if (reason instanceof WorkspaceError && reason.status === 403) {
      sequence.current++;
      setProject(null);
      setProjects([]);
      setListLoaded(false);
      setConnection(null);
      setCreating(false);
      setLoadingProject(false);
    }
    setError(
      reason instanceof Error
        ? reason.message
        : "We couldn't load this workspace. Please try again.",
    );
  }, []);
  function remember(id: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("github");
    url.searchParams.delete("google");
    url.searchParams.delete("payment");
    if (id) url.searchParams.set("project", id);
    else url.searchParams.delete("project");
    url.searchParams.delete("view");
    url.searchParams.delete("start");
    window.history.replaceState(null, "", url.pathname + url.search);
  }
  async function selectProject(id: string, teamView = team) {
    const attempt = ++sequence.current;
    setLoadingProject(true);
    setCreating(false);
    setProject(null);
    setError(null);
    setRepoUrl("");
    setPaymentReturn(null);
    remember(id);
    try {
      const [detail, repoConnection] = await Promise.all([
        api<Project>(
          `${teamView ? "/v1/operator/projects" : "/v1/projects"}/${id}`,
        ),
        teamView ? Promise.resolve(null) : api<Connection>("/v1/session"),
      ]);
      if (sequence.current !== attempt) return;
      setProject(detail);
      setConnection(repoConnection);
    } catch (reason) {
      if (sequence.current === attempt) failure(reason);
    } finally {
      if (sequence.current === attempt) {
        setLoadingProject(false);
        contentTitle.current?.focus();
      }
    }
  }
  async function refreshList(teamView: boolean) {
    const result = await api<{ projects: ProjectListItem[] }>(
      teamView ? "/v1/operator/projects" : "/v1/projects",
    );
    setProjects(result.projects);
    setListLoaded(true);
    return result.projects;
  }
  useEffect(() => {
    let ignore = false;
    const requestSequence = sequence;
    const initialSequence = requestSequence.current;
    void api<Auth>("/v1/auth/session")
      .then(async (result) => {
        if (ignore || requestSequence.current !== initialSequence) return;
        setAuth(result);
        const params = new URLSearchParams(window.location.search);
        if (!admin && params.get("start") === "1") markStartProjectIntent();
        if (params.get("github") === "error")
          setError("GitHub authorization wasn’t completed. Please try again.");
        if (params.get("github") === "identity")
          setError(
            "GitHub sign-in linking couldn’t be completed. You can still share repositories with this account using Connect GitHub below.",
          );
        if (!result.account && params.get("github") === "signin-required")
          setError("Your session expired. Sign in again with the same account to return to your saved request, then connect GitHub.");
        if (params.get("google") === "error") setError("Google sign-in wasn’t completed. Please try again.");
        if (params.get("google") === "link") setError("That email already belongs to an account. Sign in with your existing method, then connect Google from Account settings.");
        if (params.get("google") === "verify-email") setError("Create and verify an email account first, then connect Google from Account settings. This Google account cannot confirm current ownership of its email address.");
        if (!result.account || (admin && !result.account.isOperator)) return;
        const teamView = admin;
        const list = await api<{ projects: ProjectListItem[] }>(
          teamView ? "/v1/operator/projects" : "/v1/projects",
        );
        if (ignore || requestSequence.current !== initialSequence) return;
        setProjects(list.projects);
        setListLoaded(true);
        const startAfterSignin = !teamView && consumeStartProjectIntent();
        const newProjectReturn = !teamView && consumeNewProjectReturn(result.account.id);
        const projectReturn = !teamView ? consumeProjectConnectReturn(result.account.id) : null;
        if (!teamView && (startAfterSignin || params.get("start") === "1" || newProjectReturn)) {
          setCreating(true);
          remember(null);
          requestAnimationFrame(() => contentTitle.current?.focus());
          return;
        }
        const selected = params.get("project") ?? projectReturn;
        const first = list.projects.find((item) => item.id === selected);
        if (first) {
          const [detail, repoConnection] = await Promise.all([
            api<Project>(
              `${teamView ? "/v1/operator/projects" : "/v1/projects"}/${first.id}`,
            ),
            teamView ? Promise.resolve(null) : api<Connection>("/v1/session"),
          ]);
          if (!ignore && requestSequence.current === initialSequence) {
            setProject(detail);
            setConnection(repoConnection);
            const returned = params.get("payment");
            if (
              params.get("project") === first.id &&
              (returned === "returned" || returned === "cancelled")
            ) {
              setPaymentReturn(returned);
              requestAnimationFrame(() =>
                document.getElementById("payments")?.scrollIntoView(),
              );
            }
            remember(first.id);
          }
        }
      })
      .catch((reason: unknown) => {
        if (!ignore && requestSequence.current === initialSequence)
          failure(reason);
      })
      .finally(() => {
        if (!ignore) setInitialLoading(false);
      });
    return () => {
      ignore = true;
      requestSequence.current++;
    };
  }, [failure, admin]);

  const save: Save = async (path, data, message, onFailure) => {
    setBusy(true);
    setError(null);
    setSavedRequestId(null);
    setNotice(null);
    try {
      const result = await api<{ id?: string }>(path, data);
      setNotice(message);
      try {
        await refreshList(team);
        if (path === "/v1/projects" && result.id)
          await selectProject(result.id, false);
        else if (project)
          setProject(await api<Project>(`${prefix}/${project.id}`));
      } catch (reason) {
        failure(reason);
        setNotice(
          `${message} The latest view couldn't be refreshed. Use Refresh to update it.`,
        );
      }
      return true;
    } catch (reason) {
      onFailure?.(reason);
      if (reason instanceof WorkspaceError && reason.code === "REQUEST_ALREADY_SAVED" && path === "/v1/projects" && typeof data === "object" && data !== null && "id" in data && typeof data.id === "string")
        setSavedRequestId(data.id);
      failure(reason);
      return false;
    } finally {
      setBusy(false);
    }
  };
  async function refresh() {
    setBusy(true);
    setError(null);
    setNotice("Refreshing workspace…");
    try {
      await refreshList(team);
      if (project) {
        const [detail, repoConnection] = await Promise.all([
          api<Project>(`${prefix}/${project.id}`),
          team ? Promise.resolve(null) : api<Connection>("/v1/session"),
        ]);
        setProject(detail);
        setConnection(repoConnection);
        setNotice(repoConnection
          ? repoConnection.connectionError || (repoConnection.githubLogin
            ? "Repository list refreshed."
            : "GitHub isn’t connected yet. Use Connect GitHub to authorize repository access.")
          : "Project refreshed.");
      } else setNotice("Dashboard refreshed.");
    } catch (reason) {
      setNotice(null);
      failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const report = await api<Inventory & { id: string }>(
        "/v1/github/inspect",
        { repositoryUrl: repoUrl },
      );
      await api(`/v1/projects/${project.id}/repository`, {
        version: project.version,
        inspectionId: report.id,
      });
      setNotice("Repository inventory linked to your project.");
      setProject(await api<Project>(`/v1/projects/${project.id}`));
      await refreshList(false);
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  }
  function startProject() {
    sequence.current++;
    setLoadingProject(false);
    setCreating(true);
    setProject(null);
    setNotice(null);
    setError(null);
    remember(null);
    requestAnimationFrame(() => contentTitle.current?.focus());
  }
  async function openOverview() {
    sequence.current++;
    setLoadingProject(false);
    setProject(null);
    setCreating(false);
    setConnection(null);
    setNotice(null);
    setError(null);
    remember(null);
    setBusy(true);
    try {
      await refreshList(team);
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await api("/v1/auth/logout", {});
      if (auth?.account) clearAccountDrafts(auth.account.id);
      sequence.current++;
      setAuth((value) => (value ? { ...value, account: null } : value));
      setProject(null);
      setProjects([]);
      setListLoaded(false);
      setConnection(null);
      setCreating(false);
      setLoadingProject(false);
      setInitialLoading(false);
      setNotice(null);
      setError(null);
      remember(null);
    } catch (reason) {
      failure(reason);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <a className="skip-link" href="#workspace-main">
        Skip to {admin ? "backoffice" : "dashboard"}
      </a>
      <header className="portal-header">
        <a className="wordmark" href={admin ? CUSTOMER_ORIGIN : "/"} aria-label="m8itwork home">
          <span className="logo-mark">m8</span>itwork
          <span className="logo-dot">.</span>
        </a>
        <span className="portal-header-label">
          {admin ? "BACKOFFICE" : "CUSTOMER DASHBOARD"}
        </span>
        <nav aria-label={admin ? "Backoffice navigation" : "Dashboard navigation"}>
          <a href={admin ? CUSTOMER_ORIGIN : "/"}>Website</a>
          {auth?.account && (
            <>
              <span className="portal-user">{auth.account.githubLogin ? `@${auth.account.githubLogin}` : auth.account.displayName || auth.account.email || "Your account"}</span>
              {!admin && <a className="portal-account-link" href="/account">Account</a>}
              {auth.account.isOperator && (
                <a
                  className="portal-admin-link"
                  href={admin ? `${CUSTOMER_ORIGIN}/dashboard` : `${ADMIN_ORIGIN}/`}
                >
                  {admin ? "Customer dashboard" : "Backoffice"}
                </a>
              )}
              {connection?.githubLogin && (
                <button
                  className="portal-plain"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api("/v1/github/disconnect", {});
                      setConnection(await api<Connection>("/v1/session"));
                      setNotice(
                        "GitHub access disconnected. Your saved project history is retained.",
                      );
                    } catch (reason) {
                      failure(reason);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Disconnect GitHub
                </button>
              )}
              <button
                className="portal-plain"
                onClick={signOut}
                disabled={busy}
              >
                Sign out
              </button>
            </>
          )}
        </nav>
      </header>
      <div className="portal-alerts">
        {error && (
          <p className="portal-error" role="alert">
            {error}
            {savedRequestId ? <a href={`/dashboard?project=${encodeURIComponent(savedRequestId)}`} target="_blank" rel="noopener noreferrer">Open saved request ↗</a> : null}
            {!auth && (
              <button
                className="portal-plain"
                onClick={() => window.location.reload()}
              >
                Try again
              </button>
            )}
          </p>
        )}
        {notice && (
          <p className="portal-notice" role="status">
            {notice}
          </p>
        )}
      </div>
      {initialLoading ? (
        <main id="workspace-main" className="portal-loading">
          <p role="status">Opening your {admin ? "backoffice" : "dashboard"}…</p>
        </main>
      ) : !auth?.account ? (
        <main id="workspace-main" className="portal-login">
          <div>
            <p className="portal-kicker">{admin ? "M8ITWORK BACKOFFICE" : "A CLEAR WAY FORWARD"}</p>
            {admin ? <h1>Make the next<br /><span>app move forward.</span></h1> : <h1>Your app’s next chapter.<br /><span>All in one place.</span></h1>}
            <p className="portal-lead">
              {admin
                ? "Your place to review customer requests, reply, agree the work, and manage delivery."
                : "Bring your repository, ideas, and rough edges. Follow the plan from the first review to a verified handover."}
            </p>
            {!admin && <ol className="portal-login-steps">
              <li>
                <b>01</b>
                <div>
                  <strong>Share & tell us</strong>
                  <span>
                    Connect GitHub and tell us what you want to fix, add, or improve.
                  </span>
                </div>
              </li>
              <li>
                <b>02</b>
                <div>
                  <strong>Review & agree</strong>
                  <span>
                    Our findings, a clear scope, estimated delivery, and cost.
                  </span>
                </div>
              </li>
              <li>
                <b>03</b>
                <div>
                  <strong>Build & verify</strong>
                  <span>
                    Visible updates and checks against the agreed work.
                  </span>
                </div>
              </li>
            </ol>}
          </div>
          {admin ? <section className="portal-card portal-signin">
            <span className="portal-github-icon" aria-hidden="true">
              ↗
            </span>
            <h2>{admin ? "Sign in to the backoffice." : "Let’s get your project moving."}</h2>
            <p>
              {admin ? "Use your approved team GitHub account." : "Sign in with GitHub to open your dashboard and return to your projects."}
            </p>
            {auth?.connectEnabled ? (
              <a
                className="button"
                href={`${API}/v1/github/connect?flow=${admin ? "admin" : "login"}`}
              >
                Continue with GitHub <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <p className="portal-notice">
                {admin ? "Backoffice sign-in is being set up." : <>Customer sign-in is being set up. You can still <a href="/#review">send your app for review</a>.</>}
              </p>
            )}
            <p className="portal-muted">
              {admin ? "Backoffice access is limited to approved team accounts." : "You choose which repositories the read-only App can access. No code changes are made by connecting."}
            </p>
            <p className="portal-muted">
              {admin ? <a href={`${CUSTOMER_ORIGIN}/dashboard`}>Looking for your customer dashboard? ↗</a> : "Starting a project is free. Any paid assessment or development is scoped and agreed separately."}
            </p>
            <a href={`${CUSTOMER_ORIGIN}/privacy`} className="portal-muted">
              Privacy & access terms
            </a>
          </section> : <CustomerAuthPanel config={auth} />}
        </main>
      ) : admin && !auth.account.isOperator ? (
        <main id="workspace-main" className="portal-login">
          <section className="portal-card">
            <h1>The backoffice is for the team.</h1>
            <p>
              Your customer dashboard is ready. Backoffice access is limited to approved team accounts.
            </p>
            <a className="button" href={`${CUSTOMER_ORIGIN}/dashboard`}>
              Open your dashboard ↗
            </a>
          </section>
        </main>
      ) : (
        <div className={`portal-layout ${!team && !project && !creating ? "dashboard-overview" : ""}`}>
          <aside className="portal-sidebar">
            <div className="portal-sidebar-title">
              <h2>{team ? "Team projects" : "Your projects"}</h2>
              {!team && (
                <button
                  className="portal-plus"
                  aria-label="Start a new project"
                  disabled={busy || !listLoaded}
                  onClick={startProject}
                >
                  +
                </button>
              )}
            </div>
              <button
                className="portal-project-link"
                disabled={busy}
                onClick={() => void openOverview()}
              >
                ← {team ? "All customer projects" : "Dashboard"}
              </button>
            <nav aria-label="Projects">
              {projects.map((item) => (
                <button
                  key={item.id}
                  className={`portal-project-link ${project?.id === item.id ? "active" : ""}`}
                  disabled={busy}
                  aria-current={project?.id === item.id ? "page" : undefined}
                  onClick={() => void selectProject(item.id)}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {stageLabels[item.stage] ?? item.stage}
                    {item.account ? ` · ${item.account.displayName || (item.account.githubLogin ? `@${item.account.githubLogin}` : "Customer")}` : ""}
                  </span>
                </button>
              ))}
            </nav>
            {listLoaded && !projects.length && (
              <p className="portal-muted">
                {team
                  ? "Submitted projects will appear here."
                  : "Start your first project to keep everything together."}
              </p>
            )}
            <div className="portal-sidebar-foot">
              <p>
                One scope.
                <br />
                Visible progress.
                <br />
                <span>A better next chapter.</span>
              </p>
            </div>
          </aside>
          <main id="workspace-main" className="portal-content">
            <div className="portal-content-toolbar">
              <span className="portal-kicker">
                {team ? "BACKOFFICE" : "PLAN / BUILD / SHIP"}
              </span>
              <button
                className="portal-plain"
                onClick={refresh}
                disabled={busy || loadingProject}
              >
                {busy ? "Working…" : "Refresh"}{" "}
                <span aria-hidden="true">↻</span>
              </button>
            </div>
            {team && !project && listLoaded && <WorkerSetup />}
            {!listLoaded ? (
              <section className="portal-card">
                <h1>Your projects couldn’t be loaded.</h1>
                <p>Try again to see your saved projects and their latest progress.</p>
                <button className="button" onClick={refresh} disabled={busy}>
                  {busy ? "Loading projects…" : "Try again"}
                </button>
              </section>
            ) : loadingProject ? (
              <p role="status">Opening project…</p>
            ) : creating ? (
              <section className="portal-card">
                <p className="portal-kicker">LET’S MOVE IT FORWARD</p>
                <h1 ref={contentTitle} tabIndex={-1}>
                  Your repo. Your next step.
                </h1>
                <p className="portal-lead">
                  Connect your app and tell us what you want next. We’ll review it and get back to you here.
                </p>
                <NewProjectForm
                  accountId={auth.account.id}
                  save={save}
                  busy={busy}
                  setWorking={setBusy}
                  onError={failure}
                />
              </section>
            ) : project ? (
              <>
                <div className="portal-project-heading">
                  <div>
                    <h1 ref={contentTitle} tabIndex={-1}>
                      {project.name}
                    </h1>
                    <p className="portal-muted">
                      {project.platform} · Updated{" "}
                      {displayDate(project.updatedAt)}
                      {team && project.contactEmail ? ` · ${project.contactEmail}` : ""}
                    </p>
                  </div>
                  <span
                    className={`portal-stage stage-${project.stage.toLowerCase()}`}
                  >
                    {stageLabels[project.stage]}
                  </span>
                </div>
                <ProjectSteps stage={project.stage} />
                <section className="portal-next">
                  <span aria-hidden="true">↗</span>
                  <div>
                    <h2>
                      {requestedPayment(project)
                        ? `${duePayment!.label} needs your attention.`
                        : nextActions[project.stage]?.[0]}
                    </h2>
                    <p>
                      {requestedPayment(project)
                        ? `${money({ amountCents: duePayment!.amountCents, currency: project.proposals.find((p) => p.id === project.currentProposalId)!.currency })} · ${paymentGateLabels[duePayment!.dueWhen]}. Review the payment status and next step below.`
                        : nextActions[project.stage]?.[1]}
                    </p>
                  </div>
                  {project.stage === "DRAFT" && !team && (
                    <button
                      className="button"
                      disabled={
                        busy || (!project.repositoryUrl && !project.demoUrl && !project.accessNote)
                      }
                      onClick={() =>
                        void save(
                          `/v1/projects/${project.id}/submit`,
                          { version: project.version },
                          "Project submitted for our review.",
                        )
                      }
                    >
                      Submit for review
                    </button>
                  )}
                  {project.stage === "AWAITING_APPROVAL" && (
                    <a className="button" href="#proposal">
                      Review proposal <span aria-hidden="true">↓</span>
                    </a>
                  )}
                  {duePayment && (
                    <a className="button" href="#payments">
                      Review payment <span aria-hidden="true">↓</span>
                    </a>
                  )}
                </section>
                <nav
                  className="project-section-nav"
                  aria-label="Project sections"
                >
                  <a href="#conversation">Conversation</a>
                  <a href="#proposal">Scope & estimate</a>
                  <a href="#payments">Payments</a>
                  <a href="#delivery">Delivery</a>
                </nav>
                {team && (
                  <OperatorForms
                    key={project.id}
                    project={project}
                    accountId={auth.account.id}
                    save={save}
                    busy={busy}
                  />
                )}
                {!team && <AiReviewConsent project={project} save={save} busy={busy} />}
                <div className="portal-project-grid">
                  <div className="portal-main-column">
                    <ProjectConversation
                      key={`${auth.account.id}:${project.id}:${team}`}
                      projectId={project.id}
                      accountId={auth.account.id}
                      team={team}
                      onError={failure}
                    />
                    <ProjectDelivery
                      key={`delivery:${project.id}`}
                      project={project}
                      team={team}
                      accountId={auth.account.id}
                      busy={busy}
                      save={save}
                    />
                    <section className="portal-card">
                      <div className="portal-section-heading">
                        <h2>Your head start</h2>
                        <span className="portal-muted">{project.platform}</span>
                      </div>
                      <p className="portal-preserve">{project.summary}</p>
                      {project.demoUrl && (
                        <a
                          href={project.demoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open demo ↗
                        </a>
                      )}
                      {project.accessNote && (
                        <p className="portal-muted portal-preserve">
                          Access notes: {project.accessNote}
                        </p>
                      )}
                      {project.inspectionReport && (
                        <InventoryDetails
                          inventory={project.inspectionReport}
                        />
                      )}
                      {project.stage !== "DRAFT" && !team && project.repositoryUrl && <div className="portal-connect">
                        <h3>Repository access</h3>
                        <p className="portal-muted">{connection?.githubLogin && !connection.connectionError ? `Connected as @${connection.githubLogin}.` : "Reconnect GitHub so we can review your saved repository. Your project and saved commit stay the same."}</p>
                        {connection?.connectionError && <p className="portal-notice">{connection.connectionError}</p>}
                        {connection?.connectEnabled && <div className="portal-connection-actions"><a className="portal-link-button" href={`${API}/v1/github/connect?flow=repositories`} onClick={() => markProjectConnectReturn(auth.account!.id, project.id)}>{connection.githubLogin ? "Reconnect GitHub" : "Connect GitHub"} ↗</a><button className="portal-plain" disabled={busy} onClick={refresh}>Refresh connection</button></div>}
                      </div>}
                      {project.stage === "DRAFT" && !team && (
                        <div className="portal-connect">
                          <h3>
                            {project.repositoryUrl
                              ? "Update repository inventory"
                              : "Connect your repository"}
                          </h3>
                          <p className="portal-muted">
                            Choose the repositories in GitHub, then inspect and
                            link one to this project.
                          </p>
                          {connection?.connectionError && (
                            <p className="portal-error">
                              {connection.connectionError}
                            </p>
                          )}
                          {!connection?.connectEnabled ? (
                            <p className="portal-notice">
                              Private GitHub access is being set up. If your
                              code isn’t available yet, include access
                              constraints when starting the project.
                            </p>
                          ) : (
                            <>
                              <div className="portal-connection-actions">
                                <a
                                  className="portal-link-button"
                                  href={`${API}/v1/github/connect?flow=repositories`}
                                  onClick={() => markProjectConnectReturn(auth.account!.id, project.id)}
                                >
                                  {connection.githubLogin
                                    ? "Reconnect GitHub"
                                    : "Connect GitHub"}{" "}
                                  ↗
                                </a>
                                {connection.installUrl && (
                                  <a
                                    href={connection.installUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    Choose repositories in GitHub ↗
                                  </a>
                                )}
                                <button
                                  className="portal-plain"
                                  disabled={busy}
                                  onClick={refresh}
                                >
                                  Refresh repositories
                                </button>
                              </div>
                              <form className="portal-form" onSubmit={inspect}>
                                {connection.repositories.length > 0 && (
                                  <label>
                                    Available repositories
                                    <SelectField aria-label="Available repositories" value={repoUrl} onValueChange={setRepoUrl} repository placeholder="Choose your app’s repository" options={connection.repositories.map(repo => ({ value: repo.url, label: repo.name, detail: repo.private ? "private" : "public" }))} />
                                  </label>
                                )}
                                <label>
                                  GitHub repository link
                                  <input
                                    type="url" autoComplete="off" spellCheck={false}
                                    required
                                    value={repoUrl}
                                    onChange={(event) =>
                                      setRepoUrl(event.target.value)
                                    }
                                    placeholder="https://github.com/you/your-app"
                                    maxLength={500}
                                  />
                                </label>
                                <button className="button" disabled={busy}>
                                  {busy
                                    ? "Working…"
                                    : "Inspect & link repository"}
                                </button>
                                <p className="portal-muted">
                                  Read-only static inventory. We don’t execute
                                  code or verify workflows in this scan.
                                  {connection.truncated
                                    ? " The list is limited; paste an authorized repository link if it’s missing."
                                    : ""}
                                </p>
                              </form>
                            </>
                          )}
                          {!project.repositoryUrl && (
                            <details>
                              <summary>Review without connecting GitHub</summary>
                              <form
                                className="portal-form"
                                onSubmit={async (event) => {
                                  event.preventDefault();
                                  const values = Object.fromEntries(
                                    new FormData(event.currentTarget),
                                  );
                                  await save(
                                    `/v1/projects/${project.id}/access`,
                                    {
                                      version: project.version,
                                      accessNote: values.accessNote,
                                    },
                                    "Access constraints saved. You can submit for review.",
                                  );
                                }}
                              >
                                <label>
                                  Access constraints
                                  <textarea
                                    name="accessNote"
                                    required
                                    minLength={10}
                                    maxLength={1000}
                                    rows={3}
                                    defaultValue={project.accessNote ?? ""}
                                    placeholder="Tell us where the code lives and what access you can provide."
                                  />
                                </label>
                                <button className="button" disabled={busy}>
                                  Save access notes
                                </button>
                              </form>
                            </details>
                          )}
                        </div>
                      )}
                    </section>
                    <section className="portal-card">
                      <h2>Issues, ideas & requirements</h2>
                      <p className="portal-muted">
                        Keep the next step in one place. Add bugs, suggestions,
                        feature requests, or PRD text.
                      </p>
                      {!team && (
                        <RequestForm
                          accountId={auth.account.id}
                          key={project.id}
                          project={project}
                          save={save}
                          busy={busy}
                        />
                      )}
                      <div className="portal-request-list">
                        {project.requests.length === 0 ? (
                          <p className="portal-empty">
                            No extra requests yet. Your project brief is already
                            saved.
                          </p>
                        ) : (
                          project.requests.map((item) => (
                            <details key={item.id}>
                              <summary>
                                <span className="portal-kind">{item.kind}</span>
                                <strong>{item.title}</strong>
                              </summary>
                              <p className="portal-preserve">{item.detail}</p>
                              {item.referenceUrl && (
                                <a
                                  href={item.referenceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  Open reference ↗
                                </a>
                              )}
                              <p className="portal-muted">
                                Added {displayDate(item.createdAt)}
                              </p>
                            </details>
                          ))
                        )}
                      </div>
                    </section>
                    <section className="portal-card">
                      <h2>Our review</h2>
                      {project.reviewSummary ? (
                        <p className="portal-preserve">
                          {project.reviewSummary}
                        </p>
                      ) : (
                        <p className="portal-empty">
                          {project.stage === "DRAFT"
                            ? "Submit your brief when it’s ready. Our findings will appear here."
                            : "Our findings are pending. Scope, cost, and delivery estimates follow this review."}
                        </p>
                      )}
                    </section>
                    {team && (
                      <TeamNotes
                        key={`notes:${project.id}`}
                        project={project}
                        accountId={auth.account.id}
                        save={save}
                        busy={busy}
                      />
                    )}
                  </div>
                  <div className="portal-side-column">
                    <ProposalCard
                      project={project}
                      team={team}
                      save={save}
                      busy={busy}
                    />
                    <ProjectPayments
                      key={`payments:${project.id}`}
                      project={project}
                      team={team}
                      save={save}
                      refresh={refresh}
                      onError={failure}
                      returnStatus={paymentReturn}
                      saving={busy}
                    />
                    <section className="portal-card">
                      <h2>Progress & updates</h2>
                      <p className="portal-muted">
                        Published updates from you and the team. Use Refresh to
                        see the latest.
                      </p>
                      <ol className="portal-timeline">
                        {project.updates.map((item) => (
                          <li key={item.id}>
                            <span className="portal-timeline-dot" />
                            <div>
                              <p className="portal-muted">
                                {item.author === "TEAM" ? "m8itwork" : "You"} ·{" "}
                                {displayDate(item.createdAt)}
                              </p>
                              <h3>{item.title}</h3>
                              <p className="portal-preserve">{item.detail}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    </section>
                  </div>
                </div>
              </>
            ) : team ? (
              <AdminOverview
                projects={projects}
                select={(id) => void selectProject(id, true)}
              />
            ) : (
              <CustomerDashboard
                projects={projects}
                select={(id) => void selectProject(id, false)}
                start={startProject}
                busy={busy}
              />
            )}
          </main>
        </div>
      )}
    </>
  );
}

function ProjectSteps({ stage }: { stage: string }) {
  const current =
    stage === "DRAFT"
      ? 0
      : stage === "IN_REVIEW"
        ? 1
        : ["AWAITING_APPROVAL", "APPROVED"].includes(stage)
          ? 2
          : 3;
  return (
    <ol className="portal-steps" aria-label="Project journey">
      {[
        "Connect & brief",
        "Our review",
        "Scope & estimate",
        "Build & verify",
      ].map((label, index) => (
        <li
          key={label}
          className={
            index < current ? "done" : index === current ? "current" : ""
          }
          aria-current={index === current ? "step" : undefined}
        >
          <span>{index < current ? "✓" : `0${index + 1}`}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
function InventoryDetails({ inventory }: { inventory: Inventory }) {
  return (
    <details className="portal-inventory">
      <summary>
        Saved repository inventory{" "}
        <span className="portal-muted">{inventory.commit.slice(0, 7)}</span>
      </summary>
      <a href={inventory.url} target="_blank" rel="noopener noreferrer">
        {inventory.repository} ↗
      </a>
      <p>
        {inventory.branch} · {inventory.fileCount} sampled files
      </p>
      <p>
        {inventory.stack.length
          ? inventory.stack.join(" · ")
          : "Stack needs manual review"}
      </p>
      {!inventory.complete && (
        <p className="portal-notice">
          Partial inventory — not all files were sampled.
        </p>
      )}
      <p className="portal-muted">
        Static evidence at this commit. Workflow verification is part of our
        review and agreed work.
      </p>
      <ul>
        {inventory.limitations.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </details>
  );
}
function ProposalCard({
  project,
  team,
  save,
  busy,
}: {
  project: Project;
  team: boolean;
  save: Save;
  busy: boolean;
}) {
  const proposal = project.proposals.find(
    (item) => item.id === project.currentProposalId,
  );
  const estimateExpired =
    proposal &&
    proposal.deliveryDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
  return (
    <section id="proposal" className="portal-card portal-proposal">
      <p className="portal-kicker">THE PLAN AHEAD</p>
      <h2>Scope & estimate</h2>
      {proposal ? (
        <>
          <span className="portal-stage">
            {proposal.approvedAt ? "Approved" : "Proposed"} · v
            {proposal.version}
          </span>
          <div className="portal-estimate">
            <div>
              <span>Project cost</span>
              <strong>{money(proposal)}</strong>
            </div>
            <div>
              <span>Estimated delivery</span>
              <strong>{displayDate(proposal.deliveryDate)}</strong>
            </div>
          </div>
          <h3>What we’ll build</h3>
          <p className="portal-preserve">{proposal.scope}</p>
          <h3>How we’ll verify it</h3>
          <p className="portal-preserve">{proposal.acceptance}</p>
          <h3>Payment schedule</h3>
          {proposal.milestones?.length ? (
            <ol className="proposal-payment-summary">
              {proposal.milestones.map((m) => (
                <li key={m.id}>
                  <strong>
                    {m.label} ·{" "}
                    {money({
                      amountCents: m.amountCents,
                      currency: proposal.currency,
                    })}
                  </strong>
                  <span>{paymentGateLabels[m.dueWhen]}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="portal-muted">
              The team will confirm the payment schedule before collection.
            </p>
          )}
          <h3>Assumptions & conditions</h3>
          <p className="portal-preserve">{proposal.assumptions}</p>
          {estimateExpired && project.stage === "AWAITING_APPROVAL" && (
            <p className="portal-notice">
              This delivery estimate has passed. Add a request for an updated
              proposal before approving.
            </p>
          )}
          {project.stage === "AWAITING_APPROVAL" &&
            !team &&
            !estimateExpired && (
              <form
                key={proposal.id}
                className="portal-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    `/v1/projects/${project.id}/approve`,
                    {
                      version: project.version,
                      proposalId: proposal.id,
                      consent: true,
                    },
                    `Scope v${proposal.version} approved.`,
                  );
                }}
              >
                <label className="portal-check">
                  <input type="checkbox" required />
                  <span>
                    I’ve reviewed this version’s scope, cost, estimated
                    delivery, payment schedule, and assumptions.
                  </span>
                </label>
                <button className="button" disabled={busy}>
                  Approve scope v{proposal.version}
                </button>
                <p className="portal-muted">
                  Approval confirms this scope, estimate, and payment schedule.
                  Pay requested installments through Stripe Checkout; work
                  starts after its agreed payment is confirmed. Need a change?
                  Use the project conversation before approving.
                </p>
              </form>
            )}
          {project.proposals.length > 1 && (
            <details>
              <summary>Previous proposal versions</summary>
              {project.proposals
                .filter((item) => item.id !== proposal.id)
                .map((item) => (
                  <div className="portal-old-proposal" key={item.id}>
                    <strong>
                      v{item.version} · {money(item)}
                    </strong>
                    <p>Estimated delivery: {displayDate(item.deliveryDate)}</p>
                    <p className="portal-preserve">{item.scope}</p>
                    <p className="portal-muted">
                      Superseded — this version can’t be approved.
                    </p>
                  </div>
                ))}
            </details>
          )}
        </>
      ) : (
        <>
          <div className="portal-estimate">
            <div>
              <span>Project cost</span>
              <strong>Pending review</strong>
            </div>
            <div>
              <span>Estimated delivery</span>
              <strong>Pending scope</strong>
            </div>
          </div>
          <p className="portal-muted">
            We’ll propose the work after reviewing your app and requests. You’ll
            see the scope, cost, delivery estimate, and assumptions together
            before deciding.
          </p>
        </>
      )}
    </section>
  );
}
