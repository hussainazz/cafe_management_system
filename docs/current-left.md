# Current Stage Status

Last reconciled: 14 October 2026. This file is the active completion checklist;
implementation history belongs in Git and feature-specific records, not in a
second chronological backlog.

## Stage Status

| Stage | Status | Notes |
| --- | --- | --- |
| 0 — Scope and domain baseline | Complete | Scope, ADRs, ERD, API inventory, database constraints, and conventions are documented. |
| 1 — Database and backend foundation | Complete | Schema, migrations, bootstrap, test database, health checks, and fresh-environment rehearsal are complete. |
| 2 — POS backend | Complete | Orders, payments, discounts, deletion, receipts, audit, and backend coverage are implemented. |
| 3 — QR-menu backend | Complete | Public browse-only APIs, search/filter, pricing, availability, and response boundaries are implemented. |
| 4 — QR-menu frontend | Complete | Public menu implementation, responsive states, assets, and recorded browser verification are complete. |
| 5 — Public-menu deployment preparation | Complete | Release and recovery procedures are recorded. |
| 6 — Public-menu VPS deployment and pilot | Deployed; pilot follow-up resolved | The menu is live and the limited-pilot follow-up is resolved. |
| 7 — Shared POS foundation | Complete | Shared Staff/Manager POS, table/order/payment/receipt flows, waiter calls, and recovery are in café use. |
| 8 — Manager capability backend | Complete | Catalog, Staff/settings, payment history, accounting, audit, and reversal APIs are implemented. |
| 9 — Manager panels in shared POS | Complete | Role-gated Manager workspace and its panels are in café use. |
| 10 — Full-system hardening and POS pilot | Complete | The café has used the menu and POS in live operation for one month; browser/device, printing, security, release, and production-readiness work is closed. |
| 11 — Inventory costing baseline, schema, contracts, and migration | Complete | Approved scope, relational model, constraints, contracts, forward migration, generated client, and isolated migration rehearsal are complete. |
| 12 — Purchases, valuation, recipes, settlement, and reconciliation | Complete | Manager inventory APIs, order-cost snapshots, payment recognition, whole-order consumption/retry, count reconciliation, corrections, and isolated integration coverage are implemented. |
| 13 — Manager inventory panels and gross-profit reports | Complete | Manager stock, purchases, recipe costing, counts, history, and bounded gross-profit reporting are connected to the protected APIs. |
| 14 — Inventory integration and operational verification | Complete | API, POS component, authorization/DTO, P2 management, expanded browser, migration-upgrade, and isolated backup/restore checks pass. |

## Completion Record

Stage 10 closed on 12 October 2026. The café has used the menu and POS in live
operation for one month, completing browser/device acceptance, printing,
security, release, and production-readiness work. Stage-specific test,
migration, security, performance, and pilot evidence is retained in the linked
feature records and implementation notes below.

## Stage 11 Completion Record — Inventory Costing Baseline

- [x] Approve the inventory-costing and gross-profit scope, business rules, and
  delivery boundaries in `docs/planning/inventory-costing.md`, `scope.md`, and
  ADR 0011.
- [x] Add the Prisma models, reviewed constraints, and forward migration for
  stock, recipes, purchases, valuation, counts, order costing snapshots, and
  pending consumption.
- [x] Add validated shared contracts and the Manager API inventory for the
  stock, purchase, recipe/costing, count, movement-history,
  pending-consumption, and profit-report workflows.
- [x] Apply the migration to the authorized isolated test database. All 31
  checked-in migrations apply successfully through
  `20261012110000_inventory_costing`.

Left:

- None. Prisma validation and generation, contracts/API typechecks, and the
  isolated test-database migration reset pass.

## Stage 12 Completion Record — Inventory Operations And Payment Recognition

- [x] Implement Manager stock-item, purchase, recipe, costing-configuration,
  and recipe-preview APIs with version and authorization checks.
- [x] Implement opening/physical inventory counts, append-only movements,
  moving-average balance updates, idempotent purchase posting, and pending
  consumption retry.
- [x] Snapshot order-item costing and integrate full-order payment recognition,
  all-or-nothing consumption, shortage handling, count reconciliation, and
  exactly-once stock restoration on reversal/deletion.
- [x] Audit stock/cost changes and confirm Staff, receipt, and public-menu
  responses expose no cost or margin information.

Left:

