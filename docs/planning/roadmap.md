# Delivery Roadmap

This document owns delivery sequencing and stage status. Product decisions live in `scope.md`; backend task detail lives in `backend-backlog.md`; production gates live in `production-gates.md`.

## Sequence Rule

The delivery order is database-first and POS-first:

1. Create the database schema, tables, migrations, seed/bootstrap flow, and test database workflow.
2. Build the backend required for Staff POS operation.
3. Build the backend required for the browse-only QR menu.
4. Build the Staff POS frontend.
5. Build the browse-only QR-menu frontend.
6. Complete deployment hardening, including Iranian VPS deployment and any CDN decision, last.

Manager/admin and reporting work must not block the POS and QR-menu path unless a current POS/QR dependency requires it. UX research, wireframes, and design assets may be prepared earlier, but they must not drive unfinished backend rules or create a second source of business logic.

## Current Stage Status

No roadmap stage is complete yet.

Current implementation status as of 2 August 2026:

- **Stage 0 — Scope and domain baseline:** partially complete. `scope.md` defines the main v1 scope, non-goals, roles, order states, business rules, architecture direction, and production gates. Remaining exit-gate evidence still needed: ADR files, ERD, API inventory, explicit database constraint list, request/response conventions, and a prioritized backend backlog with acceptance criteria.
- **Stage 1 — Database and backend foundation:** in progress. Implemented so far: pnpm monorepo workspace, strict shared TypeScript config, Prettier/ESLint setup, Fastify API skeleton, environment validation, request IDs, basic logging, CORS/Helmet/Sensible registration, Swagger/OpenAPI plugin registration, PostgreSQL Docker Compose service, Prisma schema/client setup, liveness/readiness routes, graceful shutdown, and API health integration tests.
- **Stage 1 verification:** `pnpm typecheck` passes, and `pnpm --filter @cafe/api test` passes against the current local PostgreSQL connection. `pnpm lint` errors are ignored by project rule in `AGENTS.md`.
- **Stage 1 remaining work:** create the initial database tables, add the initial Prisma migration, create the seed/bootstrap flow for the first Manager, define a separate test database workflow, finish structured error envelopes, decide how OpenAPI schemas are generated from validated request/response schemas, and prove the fresh-environment Stage 1 exit gate.

## Stage Overview

| Stage | Area                                  | Required outcome                                                                                                                                     |
| ----- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scope and domain baseline             | Approved use cases, business rules, state tables, ERD, API inventory, ADRs, and prioritized backlog                                                  |
| 1     | Database and backend foundation       | Database tables, migrations, seed/bootstrap, test database workflow, runnable Fastify service, health checks, and test infrastructure                |
| 2     | POS backend                           | Staff auth, catalog/table data needed by POS, Staff-created orders, payments, receipts, deletion, audit, and barista queue API                       |
| 3     | QR-menu backend                       | Public browse-only menu API for categories, products, options, availability, images, and final Toman prices                                         |
| 4     | Staff POS frontend                    | POS, table operations, barista queue, payment entry, deletion flow, receipt printing, and reconnect/conflict states                                  |
| 5     | QR-menu frontend                      | Mobile-first browse-only public menu with categories, search/filtering, options, availability, images, and final Toman prices                       |
| 6     | Manager and reporting backend         | Manager catalog/user/settings APIs, sales reports, audit queries, indexes, and bounded exports                                                       |
| 7     | Manager frontend                      | Catalog management, Staff accounts, settings, reports, and audit-history interfaces                                                                  |
| 8     | Full-system hardening                 | Integration/contract/E2E coverage, security review, migration rehearsal, performance checks, and API/frontend stabilization                         |
| 9     | Deployment preparation                | Production Compose/Caddy-or-Nginx baseline, backup/restore procedures, monitoring, log rotation, release procedure, and manual fallback runbook      |
| 10    | VPS deployment and pilot              | Iranian VPS deployment, HTTPS, production secrets, restore drill, CDN need check after measurement, and limited live pilot                          |
| Later | Customer ordering                     | Customer cart, table selection, Staff confirmation, preparation handoff, and protected public order submission                                       |

## Stages

### Stage 0 — Scope And Domain Baseline

- Freeze the v1 feature list and explicit non-goals.
- Write the Staff order, payment, deletion, table, Manager, and public-menu use cases.
- Finalize the `PENDING` → `PAID`/`DELETED` state rules and exceptional transitions.
- Create the initial ERD, ownership boundaries, and database constraint list.
- Define request/response conventions, error envelope, pagination, idempotency, and concurrency behavior.
- Record the major decisions as ADRs: modular monolith, PostgreSQL/Prisma, Toman integers, UTC storage with `Asia/Tehran` reporting, Iranian VPS, browser printing, and browse-only QR menu.
- Convert the approved scope into an ordered backend backlog with acceptance criteria.

Exit gate:

- No unresolved decision changes the core order, payment, role, money, time, or deployment model.

### Stage 1 — Database And Backend Foundation

- Create the monorepo, strict TypeScript configuration, formatting, linting, and test commands.
- Set up the Fastify application, feature-module convention, configuration validation, structured errors, request IDs, and logging.
- Set up PostgreSQL, Prisma, initial database tables, migration workflow, seed/bootstrap flow, and separate test database.
- Add liveness/readiness endpoints and graceful shutdown.
- Generate the initial OpenAPI document from validated request/response schemas.
- Create the Docker Compose development baseline without introducing the frontend application yet.

Exit gate:

- A fresh environment can start the API and database, apply migrations, seed the first Manager, pass automated tests, and expose healthy endpoints.

### Stage 2 — POS Backend

