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
        <p>Updated October 7, 2026.</p>
        <h2>Your project brief</h2>
        <p>
          We store your name, email, project details, demo link, selected
          workflows, and any repository inspection summary you attach. We use
          this information to assess whether we can help and follow up about the
          service. Do not submit passwords, API keys, customer records, or other
          secrets.
        </p>
        <h2>Your customer workspace</h2>
        <p>
          Email signup stores your name, email, verification status, and a
          salted password hash. Passwords and account-link tokens are not stored
          as plain text or in browser drafts. Google sign-in uses your verified
          email, profile name, and Google account ID. GitHub sign-in uses
          GitHub’s numeric user ID, username, and profile name. Creating an account does not grant repository access. New project intake connects a selected repository and records what you want next. We store your
          projects, contact email, issues, suggestions, requirements, repository
          summaries, proposals, approvals, conversations, delivery checklists,
          verification evidence, and progress updates to review and deliver the
          agreed work. The team can also record internal notes, which are
          visible only to authorized operators. Each customer can access their
          own projects; authorized project-team operators can review them and
          publish updates. Reference links are stored without being fetched
          automatically.
        </p>
        <p>
          Resend delivers account verification and password-recovery messages;
          we send it your email and a short-lived action link. Incoming mail to
          hello@m8itwork.com is routed by Cloudflare to the operator’s inbox.
          Password-reset links expire after 30 minutes and verification links
          after 24 hours. Completing a reset revokes all your account sessions
          and repository credentials held by this service. Google receives only
          an identity sign-in request; we do not request access to your Gmail or
          Drive.
        </p>
        <h2>Project notifications</h2>
        <p>Resend also delivers generic project updates and verified notification-email links. Messages include an authenticated dashboard link; private requests, repository source, team notes and provider login codes are not included. You can verify a separate notification address and control project emails in Account without changing your sign-in or recovery identity. Signing out does not stop these emails; disabling updates or closing your account does. Security and explicitly requested account emails remain separate.</p>
        <p>Notification verification links expire after 30 minutes. We retain delivery identifiers, destination, kind, retry status and timestamps to prevent duplicate sends and recover failures. Verification links are encrypted while awaiting delivery and cleared afterward. Sent or skipped delivery records are cleared after 90 days. Project history, proposal conditions, repository revisions, cancellation agreements, handover and acceptance records remain with the project.</p>
        <h2>Payments</h2>
        <p>
          For an agreed project, Stripe Checkout handles card details on
          Stripe’s hosted payment page. We send Stripe your contact email,
          project and installment names, agreed amount and currency, and
          identifiers linking the payment to your project. We do not receive or
          store your full card number. We retain the agreed payment schedule,
          Stripe transaction identifiers, payment status, receipt and invoice
          links, and refund or dispute information to reconcile payments and
          deliver work. Stripe processes payment information under its own{" "}
          <a
            href="https://stripe.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            privacy policy
          </a>
          .
        </p>
        <p>
          You can choose to save a card in Account or during Checkout for a
          future agreed project payment. Stripe stores the card details; we
          retain its payment-method identifier and display only its brand, last
          four digits and expiry. Adding a card does not make a payment, and
          saving it does not authorize us to charge it automatically. Remove
          saved cards in Account. Removing a card does not cancel an agreed
          project or refund an existing payment.
        </p>
        <h2>Repository inspection</h2>
        <p>
          Inspection is read-only. We retrieve GitHub repository metadata, one
          commit’s file tree, and up to eight small package manifests. We do not
          execute the code, fetch your demo automatically, or send it to an AI
          provider. Only the resulting summary is retained; source file contents
          are not stored.
        </p>
        <h2>AI-assisted review</h2>
        <p>
          When you send a new repository request or separately allow AI review
          in your dashboard, you authorize us to send a bounded source sample
          and your project requests to OpenAI or Anthropic through a
          coding-agent subscription on the operator’s machine. Up to 40 eligible
          files from your saved commit are sampled, with limits on file size and
          total content. Sensitive and instruction files are excluded and
          recognizable credentials are redacted; this cannot guarantee that all
          secrets are detected. Do not commit secrets or share customer data in
          your repo. Repository code, dependencies, and tests are not executed.
        </p>
        <p>
          Source passes temporarily through our server and local worker; we do
          not retain source snapshots in our application database. We retain the
          private draft report, evidence paths, coverage limitations, a bounded
          request snapshot, operator review prompts, and visible agent replies
          and progress messages with your project. These review records are
          accessible only to authorized operators. Internal model reasoning and
          raw provider transcripts are not retained by our application.
          Follow-up questions use the same read-only review boundaries. The
          operator checks and edits the draft before publishing a review or
          quote. Provider processing and retention follow the subscription
          account’s settings and the provider’s policies. You can withdraw
          permission in your dashboard to stop queued and running reviews;
          information already sent to a provider cannot be recalled. Manual
          discussion remains available.
        </p>
        <h2>Private GitHub access</h2>
        <p>
          Our configured GitHub App requests read-only repository contents
          access. You choose repositories when installing the app. Access tokens
          are encrypted on the server and used for up to eight hours.
          Disconnecting deletes the connection stored by this service. You can
          revoke authorization and uninstall the app in GitHub settings. A
          previously submitted inspection summary stays with your brief. Signing
          out also clears repository access in this browser; saved project
          history stays in your workspace.
        </p>
        <h2>Browser sessions and retention</h2>
        <p>
          You can close your account in Account settings. Closing signs out all
          devices, retires repository credentials and recovery links held by
          this service, withdraws unagreed requests and stops queued or running
          reviews. Agreed work, pending payments or disputes need a team check
          first. Project and financial records remain with the team. Closed identities and hashed retired identity identifiers are retained to prevent restoring an old backup from reopening a closed account. Closing
          does not delete GitHub repositories, uninstall the GitHub App, refund
          payments or remove payment methods stored by Stripe; you can remove
          saved cards before closing. Contact hello@m8itwork.com about retained
          records or returning to the service. A hashed closure receipt is valid
          for 30 minutes to confirm an interrupted request; expired receipts are
          removed during operational cleanup. Its short-lived random identifier
          may remain in this browser tab for that period.
        </p>
        <p>
          An essential, HTTP-only cookie connects your browser to its inspection
          for 24 hours. Expired sessions and unsubmitted inspections are removed
          by the operator’s cleanup job. A separate essential, HTTP-only account
          cookie keeps your workspace login for up to 30 days. Repository tokens
          expire independently, so a customer can still read project history
          when repository access needs reconnecting. Signing out revokes the
          current account session. A draft may be stored in this tab for up to
          one hour, tied to your signed-in account, to preserve it when you connect GitHub; a successful
          submission clears it. Submitted briefs and workspace records are
          retained while discussing or delivering the project. To request
          deletion, email{" "}
          <a href="mailto:hello@m8itwork.com">hello@m8itwork.com</a>, or use
          your project conversation. Deletion requests are reviewed
          individually; agreement and transaction records may be retained to
          reconcile payments, accounting, refunds, or disputes. Deleting this
          service’s records does not delete records held by Stripe, GitHub,
          OpenAI or Anthropic.
        </p>
        <p>
          Unsaved project, request, conversation, and operator form drafts may
          stay in this tab for one hour. They are tied to your signed-in account
          and project so you can recover them after signing in again with the
          same account. Successful saves and explicit sign-out clear these
          drafts. Approval acknowledgments are never stored or restored.
        </p>
        <h2>Before you submit</h2>
        <p>
          Share only code and project information you are authorized to provide.
          The preliminary report is not a security audit, executed test result,
          or binding delivery quote.
        </p>
        <a className="button" href="/dashboard">
          Back to your dashboard <span aria-hidden="true">↗</span>
        </a>
      </main>
    </div>
  );
}