- None. Contracts build, API typecheck, inventory integration (4/4), existing
  order integration (41/41), and `git diff --check` pass.

## Stage 13 Completion Record — Manager Inventory And Gross-Profit Reports

- [x] Add Manager inventory panels for stock items, purchases, recipes and
  product costing, recipe preview, physical counts/reconciliation, movement
  history, and pending consumption.
- [x] Add bounded Tehran-calendar gross-profit reporting for per-product and
  café net sales, theoretical COGS, coverage, gross profit/margin, and
  inventory-based consumption estimates.
- [x] Connect the report and inventory views to Manager-only API contracts;
  keep costs and margins out of Staff, receipt, and public-menu responses.

Left:

- None. Contracts build, API/POS typechecks, the POS suite (19 files, 96 tests),
  inventory integration (6/6), orders integration (41/41), and the remaining
  API integration files pass. Report checks cover discount allocation,
  reversal restatement, pending-order variance handling, and zero-sales margin.

## Active Completion Checklist — Inventory Costing Stage 14

- [x] Allow a new active recipe to reuse an archived recipe name while keeping
  the archived recipe's original name available in retained history and DTOs.

- [x] Extend inventory integration coverage for a multi-ingredient shortage and
  whole-order retry, purchase-return valuation/idempotency/over-return, and
  aggregate café gross-margin and incomplete-cost reporting. The expanded
  inventory suite passes 17/17 tests against the isolated test database.
- [x] Run inventory integration, order/payment, authorization, contract, and
  API response-boundary checks against the isolated test database.
- [x] Measure purchase posting, receipt-time pending-order retry, count posting,
  and bounded gross-profit report timing. Results are in
  `docs/performance/inventory-costing-response-times.md`.
- [x] Verify representative Manager inventory operations and the
  paid-order-to-report journey in an authenticated browser session.
- [x] Add exact fractional valuation, count eligibility and adjustment,
  correction and reconciled-restoration, incomplete-cost, Manager
  authorization/DTO, P2 management/history/validation, and focused
  inventory-workspace component scenarios.
- [x] Extend authenticated browser verification across purchase returns,
  recipe configuration and option-adjusted preview, physical-count values,
  movement history, report filtering, and invalid date-range recovery.
- [x] Rehearse an upgrade from the preceding 30 migrations to the inventory
  migration on `cafe_management_test`, preserve an existing row, and confirm
  the database is current at all 31 migrations.
- [x] Complete the custom-format backup and clean restore rehearsal for the
  inventory migration. The backup validated, the test database restored, all
  31 migrations were current, and paid-order, tender, audit, and inventory
  fixtures were preserved.

Left:

- None.

Verification:

- The full API package suite passes after resetting `cafe_management_test` and
  applying all 31 migrations. The inventory integration file passes 17/17.
  Added precise half-up movement-value assertions, multi-ingredient count
  eligibility, physical adjustment history, reversed reconciled-restoration,
  no-costing coverage, all Manager-only read/write route checks, response
  schema parsing, and stock/purchase/count P2 lifecycle validation. The UI now
  has seven focused inventory-workspace tests; that file passes 7/7 after the
  critique fixes. The earlier full POS suite passed 101/101, and API/POS
  typechecks pass.
- Expanded browser checks were read-only against local café data. The purchase
  return form opens and cancels without posting; Espresso Single costing loads,
  a valid option returns a complete 405-Toman preview; physical counts show
  tracked balances and retained count history; movement history filters by
  item; and the report rejects a reversed date range in place, then recovers
  when the valid dates are restored. The representative paid-order report
  still shows 185,000 Toman sales, 405 Toman recognized cost, 184,595 Toman
  gross profit, 99.78% margin, and zero pending consumption. Its 404-Toman
  inventory-period consumption remains explicitly estimated; the 1-Toman
  variance is not asserted as exact actual COGS.
- The isolated upgrade rehearsal passed on `cafe_management_test`: migrations
  1–30 were applied, existing category data survived, and
  `20261012110000_inventory_costing` applied as migration 31. A read-only
  `prisma migrate status` confirms all 31 are current. The custom-format backup
  validated and restored successfully; post-restore checks confirmed the
  database is current and retains the paid order, tender, audit, stock,
  movement, balance, and opening-count fixtures.

## Active Follow-up Checklist — Recipe Naming And Public Ingredient Labels

