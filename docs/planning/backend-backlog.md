# Backend Backlog

This document tracks backend work. Product and business rules live in `scope.md`; current stage status lives in `../current-left.md`; production readiness lives in `production-gates.md`.

## Current Backend Status

Last reconciled: 13 October 2026. The prioritized sections below are the
authoritative backend acceptance criteria; this summary records whether each
stage is implemented.

- **P0 / Stage 1 — Complete.** Foundation, migrations, bootstrap, isolated test
  database, contracts, health checks, and fresh-environment rehearsal are in
  place.
- **P1 / Stage 2 — Complete.** POS auth, orders, settlements, deletion,
  discounts, receipts, audit, and waiter-call backend increments are in place.
- **P2 / Stage 3 — Complete.** Browse-only QR-menu API and public response
  protections are implemented.
- **P3 / Stage 8 — Complete.** Manager catalog, settings, payment history,
  accounting, and audit APIs are implemented.
- **P4 / Stage 10 — Complete.** Full-system test, security,
  migration/restore, measured-performance, and café pilot evidence are closed.
  See `docs/current-left.md` for the completion record.
- **P5 / Stage 11 — Complete.** Inventory-costing scope, schema, contracts,
  migration, and isolated test-database reset are complete; details are recorded
  in `docs/current-left.md`.
- **P6 / Stage 12 — Complete.** Purchases, moving-average valuation, recipe
  costing, settlement recognition, stock correction, and count reconciliation.
- **P7 / Stage 13 — Complete.** Manager inventory/costing panels and
  gross-profit reporting.
- **P8 / Stage 15 — In progress.** Product-first recipe setup maps menu options
  to complete reusable recipes while preserving existing costing behavior.
- **P8 / Stage 14 — Complete.** Integration, browser, migration/restore, and
  measured-performance verification for the inventory phase.
- **P9 / Stage 16 — Complete.** Manager-managed explanatory product notes are
  persisted in the catalog and exposed in the public menu product detail.

Last recorded integrated local verification (2 October 2026): isolated API
suite 16 files / 102 tests, POS suite 18 files / 87 tests, contracts build,
API/POS typechecks, production POS build, and attached-browser checks at
469×343, 390×844, and desktop sizes. This predates the 3 October changes; those
changes still need their migration and release verification.

## Stage 0 Backlog — Scope And Domain Baseline

Done:

- v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and delivery stages are documented.
- ADR files for modular monolith, PostgreSQL/Prisma, Toman integers, UTC storage with `Asia/Tehran` reporting, Iranian VPS, browser printing, browse-only QR menu, settlement allocation, and the shared POS/waiter-call/initial-reporting boundary are documented.
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

### P0 - Stage 1 Foundation Exit Gate — Complete

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

### Prisma schema/migration synchronization rule

Every database-model change must be delivered as one synchronized change set:

1. Update `apps/api/prisma/schema.prisma` and create the corresponding reviewed
   forward migration; never rely on `prisma db push`, ad-hoc SQL, or a generated
   client alone.
2. Regenerate the Prisma client, apply pending migrations to the intended local
   development database with `pnpm --filter @cafe/api prisma:deploy`, and restart
   the API watcher before browser/POS verification.
3. Run the migration rehearsal and the affected API tests against the isolated
   `_test` database. Do not use the development database for the authorized
   test reset workflow.
4. Before a release, bundle the migration, record the applied migration version,
   and apply it to the target database through the release runbook before
   starting code that queries the new schema.

The schema, migration history, generated client, and running database must be
checked as a single compatibility boundary. If they drift, authenticated POS
bootstrap requests can return Prisma 500 errors after a successful login and
appear to be an authorization failure. A readiness failure should be reported
as schema/migration drift, not as a credential or role problem.

#### P0.4 Structured Error Envelope Implementation

Implement the documented application error envelope for API routes.

Acceptance criteria:

- Validation, authentication, authorization, conflict, business-rule, rate
  limit, internal, and dependency failures return the stable envelope from
  `request-response-conventions.md`.
- Error responses include the effective `requestId` and safe timestamp.
- Error details never expose stack traces, raw database errors, credentials,
  tokens, cookies, or password hashes.
