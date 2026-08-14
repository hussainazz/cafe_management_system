# Backend Backlog

This document tracks backend work extracted from the roadmap. Product and business rules live in `scope.md`; sequencing and stage status live in `roadmap.md`; production readiness lives in `production-gates.md`.

## Current Backend Status

Stages 0 and 1 are complete. Stage 2 is in progress. Backend work follows this
priority: database/tables first, POS backend second, QR-menu backend third.

Current verification:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes against the current local PostgreSQL connection.
- `pnpm lint` errors are ignored by project rule in `AGENTS.md`.
- Stage 2 authentication is implemented and verified: unique Staff/Manager
  usernames, signed access sessions, rotating hashed refresh sessions,
  logout/logout-all revocation, account-deactivation revocation, and safe auth
  event records.
- Stage 2 authorization is implemented and verified: Staff routes allow Staff
  and Manager users, Manager-only guards return `403 FORBIDDEN` to Staff users,
  missing sessions return `401 AUTHENTICATION_REQUIRED`, and a Manager-only
  account-deactivation service check prevents route-bypass authorization.
- Product sale discounts are Manager-only catalog configuration. Staff and
  Managers may apply reasoned item-level or order-level discounts to open
  orders; every applied discount is snapshotted and audited.
- The 13 August 2026 fresh-environment rehearsal applied both migrations to a
  new database, created exactly one Manager, rejected a repeat bootstrap, and
  returned healthy liveness/readiness responses.

## Stage 0 Backlog — Scope And Domain Baseline

Done:

- v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and the database-first/POS-first roadmap are documented.
- ADR files for modular monolith, PostgreSQL/Prisma, Toman integers, UTC storage with `Asia/Tehran` reporting, Iranian VPS, browser printing, browse-only QR menu, and settlement allocation are documented.
- Initial ERD is documented.
- API inventory is documented in `api-inventory.md`, including operational, identity, POS, public-menu, Manager, reporting, and planned realtime boundaries.
- Database constraints are explicitly documented in `database-constraints.md`, including keys, foreign keys, checks, indexes, and transactional invariants.
- Request/response conventions are documented in `request-response-conventions.md`, including error envelopes, pagination, idempotency, and concurrency behavior.
- The approved scope is converted into the prioritized backend backlog below, with acceptance criteria for each implementation work item.

Left:

- None.

Exit gate:

- No unresolved decision changes the core order, payment, role, money, time, or deployment model.

## Prioritized Backend Implementation Backlog

### P0 - Stage 1 Foundation Exit Gate

#### P0.1 Initial Database Schema And Migration

Build the Prisma models and initial migration for the v1 ERD and explicit
database constraints.

Acceptance criteria:

- The Prisma schema represents the v1 entities in `erd.md` and the constraint
  list in `database-constraints.md`.
- The first migration creates all required tables, enums, keys, foreign keys,
  checks, uniqueness rules, and indexes that PostgreSQL can enforce directly.
- Cross-row invariants that PostgreSQL cannot enforce plainly are documented in
  service-level comments or tests before dependent services rely on them.
- A fresh PostgreSQL database can apply the migration without manual SQL edits.

#### P0.2 First Manager Bootstrap

Create the operations-only bootstrap flow for the first Manager account.

Acceptance criteria:

- The bootstrap command creates exactly one initial `MANAGER` user with a
  hashed password and refuses to run after any Manager exists.
- The command is not an HTTP route and is excluded from the public OpenAPI
  contract.
- Missing, weak, or malformed bootstrap inputs fail with the structured error
  convention or a clear CLI error.
- The created Manager can be used by the Stage 2 authentication work without
  changing the schema.

#### P0.3 Separate Test Database Workflow

Define and automate a database workflow that keeps integration tests isolated
from development data.

Acceptance criteria:

- Test commands use a separate database URL from local development.
- The test workflow can create, migrate, reset, and dispose of test data
  repeatably.
