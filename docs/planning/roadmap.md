# Delivery Roadmap

This document owns delivery sequencing and stage status. Product decisions live in `scope.md`; backend task detail lives in `backend-backlog.md`; production gates live in `production-gates.md`.

## Sequence Rule

The delivery order is database-first. The QR-menu frontend was temporarily
prioritized ahead of the shared POS foundation because of the revised project
deadline approved on 21 August 2026:

1. Create the database schema, tables, migrations, seed/bootstrap flow, and test database workflow.
2. Build the backend required for Staff POS operation.
3. Build the backend required for the browse-only QR menu.
4. Build the browse-only QR-menu frontend.
5. Build the first shared POS frontend for Staff and Manager operational work, including waiter-call, with the small backend increment it requires.
6. Complete deployment hardening, including Iranian VPS deployment and any CDN decision, last.

Manager accounting/catalog panels and expanded administration work must not block the first shared POS release. Manager and Staff are role levels inside one POS application, not separate applications; shared table/order/payment behavior must not be duplicated. UX research, wireframes, and design assets may be prepared earlier, but they must not drive unfinished backend rules or create a second source of business logic.

## Current Stage Status

Stages 0 through 4 are complete. Stage 5 (shared POS foundation) is next.

Current implementation status as of 1 September 2026:

- **Stage 0 — Scope and domain baseline:** complete and amended by ADR 0009. `scope.md` defines the main v1 scope, non-goals, roles, lifecycle/payment states, business rules, architecture direction, and production gates. ADR files exist for the fixed major decisions, including settlement allocation and the shared POS/waiter-call/reporting boundary; the ERD is documented; `api-inventory.md` maps the approved v1 HTTP and realtime contract surface; `database-constraints.md` explicitly lists the planned database constraints; `request-response-conventions.md` defines shared application envelopes, errors, pagination, idempotency, and concurrency; and `backend-backlog.md` converts the approved scope into a prioritized backend backlog with acceptance criteria.
- **Stage 1 — Database and backend foundation:** complete. The database schema and reviewed migrations, first-Manager bootstrap, isolated test-database workflow, structured error envelope, Zod-derived OpenAPI contract, Docker Compose PostgreSQL baseline, liveness/readiness routes, and graceful shutdown are implemented. The fresh-environment rehearsal on 13 August 2026 applied both migrations to a new database, created exactly one Manager, rejected a repeat bootstrap, returned healthy liveness/readiness responses, and passed typecheck and the API test suite.
- **Stage 2 — POS backend core:** complete under its original baseline. The order/payment/receipt workflow, including Staff/Manager reasoned item/order discounts and Manager-only product sale-discount configuration, is covered through authenticated API calls against real PostgreSQL. The newly approved waiter-call persistence/API is a Stage 5 prerequisite increment and is not yet implemented.
- **Stage 3 — QR-menu backend:** complete. Anonymous browse-only menu and product-detail APIs expose only customer-facing catalog data, final Toman prices, availability, priced options, and images; preparation deadlines remain private to POS workflows. Search/filter, response safety, and anonymous behavior are covered by integration tests.
- **Stage 4 — QR-menu frontend:** complete. The Persian RTL, mobile-first public menu renders the Run Cafe catalog through the typed public API with category navigation, search, product details and priced options, current availability, compact displayed Toman prices, loading/empty/error states, local product photography, and no customer-facing preparation timing, ordering, or payment flow. The root route redirects to `/menu`; typecheck, focused tests, production build, and representative mobile/desktop browser rendering were verified during the completed stage.

## Stage Overview

