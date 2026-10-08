import type { Account } from "./workspace-types";

export function CustomerNavigation({
  current,
  account,
  busy,
  signingOut = false,
  logout,
  signInHref,
}: {
  current: "dashboard" | "account" | "billing";
  account: Account | null;
  busy: boolean;
  signingOut?: boolean;
  logout: () => void;
  signInHref?: string;
}) {
  const identity = account
    ? account.displayName ||
      (account.githubLogin ? `@${account.githubLogin}` : account.email) ||
      "Your account"
    : null;
  return (
    <>
    <nav className="customer-navigation" aria-label="Customer navigation">
      <a className="portal-account-link" href="/dashboard" aria-current={current === "dashboard" ? "page" : undefined}>
        Dashboard
      </a>
      {account ? (
        <>
          <a className="portal-account-link" href="/billing" aria-current={current === "billing" ? "page" : undefined}>
            Billing
          </a>
          <a className="portal-account-link" href="/account" aria-current={current === "account" ? "page" : undefined}>
            Account
          </a>
          <span className="portal-user" title={identity ?? undefined}>
            {identity}
          </span>
        </>
      ) : signInHref ? (
        <a className="portal-account-link" href={signInHref}>Sign in</a>
      ) : null}
    </nav>
    {account && (
      <button className="portal-plain customer-signout" onClick={logout} disabled={busy}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    )}
    </>
  );
}
