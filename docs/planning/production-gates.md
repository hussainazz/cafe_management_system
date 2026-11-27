# Production Gates

## SEP SSP1126 activation gate (ADR 0012)

Ship disabled. Prove health/preflight from the actual HTTPS POS in Windows 8.1
Firefox ESR 115, record delivered CSP and proxy/VPN behavior, and verify an
IPv4 loopback-only socket before financial operations. No browser security
exceptions or LAN firewall opening. Inspect vendor logging before loading SEP.
Use protected per-installation credentials, durable single-dispatch recovery,
verified result posting, and audited reconciliation. Test uncertain approval,
restart, duplicate/concurrent requests, and cash/split regressions with fakes.
Validate a .NET Framework 4.8 x86 artifact and matching dependency hashes, with
quiet least-privilege Task Scheduler startup, SSH diagnostics, and rollback.
Per-attempt payment timing must be available from the cashier JSONL journal and
as `TERMINAL_PAYMENT_TIMING` rows on the VPS; use
[`sep-payment-timing.md`](../runbooks/sep-payment-timing.md) to compare distinct
attempt IDs. Timing measurements are operational evidence, not payment results.
The 0.2.0 bridge dispatched the supervised 350,000 Toman test as attempt
`3ae7bd3a-07e5-4cbd-a107-c86f2f032a41` for order
`456e0c4e-61b9-4154-ab58-63322f458704`. Its phase details were not persisted,
so the journal cannot show whether `PcStarterPurchase` was entered. The cashier
clock was about 9 seconds behind the signed backend issue time, within the
30-second allowance; authorization validation passed. The operator found no
receipt or debit, and the POS audit now records that attempt as `FAILED` with no
settlement. The order remains OPEN/UNPAID with 350,000 Toman due, and no
unresolved terminal attempts remain for it.

Version 0.2.1 with local allowlisted worker-phase diagnostics was transferred,
verified, and installed under the existing account. It preserves the pairing,
attempt journal, and old binary. At install the task and both payment switches
were disabled; no device call occurred. Following the user's explicit retry
request, both Windows payment switches and `SEP_TERMINAL_ENABLED` are now true,
the Task Scheduler task is Running, and loopback health reports 0.2.1 with
payment enabled. API readiness and database health returned 200. Any payment
must originate through the authenticated POS workflow; do not issue a direct
bridge request or retry if a result is uncertain.
The final ZIP in cashier Documents has SHA-256
`b10ed2af00ea851c62f46a00f5fde98ddfcb32fc53316633057eb385a24dfb6c` and its
installed executable/DLL hashes match the package manifest.

Two subsequent POS attempts were created for this order. Attempt
`4e72ae38-6b21-4c52-a892-91cf6b28de92` is `FAILED`, reconciled with
`TERMINAL_RECEIPT`. Attempt
`26f4fe04-7faa-491c-998d-49921f8813ad` was reconciled `FAILED` with
`TERMINAL_RECEIPT`, no response code, and no linked settlement. Its audit records
no-charge, terminal-idle, and bridge-stopped confirmations. Its 0.2.1 diagnostic
confirms `ConnectionTest` returned `00`, then
`PcStarterPurchase` was entered and returned null (worker exit code 1); SDK
cleanup succeeded. The local evidence cannot establish whether the purchase
message was sent or whether the terminal/bank approved it. The operator saw a
terminal communication message. Staff later reconciled it as no-charge after
checking records. New initiation has been paused: backend flag
false, both Windows payment configs false, task Disabled, no worker/listener.
The API is active; direct and POS-prefixed readiness return 200. The operator
reports no matching bank transaction for the latest terminal attempt. A
separate manual POS settlement `3377c445-ea5d-47e9-94c3-453faa90f11e` was
recorded seven seconds after the no-charge reconciliation as 350,000 Toman
`CARD_TERMINAL`; it is not linked to the terminal attempt. The order is now
CLOSED/PAID, and the user confirms this separate settlement corresponds to an
actual debit. A fresh production query confirms the paid order and settlement.
Keep terminal initiation disabled while validating the 0.2.3 lifecycle fix.
Do not substitute the earlier ConnectionTest for a purchase result.

### 0.2.3 lifecycle diagnosis and cashier verification — 29 October 2026

Static inspection of the pinned SDK IL confirmed the null-result path. The
successful `ConnectionTest()` ends a synchronous transaction, and SDK network
disposal closes the channel and clears its connection settings. The previous
bridge called `PcStarterPurchase()` on that closed factory; the SDK guard then
returned null before constructing or sending a purchase message. The 0.2.3
worker now reapplies `SetLan` and `Initialization(English, 10, Sync)` between
the connection test and purchase call. Fake lifecycle tests verify that order.

Version 0.2.3 was transferred, remotely checksum-verified, and installed under
the existing cashier account. A hidden Windows health-only launch returned
version 0.2.3 and the expected disabled/manual-verification fields. The host was
stopped; final inspection confirmed the task remains Disabled, both payment
switches remain false, and no bridge/worker/listener remains. No terminal SDK
call or financial operation occurred. Thus the lifecycle fix is installed but
has not yet had a supervised hardware purchase test. Keep backend and Windows
payment initiation disabled until that test is explicitly approved. A timeout,
null result, or lost response remains UNKNOWN and must not be retried. Receipt or
bank verification and audited reconciliation remain required before posting.

### Authorized 590,000 Toman supervised checkout — 29 October 2026

The user authorized one charge for order
`46f27c22-cf07-48c1-8cdd-6af015313de5`. A read-only production check showed
OPEN/UNPAID, 590,000 Toman due, version 1, and no terminal attempt for the
order; no unresolved terminal attempts exist. The backend terminal flag was
enabled and `cafe-api.service` restarted; internal readiness returned 200. On
the cashier, both 0.2.3 payment switches were enabled with vendor logging off,
and the task was started. `/health` reports payments mode; `netstat` confirms
the only listener is `127.0.0.1:18711`. No purchase has been initiated. The
cashier must explicitly start the amount-matched POS checkout while watching
the Q80. After outcome inspection, disable the backend flag and both Windows
switches, stop and disable the task, and confirm no listener. Any uncertain
outcome stays UNKNOWN pending receipt/bank reconciliation; do not retry.

### Amount-unit incident and 0.2.4 local correction — 29 October 2026

The supervised bridge attempt for the order above was attempt
`e3a0a92e-ebc1-484f-a098-47c7902b3e48`. Production read-only evidence showed
OPEN/UNPAID, 590,000 Toman due, no settlement, and attempt status UNKNOWN.
Windows diagnostics show intent authorization and claim succeeded, the pinned
SDK hashes matched, `SetLan`, initialization, `ConnectionTest` (`00`, terminal
`31187710`), and purchase reinitialization passed, then
`PcStarterPurchase` returned response code `98`; cleanup and worker exit code 0
were recorded. The SDK defines `98` as cancellation. The bridge source passed
the 590,000 Toman value unchanged while the terminal displayed 590,000 instead
of the expected 5,900,000 Rial. The remembered terminal display
`signum(13)` is not identified in the official local SDK material. Its exact
meaning and causal link to the amount remain unverified.