- [x] Merge the recipe's precise name and the component's display label. When
  a recipe is selected as a nested ingredient, use its recipe name as the
  displayed label and remove the separate manual component-name field.
- [x] Give each precise recipe variant a separately editable shared ingredient
  name. Multiple POS recipes may share a value such as «لاته»; keep the precise
  variant name for costing and reserve public-menu display for the pending
  curated-ingredient integration below.
- [ ] Add a curated ingredient summary to the public menu. Support a shared
  display key such as `espresso` for multiple recipe variants while keeping
  the selected variant and costing details in the Manager/POS logic.

Verified behavior: component identifiers may repeat across different recipes;
they must be unique within each recipe. Product costing option rules target a
component in the selected product recipe and can replace it with a specific
stock item or recipe. When multiple selected options affect the same component,
configure exact option-combination overrides; separate option rules targeting
that same key conflict. The public-menu response currently contains no recipe
or ingredient list, so the curated public ingredient summary is not implemented.

## Latest Implementation Notes

- 14 October: recipe variants now carry both a precise `نام دستور تهیه` and
  a separately editable, reusable `شناسه‌ی ماده`. For example, «لاته ۵۰/۵۰»
  and «لاته ۲۰/۸۰» can each retain their own costing recipe while sharing
  «لاته» as the future menu label. The identifier is recipe-level; component
  rows still derive their displayed name from the linked stock item or nested
  recipe. Added API contract, audit snapshots, schema field, and a backfill
  migration. Public-menu work remains pending. API/POS typechecks and
  `git diff --check` pass. Applied
  `20261014143000_recipe_shared_ingredient_name` to the local development
  database after the user's approval. API readiness is healthy; the POS
  inventory panel loads without the schema error, and editing «لاته» shows
  «لاته» in both the precise recipe name and shared ingredient identifier.

- 14 October: recipe-component labels now come from the linked stock-item or
  nested-recipe name. Removed the manually editable component-name field from
  the POS editor and input contract; existing recipes display the linked
  source's current name. Local POS verification archived and replaced
  `QA archive reuse 2026-10-14` by the same name, then confirmed the archived
  opening-count movement remains visible with that name. The labeled QA stock
  records remain in the local development database; no reset was needed.

- 14 October: recipe component quantity inputs now show the selected stock
  item's base unit or nested recipe's output unit in the label and placeholder.
  New component quantities start blank so the unit hint is visible until an
  amount is entered. Existing recipe quantities remain unchanged while editing.

- 14 October: removed the recipe editor's visible output-quantity field. New
  recipes still use the required default of one output unit, while editing an
  existing recipe preserves its saved yield. Confirmed nested recipes remain
  database-linked and are recursively expanded when costing is calculated;
  no follow-up task is needed for recipe reuse. Component keys remain internal
  identifiers used by option-costing rules; the component name is its readable
  label. The user later authorized removal of all local inventory data, so the
  sample rows created in the browser walkthrough have been cleared.

- 14 October: completed the user-requested live local browser stock-to-paid-order
  walkthrough. Created `قهوه 100 عربیکا` with an explicit 1,000 g pack. Found
  that API checks and a database index incorrectly limited the café to one
  posted opening count. The user approved per-item opening initialization and
  the new local migration. Replaced the global limit with a unique opening
  movement per stock item and retained transactional protection against
  reinitializing tracked balances, including zero openings. Added count-item
  selection so unrelated items remain untouched. Applied
  `20261014093000_opening_inventory_per_item` to local `cafe_management`.
  Opening 2,000 g / 2,000,000 Toman, purchase +1,000 g / 1,200,000 Toman, and
  physical count 2,900 g / 3,093,333 Toman all posted through the UI. Configured
  sample Arabica espresso recipes at 18 g single and 36 g double; previews
  returned 19,200 and 38,400 Toman. Saved takeaway order #1 for one single and
  two doubles with the 100 percent Arabica option, totaling 715,000 Toman.
  Stock remained 2,900 g before settlement. The user performed the final
  payment click after browser approval review required a handoff. The paid
  order then closed, stock became 2,810 g / 2,997,333 Toman, and the filtered
  movement history showed exactly one -90 g / -96,000 Toman consumption
  entry and no pending consumption. All 76 focused API checks, 12 inventory
  UI checks, both typechecks, and the diff check pass at that time. The sample
  records and two espresso costing assignments were later cleared from the
  local database at the user's request.
  Prisma status confirms all 33 local development migrations are current.
  The optional multi-database migration rehearsal was blocked by the sandbox;
  that script creates additional databases outside the authorized test target,
  so it was not retried. The approved isolated database reset applied all 33
  migrations successfully.

