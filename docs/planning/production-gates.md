# Production Gates

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

The public-menu deployment path was deliberately brought forward after the
QR-menu backend and frontend for the release deadline. It covers only the
browse-only menu and its supporting API; it does not satisfy the later shared
POS, payment, printer, Manager, or full-system pilot gates. Those remain in the
post-deployment roadmap stages.

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
- Bundle/self-host application assets, fonts, product images, Docker images needed for rollback, dependency lockfiles, migrations, and deployment scripts.
- A CDN is not required for one café. Optimize images, serve them with cache headers, and check whether an Iranian CDN is needed only after the VPS deployment is running and real measurements show a need.
- Docker Compose runs web, API, PostgreSQL, and required image storage. Caddy or Nginx handles HTTPS and WebSockets.
- Validate production configuration at startup. Inject secrets; never commit or bake them into images.
- Expose separate liveness and readiness checks. Readiness fails when required dependencies are unavailable.
- Automated backups have documented retention and are stored separately from the primary VPS. Complete a clean restore drill before pilot and after material schema changes.
- Each release runs reviewed migrations, records the deployed version, and has a rollback or forward-fix plan that does not require downloading an international dependency.
- Log rotation and alerts cover readiness, database connectivity, disk space, backup failure, and repeated server errors.
- Maintain an operator runbook for deployment, startup/shutdown, backup/restore, user recovery, bar-ticket and customer-receipt setup, and manual order fallback.

## Testing And Quality Strategy

| Level        | Purpose                                         | Examples                                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit         | Fast tests for pure rules and state transitions | Toman arithmetic, option validation, discount allocation, settlement allocation, payment-status transitions, permission predicates                                                                                       |
| Integration  | Real PostgreSQL constraints and transactions    | Order creation, selected-item settlement, mixed tender, card transfer, reversal, logical deletion, idempotency, stale-version conflict, table occupancy/reminder, pending waiter-call deduplication and table-opening resolution, rollback |
| API contract | Request/response and authorization behavior     | OpenAPI schema, error envelope, Manager-only product sale-discount configuration/payment history/daily report, shared item/order discounts, eligible occupied-table credential boundaries, forbidden actions |
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
| Hardware and UX      | Actual POS device, shared Staff/Manager dashboard, waiter-call alert, browser, network, receipt printer, paper size, both print layouts, touch targets, and busy-hour workflow tested.                    |
| Pilot                | A limited live shift runs with the fallback procedure; issues are recorded and no unreconciled financial difference remains.                                                                             |

## Decisions Fixed Before Implementation

| Decision              | Fixed default                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Money unit            | Integer Toman for storage and display.                                                                                                              |
| Tax/service charge    | None. Catalog prices are final.                                                                                                                     |
| Business day/timezone | Store UTC; display/report using `Asia/Tehran` calendar boundaries. The cafe is always open, so v1 has no configurable business-day cut-off.         |
| Customer submission   | Not in v1. QR menu is browse-only.                                                                                                                  |
| Roles                 | Manager and Staff only; POS uses Staff.                                                                                                             |
| Deployment            | One Iranian VPS, self-hosted stack, one writable PostgreSQL database.                                                                               |
| Receipt integration   | Browser print for v1.                                                                                                                               |
| Table cleanup         | `DELETED` is logical deletion with an audit record; no deletion reason is required, including for paid orders. It never physically removes records. |