- Implement login, logout, access/refresh session rotation, revocation, account deactivation, and first-Manager bootstrap.
- Enforce the two application roles, Manager and Staff, inside routes and service methods.
- Implement the catalog, product option, availability, image metadata, and physical-table reads required for POS order entry.
- Implement table and takeaway order creation by Staff.
- Calculate all prices and totals on the server and persist immutable item/option snapshots in integer Toman.
- Implement controlled edits to `PENDING` orders, table assignment/transfer, and order history.
- Implement logical deletion with actor and timestamp; a reason is optional, including for paid-order deletion. Never physically delete an order.
- Implement manual cash and card-terminal payment records.
- Make payment registration idempotent and transactional with the `PAID` transition and audit entry.
- Provide receipt-ready API data with stable receipt numbers and `Asia/Tehran` display timestamps.
- Provide barista queue reads with polling-compatible APIs.
- Test permissions, duplicate retries, stale edits, invalid transitions, unavailable products, historical price stability, payment reconciliation, and transaction rollback.

Exit gate:

- Staff can complete every POS backend workflow through documented API calls against real PostgreSQL without any frontend dependency.

### Stage 3 — QR-Menu Backend

- Implement public read-only category, product, option, availability, image metadata, and final Toman price endpoints for the QR menu.
- Ensure QR-menu endpoints expose no cart submission, order creation, payment, tracking, table authority, or Staff-only metadata.
- Add response schemas and OpenAPI coverage for the public menu API.
- Test public-response safety, filtering/search behavior, inactive/unavailable items, and historical price boundaries where relevant.

Exit gate:

- Customers can browse the complete current menu through public API calls, with no order-submission capability.

### Stage 4 — Staff POS Frontend

- Create the Next.js application shell, route groups, layouts, shared UI primitives, environment configuration, and typed API client needed by Staff routes.
- Build order channel selection, product/options entry, notes, totals, and controlled pending-order edits.
- Build table assignment/transfer, active-table view, payment entry, deletion/clear flow, and receipt printing.
- Build the barista queue with order number, items, quantities, notes, table/channel, and creation time.
- Handle idempotent retry results, stale-version conflicts, API failures, connection state, and reconnect refetch.
- Validate touch targets, keyboard operation, actual café devices, and the real receipt printer/paper size.

Exit gate:

- Staff can complete every v1 POS operational journey through the interface without database or API tooling.

### Stage 5 — QR-Menu Frontend

- Build the mobile-first public menu with categories, search/filtering, options, availability, final Toman prices, optimized images, and no checkout.
- Ensure the public UI exposes no cart checkout, customer order submission, payment, or tracking states.
- Measure the public menu on representative low-end phones and slow domestic connections.

Exit gate:

- Customers can reliably browse the complete current menu on mobile.

### Stage 6 — Manager And Reporting Backend

- Implement complete Manager-only catalog, product option, image, price, availability, display-order, Staff account, and settings APIs.
- Implement bounded daily, weekly, and monthly sales reports.
- Add payment-method, channel, hour, product, category, discount, and deleted-order breakdowns.
- Define the café’s business-day cut-off and apply `Asia/Tehran` boundaries consistently.
- Add audit queries, export limits, and required database indexes.
- Implement permissioned payment correction/reversal instead of editing posted payments.
- Verify report totals against fixed fixtures and inspect query plans for important ranges.

Exit gate:

- Manager and reporting APIs are documented, permissioned, tested, and bounded.

### Stage 7 — Manager Frontend

- Build category, product, option, image, price, availability, and display-order management.
- Build Staff account creation, deactivation, and session-management interfaces.
- Build settings, sales reports, deleted-order views, payment-correction views, and audit-history search.
- Add confirmation, permission, validation, loading, error, and empty states for every Manager action.

Exit gate:

- A Manager can operate the v1 system without direct server or database access.

### Stage 8 — Full-System Hardening

- Run the critical browser E2E suite across public menu, POS, barista, payment, deletion, receipt, Manager, and reporting journeys.
- Complete integration/contract test coverage for authorization, idempotency, concurrency, payments, reports, and public-response safety.
- Run the security review for cookies/tokens, CSRF, rate limits, uploads, secrets, input limits, and safe logs.
- Rehearse migrations on both a fresh database and a restored production-like database.
- Measure login, order creation/edit/deletion, payments, reports, image handling, queue reads, and public menu response targets.

Exit gate:

- The full system is stable enough to prepare deployment without major behavior or contract changes.

### Stage 9 — Deployment Preparation

- Create the production Docker Compose baseline, Caddy-or-Nginx configuration, backup/restore procedures, monitoring targets, log rotation, release procedure, and manual order fallback runbook.
- Validate accessibility, supported browsers, café devices, QR codes, image sizes, and busy-hour workflows.
- Complete restart, rollback/forward-fix, and clean restore drills without downloading required international dependencies.

Exit gate:

- Deployment is ready to execute on the Iranian VPS, with required procedures and recovery evidence documented.

### Stage 10 — VPS Deployment And Pilot

- Deploy the self-hosted stack to the Iranian VPS with HTTPS, production secrets, health checks, monitoring, backups, and log rotation.
- Check whether the project needs an Iranian CDN only after VPS deployment and real measurement. Do not add a CDN by default.
- Run a limited live café shift with the manual internet-failure fallback, record defects, reconcile all payments, and fix release blockers.

Exit gate:

- All production readiness gates in `production-gates.md` have evidence and the pilot finishes without an unreconciled financial difference.

### Post-v1 — Customer Ordering

Start this only after v1 is stable in production. Define a new state model and ADR before adding the customer cart, table selection, Staff confirmation, preparation handoff, rate limits, idempotency, safe public tokens, and customer-facing failure/retry states.
