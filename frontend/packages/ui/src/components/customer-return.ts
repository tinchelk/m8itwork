const key = "m8-customer-signin-return";
const projectId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dashboardReturn(params: URLSearchParams) {
  const kept = new URLSearchParams();
  const project = params.get("project");
  if (project && projectId.test(project)) {
    kept.set("project", project);
    const payment = params.get("payment");
    if (payment === "returned" || payment === "cancelled") kept.set("payment", payment);
  } else if (params.get("start") === "1") kept.set("start", "1");
  return kept.size ? `/dashboard?${kept}` : null;
}

function validSavedReturn(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value === "/account" || value === "/billing" || /^\/account#contact=[A-Za-z0-9_-]{16,200}$/.test(value)) return true;
  if (!value.startsWith("/dashboard?")) return false;
  const params = new URLSearchParams(value.slice("/dashboard?".length));
  return dashboardReturn(params) === value;
}
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
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const target = params.get("return");
  return target === "account"
    ? `/account${notificationReturnFragment()}`
    : target === "billing"
      ? "/billing"
      : dashboardReturn(params);
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
      validSavedReturn(saved.target) &&
      (saved.expires ?? 0) > Date.now()
    )
      return saved.target;
  } catch {
    /* Ignore an unavailable or invalid browser preference. */
  }
  return null;
}