- 14 October: completed inventory error-envelope and handling follow-up.
  Validation retains safe field details, stale-version errors include the
  current version when known, and inventory routes declare internal/dependency responses.
  PostgreSQL/Prisma errors map to safe conflict, range/business, dependency,
  or internal responses. Logs retain SQLSTATE, available schema identifiers,
  Prisma code, request/route context, and source locations without raw database
  messages, SQL, parameters, credentials, or failing rows. Blank supplier
  strings, out-of-range input quantities, inexact package multiplication, and
  receipt balance overflow are rejected before invalid writes. The POS shows
  Persian errors, field details, and a support reference; reads fail within
  their affected panel, retry buttons repeat reads only, draft data survives
  failed writes, and duplicate submissions are blocked while a write is
  pending. A rejected multi-line receipt rolls back every line. Failed costing
  reads block edits until a successful read, and stale
  read responses cannot replace a newer product's configuration. All 75 focused
  API checks pass against `cafe_management_test`, including the actual
  `PrismaClientUnknownRequestError` produced by a purchase constraint. The
  inventory UI passes 11 checks, API transport 4, and Manager workspace 13;
  API/POS typechecks pass. No new migration or development-data mutation was
  needed. The specific earlier failed purchase was not replayed against café
  data; its original payload and database cause were absent from the old logs.

- 13 October: clarified the archived-stock behavior. Archiving hides the item
  from active stock lists and preserves its database history; active stock names
  may be reused after archive. Archived display names are retained separately
  while internal unique names are reassigned. Filtered archived rows from the
  stock management list. Prisma schema validation and generation, POS
  and API typechecks, and `git diff --check` pass. Corrected the declared return
  type in the already-modified `test/verify-isolated-restore.ts` helper. Prisma
  migration diff generated the new-column SQL. With the user's approval, applied
  `20261013103000_reuse_archived_stock_names` to the local `cafe_management`
  database at `127.0.0.1:5433`; Prisma reports the database schema up to date.
  Browser access was unavailable during that pass; archive/name-reuse and
  historical display were verified in the local POS on 14 October. No tests
  were run for the migration change.

## Follow-up — Archived Stock Name Reuse

- [x] Hide archived stock items from the active stock management list.
- [x] Preserve archived names and history while freeing names for new active
  stock items.

Left:

- None. Local POS verification confirmed that archived stock is removed from the
  active list, a new item can reuse its name, and the archived opening-count
  movement remains visible under the archived name in movement history.

## Follow-up — Archived Recipe Name Reuse

- [x] Hide archived recipes from active recipe selectors and lists.
- [x] Preserve archived recipe names and history while allowing an active
  replacement to reuse the name.

Left:

- None. The additive migration is applied to the local development database;
  archived recipe DTOs continue to display their retained original names.
  API and POS typechecks pass.

## Follow-up — Recipe Component Entry

- [x] Remove the manual ingredient-identifier field from recipe component rows.
  The POS retains the internal component key used by option-costing rules.

Left:

- None. POS typecheck and `git diff --check` pass.

- 13 October: refined the gross-profit report layout after a focused
  Impeccable review. Date filters now lead in a full-width row, followed by
  the café totals and full-width product detail; totals use a compact paired
  grid on desktop and two columns on narrow screens. Desktop and 390 px
  browser views were checked. The layout detector, POS typecheck, and diff
  check pass.

- 13 October: refined the physical-count form after a focused Impeccable
  layout review. Each stock item now keeps its name, quantity, and value
  together in one desktop row; the fields stack clearly on a narrow screen.
  The form no longer has a redundant inset frame. Desktop and 390 px browser
  views were inspected; the layout detector, POS typecheck, and diff check pass.

- 13 October: ran an Impeccable critique of the Manager inventory and
  gross-profit UI (22/40 baseline) and applied its targeted `clarify`,
  `harden`, `distill`, `layout`, `adapt`, and `polish` follow-up. Purchase
  creation now names the draft state and distinguishes final receipt posting;
  purchase and count posting show quantity/value and reconciliation summaries
  before confirmation. Recipe option rules select a named base component in
  place of recalling its internal key. The report gives the product table full
  width and explains narrow-screen scrolling. Inventory navigation announces
  its active section, and confirmation dialogs manage focus and keyboard
  dismissal. The focused inventory component suite passes 7/7, the POS
  typecheck passes, and desktop and narrow-screen browser inspection confirms
  the revised report and purchase form layout.