| Stage | Area                            | Required outcome                                                                                                                                |
| ----- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | Scope and domain baseline       | Approved use cases, business rules, state tables, ERD, API inventory, ADRs, and prioritized backlog                                             |
| 1     | Database and backend foundation | Database tables, migrations, seed/bootstrap, test database workflow, runnable Fastify service, health checks, and test infrastructure           |
| 2     | POS backend                     | Staff auth, catalog/table timing data needed by POS, Staff-created orders, split-tender payments, receipts, deletion, and audit                 |
| 3     | QR-menu backend                 | Public browse-only menu API for categories, products, priced options, availability, images, and final Toman prices                              |
| 4     | QR-menu frontend                | Mobile-first browse-only public menu with categories, search/filtering, priced product selections, images, and final Toman prices               |
| 5     | Shared POS foundation           | One Staff/Manager POS shell and table dashboard: basic order/payment/receipt workflows, ordered physical tables, occupancy/reminder flow, and table-scoped waiter-call |
| 6     | Manager capability backend      | Manager catalog/user/settings, payment history, discounts, audit queries, and today/yesterday daily accounting report                           |
| 7     | Manager panels in shared POS    | Role-gated catalog, Staff-account, settings, payment-history, audit, and daily-report panels inside the existing POS application                 |
| 8     | Full-system hardening           | Integration/contract/E2E coverage, security review, migration rehearsal, performance checks, and API/frontend stabilization                     |
| 9     | Deployment preparation          | Production Compose/Caddy-or-Nginx baseline, backup/restore procedures, monitoring, log rotation, release procedure, and manual fallback runbook |
| 10    | VPS deployment and pilot        | Iranian VPS deployment, HTTPS, production secrets, restore drill, CDN need check after measurement, and limited live pilot                      |
| Later | Customer ordering               | Customer cart, table selection, Staff confirmation, and protected public order submission                                                       |

## Stages

### Stage 0 — Scope And Domain Baseline

- Freeze the v1 feature list and explicit non-goals.
- Write the Staff order, payment, deletion, table, Manager, and public-menu use cases.
- Finalize the `OPEN` → `DELETED` lifecycle state rules, `UNPAID`/`PARTIALLY_PAID`/`PAID` payment statuses, settlement allocation rules, and exceptional transitions.
- Create the initial ERD, ownership boundaries, and database constraint list.
- Define request/response conventions, error envelope, pagination, idempotency, and concurrency behavior.
- Record the major decisions as ADRs: modular monolith, PostgreSQL/Prisma, Toman integers, UTC storage with `Asia/Tehran` reporting, Iranian VPS, browser printing, browse-only QR menu, settlement allocation, and the shared POS/waiter-call/initial-reporting boundary.
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

- Implement login, logout, access/refresh session rotation, revocation, and account deactivation. The first Manager is created by the Stage 1 operations-only bootstrap command.
- Enforce the two application roles, Manager and Staff, inside routes and service methods.
- Implement the catalog, product option, availability, image metadata, product preparation-deadline, physical-table seating-limit, and active table ETA reads required for POS order entry.
- Implement table and takeaway order creation by Staff.
- Calculate all prices, totals, estimated preparation minutes, and table release estimates on the server and persist immutable item/option/timing snapshots.
- Implement controlled edits to `OPEN` orders, table assignment/transfer, and order history; after the first settlement, allow only additive/unsettled-quantity edits and reject rewrites to settled quantities, posted allocations, tenders, or settlement receipts.
- Implement logical deletion with actor and timestamp; a reason is optional at every payment status. Never physically delete an order.
- Implement per-payer settlements that allocate selected order-item quantities and contain one or more cash, card-terminal, or card-to-card transfer tenders.
- Make each settlement recording idempotent and transactional; update the order's `UNPAID`/`PARTIALLY_PAID`/`PAID` status and audit entry from active allocations.
- Provide bar-ticket and customer-receipt-ready API data with stable order numbers, timing snapshots, and `Asia/Tehran` display timestamps. The bar ticket is limited to preparation information; customer receipts contain the financial detail.
- Test permissions, duplicate retries, stale edits, invalid transitions, unavailable products, historical price/timing stability, selected-item allocation, mixed tender, optional card-transfer references, settlement reversal, payment reconciliation, and transaction rollback.

Exit gate:

- Staff can complete every POS backend workflow through documented API calls against real PostgreSQL without any frontend dependency.

### Stage 3 — QR-Menu Backend

- Implement public read-only category, product, priced option, availability, image metadata, and final Toman price endpoints for the QR menu; keep preparation deadlines in authenticated POS workflows.
- Ensure QR-menu browse endpoints expose no cart submission, order creation, payment, tracking, table-management authority, or Staff-only metadata. The Stage 5 waiter-call command is a separate, narrowly scoped exception.
- Add response schemas and OpenAPI coverage for the public menu API.
- Test public-response safety, filtering/search behavior, inactive/unavailable items, and historical price boundaries where relevant.

Exit gate:

- Customers can browse the complete current menu through public API calls, with no order-submission capability.

### Stage 4 — QR-Menu Frontend

