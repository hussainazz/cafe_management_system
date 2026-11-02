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
- Leave `NEXT_PUBLIC_PRODUCT_IMAGE_BASE_URL` unset to use the menu's same-origin `/api/product-images` proxy, which forwards opaque storage keys to the API image route without exposing the API host. Keep committed static menu images, such as `apps/web/public/items_pictures/`, in the application release when required.
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
| API contract | Request/response and authorization behavior     | OpenAPI schema, error envelope, Staff catalog/sale-discount/payment-history access, Manager-only daily report and reversal-policy settings, optional correction reasons, shared item/order discounts, eligible occupied-table credential boundaries, forbidden actions |
| Browser E2E  | Small complete journeys                         | Shared POS login, order and concise bar-ticket print, selected-item mixed-tender/card-transfer settlement, QR-scan occupancy reminder, highlighted waiter-call table opening, delete/clear table, detailed receipt, Manager role-gated panels, public menu browse |
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
| Security             | HTTPS, secure session controls, CSRF controls, rate limits, Manager/Staff authorization review, secret handling, safe logging, dependency scan.                                                          |
| Data safety          | Migration test, automated backup, successful clean restore, explicit full order/payment-history retention despite the two-day report window, retention policy, disk monitoring.                           |
| Reliability          | Restart recovery, readiness checks, stale-client conflicts, idempotent retries, and café-internet-loss/manual-fallback behavior tested.                                                                  |
| Operations           | Versioned release, rollback/forward-fix procedure, log access, alerts, Manager recovery, operator runbook.                                                                                               |
| Hardware and UX      | Actual POS device, shared Staff/Manager dashboard, waiter-call alert, Chrome on the café's Windows POS computer, network, receipt printer, paper size, both print layouts, touch targets, and busy-hour workflow tested.                    |
| Pilot                | A limited live shift runs with the fallback procedure; issues are recorded and no unreconciled financial difference remains.                                                                             |

## Decisions Fixed Before Implementation

| Decision              | Fixed default                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money unit            | Integer Toman for storage and display.                                                                                                              |
| Tax/service charge    | None. Catalog prices are final.                                                                                                                     |
| Business day/timezone | Store UTC; display/report using `Asia/Tehran` calendar boundaries. The cafe is always open, so v1 has no configurable business-day cut-off.         |
| Customer submission   | Not in v1. QR menu is browse-only.                                                                                                                  |
| Roles                 | Manager and Staff only; POS uses Staff.                                                                                                             |
| Deployment            | One Iranian VPS, self-hosted stack, one writable PostgreSQL database. The public menu and table QR links remain at the root domain; the shared POS is served at `/pos`. API release artifacts must include the Prisma `debian-openssl-3.0.x` engine for the current Debian-family VPS OS. |
| Receipt integration   | Hidden same-origin iframe printing from the Windows POS browser using the shared Persian RTL thermal documents. The browser print workflow must be configured on the café POS computer; no QZ Tray, VPS-side browser, `lp`, direct USB, or raw ESC/POS integration. |
| Table cleanup         | `DELETED` is logical deletion with an audit record; no deletion reason is required, including for paid orders. It never physically removes records. |
