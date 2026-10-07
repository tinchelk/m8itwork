import { z } from "zod";
import type { ReadableStreamDefaultReader } from "node:stream/web";
import { AppError } from "../shared/errors.js";

export type Fetch = typeof globalThis.fetch;
const repository = z.object({
  full_name: z.string(),
  html_url: z.url(),
  private: z.boolean(),
  default_branch: z.string(),
  language: z.string().nullable(),
  archived: z.boolean(),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      sha: z.string(),
      size: z.number().optional(),
    }),
  ),
});

export function parseRepositoryUrl(value: string): {
  owner: string;
  repo: string;
} {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      400,
      "INVALID_REPOSITORY",
      "Use a GitHub repository link, such as https://github.com/you/your-app.",
    );
  }
  const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(url.pathname);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  ) {
    throw new AppError(
      400,
      "INVALID_REPOSITORY",
      "Use the main https://github.com/owner/repository link.",
    );
  }
  const owner = match[1]!;
  const repo = match[2]!.replace(/\.git$/, "");
  if (!repo || repo === "." || repo === "..")
    throw new AppError(
      400,
      "INVALID_REPOSITORY",
      "The repository name is invalid.",
    );
  return { owner, repo };
}

async function boundedJson(
  response: Response,
  maxBytes = 2_000_000,
): Promise<unknown> {
  if (!response.body)
    throw new AppError(
      502,
      "GITHUB_RESPONSE",
      "GitHub returned an empty response. Try again.",
    );
  const reader =
    response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maxBytes)
        throw new AppError(
          422,
          "REPOSITORY_TOO_LARGE",
          "This repository exceeds the current inspection limit. Contact hello@m8itwork.com so we can arrange a review.",
        );
      parts.push(next.value);
    }
    return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
  } finally {
    await reader.cancel();
  }
}