- Inventory validation preserves field details and current-version conflicts.
  Database conflict/dependency/range failures use their documented statuses;
  unknown failures remain internal errors. Logs retain safe Prisma/PostgreSQL
  identifiers and source locations correlated to the request without raw SQL
  or row values. The POS preserves those safe details and keeps failures in the
  affected panel. Focused verification is recorded in `docs/current-left.md`.
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

### P1 - Stage 2 POS Backend — Complete

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

- POS catalog reads return every unarchived source category, sellable products, options,
  availability, final Toman prices, image metadata, and preparation deadlines.
- Table reads return active tables, the optional café seating limit, active order summaries,
  estimated preparation minutes, and estimated release times.
- Inactive or archived data is hidden unless a documented Staff use case
  requires it.
- Response DTOs do not expose Manager-only metadata or persistence internals.

#### P1.4 Staff Order Creation

Implement table and takeaway order creation by Staff.

Acceptance criteria:

- The server validates active, non-archived products in unarchived source categories and available options (active unavailable products remain orderable in POS), and calculates all prices, discounts,
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
- Before the first settlement, Staff and Manager may edit order content,
  item/order discounts with optional reasons, notes, and table assignment. Only Manager may
  configure a product sale discount, and the same settlement immutability rules
  still apply.
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
- Settlement, allocations, tenders, paid/balance/status updates, `CLOSED`
  transition on full payment, version increment, idempotency, and audit rows
  commit atomically. A fully paid table order also frees the table, invalidates
  its prior guest context, and resolves any pending waiter call in that same
  transaction.
- Adding items to a previously `PAID` open order recalculates the order payment
  status to `PARTIALLY_PAID` until the new balance is settled.

#### P1.8 Settlement Reversal

Implement Manager-only full settlement reversal.

Acceptance criteria:

- An explicitly requested full settlement reversal requires a non-empty
  reason. Correcting tender methods through the dedicated settlement-edit path
  does not require a reason.
- Reversal recalculates order paid amount, balance, and payment status.
- Posted tenders and allocations are never edited or physically deleted.
- Reversal writes audit data and increments the order version atomically.

#### P1.9 Receipt And Bar-Ticket API Data

Implement print-ready API data for bar tickets and customer receipts.

Acceptance criteria:

- Bar-ticket data includes the prominent Tehran-business-day order number, `Asia/Tehran` display time,
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

#### P1.11 Shared POS Waiter-Call And Role Alignment

Add the small backend increment required by the first shared POS interface.

Acceptance criteria:

- Preserve the existing table UUIDs while migrating the active POS topology to
  exactly `1` through `15` in display order. Archive the old `سوشال سوشال`
  row without moving its history; rename the old named rows in place.
  Provision exactly one independent customer QR for each table `1` through
  `13`; tables `14` and `15` have no customer QR. No shared-family routing or
  temporary QR assignment remains.
- A table has a rotatable opaque QR credential whose usable value is never
  stored in PostgreSQL or server logs. The operations command provisions one
  physical QR location or all provisionable locations, emits SVG/HTML/JSON print artifacts outside
  version control, refuses implicit replacement, and rotates only explicitly.
  An eligible-table QR scan while the dashboard
  still shows `AVAILABLE` creates a non-blocking occupancy reminder; it does
  not mark the table occupied or identify the customer.
- `/menu` remains the only catalog. `/t/:token` establishes a signed HttpOnly
  context for at most 12 hours and redirects there; generic visits have no call
  control, and table clearing or credential rotation invalidates old contexts.
- Staff and Manager have equal authority to mark a table `OCCUPIED` or
  `AVAILABLE`. A public waiter call requires an eligible QR context plus the
  customer phone session and its unexpired credential-bound visit; phone OTP verification is deferred;
  it does not require occupancy and grants no order, payment, receipt, tracking,
  or catalog authority.
- The POS table card is highlighted while its call is `PENDING`. Opening that
  card acknowledges and resolves the call in one version-checked action, then
  returns the card to its normal occupied state. No acknowledgement/resolution
  actor is stored.
- Database constraints prevent more than one pending waiter-call per table, and
  integration tests cover table eligibility, scan-before-occupancy reminder,
  duplicate taps, invalid/rotated/expired/prior-occupancy contexts,
  occupied-table validation, table-opening conflicts, reconnect/refetch,
  plaintext-token exclusion, and print artifact mapping.
