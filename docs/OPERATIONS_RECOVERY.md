# Operations, restore and provider acceptance

This runbook describes the launch-completion implementation. Local fixtures and a restore drill are distinct from production deployment and real-provider acceptance.

## Daily ownership and alerts

Tin is the pilot operator. On each working day, review submitted requests, unread conversations, review jobs and **Service health & recovery** in the backoffice. The initial fit review is free; paid assessment/development requires a separate published scope and customer approval. Aim to reply within the configured `RESPONSE_TARGET_WORKING_DAYS` (default two); this is not a development ETA.

Operators verify a notification destination in customer Account and enable **Email me customer requests and operational alerts**. Only numeric allowlisted GitHub identities receive operator mail; role, verified destination, preferences and account closure are rechecked at delivery. New requests/replies and newly opened incidents create one durable generic alert. Operator-mail failures do not recursively produce more mail alerts. All project details stay behind authenticated links.

The API processes payment inbox events and notifications every minute, without overlapping runs in one process. PostgreSQL fences and durable leases coordinate replicas. Cleanup runs hourly. Shutdown stops scheduling and awaits current maintenance. Financial events are saved before webhook acknowledgement; unknown or unreconciled related events hold work. Provider errors are stored as redacted codes.

An in-process scheduler cannot alert while the API itself is down. Configure independent provider/uptime notifications to Tin for `https://api.m8itwork.com/health`, API deployment failures and database health before a paid pilot. This external alert destination/provider is an operating dependency; a dashboard or configured email key is not evidence that it is active. During an outage, stop customer collection and review workers, inspect Railway health/logs without exporting credentials, and use the recovery procedure below if database consistency is uncertain.

## Recovery actions

- Payment event: retry reconciliation in Operations, then inspect the original Stripe session/refund/dispute if still pending. No retry creates a second charge. Collection/work remains held until facts reconcile.
- Email failure: retry only inside the first delivery attempt's 23-hour safe window. The provider's idempotency key/payload stay stable. `DELIVERY_UNCERTAIN` requires checking Resend delivery history before manually sending a replacement. Verify `CONTACT_REQUIRED` destinations in Account. Never paste private source or login codes into email.
- Worker offline: start its Docker host or revoke a retired worker. Sign-in/error/quota attention links to Worker setup/project review controls. Fresh login requires human provider acceptance; cached doctor status is not fresh-login acceptance.
- Cancellation: pause work/collection, agree exact written terms and retained amount, explicitly expire open sessions/refund through Stripe if agreed, then verify and settle. To resume, the team offers the original agreement and the customer confirms; old settlement offers retire.

## Encrypted off-provider logical backups

`scripts/backup.ts` supports encrypted `pg_dump` archives and isolated `pg_restore`. Supply a separate 32-byte base64 `BACKUP_ENCRYPTION_KEY` through private environment configuration; keep it and archives outside this repository and the Railway volume. The application token-encryption key must also be securely recoverable. Archive paths are exclusive, mode 0600; an existing archive is never overwritten/deleted. Credentials use child environment variables and sanitized errors. The archive is authenticated before SQL reaches the restore process.

Configure PostgreSQL tools locally, or `PG_TOOL_PREFIX` as a JSON array for a private Docker PostgreSQL client, forwarding `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` and `PGDATABASE` through environment names (do not put values in argv). Examples use shell placeholders only:

```sh
# Explicit source URL; never rely on backend DATABASE_URL implicitly.
BACKUP_DATABASE_URL="$PRIVATE_SOURCE_URL" npm run backup -- backup /private/off-provider/m8itwork-2026-10-07.enc
# Destination must be a new local *_restore_* database. No clean/drop option exists.
RECOVERY_DATABASE_URL="$ISOLATED_RESTORE_URL" npm run backup -- restore /private/off-provider/m8itwork-2026-10-07.enc
```

Schedule and verify independent encrypted copies before accepting paid customers. Daily Railway volume backups currently retain six days; they remain useful but do not constitute an off-provider copy, tested restoration or point-in-time recovery. Document the chosen recovery-point objective, retained copies and latest successful drill. A lost or stale security-fence export is a blocker, never permission to reopen old accounts.