- Build the mobile-first public menu with categories, search/category filtering, priced item options, current availability, final Toman prices, optimized images, no customer-facing preparation timing or availability-only toggle, and no checkout.
- Ensure the public UI exposes no cart checkout, customer order submission, payment, or tracking states.
- Measure the public menu on representative low-end phones and slow domestic connections.

Exit gate:

- Customers can reliably browse the complete current menu on mobile.

### Stage 5 — Shared POS Foundation

- Add the minimal waiter-call backend increment: ordered physical-table records, hashed table QR credentials, explicit `AVAILABLE`/`OCCUPIED` state, QR-scan occupancy reminders, one pending call per eligible occupied table, common table-opening acknowledgement/resolution, events, constraints, and tests.
- Preserve the existing discount boundary: Staff and Manager may apply reasoned item/order discounts, while only Manager may configure catalog product sale discounts.
- Add `apps/pos` as a sibling of the existing public-menu `apps/web` package, then create one Next.js POS application shell, route groups, layouts, shared UI primitives, environment configuration, and typed API client used by both Staff and Manager accounts.
- Build order channel selection, product/options entry, notes, totals, and controlled `OPEN` order edits, including adding items after partial payment without rewriting settled quantities.
- Build one shared table dashboard for both roles with table assignment/transfer, active-table timing, occupancy controls/reminders, highlighted waiter-call cards that resolve when opened, selected-item settlement with mixed tenders, payment-status display, deletion/clear flow, concise bar-ticket printing, and detailed customer-receipt printing for whole orders and settlements.
- Handle idempotent retry results, stale-version conflicts, API failures, connection state, and reconnect refetch.
- Validate touch targets, keyboard operation, actual café devices, and the real receipt printer/paper size.

Exit gate:

- Staff and Manager can complete the same basic POS operational journeys—including reasoned item/order discounts—through one shared interface, a table waiter-call can be received and resolved, and Staff cannot access Manager-only product sale-discount configuration, accounting, payment-history, catalog, settings, or audit capabilities.

### Stage 6 — Manager Capability Backend

- Implement complete Manager-only catalog, product option, image, price, availability, display-order, Staff account, and settings APIs.
- Implement Manager-only cursor-paginated payment history while keeping Staff access to individual order and settlement receipts.
- Implement one bounded daily accounting report whose only valid period is the current or immediately previous `Asia/Tehran` calendar day.
- Include daily totals, order count, payment-method totals, discounts, settlement reversals, and logically deleted-order treatment. Defer weekly/monthly periods, arbitrary date ranges, exports, product/category/hour analytics, and forecasting.
- Keep every historical order, item, settlement, tender, reversal, and audit row regardless of the two-day report window.
- Add audit queries and the database indexes required by measured payment-history and two-day report query plans.
- Implement permissioned full-settlement reversal instead of editing posted tenders or allocations.
- Verify today/yesterday report totals against fixed fixtures and inspect both permitted query plans.

Exit gate:

- Manager capability APIs are documented, permissioned, tested, and bounded; Staff cannot browse payment history or reports, and data older than yesterday remains retained.

### Stage 7 — Manager Panels In Shared POS

- Extend the existing POS shell and navigation according to the authenticated role; do not create a separate Manager application or duplicate the table dashboard.
- Build category, product, option, image, price, product preparation-deadline, table seating-limit, availability, and display-order management.
- Build Staff account creation, deactivation, and session-management interfaces.
- Build settings, Manager-only payment history, today/yesterday daily accounting, settlement-reversal, and audit-history interfaces.
- Add confirmation, permission, validation, loading, error, and empty states for every Manager action.

Exit gate:

- A Manager can operate all v1 capabilities from role-gated panels inside the shared POS without direct server or database access.

### Stage 8 — Full-System Hardening

- Run the critical browser E2E suite across public menu, POS, bar-ticket printing, selected-item settlement, mixed tender, card transfer, deletion, customer whole-order/settlement receipts, Manager, and reporting journeys.
- Complete integration/contract test coverage for authorization, idempotency, concurrency, settlement allocation, reversals, reports, and public-response safety.
- Run the security review for cookies/tokens, CSRF, rate limits, uploads, secrets, input limits, and safe logs.
- Rehearse migrations on both a fresh database and a restored production-like database.
- Measure login, order creation/edit/deletion, payments, reports, image handling, and public menu response targets.

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

Start this only after v1 is stable in production. Define a new state model and ADR before adding the customer cart, table selection, Staff confirmation, rate limits, idempotency, safe public tokens, and customer-facing failure/retry states.