After inspection, `SEP_TERMINAL_ENABLED` was set false and the API returned
ready. The cashier task is Disabled; both 0.2.3 payment switches are false;
the host and worker are stopped; port 18711 has no listener. No payment was
initiated during diagnosis. The operator reports no debit and cleared terminal
history, but the durable attempt remains UNKNOWN until an authenticated audited
POS reconciliation; do not retry this attempt.

Local bridge 0.2.4 now converts authorized integer Toman to Rial exactly once
(`590000` -> `5900000`) before the SDK call. Fake payment, host, worker-guard,
lifecycle and amount tests passed. The disabled x86/net48 artifact and manifest
were verified; ZIP SHA-256 is
`6d7937b87e891f3287eda0e3a9e86ec515a0884ba18f544b5de32822256d879d`. The
artifact is not transferred or installed. Keep both initiation controls disabled; any new supervised
hardware test requires separate explicit authorization and amount confirmation.

### Bridge activation retry — 30 October 2026

After the user requested activation, the 0.2.4 x86 package was transferred with
the recorded SHA-256, staged, and upgraded under the existing Windows account.
The scheduled task is Running; bridge health reports `mode=payments`,
`paymentEnabled=true`, `terminalAccess=true`, and
`manualVerificationRequired=true`. Windows `netstat` shows the only listener at
`127.0.0.1:18711`. The VPS configuration has
`SEP_TERMINAL_ENABLED=true`; `cafe-api.service` is active and readiness reports
the database connected. Public `/pos/release` reports `cafe-sep-75a2f4a`.
No purchase worker or payment was initiated during verification. This enables
the terminal option in the authenticated POS settlement window; it does not
resolve the earlier UNKNOWN attempt. The cashier must explicitly initiate a
new, amount-confirmed checkout and reconcile its evidence before posting.

This document owns deployment, resilience, quality, fixed production decisions, and production readiness evidence.

## Live VPS Observation (2026-09-01)

The following snapshot was collected read-only from the configured ArvanCloud VPS
(`ubuntu@185.97.116.250`). It describes the current host, not the desired end
state; secret values are intentionally excluded.

### Deployed tree and release shape

- The deployed application root is `/opt/cafe-menu`.
- The checkout contains `apps/api`, `apps/web`, shared `packages`, `docs`, and
  `infra` directories, plus installed dependencies and generated runtime output.
- The deployed root has no `.git` metadata, so the VPS is an artifact/runtime
  installation rather than a source-controlled checkout. Release identity must
  therefore be recorded by the release procedure or deployment manifest.
- The API has compiled output under `apps/api/dist` and generated Prisma output.
  The web app has a production `.next` directory and a prior release snapshot at
  `apps/web/.next.before-local-20260830`.
- A rollback archive exists at
  `/opt/cafe-menu-release-backups/menu-before-20260830-122409.tar.gz`.

### Current process and network topology

```text
Internet :80/:443
        ↓
      Nginx (active)
        ↓
  127.0.0.1:3000  Next.js web, cafe-web.service
  127.0.0.1:3001  Fastify API, cafe-api.service
        ↓
  PostgreSQL dependency used by the API
```

- `cafe-web.service` is enabled and active, runs as user `cafe`, and starts
  `pnpm --filter @cafe/web exec next start --hostname 127.0.0.1 --port 3000`.
- `cafe-api.service` is enabled and active, runs as user `cafe`, and starts the
  compiled `dist/src/server.js` through the API package start script.
- Both services use `Restart=on-failure` and currently report `NRestarts=0`.
- Nginx is active and owns ports 80 and 443. Caddy is inactive.
- No Docker containers were running during the audit. The repository's Compose
  file therefore remains a development/baseline configuration, not the current
  production runtime mechanism.

### Verification observed

- `http://127.0.0.1:3000/menu` returned HTTP 200.
- `/api/v1/health/live` returned HTTP 200.
- `/api/v1/health/ready` returned HTTP 200.

This proves local process and dependency readiness at the audit time. It does
not yet prove public-domain routing, HTTPS certificate renewal, external backup
retention, clean restore, log rotation, alerting, printer operation, or a live
pilot. Those remain production-gate evidence to collect.

### Consequences for the release method

The current safe release flow is artifact-based: build and validate locally,
preserve production environment/secrets, database, uploads, and runtime data,
create a rollback archive, copy only the verified changed runtime artifacts to
`/opt/cafe-menu`, restart the affected systemd service, and retry health checks
after startup. Do not build, seed, or run migrations on the VPS as an incidental
part of a frontend release. The intended Docker Compose/Caddy architecture stays
documented as a hardening target until it is deliberately implemented and
verified.

### Database migration gate and 2026-10-05 incident

Release `pos-20261005-978da8b` activated API code that queried the new
`product_category_memberships` table before its migration had been staged or
applied on the VPS. API readiness still returned healthy because it checked
database connectivity, not whether the deployed schema matched the API. The
public-menu API then returned HTTP 500, the web proxy returned HTTP 503, and
the public menu showed its unavailable state even though `/menu` itself returned
HTTP 200.

Recovery used a PostgreSQL 17-compatible database dump, validated with
`pg_restore --list`. The release's Prisma schema and
`20261005120000_promotional_category_memberships` migration were staged on the
VPS. `prisma migrate status` showed that migration as pending, and
`prisma migrate deploy` applied it. No reset or seed ran. The API, web proxy,
and public menu then returned HTTP 200, and the migration status showed all 30
migrations applied. The migration created schema only; it did not copy local
category records or uploaded product images.

For every API release that changes Prisma schema:

- Include the matching Prisma schema and complete reviewed migration directory
  in the versioned release artifact and manifest. Do not activate API code if
  its required migration is absent from staged files.
- Before activation, take a PostgreSQL-version-compatible backup and validate
  it with `pg_restore --list`. Run `prisma migrate status` against the target
  database and compare every pending migration with the staged, reviewed set.
- Apply required additive migrations with `prisma migrate deploy` after the
  verified backup and before activating code that reads the new schema. Never
  use `migrate reset` or run a seed as part of this release gate. Plan breaking
  schema changes as separate expand and contract releases.
- After activation, check the affected API route directly and through its web
  proxy, then inspect the public page content. For the public menu, verify
  `/api/v1/public/menu`, `/api/public-menu`, and `/menu`; a 200 from `/menu` or
  database-connected readiness alone does not prove that the new schema works.
  Confirm expected category and product data and that the unavailable fallback
  is absent.
- If migration status, functional probes, or application logs show a schema
  mismatch, stop the release. Keep the previous compatible API active or roll
  back the artifact, then apply the reviewed migration and repeat the probes.

### Inventory finance release — 15 November 2026