- Product sale-discount configuration is Manager-only in routes and services.
  Staff and Manager may apply item/order discounts without a required reason while permitted by
  settlement state, and Staff retains settlement and individual-receipt access.

### P2 - Stage 3 QR-Menu Backend — Complete

Complete. The anonymous, browse-only category/menu and product-detail endpoints,
their OpenAPI schemas, and public-response integration coverage are implemented.
The Run Cafe catalog synchronizer is available as `pnpm db:seed:run-cafe-menu`.

#### P2.1 Public Browse-Only Menu API

Implement the anonymous QR-menu read endpoints.

Acceptance criteria:

- Public menu endpoints return unarchived source and promotional categories with eligible products, visible products, available
  priced options, product image metadata, and final Toman prices. Product
  preparation deadlines remain private to authenticated POS workflows.
- Public menu endpoints expose no cart submission, order creation, payment,
  tracking, session, or Staff-only metadata. The separately documented
  waiter-call command derives authority from a signed HttpOnly table-context
  cookie established by `/t/:token`; it grants only that single capability and
  no order authority.
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

### P3 - Stage 8 Manager Capability Backend — Complete

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

#### P3.2 Payment History, Daily Report, And Audit Queries

Implement bounded Manager accounting, payment-history, and audit reads.

Acceptance criteria:

- Manager can browse cursor-paginated payment history and open its associated
  settlement receipts; Staff cannot browse this history but can still open and
  print an individual receipt through an authorized POS order workflow.
- The first report is one daily accounting summary. Its only accepted period is
  `today` or `yesterday` in `Asia/Tehran`; metadata includes the resolved UTC
  range.
- The daily summary covers sales/paid totals, order count, payment-method mix,
  discounts, reversals, and logically deleted-order treatment. Weekly/monthly
  periods, arbitrary ranges, exports, and product/category/hour breakdowns are
  deferred.
- The two-day report limit never deletes or expires orders, order items,
  settlements, tenders, reversals, or audit history.
- Payment-history and report queries have documented bounds and supporting
  indexes selected from measured query plans.
- Fixed fixtures prove report totals, payment breakdowns, reversals, and deleted
  order handling.

### P4 - Stage 10 Backend Stabilization — Complete

#### P4.3 Discounted Price Rounding And POS Bar-Ticket Action — Complete

Round discounted final amounts to the nearest 1,000 Toman (halfway values
round up) in the authoritative server calculation. Keep the menu's compact
price presentation in thousands of Toman and show comma-separated three-digit
groups for monetary amounts throughout POS. Add a POS action that saves
the current order and starts its bar-ticket print. Treat invocation of this
operator action as confirmation to record the prepared ticket; the browser
cannot verify physical paper output.

Left:

- None. Contract, API integration, POS summary, save-and-print, and print
  acknowledgement coverage passes; café browser/printer verification is
  recorded separately in `docs/current-left.md`.

#### P4.2 Promotional Catalog Categories — Complete

Support Manager-created promotional categories that list existing products
without changing their canonical source category.

Acceptance criteria:

- Categories distinguish source and promotional behavior; promotional
  categories cannot own products.
- A product retains one canonical source category and may have membership in
  multiple promotional categories.
- Manager APIs validate membership changes and preserve source ownership.
- Public-menu category responses list promotional memberships with the same
  current product data and prices as the source category.
- Manager catalog provides a source-category/product picker to add and remove
  promotional memberships.

Left:

- None. API add/remove and public-menu behavior are covered by integration
  tests; Manager picker add/remove behavior is covered by POS component tests.
  Migration and browser checks are recorded in `docs/current-left.md`.

#### P4.1 Contract, Security, Migration, And Performance Hardening — Complete

Complete backend hardening needed before the shared POS pilot.

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

### P5 - Stage 11 Inventory Costing Baseline, Schema, Contracts, And Migration — Complete

Approve and establish the inventory-costing domain before adding runtime
workflows. Product and business rules are in `inventory-costing.md` and ADR
0011; this stage owns the schema and contract baseline.

Acceptance criteria:

- Scope, unit/value rules, opening-count boundary, order recognition, correction
  behavior, reporting coverage, and exclusions are recorded in scope and ADR
  0011 without erasing completed Stage 0–10 history.