- 13 October: ran the isolated custom-format backup and clean restore rehearsal
  to completion against `cafe_management_test`. The backup validated, restore
  succeeded, all 31 migrations were current, and paid-order, tender, audit, and
  inventory fixtures were preserved. Stage 14 is complete.

- 13 October: ran `pnpm --filter @cafe/api test` to completion against the
  isolated database. Its authorized reset applied all 31 migrations and every
  isolated API integration, route, and benchmark test passed. Refreshed the
  inventory benchmark record with the current run's purchase posting, pending
  retry, count, and report p50/p95 samples. The backup/restore rehearsal remains
  the only open Stage 14 gate.

- 13 October: completed the remaining Stage 14 API, POS-component, and
  authenticated browser coverage except the clean backup/restore rehearsal.
  Inventory integration passes 17/17, the full POS suite 101/101, and API/POS
  typechecks pass. Added exact fractional half-up valuation, multi-item count
  eligibility and adjustment movements, corrected-tender neutrality,
  reconciled-stock restoration after settlement reversal, missing-cost
  reporting, all Manager-only inventory read/write routes, response DTO schema
  checks, P2 editing/history/validation cases, and four dedicated inventory
  workspace component tests. Browser checks verified purchase-return entry,
  option-adjusted costing preview, physical-count values and history,
  item-filtered movement history, and report date validation without mutating
  café data. The 30-to-31 migration upgrade preserved existing data, and
  `prisma migrate status` reports all 31 checked-in migrations current.
  Automatic review rejected the guarded custom-format backup/restore command
  due to concern about additional database targets; no restore command ran.

- 13 October: completed the representative Stage 14 browser walkthrough in the
  local POS. An over-return validation response no longer triggers reload or
  leaves a stale Manager-wide connection error; the purchase panel retains the
  entered values, and a return at the exact received quantity succeeds. Created
  and fully settled one local Espresso Single takeaway order; the same-day
  gross-profit report showed the expected sale, complete costing, and no
  pending consumption. Its estimated inventory-consumption total differs from
  recognized COGS by 1 Toman; the report labels this value as estimated and the
  discrepancy remains under review. User-confirmed coverage for concurrency,
  transaction rollback, and report-date/inventory-period boundaries is
  complete. At that time, fractional valuation and the migration/restore
  rehearsal were still open; fractional valuation and the upgrade are now
  complete, while backup/restore remains open.

- 13 October: authorized local development migrations in `AGENTS.md`, backed
  up `cafe_management`, and applied `20261012110000_inventory_costing` with
  `prisma migrate deploy`. The authenticated POS inventory workspace and
  gross-profit report now load successfully; broader browser acceptance and
  the migration/restore rehearsal remain open.

- 12 October: completed inventory Stage 12. Added Manager stock, purchase,
  recipe, costing, preview, count, movement, and pending-consumption APIs;
  order snapshots and whole-order payment inventory recognition; shortage
  retry, count reconciliation, and exactly-once reversal/deletion restoration.
  Contracts build and API typecheck pass; inventory integration passes 4/4 and
  the existing orders integration passes 41/41 against the authorized isolated
  PostgreSQL test database. Started Stage 13.

- 12 October: completed inventory Stage 13. Added the Manager inventory
  workspace for stock, purchases, recipes and costing, counts, reconciliation,
  movement history, pending consumption, and Tehran-date gross-profit reports.
  Added discount allocation and reversal restatement coverage. Contracts and
  API/POS typechecks pass; the POS suite passes 96/96 tests, inventory passes
  6/6, and orders passes 41/41. Stage 14 browser and migration/restore checks
  remain open. Inventory route timings are recorded in
  `docs/performance/inventory-costing-response-times.md`.

- 7 October: completed Stage 10.20–10.22. Local API/report benchmarks and
  live public menu/image timings, with their methods, workloads, p50/p95
  results, and limits, are recorded in
  [the Stage 10 response-time benchmark record](performance/stage-10-response-times.md).
  The repeatable isolated benchmark is
  `apps/api/test/performance/stage10-benchmark.test.ts`; it passed (1 file / 1
  benchmark test).