- API integration tests can run against real PostgreSQL without sharing state
  between test cases.
- The workflow is documented for a fresh environment.

#### P0.4 Structured Error Envelope Implementation

Implement the documented application error envelope for API routes.

Acceptance criteria:

- Validation, authentication, authorization, conflict, business-rule, rate
  limit, internal, and dependency failures return the stable envelope from
  `request-response-conventions.md`.
- Error responses include the effective `requestId` and safe timestamp.
- Error details never expose stack traces, raw database errors, credentials,
  tokens, cookies, or password hashes.
- Health endpoints may keep their operational response shape as documented.

#### P0.5 Validated Schemas And OpenAPI Generation

Make validated request/response DTO schemas the source of truth for OpenAPI.

Acceptance criteria:

- Route schemas are defined as Zod DTOs or an approved equivalent that matches
  `request-response-conventions.md`.
- Generated OpenAPI includes request headers, path/query/body schemas, success
  responses, and expected error responses for each implemented route.
- Implemented routes and `api-inventory.md` stay in sync in the same change.
- Contract tests can verify that generated OpenAPI is available from
  `/documentation/json`.

#### P0.6 Fresh Environment Proof

Prove the Stage 1 exit gate end to end.

Acceptance criteria:

- A fresh checkout can install dependencies, start PostgreSQL and the API, apply
  migrations, and seed the first Manager using documented commands.
- Liveness and readiness endpoints return healthy results after startup.
- Typecheck and the relevant API test suite pass against the fresh database.
- Any required environment variables are documented and validated at startup.

### P1 - Stage 2 POS Backend

#### P1.1 Staff And Manager Authentication

Implement Staff/Manager login, refresh, logout, session revocation, and account
deactivation.

Acceptance criteria:

- Active Staff and Manager users can authenticate and receive secure
  application sessions.
- Refresh rotation and logout revoke old refresh sessions.
- Deactivated accounts cannot create or refresh sessions.
- Authentication events are recorded without storing secret material.

#### P1.2 Role Authorization

Enforce Manager and Staff permissions in routes and service methods.

Acceptance criteria:

- Staff-access routes allow Staff and Manager users.
- Manager routes reject Staff users with `403 FORBIDDEN`.
- Missing or expired sessions return `401` with the documented envelope.
- Authorization tests cover both route guards and service-level protections for
  important commands.

#### P1.3 POS Catalog And Table Reads

Implement Staff reads for sellable catalog data and active table timing.

Acceptance criteria:

- POS catalog reads return active categories, sellable products, options,
  availability, final Toman prices, image metadata, and preparation deadlines.
- Table reads return active tables, seating limits, active order summaries,
  estimated preparation minutes, and estimated release times.
- Inactive or archived data is hidden unless a documented Staff use case
  requires it.
- Response DTOs do not expose Manager-only metadata or persistence internals.

#### P1.4 Staff Order Creation

Implement table and takeaway order creation by Staff.

Acceptance criteria:

- The server validates availability and calculates all prices, discounts,
  totals, timing, and table estimates from authoritative data.
- Order items store immutable product, option, price, and timing snapshots.
- `POST /api/v1/orders` requires an idempotency key and retries do not create
  duplicate orders.
- Creation writes order, items, snapshots, idempotency record, version, and
  audit data atomically.

#### P1.5 Order Reads And Controlled Edits

Implement order detail/history reads plus controlled edits to `OPEN` orders.

Acceptance criteria:

- Staff can list/search orders with documented filters and cursor pagination.
- Order details include item/option snapshots, payment status, totals,
  settlements, timing, table context, and current `version`.
- Content and table edits require `expectedVersion`.
- Before the first settlement, Staff may edit order content, discount, notes,
  and table assignment.
- After the first settlement, Staff may add new items, increase quantities, and
  adjust only quantities or notes that have not been allocated to active
  settlements.