- The ERD and constraint inventory cover stock items and conversions, received
  purchases and lines, recipes/components, product costing and option rules,
  append-only movements and current valuation, physical counts and pending-order
  reconciliation, order-item costing snapshots, full-payment recognition, and
  pending consumption.
- Prisma models and one reviewed forward migration represent that model. The
  migration does not seed stock or enable tracking; tracking begins only after
  an opening count is posted.
- Shared Zod contracts and `api-inventory.md` describe Manager-only requests,
  responses, query bounds, version checks, and idempotent posting headers for
  the new workflows.
- A fresh isolated test database can apply the migration; the migration ledger,
  Prisma client, generated OpenAPI, contracts typecheck, and API typecheck agree.

Left:

- None. The schema, constraints, forward migration, shared contracts, API
  inventory, generated Prisma client, and isolated migration rehearsal are
  recorded in `docs/current-left.md`.

### P6 - Stage 12 Purchases, Valuation, Recipes, Settlement, And Reconciliation — Complete

Acceptance criteria:

- Manager stock-item and purchase operations enforce explicit compatible pack
  conversions, exact quantities, integer-Toman direct costs, idempotent
  posting, moving-average valuation, archival, and linked correction entries.
- Recipe resolution supports reusable cycle-free recipes, product recipe or
  purchased-item costing, purchased-item extras, named option replacements,
  quantity changes, additions, and explicit combination overrides. Conflicts
  are rejected. Preview exposes missing inputs rather than zero-valued costs.
- Menu-option recipe configuration associates a public product option with a
  complete reusable recipe and quantity. The selected option recipe resolves
  as the full recipe for that product selection; ambiguous simultaneous full
  recipe mappings are rejected. Existing option rules, combinations, saved
  order snapshots, and historical costing remain compatible.
- Order-item costing snapshots update with eligible unsettled content changes
  and do not follow later catalog edits.
- Whole-order final payment captures theoretical costs exactly once. Stock is
  deducted atomically for the complete order only when every requirement is
  available; otherwise one whole-order pending record is created and checkout
  succeeds.
- Posted purchases retry pending orders in full-payment order without partial
  reservations. Actual movements use posting-time average values while
  theoretical item costs retain full-payment snapshots.
- Physical-count posting records expected/observed quantities and valuation;
  the Manager explicitly identifies absorbed pending orders before posting.
- Tender corrections have no inventory effect. Reversals and logical deletion
  cancel pending work or restore previously deducted/reconciled stock once at
  recorded carrying value, and preserve an auditable movement history.
- Staff and public/receipt DTOs do not expose inventory costs or margins.

Left:

- None. Manager inventory APIs, order recognition and correction hooks, and
  isolated inventory/order integration coverage are implemented; details and
  verification are recorded in `docs/current-left.md`.

### P7 - Stage 13 Manager Inventory Panels And Gross-Profit Reports — Complete

Acceptance criteria:

- The shared POS Manager workspace supports stock items, received purchases,
  recipes/product costing, recipe preview, physical counts and reconciliation,
  inventory history, pending consumption, and gross-profit reports.
- Stock setup omits editable category input while retaining the stored category;
  piece-based stock shows one optional count-per-package field instead of the
  named pack-conversion editor.
- Purchase history exposes cursor pagination and server-side supplier/item
  search, status filtering, and a received-time range.
- Inventory movement history exposes cursor pagination, date-range filters,
  and a selectable search mode for stock-item name, visible order number, or
  movement type. Order-consumption movements display the POS order number.
- The Manager section is labeled «انبار»; «خریدها» is the first inventory tab
  and «سود ناخالص» is the last.
- Count history exposes cursor pagination and server-side stock-item search,
  count-kind/status filters, and a count-created-time range. The Manager count
  editor creates physical counts only; stock-item setup initializes each
  item's starting quantity and value and records its opening ledger entry. A
  physical count with any quantity differing from its recorded balance
  requires one shared reason for the count.
- The recipe workflow starts from a public menu product and shows only its
  active public options. Each option can be assigned a full ingredient recipe
  using stock items or previously created recipes, with source-unit guidance.
- Archived stock items are hidden from active stock lists while their historical
  purchase and movement records remain available; a new active stock item may
  reuse an archived item's name.
