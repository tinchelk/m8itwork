const key = "m8-customer-signin-return";
// Verification intent stays in a fragment/browser storage, never in an API query.
export function notificationReturnFragment() {
  if (typeof window === "undefined") return "";
  const contact = new URLSearchParams(window.location.hash.slice(1)).get(
    "contact",
  );
  return contact && /^[A-Za-z0-9_-]{16,200}$/.test(contact)
    ? `#contact=${contact}`
    : "";
}
export function requestedCustomerReturn() {
  const target = new URLSearchParams(window.location.search).get("return");
  return target === "account"
    ? `/account${notificationReturnFragment()}`
    : target === "billing"
      ? "/billing"
      : null;
}
export function rememberCustomerReturn() {
  const target = requestedCustomerReturn();
  try {
    if (target)
      sessionStorage.setItem(
        key,
        JSON.stringify({ target, expires: Date.now() + 15 * 60_000 }),
      );
    else sessionStorage.removeItem(key);
  } catch {
    /* Sign-in also works without storage. */
  }
}
export function consumeCustomerReturn() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null") as {
      target?: string;
      expires?: number;
    } | null;
    sessionStorage.removeItem(key);
    if (
      saved &&
      (saved.target === "/account" ||
        saved.target === "/billing" ||
        /^\/account#contact=[A-Za-z0-9_-]{16,200}$/.test(saved.target ?? "")) &&
      (saved.expires ?? 0) > Date.now()
    )
      return saved.target;
  } catch {
    /* Ignore an unavailable or invalid browser preference. */
  }
  return null;
}