Release `cafe-20261115-aadc136` is deployed from `main` commit
`aadc1364f4bf3e03caf05d5ffe0d0336659d1a11`. Its verified artifact SHA-256 is
`f127536f21e77f40f23ea4009d2a8ed7d8b19ba8bb94bbe73cbc2efa35c91b10`. The
artifact contains the API runtime, matching contracts, POS production output,
Prisma schema, and all migration files. It excludes secrets, developer-local
product images, POS development/cache output, source maps, and unchanged public
assets.

Before activation, production migration status showed exactly three pending
migrations: `20261115120000_packaging_economics_price_history`,
`20261115150000_sales_analytics_item_entry`, and
`20261115170000_pricing_experiments`. A PostgreSQL 17.12 client created a
custom-format backup from the PostgreSQL 17.11 production server; `pg_restore
--list` passed. The validated backup is
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261115-aadc136.dump`
(SHA-256 `99132b6b9d6a8adcca6971ca399b96b1d58bdbbdf81696c977899cbc594a0e52`).
The previous runtime rollback archive was also captured and validated at
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261115-aadc136.tar.gz`
(SHA-256 `721d0cdf5a298fb31bdc7799ebcaa5e0f08f3d3f59c6975c5eeb1e8bd2e3f249`).

All three additive migrations applied successfully; the post-release status
reports all 53 migrations current. The baseline created 366 `BASELINE` price
history records, and the pricing-experiment table was empty after migration.
API liveness/readiness, the direct API public-menu route, the web public-menu
proxy/page, POS page, and public `/pos/release` returned expected responses.
The new Manager analytics and pricing routes responded with 401 without an
authenticated session. `cafe-api.service`, `cafe-pos.service`, and
`cafe-web.service` are active with zero automatic restarts. POS-uploaded image
storage remains 32 files / 5,759,237 bytes.

The production migration and route checks are complete. Physical café-device
acceptance remains a separate operational gate.

### Developer Manager parity release — 16 November 2026

Released commit `33362add26a2b1dafc32ea7a2527318f90122cc9` as
`cafe-20261116-33362ad` after committing and pushing each changed file
separately. The coordinated API, contracts, and POS artifact SHA-256 is
`df8fe6dc0634ee98f9cebf3c791fc01f4427ed35594f792b51935ebfae8ada0d`. It
contains the API runtime, matching contracts, POS production output, and
Prisma metadata. It excludes secrets, developer-local product images, POS
development/cache output, source maps, declarations, tests, the unused RHEL
Prisma engine, and unchanged public assets.

