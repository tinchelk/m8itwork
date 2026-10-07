const key = "m8-customer-signin-return";
export function requestedCustomerReturn() {
  const target = new URLSearchParams(window.location.search).get("return");
  return target === "account" || target === "billing" ? `/${target}` : null;
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
      (saved.target === "/account" || saved.target === "/billing") &&
      (saved.expires ?? 0) > Date.now()
    )
      return saved.target;
  } catch {
    /* Ignore an unavailable or invalid browser preference. */
  }
  return null;
}