- 7 October: completed Stage 10.15–10.19. The authorized `cafe_management_test`
  schema was reset and all 30 checked-in migrations applied. A custom-format
  backup of that isolated database passed `pg_restore --list`; the guarded
  restore rehearsal restored a synthetic paid order, settlement, tender, and
  audit record, then confirmed `prisma migrate deploy` found no pending
  migrations. Session review confirmed HttpOnly, SameSite=Strict, production
  Secure cookies, 15-minute access tokens, hashed rotating refresh tokens,
  server-side Staff/Manager checks, and SameSite plus disabled CORS as the CSRF
  defense. Request-boundary review confirmed schema and body limits, one-file
  5 MiB image uploads with signature checks, 32-character production secrets,
  OTP throttling, cookie log redaction, and generic error logging. Added a
  bounded login-failure throttle of five attempts per normalized username in
  15 minutes. It is process-local, matching the current single API process.
  The full-workspace `pnpm audit` initially reported 3 critical, 25 high, and
  9 moderate advisories. Patched compatible packages and added overrides for
  `@fastify/static` 10.1.2 and `deepmerge-ts` 8.0.0; the final scan reports zero
  advisories across 465 dependencies. API, POS, and web typechecks pass. Focused
  auth tests pass 8/8, image tests 3/3, and OpenAPI tests 2/2.
- 7 October: completed Stage 10.14 public-response safety coverage. The public
  menu tests assert its exact catalog DTO and exclude internal pricing,
  preparation, ordering, and archive fields. Anonymous table-context,
  customer-authentication, OTP, and waiter-call responses assert their allowed
  fields and exclude QR tokens, table and waiter-call IDs, customer IDs, names,
  and phone numbers. Public-menu integration passes 4/4 tests and waiter-call
  integration passes 8/8 tests.
- 7 October: completed Stage 10.13 concurrency coverage. A stale order edit
  after a table transfer returns `STALE_VERSION` without changing the item;
  simultaneous edits using one order version commit only one mutation, return
  `STALE_VERSION` for the loser, and retain one version increment and audit
  entry. Existing concurrent-settlement coverage also confirms only one
  settlement commits. The orders integration suite passes 41/41 tests.
- 7 October: completed Stage 10.12 idempotency coverage. Order creation,
  settlement recording, settlement correction, and waiter-call deduplication
  retries are covered. Same-key replays preserve the original result without
  duplicating orders, settlements, tenders, allocations, reversals, audit
  entries, or idempotency records; changed payloads return
  `IDEMPOTENCY_CONFLICT`. Settlement-correction replays now return the
  documented `Idempotency-Replayed: true` header. Orders integration passes
  40/40 tests, waiter-call integration passes 8/8, and API typecheck passes.
- 7 October: moved Stage 10.11 authorization coverage to
  `docs/planning/deferred-project-features.md`. Detailed Staff/Manager access
  boundaries are not required for the current café workflow; retain the task
  for the general POS project-completeness pass.
- 6 October: completed Stage 10.10 settlement and reporting integration
  coverage against the isolated PostgreSQL test database. After applying all
  migrations with the authorized test database reset, the orders integration
  suite passes 39/39 and the admin/reporting suite passes 15/15. Coverage
  verifies item- and amount-based allocation, payment corrections that record
  the prior settlement as reversed, rejection of the retired direct reversal
  route without financial side effects, fixed daily report totals for mixed
  tenders/discounts/deleted orders, Tehran date and shift boundaries, and
  cross-day reversal reporting.

- 6 October: completed Stage 10.9 core PostgreSQL integration coverage. Order
  create/edit/delete and payment scenarios pass, including a forced audit-write
  failure after settlement persistence begins; database assertions verify the
  settlement, tenders, allocations, order closure, table release, audit row,
  and idempotency record roll back together. The orders integration file passes
  39/39 tests; the full API suite passes 17 files / 115 tests.

- 6 October: completed Stage 10.6–10.8. The generated OpenAPI audit checks
  every API operation for success/request/path/error schemas; the settlement
  correction body schema was added and shared structured errors are documented.
  Added pure pricing, catalog discount, quantity-allocation, payment-status,
  and order DTO validation coverage. The full API package suite passes all
  17 files / 114 tests, and API typecheck passes. Later Stage 10 gates remain
  open.