- Settled item quantities, posted allocations, tenders, payer receipts, and
  order-level discounts are not rewritten after settlement.
- Stale updates return `409 STALE_VERSION`; invalid state transitions return
  `409 INVALID_STATE`.

#### P1.6 Logical Deletion

Implement logical order deletion for Staff and Manager users.

Acceptance criteria:

- Deleting an order sets `DELETED`, records actor and timestamp, keeps all
  financial/history rows, increments version, and writes audit data.
- A reason remains optional for both unpaid and paid orders.
- Deleted orders are excluded from active POS views but remain queryable for
  history and reports.
- No normal API route physically deletes an order.

#### P1.7 Settlement Recording

Implement per-payer settlement recording with selected item allocations and
multiple manual tenders.

Acceptance criteria:

- A settlement can allocate selected unallocated order-item quantities and one
  or more `CASH`, `CARD_TERMINAL`, or `CARD_TRANSFER` tenders.
- The server calculates settlement amount from immutable snapshots and rejects
  over-allocation or tender totals that do not match.
- Settlement recording requires idempotency and `expectedVersion`.
- Settlement, allocations, tenders, paid/balance/status updates, version
  increment, idempotency, and audit rows commit atomically.
- Adding items to a previously `PAID` open order recalculates the order payment
  status to `PARTIALLY_PAID` until the new balance is settled.

#### P1.8 Settlement Reversal

Implement Manager-only full settlement reversal.

Acceptance criteria:

- A posted settlement can be reversed only as a whole and only with a non-empty
  reason.
- Reversal recalculates order paid amount, balance, and payment status.
- Posted tenders and allocations are never edited or physically deleted.
- Reversal writes audit data and increments the order version atomically.

#### P1.9 Receipt And Bar-Ticket API Data

Implement print-ready API data for bar tickets and customer receipts.

Acceptance criteria:

- Bar-ticket data includes order number, `Asia/Tehran` display time,
  table/takeaway context, item quantities, selected options, preparation
  snapshots, estimated preparation minutes, and notes.
- Bar-ticket data excludes prices, discounts, totals, payment details, audit
  data, and staff identity.
- Whole-order and payer-settlement receipt data include stable item snapshots,
  Toman totals, tender summary where applicable, order number, and
  `Asia/Tehran` display time.
- Historical receipts remain unchanged after catalog price or timing edits.

#### P1.10 POS Backend Integration Coverage

Add real PostgreSQL tests for the complete POS backend workflow.

Acceptance criteria:

- Tests cover permissions, duplicate retries, stale edits, invalid transitions,
  adding items after partial payment, preventing settled-quantity rewrites,
  unavailable products, historical price/timing stability, selected-item
  allocation, mixed tender, optional card-transfer references, settlement
  reversal, payment reconciliation, and rollback.
- Tests prove Staff can complete the Stage 2 backend exit gate through API
  calls without a frontend.
- Typecheck and the relevant API test suite pass.

### P2 - Stage 3 QR-Menu Backend

#### P2.1 Public Browse-Only Menu API

Implement the anonymous QR-menu read endpoints.

Acceptance criteria:

- Public menu endpoints return active categories, visible products, available
  options, product image metadata, preparation-deadline minutes, and final Toman
  prices.
- Public endpoints expose no cart submission, order creation, payment, tracking,
  table authority, session, or Staff-only metadata.
- Search/filter behavior is explicitly schema-validated and documented.
- Inactive, archived, or unavailable items follow the documented public
  visibility rules.

#### P2.2 Public Menu Contract And Tests

Add OpenAPI and test coverage for public menu behavior.

Acceptance criteria:

- Public QR-menu routes appear in generated OpenAPI with validated response
  schemas.
- Tests cover public-response safety, filtering/search, inactive/unavailable
  item behavior, and final Toman price representation.
- Anonymous access works without cookies or Staff session state.

### P3 - Stage 6 Manager And Reporting Backend

#### P3.1 Manager Catalog, Staff, And Settings APIs