export class GitHubClient {
  constructor(private readonly fetcher: Fetch = fetch) {}
  async api(path: string, token?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "User-Agent": "m8itwork-read-only-review",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
      });
    } catch {
      throw new AppError(
        502,
        "GITHUB_UNAVAILABLE",
        "We couldn't reach GitHub. Please try again; your request is still here.",
      );
    }
    if (response.status === 401)
      throw new AppError(
        401,
        "GITHUB_RECONNECT",
        "Your GitHub connection expired. Please reconnect.",
      );
    if (response.status === 404)
      throw new AppError(
        404,
        "REPOSITORY_UNAVAILABLE",
        "Repository not found or not shared with this GitHub App. Check the link or connect GitHub for a private repository.",
      );
    if (response.status === 403 || response.status === 429)
      throw new AppError(
        429,
        "GITHUB_LIMIT",
        "GitHub has temporarily limited access. Please try again later; your request is still here.",
      );
    if (response.status === 409)
      throw new AppError(
        422,
        "EMPTY_REPOSITORY",
        "This repository has no code yet. Choose the repository containing your app, or contact hello@m8itwork.com for help.",
      );
    if (!response.ok)
      throw new AppError(
        502,
        "GITHUB_UNAVAILABLE",
        "GitHub couldn't complete the inspection. Please try again.",
      );
    return boundedJson(response);
  }
  async exchange(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    verifier: string;
    redirectUri: string;
  }) {
    let response: Response;
    try {
      response = await this.fetcher(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            code: input.code,
            code_verifier: input.verifier,
            redirect_uri: input.redirectUri,
          }),
          signal: AbortSignal.timeout(12_000),
          redirect: "error",
        },
      );
    } catch {
      throw new AppError(
        502,
        "GITHUB_CONNECT_FAILED",
        "GitHub connection failed. Please start again.",
      );
    }
    if (!response.ok)
      throw new AppError(
        502,
        "GITHUB_CONNECT_FAILED",
        "GitHub connection failed. Please start again.",
      );
    const result = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive().optional(),
      })
      .safeParse(await boundedJson(response, 32_000));
    if (!result.success)
      throw new AppError(
        400,
        "GITHUB_CONNECT_FAILED",
        "GitHub authorization was declined or expired. Please start again.",
      );
    return result.data;
  }
  async repositories(token: string) {
    const installations = z
      .object({
        total_count: z.number(),
        installations: z.array(z.object({ id: z.number() })),
      })
      .parse(await this.api("/user/installations?per_page=100", token));
    const repos = new Map<
      string,
      { name: string; url: string; private: boolean }
    >();
    let truncated = installations.total_count > 5;
    for (const installation of installations.installations.slice(0, 5)) {
      const result = z
        .object({
          total_count: z.number(),
          repositories: z.array(
            repository.pick({ full_name: true, html_url: true, private: true }),
          ),
        })
        .parse(
          await this.api(
            `/user/installations/${installation.id}/repositories?per_page=100`,
            token,
          ),
        );
      truncated ||= result.total_count > result.repositories.length;
      for (const repo of result.repositories)
        repos.set(repo.full_name, {
          name: repo.full_name,
          url: repo.html_url,
          private: repo.private,
        });
    }
    return {
      repositories: [...repos.values()].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      truncated,
    };
  }
  async inspect(url: string, token?: string) {
    const { owner, repo } = parseRepositoryUrl(url);
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const metadata = repository.parse(await this.api(base, token));
    const branch = z
      .object({ commit: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/) }) })
      .parse(
        await this.api(
          `${base}/branches/${encodeURIComponent(metadata.default_branch)}`,
          token,
        ),
      );
    const commit = branch.commit.sha;
    const tree = treeSchema.parse(
      await this.api(`${base}/git/trees/${commit}?recursive=1`, token),
    );
    const paths = tree.tree
      .slice(0, 3000)
      .filter((entry) => entry.type === "blob");
    const complete = !tree.truncated && tree.tree.length <= 3000;
    const manifests = paths.filter(
      (entry) =>
        /(^|\/)package\.json$/.test(entry.path) &&
        !/(^|\/)(node_modules|vendor|dist|build|\.next)\//.test(entry.path),
    );
    const readable = manifests
      .filter((entry) => (entry.size ?? Infinity) <= 64_000)
      .slice(0, 8);
    const packages = await Promise.all(
      readable.map(async (entry) => {
        try {
          const blob = z
            .object({ content: z.string(), encoding: z.literal("base64") })
            .parse(await this.api(`${base}/git/blobs/${entry.sha}`, token));
          const raw: unknown = JSON.parse(
            Buffer.from(blob.content.replace(/\n/g, ""), "base64").toString(
              "utf8",
            ),
          );
          const data = z
            .object({
              dependencies: z.record(z.string(), z.unknown()).optional(),
              devDependencies: z.record(z.string(), z.unknown()).optional(),
              scripts: z.record(z.string(), z.unknown()).optional(),
            })
            .parse(raw);
          return {
            path: entry.path,
            dependencies: [
              ...Object.keys(data.dependencies ?? {}),
              ...Object.keys(data.devDependencies ?? {}),
            ],
            scripts: Object.keys(data.scripts ?? {}),
          };
        } catch (error) {
          if (
            error instanceof AppError &&
            [401, 429, 502].includes(error.statusCode)
          )
            throw error;
          return {
            path: entry.path,
            dependencies: [] as string[],
            scripts: [] as string[],
            unreadable: true,
          };
        }
      }),
    );
    return makeReport({
      metadata,
      commit,
      paths: paths.map((entry) => entry.path),
      complete,
      packages,
      manifestsLimited: readable.length !== manifests.length,
    });
  }
}

