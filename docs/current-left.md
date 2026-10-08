# Current Stage Status

Last reconciled: 6 October 2026. This file is the active completion checklist;
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
| 7 — Shared POS foundation | Implementation complete; acceptance pending | Shared Staff/Manager POS, table/order/payment/receipt flows, waiter calls, and recovery are implemented. Finish the operational checks below. |
| 8 — Manager capability backend | Complete | Catalog, Staff/settings, payment history, accounting, audit, and reversal APIs are implemented. |
| 9 — Manager panels in shared POS | Implementation complete; acceptance pending | Role-gated Manager workspace and its panels are implemented. Finish the operational checks below. |
| 10 — Full-system hardening and POS pilot | In progress | Owns the remaining end-to-end, security, release, hardware, and live-pilot evidence. |

## Active Completion Checklist — Stage 10

- [x] Resolve the limited public-menu pilot follow-up for Stage 6.
- [x] Provision and physically verify the 13 independent table QR artifacts
  for eligible tables 1–13.
- [x] Complete attached-browser and café-device acceptance for Staff and
  Manager flows: order entry/editing, settlement and payment correction,
  deletion, discounts, waiter calls, reconnect/recovery, and accounting.
- [x] Verify bar tickets and customer receipts in Chrome on the café POS,
  including the configured printer, Persian output, 80 mm paper, and paper
  advance.
- [x] Apply and verify the pending 3 October migrations through the release process:
  product-image alt text follows the product name, and discount/payment-method
  correction reasons are optional. Backup and rollback evidence are retained
  for release `pos-20261004-55f9fe5`.
- [x] **10.1 — Resolve the four known POS test groups:** investigate and fix or
  update the 4 Manager workspace failures.
- [x] **10.2 — Resolve POS session-boundary coverage:** investigate and fix or
  update the 1 session-boundary failure.
- [x] **10.3 — Resolve POS recovery coverage:** investigate and fix or update
  the 3 recovery-state failures.
- [x] **10.4 — Resolve POS settlement coverage:** investigate and fix or update
  the 1 settlement failure.
- [x] **10.5 — Re-run the complete POS package suite** and record the final
  result after 10.1–10.4.
- [x] **10.6 — Reconcile OpenAPI coverage:** compare implemented routes and
  realtime events with the current contract; fill missing request, response,
  and error schemas.
- [x] **10.7 — Complete unit coverage:** verify pure domain rules,
  discount/payment calculations, allocation rules, and state transitions.
- [x] **10.8 — Complete API contract coverage:** verify DTO validation,
  request/response behavior, and structured errors against the contract.
- [x] **10.9 — Complete core PostgreSQL integration coverage:** verify order
  creation/edit/deletion and transactional payment workflows.
- [x] **10.10 — Complete settlement and reporting integration coverage:** verify
  allocation, reversals, and daily-report totals against fixed fixtures.
- [x] **10.12 — Complete idempotency coverage:** verify retries cannot duplicate
  orders, settlements, tenders, or other guarded mutations.
- [x] **10.13 — Complete concurrency coverage:** verify stale edits and
  simultaneous mutations return conflicts without overwriting newer state.
- [x] **10.14 — Complete public-response safety coverage:** verify public menu
  and other anonymous responses do not expose private catalog or operational
  data.
- [x] **10.15 — Rehearse migrations on a fresh database** and record the
  commands and result.
- [x] **10.16 — Rehearse backup restore and migrations on a restored,
  production-like database** and record the evidence.
- [x] **10.17 — Review session security:** check cookies, token handling, CSRF
  protections, and Staff/Manager authorization.
- [x] **10.18 — Review request and data boundaries:** check rate limits,
  uploads, input limits, secrets, and safe logging.
- [x] **10.19 — Run and record a dependency security scan.**
- [x] **10.20 — Measure transactional response times:** record login, order
  create/edit/delete, and payment targets with the measurement method and
  workload.
- [x] **10.21 — Measure report response times** and record the query/workload
  used.
- [x] **10.22 — Measure image and public-menu response times** and record the
  request/workload used.
- [ ] **10.23 — Run the critical browser E2E suite** from
  `docs/planning/browser-testing.md` across public menu, POS ordering and
  printing, settlement/tenders, deletion, receipts, Manager, and reporting.
- [x] Add Manager controls to create, edit, and remove product offers by
  entering a final price or percentage. Show the calculated percentage in POS
  for final-price offers; show only a percentage in the public menu. The menu
  refreshes on tab return and once per visible minute. Browser/device
  acceptance remains open.
- [x] Enforce source-only categories in POS catalog reads and order creation/editing;
  prevent promotional categories from becoming POS-visible or being archived.
  Focused admin, POS catalog, and order integration coverage passes.
- [x] Complete backend-backlog P4.2 membership API/public-menu behavior by
  saving and removing promotional memberships and verifying public-menu output.
- [x] Complete backend-backlog P4.3 discounted-price rounding and the POS
  confirm-order-and-print actions for bar tickets and customer receipts when
  creating orders. Confirm printing from the operator's successful action.
- [x] In the isolated Manager browser, verify the promotional picker opens with
  collapsed source groups, product search, eligibility guidance, keyboard focus
  containment, and a discard warning for changed selections.
- [x] Apply the promotional-category migration locally and verify that the
  Manager catalog loads again.
- [x] Complete production readiness evidence in
  `docs/planning/production-gates.md`, including backup/restore, monitoring,
  restart recovery, runbook/manual fallback, and a limited live café shift with
  payment reconciliation and no unresolved financial difference.

## Latest Implementation Notes

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
  browser and café-device acceptance remains in the Stage 10 checklist.
- 3 October: product-options headings, guidance, labels, numeric values, and
  validation messages now use the POS body type role for easier scanning.
- 3 October: POS discounts and payment-method corrections no longer require a
  reason; paid-order deletion was already reasonless. Explicit full-settlement
  reversal still requires a reason. The migration and browser/release checks
  are pending above.
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