- 6 October: closed Stage 10.1–10.5. The nine POS suite failures came from
  assertions using Persian labels that had changed in the current UI copy. The
  four focused test files pass 29/29 tests; the complete POS package suite
  passes all 19 files / 95 tests.

- 6 October: split the remaining Stage 10 backend and end-to-end gate into
  independently verifiable checklist items. The known POS suite failures are
  listed separately from API, migration, security, performance, and browser
  E2E work so each result can be closed and recorded on its own.

- 6 October: completed Stage 10 P4.2 and P4.3 behavioral coverage. The API
  integration suite passes all 16 files / 107 tests, including promotional
  membership add/remove with public-menu output and catalog/item/order discount
  rounding through settlement. POS focused coverage passes 28 tests for picker
  membership saves/removals, rounded draft totals, both save-and-print actions,
  print-frame completion, and ticket acknowledgement. Contract rounding tests
  pass 11 tests. POS typecheck passes. The full POS package suite still has 9
  failures: 4 Manager workspace, 1 POS session-boundary, 3 recovery-state, and
  1 settlement test. The wider Stage 10 gate remains open.

- 6 October: resolved the Stage 6 limited public-menu pilot follow-up.

- 6 October: Manager audit entries now include associated order references and
  settlement-correction links, and the audit filter can find all order and
  settlement events by order UUID. Browser and API acceptance remains pending
  under Stage 10.

- 6 October: replaced user-facing “POS” terminology in the POS catalog and
  Manager controls with «صندوق», including the application name metadata.

- 6 October: new-order entry now offers separate confirmation actions to save
  the order and print either a bar ticket or a customer receipt. Editing an
  existing order keeps its separate print actions and no longer shows the
  combined save-and-print bar-ticket action. Stage 10 browser and printer
  acceptance remains open.

- 6 October: completed a Persian copy-editing pass across the shared POS and
  Manager workspace, including order entry, catalog, payments, accounting,
  audit, settings, recovery, login, and printed receipts. Standardized wording
  and clarified action outcomes and error guidance. No workflow behavior
  changed; Stage 10 browser, café-device, and printer acceptance remains open.

- 5 October: deployed all committed application updates through `978da8b`
  as release `pos-20261005-978da8b`. The additive promotional-membership
  schema migration is applied; migration status reports all 30 migrations
  current. No category seed ran and no developer-local uploaded images or
  category records were transferred. The VPS image-storage directory remains
  intact. Public `/menu`, `/pos`, `/pos/release`, a committed menu image, and
  the POS font returned HTTP 200; API readiness is connected and all three
  services are active with `NRestarts=0`. POS device/printer acceptance and
  the remaining Stage 10 checks stay open. The release exposed a missing
  migration-before-activation check; the incident and new schema gate are
  recorded in `docs/planning/production-gates.md`.

- 5 October: the public-menu `افزودنی` category now uses two columns, including
  narrow mobile layouts. Items with an uploaded image sort first and span the
  full category width; items without an uploaded image have no artwork
  placeholder. Uploaded product images now load through a same-origin web
  proxy to the API image route. Reloaded the attached browser and confirmed the
  uploaded add-on photo renders in its full-width card; café-device acceptance
  remains open.

- 5 October: discounted final amounts now round to the nearest 1,000 Toman
  (halfway values round up); the public menu retains compact prices in
  thousands of Toman. POS previews include catalog offers. Added the combined
  order-save and bar-ticket action; ticket acknowledgment no longer depends on
  `afterprint`. Stage 10 browser, device, printer, and behavioral verification
  remains open.

- 5 October: documented that developer-local POS image uploads are café runtime
  data and must stay out of VPS release archives and transfers. Releases must
  preserve the VPS image directory; static, committed menu images remain part
  of the application artifact when needed.

- 5 October: approved promotional categories as a Stage 10 catalog increment.
  A product keeps one canonical source category and can be listed in
  promotional categories by membership. Schema, API, contracts, UI, and
  migration are implemented; generated Prisma, contracts build, API typecheck,
  POS typecheck, and diff check pass. Local migration deployment resolved the
  POS Manager catalog load failure; the database is up to date and the catalog
  loads in the browser. Membership API/public-menu behavior, the promotional
  category action flow, and behavioral tests remain open.

- 5 October: fixed promotional-category creation feedback in the catalog.
  The form now resets safely after the async save, selects the newly created
  category, and explains how source and promotional types differ. POS
  typecheck passes. The
  existing `ویژه و جدید` category is still a source category; preserving its
  products while reclassifying it requires choosing their canonical source
  records, so that data change remains unresolved.