Implement Manager-only write APIs for catalog, Staff accounts, and café
settings.

Acceptance criteria:

- Manager can create/update/deactivate categories, products, option groups,
  options, images, Staff accounts, table settings, availability, and display
  order.
- Referenced records are archived or deactivated instead of physically removed.
- Staff users cannot access Manager write APIs.
- All writes validate DTOs, write audit entries where meaningful, and preserve
  historical order snapshots.

#### P3.2 Sales Reports And Audit Queries

Implement bounded Manager reporting and audit reads.

Acceptance criteria:

- Reports cover daily, weekly, and monthly sales, order counts, average value,
  payment mix, item/category sales, discounts, deleted orders, and hourly sales.
- `Asia/Tehran` calendar boundaries are applied consistently and response
  metadata includes the resolved UTC range.
- Report queries have documented bounds, export limits, and supporting indexes.
- Fixed fixtures prove report totals, payment breakdowns, reversals, and deleted
  order handling.

### P4 - Stage 8 Backend Stabilization

#### P4.1 Contract, Security, Migration, And Performance Hardening

Complete backend hardening needed before deployment preparation.

Acceptance criteria:

- All v1 endpoints and realtime events are represented in the reviewed OpenAPI
  contract.
- Unit, PostgreSQL integration, API contract, authorization, idempotency, and
  concurrency suites pass.
- Migrations work on both a fresh database and a restored production-like
  database.
- Security review covers cookies/tokens, CSRF, rate limits, uploads, secrets,
  input limits, and safe logs.
- Measured backend response targets are recorded for login, order
  create/edit/delete, payments, reports, image handling, and public-menu reads.

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
- Initial database tables and reviewed Prisma migrations.
- First-Manager bootstrap flow.
- Isolated test-database workflow and documentation.
- Structured error envelopes with safe validation details and request IDs.
- Zod DTO schema generation for the current API OpenAPI contract.
- Fresh-environment exit-gate rehearsal.

Exit gate:

- A fresh environment can start the API and database, apply migrations, seed the first Manager, pass automated tests, and expose healthy endpoints.

## Stage 2 Backlog — POS Backend

- Implement login, logout, access/refresh session rotation, revocation, and account deactivation. The first Manager is created by the Stage 1 operations-only bootstrap command.
- Enforce the two application roles, Manager and Staff, inside routes and service methods.
- Implement the catalog, product option, availability, image metadata, product preparation-deadline, physical-table seating-limit, and active table ETA reads required for POS order entry.
- Implement table and takeaway order creation by Staff.
- Calculate all prices, totals, estimated preparation minutes, and table release estimates on the server and persist immutable item/option/timing snapshots.
- Implement controlled edits to `OPEN` orders, table assignment/transfer, and order history; after the first settlement, allow only additive/unsettled-quantity edits and reject rewrites to settled quantities, posted allocations, tenders, or settlement receipts.
- Implement logical deletion with actor and timestamp; a reason is optional at every payment status. Never physically delete an order.
- Add order-version concurrency protection and creation idempotency.
- Implement per-payer settlements that allocate selected order-item quantities and contain one or more cash, card-terminal, or card-to-card transfer tenders.
- Make each settlement recording idempotent and transactional; update the order's `UNPAID`/`PARTIALLY_PAID`/`PAID` status and audit entry from active allocations.
- Provide concise bar-ticket and detailed customer-receipt API data with stable order numbers, timing snapshots, and `Asia/Tehran` display timestamps. Bar-ticket data must exclude prices, discounts, totals, and payment information; customer receipts retain the financial detail for whole orders and settlements.
- Test permissions, duplicate retries, stale edits, invalid transitions, adding items after partial payment, preventing settled-quantity rewrites, unavailable products, historical price/timing stability, selected-item allocation, mixed tender, optional card-transfer references, settlement reversal, payment reconciliation, and transaction rollback.

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
