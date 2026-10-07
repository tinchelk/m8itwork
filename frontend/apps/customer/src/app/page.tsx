import { Intake } from "@/components/intake";
import { WorkshopBackdrop } from "@/components/workshop-backdrop";
import Image from "next/image";

const fixes = [
  [
    "01",
    "Finish the launch.",
    "Bring the app you’ve started. We complete the missing pieces, verify the important journeys, and help get it into people’s hands.",
  ],
  [
    "02",
    "Fix what gets in the way.",
    "Signup breaks. Checkout stops. Data doesn’t arrive. We trace the problem and make the agreed workflows work together.",
  ],
  [
    "03",
    "Build what comes next.",
    "Add custom features, connect your business tools, or reshape a workflow. We build on what’s there and scope larger changes when they’re needed.",
  ],
];
export default function Home() {
  return (
    <div className="workshop-shell" id="top">
      <WorkshopBackdrop />
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header wrap">
        <a className="wordmark" href="/" aria-label="m8itwork home">
          <span className="logo-mark" aria-hidden="true">
            m8
          </span>
          itwork<span className="logo-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#help">How we help</a>
          <a href="#process">How it works</a>
          <a href="/dashboard">Your dashboard</a>
          <a className="button small" href="/dashboard">
            Show us your app <span aria-hidden="true">↗</span>
          </a>
        </nav>
      </header>
      <div className="site-workbench">
        <main id="main">
          <section className="hero wrap">
            <div className="hero-copy">
              <p className="eyebrow">
                <span className="live-dot" /> FINISH. FIX. TAKE IT FURTHER. ·
                PILOT
              </p>
              <h1>
                Built with AI.
                <br />
                <span>
                  Let’s take it
                  <br />
                  further.
                </span>
              </h1>
              <p className="hero-description">
                Your app has a head start. We help you finish it, fix what’s
                blocking you, and build the features and connections you need
                next.
              </p>
              <a className="button" href="/dashboard">
                Show us your app <span aria-hidden="true">↗</span>
              </a>
              <p className="quiet hero-note">
                Create an account with email or Google. Prefer a quick first look?
                <a href="#review"> Send a demo brief.</a>
              </p>
            </div>
            <div
              className="hero-visual"
              aria-label="Illustration of planning an app’s next chapter"
            >
              <div className="visual-top">
                <span>THE WORKBENCH</span>
                <span className="plan-label">PLAN / BUILD / SHIP</span>
              </div>
              <div className="work-card">
                <span className="mono">YOUR APP’S NEXT CHAPTER</span>
                <h2>
                  A head start.
                  <br />
                  More possibilities.
                </h2>
                <ul className="illustrated-checklist">
                  <li>
                    <span aria-hidden="true">✓</span>See what’s already built
                  </li>
                  <li>
                    <span aria-hidden="true">✓</span>Choose what comes next
                  </li>
                  <li>
                    <span aria-hidden="true">↳</span>Build, check, and ship it
                  </li>
                </ul>
                <Image
                  className="hero-bot"
                  src="/art/repair-bot.png"
                  alt=""
                  width={170}
                  height={185}
                  priority
                  sizes="170px"
                />
              </div>
              <div className="review-ticket">
                <span className="ticket-icon" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <p>One clear way forward.</p>
                  <span>Review → scope → build → verify</span>
                </div>
                <span className="ticket-arrow" aria-hidden="true">
                  ↗
                </span>
              </div>
              <p className="visual-foot">
                Illustration of our review process. Actual findings come after
                inspection.
              </p>
            </div>
          </section>
          <div className="platform-strip">
            <div className="wrap">
              <span>STARTED WITH AI? YOU’RE IN THE RIGHT PLACE.</span>
              <div>
                <b>Lovable</b>
                <b>Base44</b>
                <b>Bolt</b>
                <b>Replit</b>
                <span>or your own stack</span>
              </div>
            </div>
          </div>
          <section id="help" className="section wrap">
            <div className="section-heading">
              <p className="eyebrow">KEEP THE MOMENTUM GOING</p>
              <h2>
                You have an app.
                <br />
                Let’s move it forward.
              </h2>
              <p>
                Bring the progress you’ve made, the things that need fixing, and
                the ideas you’re ready to add. We’ll turn the next step into a
                focused project.
              </p>
            </div>
            <div className="fix-grid">
              {fixes.map(([number, title, description]) => (
                <article key={number}>
                  <span className="mono number">{number} /</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </section>
          <section id="process" className="process-section">
            <div className="wrap section">
              <div className="process-intro">
                <p className="eyebrow">CLEAR SCOPE. VISIBLE PROGRESS.</p>
                <h2>
                  From what you have
                  <br />
                  to what you need.
                </h2>
                <p>
                  No mystery project. We agree on what to build and how we’ll
                  know it works.
                </p>
              </div>
              <ol className="process-list">
                <li>
                  <span>01</span>
                  <div>
                    <h3>Show us what you’ve built.</h3>
                    <p>
                      Create an account, share a demo and your requests,
                      and connect a private repository when you’re ready.
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <h3>Get a scope you can understand.</h3>
                    <p>
                      See our review, then agree on the proposed scope,
                      acceptance checks, cost, and estimated delivery.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <h3>Build it. Verify it. Hand it over.</h3>
                    <p>
                      Follow progress updates in your workspace. We verify the
                      agreed work and share the handover there.
                    </p>
                  </div>
                </li>
              </ol>
            </div>
          </section>
          <section id="review" className="section wrap review-section">
            <div className="review-intro">
              <p className="eyebrow">LET’S SEE WHAT YOU’VE GOT</p>
              <h2>
                Your app.
                <br />
                Your next step.
                <br />
                <span>Our next project?</span>
              </h2>
              <p>
                We’re piloting this service with a small number of projects.
                Tell us what you want to fix or add and we’ll review whether we
                can help.
              </p>
              <div className="review-expect">
                <h3>What happens next</h3>
                <p>
                  GitHub gives us an initial look at the code. Your demo and
                  goals help us confirm the scope. We’ll contact you about a
                  paid assessment before development starts.
                </p>
              </div>
              <p className="quiet">
                This quick brief doesn’t require an account. For a project
                workspace with review and delivery updates,{" "}
                <a href="/dashboard">open your dashboard</a>. Assessment and
                project fees are agreed separately.
              </p>
            </div>
            <Intake />
          </section>
          <section className="faq wrap">
            <p className="eyebrow">A FEW GOOD QUESTIONS</p>
            <div>
              <details>
                <summary>
                  Can you add features my app builder doesn’t offer?
                </summary>
                <p>
                  We can work on custom features, integrations, and workflows.
                  First we check your code and the access your platform allows.
                  Then we scope the best route: extend the existing app, add a
                  separate service, or move parts of it when needed. You approve
                  the approach and cost before we start.
                </p>
              </details>
              <details>
                <summary>Will you rebuild my whole app?</summary>
                <p>
                  We start with what you have. The assessment helps us decide
                  which parts to keep, what needs changing, and whether a larger
                  change is justified. You approve the scope before work begins.
                </p>
              </details>
              <details>
                <summary>Can you review a private repository?</summary>
                <p>
                  When the GitHub connection is enabled, you choose which
                  repositories to share with our read-only GitHub App. You can
                  also send your demo and arrange access during the assessment.
                </p>
              </details>
              <details>
                <summary>
                  Can the scan tell me exactly when I can launch?
                </summary>
                <p>
                  The initial scan inventories visible repository evidence and
                  suggests an assessment allowance. A project estimate needs a
                  human review of the requested changes, integrations, and
                  testing requirements.
                </p>
              </details>
              <details>
                <summary>What if my AI tool doesn’t export to GitHub?</summary>
                <p>
                  Send your demo and describe what you need. We’ll discuss the
                  access your platform supports and whether we can help before
                  agreeing to paid work.
                </p>
              </details>
            </div>
          </section>
        </main>
        <footer className="wrap footer">
          <a className="wordmark" href="/">
            m8itwork<span className="logo-dot">.</span>
          </a>
          <p>Built something? Let’s take it further.</p>
          <a href="/privacy">Privacy & repository access</a>
        </footer>
      </div>
    </div>
  );
}