- 5 October: improved the promotional product picker with guarded dismissal,
  Escape and focus handling, initial search focus, searchable/collapsible source
  groups with counts, and explicit product-eligibility guidance. In an isolated
  Manager browser, checked focus wrapping/restoration, search filtering, and
  the unsaved-change warning. No membership changes were saved.

- 4 October: deployed POS/API release `pos-20261004-55f9fe5` from commit
  `55f9fe5`. Both 3 October migrations are applied; all 29 migrations are up
  to date. API readiness, public `/menu`, `/pos`, `/pos/api/v1/health/ready`,
  and `/pos/release` returned HTTP 200; all three services are active with
  `NRestarts=0`. Browser, café-device, printer, and full pilot acceptance stays
  open in Stage 10.
- 4 October: POS and thermal print typography now uses Manrope for ASCII digit
  glyphs only, with Estedad retained for Persian glyphs and RTL unchanged.
  Stage 10 browser and printer acceptance remains open.
- 4 October: table-order payment status now uses the takeaway panel's blue badge
  styling at the left of the occupied-panel header; elapsed time remains below
  the table title. Stage 10 browser and café-device acceptance remains open.
- 4 October: the occupied-order panel no longer has a 42px top margin, so its
  border aligns with the table grid when a table order is selected. Stage 10
  browser and café-device acceptance remains open.
- 4 October: thermal-ticket option text now uses Estedad Medium (500) for
  stronger readability on the café printer. Physical printer acceptance stays
  open in Stage 10.
- 4 October: customer receipts now emphasize both the `مجموع` label and total,
  show `تومان` once, use a padded Persian date/time, and add vertical space to
  item rows. Printer acceptance remains open in Stage 10.
- 4 October: the saved takeaway order's unpaid badge now shares the close
  button's header row and sits on the panel's left side. Stage 10 acceptance
  remains open.
- 4 October: moved Manager audit history out of the accounting tab into a
  dedicated audit tab; payment history and the accounting summary remain in
  the accounting tab. Stage 10 browser acceptance remains open.
- 4 October: customer receipts use the `RUN Cafe` Playfair Display Bold wordmark
  and show each item name/quantity beside its immutable base-price snapshot;
  options remain listed below. The receipt total remains authoritative and
  unchanged. The bar ticket is unchanged; printer acceptance remains in Stage 10.
- 4 October: hardened the Manager payments/deletions panel at narrow usable
  widths. Its grid now collapses based on card fit, and the retained-history /
  report-exclusion consequence is presented as a concise callout. Accounting
  summary stickiness now turns off when the grid stacks. Visually checked in
  the attached browser at 744×512; Stage 10 acceptance remains open.
- 4 October: the POS catalog product editor can create a product-specific
  option group and its first priced option while saving the product. It can
  also update shared option base prices independently from product overrides,
  and clear a product override to use the shared base price.
  Base price inputs use separate accessible labels and enforce the database
  integer range. The flow resumes from created group/option IDs after a partial
  failure. Browser and café-device acceptance remains in Stage 10.
- 4 October: traced “خامه” on “وایت چاکلت” to an explicit product override of
  0 masking its 80,000 base price. Set the product price to 80,000 and verified
  a refreshed public-menu dialog and an isolated POS draft both calculate
  375,000 (295,000 + 80,000). No order was submitted; café-device acceptance
  remains in the Stage 10 checklist.
- 3 October: the catalog product-options editor now disables limits for
  excluded groups and price overrides for unchecked options. It reports
  invalid minimum/maximum pairs and minimum counts above the allowed options;
- 3 October: product image alt text now follows the product name. Its migration
  and browser/device acceptance are pending above.
- 2 October: integrated POS TODO items #2–6 and #8–13 are complete in code and
  locally verified. TODO items #1 and #7 were excluded; see `docs/todo-final-test.md`.

## Last Recorded Local Verification

On 2 October 2026, the integrated pass recorded the isolated API suite at
16 files / 102 tests, the POS suite at 18 files / 87 tests, contracts build,
API/POS typechecks, POS production build, and attached-browser verification at
469×343, 390×844, and desktop sizes. These checks predate the 3 October changes;
they do not verify the pending migrations, current uncommitted tree, printer,
or full Stage 10 exit gate.
