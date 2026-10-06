import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { z } from "zod";

// Operator-only, temporary loopback utility. This is never served by the API.
const envPath = fileURLToPath(new URL("../.env", import.meta.url));
const current = parse(await readFile(envPath));
const origin = "http://localhost:3122";
const state = randomBytes(32).toString("base64url");
const manifest = {
  name: "m8itwork-review",
  url: current.FRONTEND_ORIGIN ?? "http://localhost:3120",
  redirect_url: `${origin}/callback`,
  callback_urls: [
    `${current.PUBLIC_API_URL ?? "http://localhost:3121"}/v1/github/callback`,
  ],
  setup_url: `${current.FRONTEND_ORIGIN ?? "http://localhost:3120"}/#review`,
  description:
    "Read-only repository inspection for m8itwork project assessments. No code changes.",
  public: true,
  hook_attributes: {
    url: `${current.PUBLIC_API_URL ?? "http://localhost:3121"}/v1/github/events`,
    active: false,
  },
  request_oauth_on_install: false,
  default_permissions: { contents: "read", metadata: "read" },
  default_events: [],
};
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const document = (body: string) =>
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>m8itwork · GitHub setup</title><style>body{background:#0d1b29;color:#edf3f2;font:16px/1.6 system-ui;max-width:680px;margin:70px auto;padding:24px}h1{line-height:1.1}p,li{color:#bfd0da}button{background:#edab75;border:0;border-radius:8px;padding:15px 24px;font:600 16px system-ui;color:#142534;cursor:pointer}a{color:#91ded2}pre{overflow:auto;background:#162d3c;border:1px solid #486674;padding:20px;border-radius:8px;font-size:12px}</style><main>${body}</main></html>`;
let converting = false;
let configured = false;
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com; frame-ancestors 'none'",
  );
  if (request.headers.host !== "localhost:3122" || request.method !== "GET") {
    response
      .writeHead(403)
      .end("Open this setup utility through localhost:3122.");
    return;
  }
  const url = new URL(request.url ?? "/", origin);
  if (url.pathname === "/") {
    response.end(
      document(
        configured
          ? '<h1>GitHub App configured.</h1><p>Credentials are saved in backend/.env. Restart the API, then connect GitHub and install the App on a selected private test repository.</p><p><a href="http://localhost:3120/#review">Open m8itwork</a></p>'
          : `<h1>Connect private repositories.</h1><p>Register the m8itwork GitHub App under your signed-in GitHub account. GitHub will ask you to confirm its name and permissions.</p><ul><li>Repository contents and metadata: read-only.</li><li>No write permissions, account permissions, or webhook events.</li><li>Available to pilot clients. Each installation chooses which repositories to share.</li><li>Local callbacks for this development setup.</li></ul><p>The callback saves the client secret directly to your local backend/.env. Credentials are never displayed or added to Git.</p><form action="https://github.com/settings/apps/new?state=${state}" method="post"><input type="hidden" name="manifest" value="${escape(JSON.stringify(manifest))}"><button type="submit">Review registration on GitHub ↗</button></form><details><summary>Review the configuration</summary><pre>${escape(JSON.stringify(manifest, null, 2))}</pre></details>`,
      ),
    );
    return;
  }
  if (url.pathname !== "/callback") {
    response.writeHead(404).end("Not found");
    return;
  }
  const incoming = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (
    configured ||
    converting ||
    !/^[A-Za-z0-9_-]{43}$/.test(incoming) ||
    incoming.length !== state.length ||
    !timingSafeEqual(Buffer.from(incoming), Buffer.from(state)) ||
    !/^[a-zA-Z0-9_-]{20,200}$/.test(code)
  ) {
    response
      .writeHead(400)
      .end(
        document(
          "<h1>Setup wasn’t completed.</h1><p>Restart the utility and begin a new registration.</p>",
        ),
      );
    return;
  }
  converting = true;
  try {
    const exchange = await fetch(
      `https://api.github.com/app-manifests/${code}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!exchange.ok) throw new Error("Conversion unavailable");
    const app = z
      .object({
        client_id: z.string().regex(/^[\w.-]+$/),
        client_secret: z.string().regex(/^[\w.-]+$/),
        slug: z.string().regex(/^[\w-]+$/),
        permissions: z
          .object({
            contents: z.literal("read"),
            metadata: z.literal("read"),
          })
          .strict(),
      })
      .parse(await exchange.json());
    const key =
      current.TOKEN_ENCRYPTION_KEY &&
      Buffer.from(current.TOKEN_ENCRYPTION_KEY, "base64").length === 32
        ? current.TOKEN_ENCRYPTION_KEY
        : randomBytes(32).toString("base64");
    const updates = {
      GITHUB_CLIENT_ID: app.client_id,
      GITHUB_CLIENT_SECRET: app.client_secret,
      GITHUB_APP_SLUG: app.slug,
      TOKEN_ENCRYPTION_KEY: key,
    };
    let source = await readFile(envPath, "utf8");
    for (const [name, value] of Object.entries(updates)) {
      const pattern = new RegExp(`^${name}=.*$`, "m");
      const line = `${name}=${JSON.stringify(value)}`;
      source = pattern.test(source)
        ? source.replace(pattern, () => line)
        : `${source.trimEnd()}\n${line}\n`;
    }
    await writeFile(`${envPath}.setup`, source, { mode: 0o600 });
    await rename(`${envPath}.setup`, envPath);
    configured = true;
    console.log(
      "GitHub App configured. Credentials saved locally; restart the API and verify a private repository.",
    );
    response.writeHead(303, { Location: origin }).end();
  } catch {
    response
      .writeHead(502)
      .end(
        document(
          "<h1>Couldn’t finish local setup.</h1><p>No credentials were printed. Check the App registration in GitHub settings and use the manual configuration instructions in docs/GITHUB_SETUP.md. Don’t create a duplicate App if GitHub already registered it.</p>",
        ),
      );
  } finally {
    converting = false;
  }
});
server.listen(3122, "127.0.0.1", () =>
  console.log(
    `GitHub App setup: ${origin} (temporary loopback server; Ctrl+C to stop)`,
  ),
);
const deadline = setTimeout(() => server.close(), 60 * 60_000);
server.on("close", () => clearTimeout(deadline));