Production migration status was already current at all 56 migrations; this
release contains no schema change and required no migration. The PostgreSQL
17.11 custom-format pre-release backup passed `pg_restore --list` with 435
entries: `/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261116-33362ad.dump`
(SHA-256 `cf5a8b899d7f6226230f455e7b0aaa27734db07461407c0bad98b8aa75e689a6`).
The verified rollback archive is
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261116-33362ad.tar.gz`
(SHA-256 `02e8083dd37e591be3b1ad3f110038b6cb70e222d9edf70de1683a75f45632d4`).

API liveness/readiness and public HTTPS `/pos` and `/pos/release` returned
HTTP 200. `/pos/release` reports `cafe-20261116-33362ad` with
`Cache-Control: no-store, max-age=0`. Gross-profit, sales-channel,
sales-analytics, and pricing-experiment routes return 401 without
authentication. API, POS, web, and Nginx services are active with zero
automatic restarts. Product-image storage remains at 32 files / 5,759,237
bytes; no environment or product-image data was transferred. Physical
café-device acceptance remains open.

### Next.js artifact transfer rule

The shared local `.next` directory can retain large Turbopack development and
build caches. These files are not production runtime artifacts and previously
expanded a menu release from about 42 MB to 424 MB, causing repeated transfer
timeouts before staging completed.

- Never transfer `.next/dev/` or `.next/cache/` to production.
- Package the remaining production `.next` output and required public assets as
  one compressed, resumable archive instead of synchronizing thousands of files
  individually over the current slow VPS connection.
- Transfer into a versioned staging directory with a timeout sized for the
  measured connection speed; do not diagnose a short transport timeout as an
  SSH, permissions, or application failure without a single-file transfer check.
- Compare local and remote archive checksums before extraction. Verify staged
  `BUILD_ID`, `server/`, `static/`, required public assets, and the absence of
  `dev/` and `cache/` before activation.
- Back up the active `.next` and public images before swapping, restart only
  `cafe-web.service`, allow for its startup delay, then verify the release ID,
  build ID, internal and public `/menu`, representative rendered image URLs,
  service state, logs, and `NRestarts`.

### POS release identity and safe browser update

Every POS activation must build the complete compatible POS/API artifact set
with one immutable staged release ID. Pass it as `POS_RELEASE_ID` to the local
POS build; it becomes the POS Next.js `BUILD_ID`, the browser's loaded ID, and
the deployed `GET /pos/release` response. That response must use
`Cache-Control: no-store`. Do not deploy a POS artifact whose release ID does
not name the compatible API/migration artifact set.

The POS shell polls that endpoint every 45 seconds. A changed ID shows the
Persian update banner. It must never force-refresh a draft, an open table or
takeaway workspace, settlement/dialog, transfer, request, or print workflow.
When the POS is idle it shows a 10-second warning then reloads; an operator can
reload immediately, but a dirty draft requires browser confirmation. Verify the
endpoint both locally and through public `/pos` after every POS release.

### Prisma native-engine release rule

This repository can be built on a RHEL-family workstation while the VPS runs
Debian with OpenSSL 3. A locally generated Prisma client that contains only the
workstation's `rhel-openssl-3.0.x` engine cannot start on the VPS. This has
caused more than one failed production activation and is a mandatory release
check, not an optional optimization.

- Keep `binaryTargets = ["native", "debian-openssl-3.0.x"]` in
  `apps/api/prisma/schema.prisma`.
- Run `pnpm --filter @cafe/api prisma:generate` and the API build locally after
  any Prisma schema/client change.
- The copied API runtime must include
  `apps/api/dist/generated/prisma/libquery_engine-debian-openssl-3.0.x.so.node`.
  Verify that exact file on the VPS before restarting `cafe-api.service`.
- Deploy the matching `packages/contracts/dist` together with an API build when
  that API imports newly added contract exports; do not restart an API artifact
  against an older contracts runtime.
- Treat the first readiness probe as a startup race only after the systemd log
  shows the API listening. A Prisma engine or missing-export error is a release
  failure and requires rollback or a corrected local artifact.

The public-menu artifact release is live for the browse-only menu and its
supporting API. The shared POS, payment, printer, Manager, and full-system
pilot gates have since been completed; see `../current-left.md` for the café
completion record.

## Deployment And Operations

### Public-menu traffic analytics

- Use the active VPS Nginx access log as the source for server-observed `/menu`
  requests, QR redirect/landing correlation, peak Tehran hours, response-body
  traffic, image/static-file payloads, and approximate distinct client IPs.
- Log a JSON record with the normalized URI, replacing `/t/:token` with a fixed
  redacted path. Do not log the raw request line, query string, customer
  cookies, referer, or user-agent. The only cookie-derived field is the
  non-secret QR request ID, mapped to a dedicated field on `/menu`. Keep the
  existing maximum 14-day raw-log retention.
- Set a short-lived, HttpOnly, Secure, SameSite=Lax QR-attribution cookie from
  the Nginx request ID on `/t/:token`; log it only on `/menu`. Clear it on the
  `/menu` response. Pair that landing with the `/t/` request ID. Count the
  `/menu` landing once and report QR redirect requests separately; never add
  redirect requests to page-request totals.
- Run a local scheduled aggregator that reads rotated and active access logs,
  buckets timestamps in `Asia/Tehran`, and persists daily aggregate summaries.
  Monthly unique-IP estimates must merge daily distinct-count sketches rather
  than sum daily counts. Do not retain raw IPs or request-level identifiers in
  permanent summaries.
- Report exact HTTP status-code counts separately for menu-service responses
  and other Nginx-routed services. Include the highest daily body-byte total,
  menu-image bytes, and other-service bytes. Detect public menu images from
  `/_next/image` when used, `/media/products/`, the compatibility
  `/api/product-images/` path, legacy bundled image paths, and image response
  types; do not assume images are requested from `/menu`.
- Treat Nginx request counts as HTTP requests, not confirmed people or page
  renders. Treat `$body_bytes_sent` totals as returned response-body payload;
  they exclude headers and transport overhead, and cached responses may send
  zero body bytes.
- If a CDN is activated, label Nginx measurements as origin-side traffic because
  cache hits no longer reach the VPS. Add provider-sourced Cache Hit Ratio,
  bytes delivered to clients, and origin bytes alongside the Nginx report;
  do not estimate CDN delivery from origin logs. Cache only an explicit public
  image allowlist: canonical `/media/products/*` responses and any separately
  approved compatibility or `/_next/image` paths. Bypass public caching for
  other `/api/` endpoints and all `/pos/` content; never apply a generic
  `/api/*` cache rule.

Deploy one self-hosted authoritative stack on an Iranian VPS:

```text
Customer phone / Staff POS / Manager browser
                ↓
     Iranian domestic internet + domain/DNS
                ↓
              Iranian VPS
  Caddy or Nginx + Next.js + Fastify + PostgreSQL
       + self-hosted images + Docker Compose
```

This allows the system to operate during loss of international connectivity only while the café can still reach domestic internet and the VPS/DNS provider is reachable. If the café’s own internet connection fails, v1 cannot create authoritative orders; the café needs a documented manual fallback procedure until service returns.

Operating rules:

- Do not make production operation depend on Vercel, a foreign CDN, Google Fonts, foreign object storage, external authentication, or foreign runtime APIs.
- Bundle/self-host application assets, fonts, committed static menu images, Docker images needed for rollback, dependency lockfiles, migrations, and deployment scripts.
- POS-uploaded product images are runtime café data stored under the API `PRODUCT_IMAGE_STORAGE_DIR`. Never include developer-local uploads from `apps/api/data/product-images/` in a release archive or transfer them to the VPS during deployment. Preserve the existing VPS image directory during release and rollback. Transfer image data only for a separately authorized data migration.
- Use the shared `@cafe/contracts` product-media URL helpers for both menu and
  POS images. Browser-facing product image URLs use `/media/products/*`;
  content-hashed bundled assets are generated under
  `apps/web/public/media/products/bundled/`, and unique uploaded storage keys
  use the public read-only API route. `NEXT_PUBLIC_PRODUCT_IMAGE_BASE_URL` is
  deprecated and ignored. Preserve legacy image endpoints and files during
  migration, and package the generated content-hash files with the web release.
- A CDN is not required for one café. Optimize images, serve them with cache headers, and check whether an Iranian CDN is needed only after the VPS deployment is running and real measurements show a need.
- Stage 10's local route timings and live public-path measurements are recorded in [the response-time benchmark report](../performance/stage-10-response-times.md). Use wider customer-device and network samples before deciding whether to add a CDN.
- Docker Compose runs web, API, PostgreSQL, and required image storage. Caddy or Nginx handles HTTPS and WebSockets.
- Validate production configuration at startup. Inject secrets; never commit or bake them into images.
- Expose separate liveness and readiness checks. Readiness fails when required dependencies are unavailable.
- Automated backups have documented retention and are stored separately from the primary VPS. Complete a clean restore drill before pilot and after material schema changes.
- Keep exactly one verified rollback bundle for the previously active coordinated API/menu/POS release and one verified pre-release database backup on the primary VPS. Create and validate each replacement before removing the previous copy; never delete the active deployment, the only verified rollback bundle, or the only verified database backup during a release or pilot. Preserve the uploaded product-image storage in place during backup, cleanup, deployment, and rollback. Retain no more than 14 days of logs on the VPS.
- Each release runs reviewed migrations, records the deployed version, and has a rollback or forward-fix plan that does not require downloading an international dependency.
- Log rotation and alerts cover readiness, database connectivity, disk space, backup failure, and repeated server errors.
- Maintain an operator runbook for deployment, startup/shutdown, backup/restore, user recovery, bar-ticket and customer-receipt setup, and manual order fallback.

## Testing And Quality Strategy

| Level        | Purpose                                         | Examples                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit         | Fast tests for pure rules and state transitions | Toman arithmetic, option validation, discount allocation, settlement allocation, payment-status transitions, permission predicates                                                                                       |
| Integration  | Real PostgreSQL constraints and transactions    | Order creation, selected-item settlement, mixed tender, card transfer, reversal, logical deletion, idempotency, stale-version conflict, table occupancy/reminder, pending waiter-call deduplication and table-opening resolution, rollback |
| API contract | Request/response and authorization behavior     | OpenAPI schema, error envelope, shared Staff/Manager/Developer POS access, Manager/Developer daily report and reversal-policy settings, Developer-only inventory analysis and pricing-experiment routes, optional correction reasons, shared item/order discounts, eligible occupied-table credential boundaries, forbidden actions |
| Browser E2E  | Small complete journeys                         | Shared POS login, order and concise bar-ticket print, selected-item mixed-tender/card-transfer settlement, QR-scan occupancy reminder, highlighted waiter-call table opening, delete/clear table, detailed receipt, role-gated Manager/Developer panels, public menu browse |
| Operational  | Release and recovery behavior                   | Migration, health checks, restart recovery, backup restore, printer output, smoke tests                                                                                                                                  |

Definition of done for a feature:

- Write the use case and acceptance rule.
- Make authorization, validation, transaction, error, and audit behavior explicit.
- Include database constraints and a migration where relevant.
- Test risky behavior at the appropriate unit, integration, contract, or browser level.
- Update API documentation for backend changes and interface states for frontend changes.
- Ensure logs contain useful context without secrets.
- Exercise the affected workflow in staging when both backend and frontend exist.

## Production Readiness Gates

| Gate                 | Required evidence                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Business correctness | Critical open/deleted, unpaid/partially-paid/paid, settlement allocation, table timing, occupancy/reminder flow, eligible-table waiter-call, concise bar-ticket, detailed customer-receipt, and today/yesterday report scenarios pass with known Toman totals. |
| Security             | HTTPS, secure session controls, CSRF controls, rate limits, Manager/Staff/Developer authorization review, secret handling, safe logging, dependency scan.                                                 |
| Data safety          | Migration test, automated backup, successful clean restore, explicit full order/payment-history retention despite the two-day report window, retention policy, disk monitoring.                           |
| Reliability          | Restart recovery, readiness checks, stale-client conflicts, idempotent retries, and café-internet-loss/manual-fallback behavior tested.                                                                  |
| Operations           | Versioned release, rollback/forward-fix procedure, log access, alerts, Manager recovery, operator runbook.                                                                                               |
| Hardware and UX      | Actual POS device, shared Staff/Manager/Developer dashboard, waiter-call alert, Chrome on the café's Windows POS computer, network, receipt printer, paper size, both print layouts, touch targets, and busy-hour workflow tested. |
| Pilot                | A limited live shift runs with the fallback procedure; issues are recorded and no unreconciled financial difference remains.                                                                             |

## Recent Release Evidence

### POS packaging, Cashier, and inventory report release — 18 November 2026

- Released `cafe-20261118-4666e31` to the VPS from runtime implementation
  commit `4666e3119518480f7b392ce75194dbe8bbbc2268`. Test-only follow-up commits
  were pushed separately; final `main` head is
  `4bfdc441ffdf3edca8febf8cc0d0ed0a93c975b6`.
- The versioned artifact SHA-256 is
  `8e4796db052e1dbcf4b3b86ff137c90fb0eaf3a6e36e0a7ce18244ccce293795`.
  It contains the API runtime, contracts build, POS production build, Prisma
  schema/config and migrations, including the Debian Prisma engine. It excludes
  environment files, uploaded product images, POS development/cache output,
  standalone output, source maps, declarations, and unchanged POS public assets.
- The PostgreSQL 17.11 pre-release custom-format backup is
  `/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261118-4666e31.dump`
  (SHA-256 `b8816948df3c55573bf30954ca15ce28342ae35eb39a5225ab14856377dde000`);
  `pg_restore --list` validated it. The coordinated rollback archive is
  `/opt/cafe-menu-release-backups/rollback-before-cafe-20261118-4666e31.tar.gz`
  (SHA-256 `03f74c06c98217c2a6f128b2877a0bd324b48d308ea4d8b17dee105d4c8d8ea2`);
  its contents and exclusions were checked. After both replacements validated,
  the older release's backup pair and temporary runtime copies were removed.
- Production applied `20261118120000_product_served_alongside`,
  `20261118130000_add_cashier_role`, and
  `20261118140000_order_packaging_assignments`. Prisma reports all 59 migrations
  current. API readiness reports the database connected; API, POS, and web
  services are active with zero restarts. Public `/pos/release` returns HTTP 200,
  the new release ID, and `Cache-Control: no-store, max-age=0`; `/pos` and `/menu`
  return HTTP 200.
- The VPS product-image directory remains at 32 files / 5,759,237 bytes. No
  product-image data or environment file was transferred. Café-device browser,
  touch, and receipt-printer acceptance remains open.

### Full API, contracts, and POS release — 18 November 2026

Released `cafe-20261118-f66d791` from `main` commit
`f66d791cec5b3e3e1185f5e6802b5208df37de76`. The coordinated artifact SHA-256
is `a90a9864ae8240d41ee77dfd329a1623d6fc8a86c579e236593cab58b00bf819`.
It contains the API runtime, matching contracts, POS production build, Prisma
schema/configuration, and all migrations, including the Debian Prisma engine.
It excludes environment files, product images, Next.js development/cache/
standalone/types/diagnostics/Turbopack output, API test/seed output, source maps,
declarations, the unused RHEL engine, and unchanged POS public assets.

The PostgreSQL 17.11 custom-format pre-release backup
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261118-f66d791.dump`
passed `pg_restore --list` with 430 entries (SHA-256
`f09f386bfb81c6907f4fd86a865453dc9eb3b644636b9376e4e91ccabe36d6be`). The
coordinated runtime rollback archive
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261118-f66d791.tar.gz`
passed archive validation (SHA-256
`c3e7d97775e6c85e50f4e5f790ece484fc4ae66c39f84af40f16138b07a4c071`). The
previous verified backup/rollback pair was removed only after both replacements
validated. Production applied `20261118150000_personnel_profiles` and
`20261118160000_retire_packaging_fee_sales`; Prisma reports all 61 migrations
current.

API (30 files / 270 tests), POS (35 files / 259 tests), and contracts (10 files
/ 32 tests) suites passed. All three typechecks and production builds passed.
After activation at `2026-11-18T17:52:09Z`, direct API liveness/readiness and
public-menu API, public `/api/public-menu`, `/menu`, and direct/public `/pos`
returned HTTP 200. Direct and public `/pos/release` report
`cafe-20261118-f66d791` with `Cache-Control: no-store, max-age=0`. API, POS,
and web services are active with zero restarts; web and Nginx were not changed.
Product-image storage remains 32 files / 5,759,237 bytes; no image or
environment data was transferred.

The existing POS systemd command starts the release successfully but Next.js
logs advisory warnings for `output: standalone` and the deprecated `static`
directory. Direct and public POS smoke routes pass. Authenticated POS-browser,
café-device, touch, and printer acceptance remains open.

### Full API, contracts, and POS release — 19 November 2026

Released `cafe-20261119-7d01337` from immutable runtime commit
`7d01337ff5236a80fd9fb505ae9f04af6da3016d`. The artifact SHA-256 is
`7bbeb7f52af41a9c10b433db2c8f86c7d17890421f6c2dd29f962afb95b5e86a`
(9,121,181 bytes). The prepared manifest binds the release ID, source commit,
artifact hash, and POS `BUILD_ID`; its uploaded SHA-256 was
`2c72f954f61999b72b3ad259226669a92341501e48f6483cdece4067c9d83e2e`. All 377
manifested files matched their hashes after VPS extraction and again in the
active runtime. The Debian OpenSSL 3 Prisma engine and generated client load;
contract imports, Node `v24.21.0`, pnpm `11.0.0`, Next `16.3.8`, the existing
dependency manifests, and the POS `BUILD_ID` were verified. The runtime archive
excludes secrets and developer-local product-image uploads.

Before migration, the PostgreSQL 17.11 custom-format pre-release dump
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261119-7d01337.dump`
passed `pg_restore --list` with 424 entries; SHA-256 is
`48d7f3c01e61498f1677a348cb8ef8f75a1ee00a4a462988aeb5e6b4990a9353`. The
coordinated, same-disk code rollback archive
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261119-7d01337.tar.gz`
passed tar validation and was extracted to a protected verification directory;
its saved runtime files matched the active pre-release files byte-for-byte.
Its SHA-256 is
`044d1498a4c93de5cb54861bed3d8191b4288bfdf2a622e05c29c807b0c6620b`. Both
artifacts remain root-private. Runtime rollback is code-only; the database
stays migrated forward.

The database had 61 applied migrations and no unfinished migration before
activation. Staged Prisma reported exactly one pending migration:
`20261119120000_restore_order_packaging_assignments`. The historically recorded
checksum for `20260918143000_add_pos_only_packing_products` differs from the
unchanged Git/deployed/staged migration file; the database has
`b5b5735df52994fe72dae334b28456cafa3bc99078396924a0b5194f80b05506`, while all
three file copies hash to
`a78fe2a2b3e9ec093899645d152b3565fce9eeb2721e23d49d199c03215cce28`. No
existing migration file or production metadata was changed to suppress it.
Prisma accepted the staged deploy and applied only the reviewed migration.
Production now reports 62 applied migrations and no unfinished migration; the
restored composite order-item key exists, the old `products_packing_inactive`
constraint is absent, and the assignment table exists.

The verified 18 November dump retained exactly eight recoverable packaging
assignment rows. Before retiring that source dump, the rows were extracted on
the VPS into the root-private replay input
`/opt/cafe-menu-release-backups/assignment-recovery-cafe-20261119-7d01337.json`
(SHA-256
`aaa2b491da9ceb1a034226abe1d9dace0a67126ef8d11291fd36e480208cfec5`). One SQL
transaction inserted and checked all eight exact rows before commit. The final
read-only comparison found eight exact rows and eight valid same-order links,
zero product over-counts, and the one audited legacy packaging-quantity
mismatch. The legacy order-line quantity and snapshot were left unchanged.
The protected replay input is retained with the new full database backup.

The migration restored 16 existing `PACKING` products to active and available
at their existing 20,000 Toman catalog price; all remain nonpublic and
unarchived. Four open unpaid orders were present during activation and remain
stored. No production payment, checkout, print, reset, seed, full-snapshot
restore, SEP change, service-config change, or environment-file change was
made. The activation snapshot had four open unpaid orders; a later read-only
snapshot counted six open orders as café activity continued. No reset or order
replay occurred. Product-image storage remains at 32 files / 5,759,237 bytes.
The image directory was never in the upload or copy scope; its
post-activation aggregate tree SHA-256 is
`095ef326e10251e3b8f228b7d1f9dd5c20ec765dae5a40e330a2d8ebc6d8366c`.

Activation began at `2026-11-19T12:58:12Z`. The API process started at
`12:59:48Z` and POS at `13:00:20Z`; API and POS service restarts completed with
zero `NRestarts`, exit status 0, and active state. Web and Nginx remained active
and were not restarted. Direct and public API readiness, `/api/public-menu`,
`/menu`, `/pos`, and `/pos/release` all returned HTTP 200. Direct, web-proxy,
and public menu APIs each returned 16 categories and 144 products. Local and
public menu HTML each returned 144 server-rendered product-card nodes. Direct
and public POS release endpoints report `cafe-20261119-7d01337` with
`Cache-Control: no-store, max-age=0`. Direct and POS-proxied unauthenticated
order routes returned HTTP 401. Production journal inspection recorded no
error-level entries after activation. Authenticated browser, café-device,
touch, and printer acceptance remains open in `docs/current-left.md`.

### Deferred takeaway payment release — 19 November 2026

Released `cafe-20261119-5d71c8e` from source commit
`5d71c8e09f150c1944a990b1b69b5e0fd58fb274`. The coordinated API/contracts/POS
artifact SHA-256 is
`643a9fb587c8a90738a574f0a7e3eb92a780b0d9ed724ee85fee98641eaa0296`
(9,293,147 bytes; 556 archive entries and 422 manifested payload files). The
POS `BUILD_ID` matches the release ID. The artifact contains all 62 migration
files and the Debian OpenSSL 3 Prisma engine; it excludes environment files,
secrets, product-image uploads, `node_modules`, and Next.js development/cache
output.

Before activation, PostgreSQL 17.11 production was backed up with PostgreSQL
17.12 client tools to
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261119-5d71c8e.dump`.
`pg_restore --list` validated its 434 entries; SHA-256 is
`57e478cb0b0cfb803ddb7e950e3cd51403ea97f1accf98cc2d8a0ca218d21b9e`. The
code-only rollback archive
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261119-5d71c8e.tar.gz`
passed archive validation; its 386 saved runtime files matched the previous
active runtime byte-for-byte. Its SHA-256 is
`505239994ef8000b40d3caf17353a4ecbd12d47dfb26c0c9becac64380d9195e`. Both
recovery artifacts were verified before deleting the superseded 7d01337 backup
pair. The separate packaging-assignment recovery input remains retained.

Activation ran from `2026-11-19T17:17:22.168608Z` to
`2026-11-19T17:17:49.840173Z`. No production migration was applied; Prisma
reports 62 migrations found and the schema up to date. Direct API liveness and
readiness, direct/public POS readiness, direct/public `/pos`, the public menu
page and proxy, and direct/public `/pos/release` all returned HTTP 200. Both
release endpoints report `cafe-20261119-5d71c8e` with
`Cache-Control: no-store, max-age=0`. Direct and public menu APIs each returned
16 categories and 141 products. API, POS, web, and Nginx are active; API and POS
restarted for activation with exit status 0 and zero `NRestarts`. Web and Nginx
were not restarted. No production payment, checkout, or print was performed by
the release.

Product-image storage remains 32 files / 5,759,237 bytes with tree SHA-256
`d85b72b8e06b01ec20fcdb158703b8607a5ba97c045b0cae354f5748ad5b4553`; no image
or environment data was transferred. API/POS error-level journal count after
activation was zero. Authenticated POS-browser, café-device, touch, and receipt
printer acceptance remains open in `docs/current-left.md`.

### Responsive takeaway panel release — 19 November 2026

Released `cafe-20261119-f4228c9` from source commit
`f4228c901d706e15adbc8c2f578e632ba20f1116`. The coordinated API/contracts/POS
artifact SHA-256 is
`17809e663e59357d7af4b4d5162b62582b974779e88dd5b66eb45c16afd1767f`
(17,566,823 bytes; 589 manifested files). Its POS `BUILD_ID` matches the
release ID. All 62 migrations and the Debian OpenSSL 3 Prisma engine are
included. Environment files, secrets, product-image uploads, `node_modules`,
Next.js development/cache output, source maps, and declarations are excluded.

The PostgreSQL 17.11 production database was backed up with PostgreSQL 17.12
client tools to
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261119-f4228c9.dump`.
`pg_restore --list` validated 434 entries; SHA-256 is
`57fb043b458f474cbfa3bcb59f0bda438e0bf10d96579c22281cb3d21485cd51`.
The code rollback archive
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261119-f4228c9.tar.gz`
contains 561 entries; all 429 saved runtime files matched the active runtime
byte-for-byte. Its SHA-256 is
`e260b1d510fd21113d8aa14a733d98598dab66447527a42f12eed8486cc89530`. After
both replacements were verified, the superseded 5d71c8e database and rollback
files were removed. The separate assignment-recovery input remains retained.

Activation ran from `2026-11-19T18:12:05.124856Z` to
`2026-11-19T18:12:22.587654Z`. No production migration was applied; Prisma
reports 62 migrations found and the schema up to date. Direct API liveness and
readiness, direct/public POS readiness, direct/public `/pos`, the public menu
page and proxy, and direct/public `/pos/release` all returned HTTP 200. Both
release endpoints report `cafe-20261119-f4228c9` with
`Cache-Control: no-store, max-age=0`. Direct and public menu APIs each returned
16 categories and 141 products. API, POS, web, and Nginx are active with zero
`NRestarts`; web and Nginx were not restarted. No production payment, checkout,
or print was performed by this release.

Product-image storage remains 32 files / 5,759,237 bytes with tree SHA-256
`d85b72b8e06b01ec20fcdb158703b8607a5ba97c045b0cae354f5748ad5b4553`; no image
or environment data was transferred. The local POS layout was inspected at
320 × 568, 464 × 584, 900 × 600, 1264 × 480, and 1264 × 704. Authenticated
production POS-browser and café-device acceptance remains open in
`docs/current-left.md`.

## Decisions Fixed Before Implementation

| Decision              | Fixed default                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money unit            | Integer Toman for storage and display.                                                                                                              |
| Tax/service charge    | None. Catalog prices are final.                                                                                                                     |
| Business day/timezone | Store UTC; display/report using `Asia/Tehran` calendar boundaries. The cafe is always open, so v1 has no configurable business-day cut-off.         |
| Customer submission   | Not in v1. QR menu is browse-only.                                                                                                                  |
| Roles                 | Manager, Staff, and Developer; POS uses one shared application with role-gated access.                                                               |
| Deployment            | One Iranian VPS, self-hosted stack, one writable PostgreSQL database. The public menu and table QR links remain at the root domain; the shared POS is served at `/pos`. API release artifacts must include the Prisma `debian-openssl-3.0.x` engine for the current Debian-family VPS OS. |
| Receipt integration   | Hidden same-origin iframe printing from the Windows POS browser using the shared Persian RTL thermal documents. The browser print workflow must be configured on the café POS computer; no QZ Tray, VPS-side browser, `lp`, direct USB, or raw ESC/POS integration. |
| Table cleanup         | `DELETED` is logical deletion with an audit record; no deletion reason is required, including for paid orders. It never physically removes records. |

## ArvanCloud CDN origin preparation — 24 November 2026

Production Nginx was backed up before the origin changes. The validated archive
is `/opt/cafe-menu-release-backups/nginx-config-before-arvan-cdn-20261124T101414Z.tar.gz`
(SHA-256
`fba80b0a38b8df54fc336e9ec9bc00eda2f3c3b9c816d81b0b3ecf1182002725`). The
active routing and cache boundary are recorded in
[`arvan-cdn-origin-readiness.md`](../runbooks/arvan-cdn-origin-readiness.md)
and represented by the `operations/nginx/cafe-menu-*` templates.

Nginx now returns one `private, no-store` cache header for POS HTML and APIs,
root APIs other than the public product-image proxy, menu/customer endpoints,
QR exchange redirects, other dynamic responses, and HTTP redirects. It hides
upstream `Cache-Control` only on these dynamic locations. Successful public
product-image responses and fingerprinted web/POS assets retain their existing
cache headers. QR correlation cookies, auth cookies, and the existing
upstream routes are preserved. Upstream `X-Real-IP` and `X-Forwarded-For` are
set from Nginx's `$remote_addr`; the real-IP module trusts only the official
ArvanCloud ranges from `https://www.arvancloud.ir/en/ips.txt` and the
documented `ar-real-ip` header. No firewall allowlist was added.

Nginx syntax passed before and after a graceful reload. Nginx, API, POS, and web
are active with zero service restarts. Direct-origin checks passed for `/menu`,
`/pos`, `/pos/release`, `/api/public-menu`, `/api/table-context`, unauthenticated
POS auth/order APIs, QR redirect behavior, public images, and fingerprinted
assets. Every checked dynamic response had exactly one private/no-store header;
public image/static responses retained exactly one existing public cache
header. A loopback request carrying forged `ar-real-ip`, `X-Real-IP`, and
`X-Forwarded-For` values remained logged as `127.0.0.1`.

The HTTP-01 webroot is `/var/lib/letsencrypt`; a temporary origin preflight file
returned HTTP 200/no-store at the public domain, and a missing token returns
404/no-store. Certbot's renewal method is `webroot` with the Nginx installer.
`certbot reconfigure` completed a staging validation for both current SANs. The
separate renewal file backup is
`/opt/cafe-menu-release-backups/certbot-renewal-before-arvan-cdn-20261124T103257Z.conf`
(SHA-256
`dd75f67c6146199e9fc55e7bf75e8ad78af14abc81581266bf93bf36da766cab`). The
production certificate serial and its `runncafe.ir` plus `www.runncafe.ir`
SANs remain unchanged; expiry is 24 January 2027. `certbot.timer` is active.
A separate `certbot renew --dry-run` invocation was stopped during Certbot's
randomized delay before challenge validation; no production certificate was
written. The successful `reconfigure` staging check is the ACME validation for
this preparation.

The CDN proxy and DNS were not activated or changed. Therefore, edge TLS,
Arvan's forwarded-client header at the origin, and CDN-mediated ACME pass-
through still require verification after activation. Until then, keep
`/.well-known/acme-challenge/*` uncached and allowed to reach the origin on
HTTP port 80. If `www` is permanently removed from DNS, the current SAN set
cannot complete HTTP-01 renewal; an approved apex-only certificate replacement
must precede removing `www`. No database, QR token, payment, or print data was
changed.

## Coordinated API, contracts, web, POS, and origin-media release — 25 November 2026

Released `cafe-20261125-0737cb8` on the configured production VPS. The
application/operations source commit for this release is
`b73c211ea8c066d65ff294045d766e21be211616`. API,
contracts, web, and POS production builds use runtime source commit
`0737cb849e7892d19f5bcc87d6680de2cde35647`; the separately committed Nginx
regex quoting correction is included from `b73c211`. The POS `.next/BUILD_ID`,
direct `/pos/release`, public-origin `/pos/release`, active manifest, and
artifact all match the immutable release ID.

The verified release artifact is
`/opt/cafe-menu-release-staging/cafe-20261125-0737cb8/cafe-20261125-0737cb8.tar.gz`,
SHA-256
`1becdce8f97c93bfe153e274ac7147d7e3e9e3a1190884f6b0c0b1381e0d8273`
(57,374,401 bytes; 629 manifested runtime files). It includes the complete 67
Prisma migrations, schema/config, Debian OpenSSL 3 engine, API/contracts/web/POS
builds, 56 generated bundled menu images, product-media generator, analytics
runtime, dependency manifests, and Nginx templates. The release manifest is
installed at `/opt/cafe-menu/release-manifest.json`; all 629 deployed file
hashes match it. Environment files, secrets, `node_modules`, developer-local
product-image uploads, Next.js standalone/dev/cache/types/diagnostics output,
source maps, declarations, and test output are excluded.
Contracts, API, web, and POS production builds passed before packaging; no
additional automated test suite was run during activation.

Before changing production, PostgreSQL 17.11 was backed up to
`/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261125-0737cb8.dump`.
PostgreSQL 17 `pg_restore --list` validated 449 entries; the archive SHA-256 is
`79e79991bec2a5050e5578e62d200e08cc3e76ab5319119b5c37edf1aec28da7`
(87,841,995 bytes). The code-only coordinated rollback archive is
`/opt/cafe-menu-release-backups/rollback-before-cafe-20261125-0737cb8.tar.gz`
(SHA-256
`1b9eea087498af2eb40ff16433290eb842e42f3808c340a873215a36e282929c`;
582 entries). The fresh `/etc/nginx` backup is
`/opt/cafe-menu-release-backups/nginx-config-before-cafe-20261125-0737cb8.tar.gz`
(SHA-256
`38e45156fd23ec1ea3ef6b3ea5b126cf01f3cf99ffef215d8659ef8321337f31`;
26 entries), with active-file checksums in
`/opt/cafe-menu-release-backups/nginx-config-checksums-before-cafe-20261125-0737cb8.sha256`
(five entries; SHA-256
`0cce2d6e4036d60909161817a5195c56e3c889d52aca8ab9c6bb1aa4c9979471`).
The previous release's database and code rollback pair was removed only after
the new pair and activation were verified. The separate packaging-assignment
recovery input remains retained.

Production Prisma reported exactly these five pending migrations in the
staged artifact:

- `20261123120000_shared_packaging_price`
- `20261123130000_estimated_product_costing`
- `20261123140000_estimated_recipe_source_constraint`
- `20261123150000_widen_order_cogs_amounts`
- `20261124100000_stock_reference_purchase`

The five reviewed migrations were applied with the staged Prisma configuration
using `prisma migrate deploy`, before activating code that reads their schema.
The production migration status now reports all 67 migrations current. No
database reset or seed ran. The pre-migration aggregate had 5,074 orders, 5,055
payment settlements, 85 packaging assignments, and one café settings row. The
post-activation aggregate had 5,075 orders, 5,055 settlements, 85 assignments,
and one settings row; the order total rose by one while the café continued
operating. All 16 internal PACKING products are active, available, nonpublic,
and unarchived. The production recipe-cost constraint preflight found zero
violations.

The first staged Nginx check caught the bundled-media regex brace as an
unquoted configuration token. The corrected template was committed and pushed
before reload; the final `nginx -t` passed and Nginx was gracefully reloaded.
The active cache snippet SHA-256 is
`5891034f2b78885e25be766f096327891ba25cf16675817ff010ec6133b48328`; the new
HTTP-context product-media map is
`0a92718bb274396e17024e5d2f9e2724d11986f136215ff7e4af680385e9b69a`. Existing
analytics and Arvan real-IP configurations remain unchanged at hashes
`2af19a110db4ce3d04756f79773e6675008a4343190b420d50f6cff01e2d998f` and
`48056336c34670c812bbaa2b91b7782a6621b14b3b1901e296284aaf3db1cbe9`.

API, POS, web, and Nginx are active with zero automatic restarts. Direct API
readiness, web menu, and POS probes return HTTP 200; direct and public release
endpoints report `cafe-20261125-0737cb8`. Direct and public menu API responses
each contain 16 categories and 140 products. The origin HTTPS matrix returned
200 for public menu, POS, `/pos/release`, public-menu API, POS readiness,
successful canonical uploaded and bundled images (GET and HEAD), the legacy
image route, and a fingerprinted static asset. Missing or malformed image
paths return 404. Each successful canonical image response has one
`public, max-age=2592000, immutable` header; the legacy image route retains its
one-year immutable header. Dynamic pages/APIs and errors have one
private/no-store policy. Unauthenticated POS `/api/v1/auth/me` returns 401
through the POS proxy; the invalid QR probe redirects with correlation cookies;
a missing HTTP-01 token returns 404/no-store.

The production image directory remains 32 files / 5,759,237 bytes with
unchanged tree SHA-256
`63b3456041b0d9447b6035b5082522c6513e400625baf0f75a7d908be247d0e3`. No image
or environment data was transferred or mutated. No payment, checkout, or
print was performed. Production browser, touch, cashier workflow, and receipt
printer acceptance remains open. ArvanCloud proxy, DNS, and edge TLS were not
activated.

The changed web workspace manifest added `@cafe/contracts`, while the existing
production installation lacked that workspace link. A noninteractive
`pnpm exec` status attempt began pnpm's automatic workspace reconciliation and
aborted before modifying `node_modules`; the installed Prisma CLI then
confirmed all migrations current, and the web workspace symlink was added to
the already-deployed contracts package. No dependency installation, database
reset, or seed ran during this release.

## POS inventory display and purchase selection release — 27 November 2026

Activated POS-only release `pos-20261126-aeb663f` on the configured production
VPS. The source changes were pushed to `main` in separate per-file commits:
`0dad82e`, `aeb663f`, `a65f480`, and `39d8740`. Runtime source commit is
`aeb663f59f9e350b0a725ddeeb45cbfc8e79e7bd`.

The artifact contains only the 150 manifested files under `apps/pos/.next`;
SHA-256 is
`f418fb6c288bf8955ed7de64b47e9110ddaf8fca6bcb67a9c38108b2a1375fe3`
(945,722 bytes). The active manifest and POS `.next/BUILD_ID` both report
`pos-20261126-aeb663f`. Schema changes are false and no migrations were applied;
the production migration count remains 67. The verified POS rollback archive is
`/opt/cafe-menu-release-backups/pos-before-pos-20261126-aeb663f.tar.gz`, SHA-256
`4b82c02f77f8c7e9b929404cef5c0d92699184482bede692c98dfb3158f57d43`.

Direct and public POS pages returned HTTP 200. Direct API readiness, direct and
proxied POS API readiness returned HTTP 200. Direct and public `/pos/release`
returned the new release ID with `no-store` caching. API, POS, web, and Nginx
were active in the activation report; POS and web `NRestarts` were 0, while API
`NRestarts` was 1. The report is
`/opt/cafe-menu-release-staging/pos-20261126-aeb663f/activation-report.json`.
The first activation attempt restored the previous POS runtime when the
`Type=simple` service was still transitioning; after updating the helper to wait
for service and endpoint readiness, the retry activated successfully in 6.2
seconds. No API, web, database, payment, checkout, print, or product-image data
was changed by this POS-only activation.