- Arbitrary bounded Persian-calendar ranges resolve to `Asia/Tehran`
  boundaries in the API. Revenue uses persisted whole-order paid amounts and
  existing discount allocation.
- Reports show per-product and café net sales, theoretical COGS, gross profit,
  gross margin, cost coverage, pending status, and inventory-based period
  consumption where boundaries are compatible. Aggregate margin uses aggregate
  amounts; zero sales and incomplete total coverage show margin unavailable.
- Unsupported actual-COGS periods are labeled estimates and surface pending
  orders, missing valuations, and variance without assigning variance to an
  unrecorded cause.
- Manager-only routes and UI are enforced server-side; Staff, public menu, and
  receipt responses never expose costing fields.

Left:

- None. Manager panels and bounded reports are connected to the protected API;
  implementation and verification details are recorded in `docs/current-left.md`.

### P8 - Stage 14 Inventory Integration And Operational Verification — Complete

Acceptance criteria:

- Unit and authorized isolated-PostgreSQL integration coverage includes unit
  conversion, exact valuation/rounding, recipes/options/cycles, purchase posting,
  full-payment recognition, shortage/pending retry, count reconciliation,
  reversal/deletion restoration, report allocation/date boundaries, and
  role/response safety.
- Idempotency, stale configuration versions, concurrent receipts/counts/
  settlements/corrections, and transaction-failure rollback cannot duplicate
  or lose quantity, value, payment, or audit effects.
- Existing order, settlement, receipt, and public-menu workflows continue to
  pass. Browser verification covers Manager workflows and the end-to-end paid
  order/inventory/report path.
- Fresh migration and restore rehearsal pass; performance measurements cover
  posting, pending-order retries, counts, and bounded profit reports.
- Record API timings and test fixture limits in
  `docs/performance/inventory-costing-response-times.md`.
- Record each completed stage and all remaining `Left:` items in
  `docs/current-left.md`. Deployment remains separately authorized.

Left:

- None. The backup validated, the isolated test database restored successfully,
  all 31 migrations were current, and paid-order, tender, audit, stock,
  movement, balance, and opening-count fixtures were preserved.

The full API suite passes after its authorized reset applied all 31 migrations;
the inventory file passes 17/17. The full POS suite passes 101/101, both
typechecks pass, and the 30-to-31 upgrade preserved pre-existing data.
Authenticated browser checks covered stock, purchases/returns, recipe costing,
physical counts, movement history, and gross-profit date validation. The
expanded acceptance coverage and execution record are in `docs/current-left.md`.

## 2 October 2026 Approved POS Behavior Notes

### P9 - Stage 16 Customer-Facing Menu Item Notes — Complete

Acceptance criteria:

- A Manager can create, update, and clear one optional explanatory note on a
  product through the POS catalog panel. The note is validated and persisted
  with the product, and every change follows the existing Manager authorization
  and catalog audit path.
- Public menu product responses include the note, while POS order-entry and
  order-item preparation notes retain their separate existing behavior.
- The menu product detail popup shows a non-empty note below all option choices;
  it works for products with no options and is absent when no note is set.
- API and UI checks cover saving, editing, clearing, authorization, DTO output,
  and popup order. Live browser verification follows the flow from Manager POS
  catalog editing to the customer menu.

Left:

- None. Focused API/POS/menu checks and the live POS-to-menu browser workflow
  are recorded in `docs/current-left.md`.

## 2 October 2026 Approved POS Behavior Notes

- POS product availability is advisory for active products; inactive/archived products and unavailable options remain blocked. Public-menu availability remains unchanged.
- Payment shift presets use each settlement recordedAt in Asia/Tehran, including partial payments: 08:00–16:00 and 16:00–midnight.
- Bar-ticket reads do not mutate print state. Authenticated preparation and retry-safe acknowledgment persist the exact preparation snapshot; edits print additions only, unchanged preparation content reprints the whole order. The operator's save-and-print action is the confirmation; browser events cannot verify paper output.
- Recovery retains local work and never automatically repeats authoritative mutations or prints.

### Inventory production activation gate

Inventory ships inactive. Manager-only Café Settings activation records one
permanent timestamp and audit entry. All inventory routes and background order
hooks remain inactive until then. Only orders created after activation qualify;
previous orders are never backfilled, including orders still open at activation.
Database constraints prevent clearing or changing activation.
