# Read-only GitHub App setup

Register a **GitHub App**, not an OAuth App with the broad `repo` scope. GitHub App user tokens combine the installed app's repository permissions with the user's own access. See [GitHub's user token documentation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app).

Private connection is required for launch. To prefill the local registration and save credentials without copying them through chat, run `npm --prefix backend run github:setup`, open <http://localhost:3122>, and review the registration on GitHub. The temporary utility uses [GitHub’s official manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest), binds only to loopback, checks the one-time state, and writes the client ID/secret/slug and encryption key to ignored `backend/.env`. Restart the API afterward and stop the utility. Confirm expiring user access tokens in GitHub settings, then install on one selected private test repository and perform the checks below. For an existing App or production configuration, use the manual steps instead of creating a duplicate.

1. In GitHub Settings → Developer settings → GitHub Apps, create a pilot app such as `m8itwork-review` (names must be globally unique).
2. Homepage: `http://localhost:3120` for local testing, or the deployed HTTPS site.
3. Callback URL: `http://localhost:3121/v1/github/callback`. The backend's `PUBLIC_API_URL` must match its origin exactly.
4. Setup URL: `http://localhost:3120/#review`. Leave **Request user authorization during installation** off; the website initiates OAuth itself with session-bound state and PKCE. Enable expiring user access tokens. Webhooks are not needed for this milestone.
5. Repository permissions: **Contents: Read-only** and GitHub's required **Metadata: Read-only**. No write or organization permissions. The connection endpoint verifies the registered app's declared permissions before redirecting a visitor.
6. Allow installation on other accounts if this is for external pilot clients. Install on **selected repositories** only.
7. Generate a client secret and put the client ID, secret, app slug, and a generated 32-byte base64 encryption key into `backend/.env`. Restart the API.

```sh
openssl rand -base64 32
```

Keep the resulting key stable while sessions exist. Changing it invalidates encrypted tokens; remove existing browser sessions when rotating it. We use user access tokens rather than installation tokens, so an App private key is not needed.

## Verify a real connection

- Click Connect GitHub. Confirm that the GitHub consent screen shows the expected app and read-only access.
- If no repositories appear, follow Choose repositories in GitHub, install on one test repo, then refresh the website's list.
- Inspect a private test repo you own. Check that the pinned commit and stack match its contents.
- Confirm that an unshared private repo fails, and that another browser cannot attach the first browser's inspection.
- Disconnect. Confirm that private inspection fails until you reconnect. Disconnect removes the stored token; visitors can revoke the GitHub authorization itself through GitHub Settings → Applications → Authorized GitHub Apps.

OAuth state expires after ten minutes and is consumed once. Tokens are AES-256-GCM encrypted in PostgreSQL, are not logged, and are used for at most eight hours. There is no persistent refresh token. Browser sessions expire after 24 hours; run the cleanup command daily.

The pilot limits repository lists to five installations and 100 repositories per installation. Users may paste an authorized repository link when it is not listed. Inspection is limited to 3,000 tree entries and eight manifests of at most 64 KB each; limitations appear in the report. Public unauthenticated GitHub API limits can affect scans. This pilot does not use a global personal token that could expose the operator's private repositories to visitors.