## Isolated restore and reconciliation

1. Freeze the original API in `RECOVERY_MODE=true` and stop workers. All authenticated/customer/worker routes return maintenance 503; health remains readable. Valid Stripe webhooks are durably ingested, without applying state or starting email. Do not roll back to code that ignores account closure.
2. Export **current post-freeze** closed-account fences into a new encrypted file from the original authoritative database: `RECOVERY_DATABASE_URL="$FROZEN_SOURCE_URL" npm run recovery -- fences /private/off-provider/current-fences.enc`. Store fences independently. If the original source/fences are unavailable, reconstruct closures/retired identities from authoritative records and keep access disabled; an older snapshot is insufficient.
3. Confirm `STRIPE_ACCOUNT_ID` is the independently verified original merchant. The encrypted fence manifest records that merchant and mode; reconciliation rejects another merchant or mode even when the restored ledger is empty. Restore an encrypted archive into a new isolated local `*_restore_*` database. Apply current additive migrations there. Do not replace production data during a drill.
4. With matching original Stripe account ID/mode/key and encryption keys, run `RECOVERY_DATABASE_URL="$ISOLATED_RESTORE_URL" npm run recovery -- reconcile /private/off-provider/current-fences.enc "$SERVICE_FROZEN_ISO_TIME"`.
5. The tool reapplies current closed-account identities and hashed aliases, resets all restored sessions/tokens/AI leases, revokes workers and suppresses old unsent emails. Identity collisions fail closed. It enumerates all app-tagged payment Checkout sessions, including ones acknowledged after the snapshot, recovers conclusively matched session mappings and retrieves each stored attempt authoritatively. Unknown app-owned sessions, ambiguous attempts, mode mismatches, provider errors or unresolved events produce a blocked report/exit 2. No charge, refund, collection or automatic reopening occurs.
6. Reconstruct any missing post-snapshot project/attempt/approval records from authoritative evidence. Resolve all blocked financial events and repeat reconciliation. Compare financial totals/provider records and closed-identity denials. Obtain operator sign-off on the report before replacing production via the provider's documented restore process.
7. Keep the new production API in recovery mode while checking migrations, closure fences, permissions and finances. Re-pair workers, require fresh customer login/repository consent, reconnect providers and enable independent outage alerts. Only then reopen access. A safe reconciliation report does not deploy or unset recovery mode.

The production restore itself is consequential and requires explicit approval of the exact target and reviewed evidence. This milestone only performs isolated local restores.

## External acceptance checklist

Record actual nonsecret results for: verification/reset email completion; Google publication/branding; a second real customer and unshared private repository denial; sandbox saved-card add/remove, deposit webhook, build/verification, final payment and handover; fresh Docker-host provider login. Merchant activation/live credentials, Google identity/provider publication and a Claude subscription require their owner's actions. Use synthetic customers and Stripe test mode only until paid-pilot approval. Never report configured keys, cached auth or fixtures as these completed checks.

## Verified isolated drill — October 7, 2026

An actual PostgreSQL 17 logical dump from the dedicated synthetic test database was encrypted with a separate ephemeral key and restored into a newly created local `m8itwork_restore_*` database. The authoritative fixture was closed after the snapshot with a changed email and newly linked Google identity. Current encrypted fences preserved those identities, fenced the old email, revoked restored sessions and retained the business project record.

A real $1 **sandbox** Checkout session with app metadata was created after the snapshot, without entering a card or charging money. Provider discovery found its missing application mapping and produced a blocked reconciliation report (exit 2). Access did not reopen. The owned synthetic Checkout was expired; fixture accounts, isolated database and ephemeral archives/keys were removed. Production data was not replaced or modified.

This closes the isolated restore/tooling drill. It does not establish a production backup schedule, off-provider storage retention/RPO, external uptime alert delivery, or permission to replace production data. Those operating configuration and paid-pilot gates remain explicit.
