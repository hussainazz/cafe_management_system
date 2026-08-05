# Production Gates

This document owns deployment, resilience, quality, fixed production decisions, and production readiness evidence.

Deployment is the last major delivery area. Do not spend implementation time on Iranian VPS deployment or CDN evaluation until the database, POS backend, QR-menu backend, POS frontend, QR-menu frontend, Manager/reporting work, and full-system hardening are ready enough to measure.

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
| Integration  | Real PostgreSQL constraints and transactions    | Order creation, selected-item settlement, mixed tender, card transfer, reversal, logical deletion, idempotency, stale-version conflict, rollback                                                                         |
| API contract | Request/response and authorization behavior     | OpenAPI schema, error envelope, Manager-only routes, forbidden actions                                                                                                                                                   |
| Browser E2E  | Small complete journeys                         | Staff login, POS order and concise bar-ticket print, selected-item mixed-tender/card-transfer settlement, delete/clear table, detailed customer whole-order/settlement receipt, Manager price change, public menu browse |
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
| Business correctness | Critical open/deleted, unpaid/partially-paid/paid, settlement allocation, table timing, concise bar-ticket, detailed customer-receipt, and price/timing-snapshot scenarios pass with known Toman totals. |
| Security             | HTTPS, secure session controls, CSRF controls, rate limits, Manager/Staff authorization review, secret handling, safe logging, dependency scan.                                                          |
| Data safety          | Migration test, automated backup, successful clean restore, retention policy, disk monitoring.                                                                                                           |
| Reliability          | Restart recovery, readiness checks, stale-client conflicts, idempotent retries, and café-internet-loss/manual-fallback behavior tested.                                                                  |
| Operations           | Versioned release, rollback/forward-fix procedure, log access, alerts, Manager recovery, operator runbook.                                                                                               |
| Hardware and UX      | Actual POS device, browser, network, receipt printer, paper size, both bar-ticket/customer-receipt layouts, touch targets, and busy-hour workflow tested.                                                |
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
