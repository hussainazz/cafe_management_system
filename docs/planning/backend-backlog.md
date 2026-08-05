# Backend Backlog

This document tracks backend work extracted from the roadmap. Product and business rules live in `scope.md`; sequencing and stage status live in `roadmap.md`; production readiness lives in `production-gates.md`.

## Current Backend Status

Stage 0 and Stage 1 are in progress. No roadmap stage is fully complete yet. Backend work follows this priority: database/tables first, POS backend second, QR-menu backend third.

Current verification:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes against the current local PostgreSQL connection.
- `pnpm lint` errors are ignored by project rule in `AGENTS.md`.

## Stage 0 Backlog — Scope And Domain Baseline

Done:

- v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and the database-first/POS-first roadmap are documented.
- ADR files for modular monolith, PostgreSQL/Prisma, Toman integers, UTC storage with `Asia/Tehran` reporting, Iranian VPS, browser printing, browse-only QR menu, and settlement allocation are documented.
- Initial ERD is documented.
- API inventory is documented in `api-inventory.md`, including operational, identity, POS, public-menu, Manager, reporting, and planned realtime boundaries.
- Database constraints are explicitly documented in `database-constraints.md`, including keys, foreign keys, checks, indexes, and transactional invariants.

Left:

- Document request/response conventions, error envelope, pagination, idempotency, and concurrency behavior.
- Convert the approved scope into a prioritized backend backlog with acceptance criteria.

Exit gate:

- No unresolved decision changes the core order, payment, role, money, time, or deployment model.

## Stage 1 Backlog — Database And Backend Foundation

Done:

- pnpm monorepo workspace.
- Shared strict TypeScript config.
- Prettier and ESLint setup.
- Fastify API skeleton.
- Environment validation.
- Request IDs and basic logging.
- CORS, Helmet, and Sensible registration.
- Swagger/OpenAPI plugin registration.
- PostgreSQL Docker Compose service.
- Prisma schema/client setup.
- Liveness and readiness routes.
- Graceful shutdown.
- API health integration tests.

Left:

- Create the initial database tables.
- Add the initial Prisma migration.
- Create the seed/bootstrap flow for the first Manager.
- Define a separate test database workflow.
- Finish structured error envelopes.
- Decide how OpenAPI schemas are generated from validated request/response schemas.
- Prove the fresh-environment Stage 1 exit gate.

Exit gate:

- A fresh environment can start the API and database, apply migrations, seed the first Manager, pass automated tests, and expose healthy endpoints.

## Stage 2 Backlog — POS Backend

- Implement login, logout, access/refresh session rotation, revocation, and account deactivation. The first Manager is created by the Stage 1 operations-only bootstrap command.
- Enforce the two application roles, Manager and Staff, inside routes and service methods.
- Implement the catalog, product option, availability, image metadata, product preparation-deadline, physical-table seating-limit, and active table ETA reads required for POS order entry.
- Implement table and takeaway order creation by Staff.
- Calculate all prices, totals, estimated preparation minutes, and table release estimates on the server and persist immutable item/option/timing snapshots.
- Implement controlled edits to `OPEN`, `UNPAID` orders, table assignment/transfer, and order history; reject edits after the first settlement.
- Implement logical deletion with actor and timestamp; a reason is optional at every payment status. Never physically delete an order.
- Add order-version concurrency protection and creation idempotency.
- Implement per-payer settlements that allocate selected order-item quantities and contain one or more cash, card-terminal, or card-to-card transfer tenders.
- Make each settlement recording idempotent and transactional; update the order's `UNPAID`/`PARTIALLY_PAID`/`PAID` status and audit entry from active allocations.
- Provide concise bar-ticket and detailed customer-receipt API data with stable order numbers, timing snapshots, and `Asia/Tehran` display timestamps. Bar-ticket data must exclude prices, discounts, totals, and payment information; customer receipts retain the financial detail for whole orders and settlements.
- Test permissions, duplicate retries, stale edits, invalid transitions, unavailable products, historical price/timing stability, selected-item allocation, mixed tender, card-transfer references, settlement reversal, payment reconciliation, and transaction rollback.

Exit gate:

- Staff can complete every POS backend workflow through documented API calls against real PostgreSQL without any frontend dependency.

## Stage 3 Backlog — QR-Menu Backend

- Implement public read-only category, product, option, availability, image metadata, product preparation-deadline, and final Toman price endpoints for the QR menu.
- Ensure QR-menu endpoints expose no cart submission, order creation, payment, tracking, table authority, or Staff-only metadata.
- Add response schemas and OpenAPI coverage for the public menu API.
- Test public-response safety, filtering/search behavior, inactive/unavailable items, and historical price boundaries where relevant.

Exit gate:

- Customers can browse the complete current menu through public API calls, with no order-submission capability.

## Stage 6 Backlog — Manager And Reporting Backend

- Implement complete Manager-only catalog, product option, image, price, product preparation-deadline, table seating-limit, availability, display-order, Staff account, and settings APIs.
- Implement bounded daily, weekly, and monthly sales reports.
- Add payment-method, channel, hour, product, category, discount, settlement-reversal, and deleted-order breakdowns.
- Apply `Asia/Tehran` calendar boundaries consistently. The cafe is always open, so v1 has no configurable business-day cut-off.
- Add audit queries, export limits, and required database indexes.
- Implement permissioned full-settlement reversal instead of editing posted tenders or allocations.
- Verify report totals against fixed fixtures and inspect query plans for important ranges.

Exit gate:

- Manager and reporting APIs are documented, permissioned, tested, and bounded.

## Stage 8 Backlog — Backend Stabilization For Full-System Hardening

Full-system hardening may pass only when:

- All v1 endpoints and events are represented in the reviewed OpenAPI contract.
- Unit, PostgreSQL integration, API contract, authorization, idempotency, and concurrency suites pass.
- Migrations work on both a fresh database and a restored production-like database.
- Login, order creation/edit/deletion, payments, reports, image handling, and public-menu reads meet measured response targets.
- Security review covers cookies/tokens, CSRF, rate limits, uploads, secrets, input limits, and safe logs.
- Seed/bootstrap, backup, restore, and rollback/forward-fix procedures are documented.
- Remaining backend changes are treated as controlled contract changes rather than informal UI-driven edits.