type Evidence = {
  title: string;
  detail: string;
  paths: string[];
  kind: "observed" | "verify";
};
interface ReportInput {
  metadata: z.infer<typeof repository>;
  commit: string;
  paths: string[];
  complete: boolean;
  packages: {
    path: string;
    dependencies: string[];
    scripts: string[];
    unreadable?: boolean;
  }[];
  manifestsLimited: boolean;
}
export function makeReport(input: ReportInput) {
  const { metadata, commit, paths, packages, complete } = input;
  const frameworkNames: Record<string, string> = {
    next: "Next.js",
    react: "React",
    vue: "Vue",
    express: "Express",
    fastify: "Fastify",
    "@supabase/supabase-js": "Supabase",
    "@base44/sdk": "Base44 SDK",
  };
  const dependencies = new Set(packages.flatMap((entry) => entry.dependencies));
  const stack = Object.entries(frameworkNames)
    .filter(([name]) => dependencies.has(name))
    .map(([, label]) => label);
  if (metadata.language && !stack.includes(metadata.language))
    stack.push(metadata.language);
  const evidence: Evidence[] = [];
  if (packages.length)
    evidence.push({
      title: "Application setup",
      detail: `${packages.length} package manifest(s) inspected. Dependency declarations describe the setup; they do not prove it runs.`,
      paths: packages.map((entry) => entry.path),
      kind: "observed",
    });
  const tests = paths.filter((path) =>
    /(^|\/)(__tests__|tests?|e2e)\/|\.(test|spec)\.[a-z]+$/i.test(path),
  );
  evidence.push({
    title: "Workflow tests",
    detail: tests.length
      ? `${tests.length} test-related files found. We still need to run them and check the key journeys.`
      : "No test files found in the inspected tree. Confirm how signup, payments, and other key journeys are verified.",
    paths: tests.slice(0, 4),
    kind: tests.length ? "observed" : "verify",
  });
  const auth = packages.filter((entry) =>
    entry.dependencies.some((name) =>
      /^(next-auth|better-auth|@clerk\/|@supabase\/|firebase|@base44\/)/.test(
        name,
      ),
    ),
  );
  evidence.push({
    title: "Login and permissions",
    detail: auth.length
      ? "Authentication-related dependencies found. User roles, sessions, and account recovery still need testing."
      : "Confirm login, user roles, and account recovery with a demo. Custom authentication may not appear in dependency declarations.",
    paths: auth.map((entry) => entry.path),
    kind: auth.length ? "observed" : "verify",
  });
  const payments = packages.filter((entry) =>
    entry.dependencies.some((name) =>
      /^(stripe|@stripe\/|@paypal\/)/.test(name),
    ),
  );
  evidence.push({
    title: "Payments and integrations",
    detail: payments.length
      ? "Payment-related dependencies found. Checkout, webhooks, and failure handling still need testing."
      : "Tell us which external services the app needs. Their absence from package manifests does not mean they are missing from the app.",
    paths: payments.map((entry) => entry.path),
    kind: payments.length ? "observed" : "verify",
  });
  const deployment = paths.filter((path) =>
    /(^|\/)(Dockerfile|vercel\.json|netlify\.toml|render\.yaml|fly\.toml)$|^\.github\/workflows\//.test(
      path,
    ),
  );
  evidence.push({
    title: "Launch setup",
    detail: deployment.length
      ? "Deployment or CI configuration found. A successful production build and correct environment settings still need verification."
      : "Confirm hosting, environment settings, and the production build before launch.",
    paths: deployment.slice(0, 4),
    kind: deployment.length ? "observed" : "verify",
  });
  const limitations = [
    "Static inspection only. No code, build, tests, or live workflows were executed.",
    "Only file paths and up to eight small package.json files were inspected. Source contents, secret files, and customer data were not collected.",
    "Development scope, cost, and delivery date require a human review of your demo and the changes you want to make.",
  ];
  if (!complete)
    limitations.unshift(
      "The repository tree was truncated or reached the 3,000-file limit. Files outside this sample may change the assessment.",
    );
  if (input.manifestsLimited || packages.some((entry) => entry.unreadable))
    limitations.unshift(
      "Some package manifests were too large, invalid, or outside the eight-file limit. The stack inventory is partial.",
    );
  if (metadata.archived)
    limitations.unshift(
      "This repository is archived. Confirm whether it represents the app you want to finish.",
    );
  const range =
    !complete || paths.length > 500
      ? [2, 3]
      : paths.length > 100
        ? [1, 2]
        : [0.5, 1];
  return {
    repository: metadata.full_name,
    url: metadata.html_url,
    private: metadata.private,
    branch: metadata.default_branch,
    commit,
    inspectedAt: new Date().toISOString(),
    fileCount: paths.length,
    complete,
    stack,
    evidence,
    limitations,
    assessmentEffort: {
      minDays: range[0]!,
      maxDays: range[1]!,
      confidence: "low" as const,
      basis:
        "A planning allowance based on the sampled repository size. It is human assessment effort, not development effort or a promised delivery date.",
    },
    repairEstimate: null,
    nextSteps: [
      "Review your demo, reproduce broken journeys, and define the new features you want.",
      "Verify the build, tests, permissions, and required integrations in a safe environment.",
      "Agree on specific changes, acceptance checks, and a delivery estimate before work starts.",
    ],
  };
}
export type InspectionReport = ReturnType<typeof makeReport>;
