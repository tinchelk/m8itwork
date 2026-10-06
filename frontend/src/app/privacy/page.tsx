import { WorkshopBackdrop } from "@/components/workshop-backdrop";

export default function Privacy() {
  return (
    <div className="workshop-shell privacy-shell">
      <WorkshopBackdrop />
      <main className="wrap privacy">
        <a className="wordmark" href="/">
          m8itwork<span className="logo-dot">.</span>
        </a>
        <p className="eyebrow">PILOT PRIVACY & ACCESS</p>
        <h1>
          What you share.
          <br />
          What we keep.
        </h1>
        <p>Updated October 6, 2026.</p>
        <h2>Your project brief</h2>
        <p>
          We store your name, email, project details, demo link, selected
          workflows, and any repository inspection summary you attach. We use
          this information to assess whether we can help and follow up about the
          service. Do not submit passwords, API keys, customer records, or other
          secrets.
        </p>
        <h2>Repository inspection</h2>
        <p>
          Inspection is read-only. We retrieve GitHub repository metadata, one
          commit’s file tree, and up to eight small package manifests. We do not
          execute the code, fetch your demo automatically, or send it to an AI
          provider. Only the resulting summary is retained; source file contents
          are not stored.
        </p>
        <h2>Private GitHub access</h2>
        <p>
          Our configured GitHub App requests read-only repository contents
          access. You choose repositories when installing the app. Access tokens
          are encrypted on the server and used for up to eight hours.
          Disconnecting deletes the connection stored by this service. You can
          revoke authorization and uninstall the app in GitHub settings. A
          previously submitted inspection summary stays with your brief.
        </p>
        <h2>Browser sessions and retention</h2>
        <p>
          An essential, HTTP-only cookie connects your browser to its inspection
          for 24 hours. Expired sessions and unsubmitted inspections are removed
          by the operator’s cleanup job. A draft may be stored in this tab for
          up to 24 hours to preserve it when you connect GitHub; a successful
          submission clears it. Submitted briefs are retained while discussing
          or delivering the project. To request deletion, contact the person who
          shared this pilot with you, or reply to your project follow-up email.
        </p>
        <h2>Before you submit</h2>
        <p>
          Share only code and project information you are authorized to provide.
          The preliminary report is not a security audit, executed test result,
          or binding delivery quote.
        </p>
        <a className="button" href="/#review">
          Back to your brief <span aria-hidden="true">↗</span>
        </a>
      </main>
    </div>
  );
}
