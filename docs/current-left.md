# Current Stage Status

Last reconciled: 5 October 2026. This file is the active completion checklist;
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
| 6 — Public-menu VPS deployment and pilot | Deployed; pilot follow-up remains | The menu is live; close any outstanding limited-pilot feedback/evidence. |
| 7 — Shared POS foundation | Implementation complete; acceptance pending | Shared Staff/Manager POS, table/order/payment/receipt flows, waiter calls, and recovery are implemented. Finish the operational checks below. |
| 8 — Manager capability backend | Complete | Catalog, Staff/settings, payment history, accounting, audit, and reversal APIs are implemented. |
| 9 — Manager panels in shared POS | Implementation complete; acceptance pending | Role-gated Manager workspace and its panels are implemented. Finish the operational checks below. |
| 10 — Full-system hardening and POS pilot | In progress | Owns the remaining end-to-end, security, release, hardware, and live-pilot evidence. |

## Active Completion Checklist — Stage 10

- [ ] Record or close the remaining limited public-menu pilot feedback for
  Stage 6.
- [ ] Provision and physically verify the 13 independent table QR artifacts
  for eligible tables 1–13.
- [ ] Complete attached-browser and café-device acceptance for Staff and
  Manager flows: order entry/editing, settlement and payment correction,
  deletion, discounts, waiter calls, reconnect/recovery, and accounting.
- [ ] Verify bar tickets and customer receipts in Chrome on the café POS,
  including the configured printer, Persian output, 80 mm paper, and paper
  advance.
- [x] Apply and verify the pending 3 October migrations through the release process:
  product-image alt text follows the product name, and discount/payment-method
  correction reasons are optional. Backup and rollback evidence are retained
  for release `pos-20261004-55f9fe5`.
- [ ] Complete the Stage 10 backend gate: current OpenAPI coverage, unit and
  isolated PostgreSQL integration/contract/authorization/idempotency/concurrency
  suites, fresh and restored-database migration rehearsals, security review,
  and measured response targets.
- [x] Add Manager controls to create, edit, and remove product offers by
  entering a final price or percentage. Show the calculated percentage in POS
  for final-price offers; show only a percentage in the public menu. The menu
  refreshes on tab return and once per visible minute. Browser/device
  acceptance remains open.
- [x] Enforce source-only categories in POS catalog reads and order creation/editing;
  prevent promotional categories from becoming POS-visible or being archived.
  Focused admin, POS catalog, and order integration coverage passes.
- [ ] Complete backend-backlog P4.2 membership API/public-menu behavior by
  saving and removing promotional memberships and verifying public-menu output.
- [ ] Complete backend-backlog P4.3 discounted-price rounding and the POS
  confirm-order-and-print-bar action. Confirm printing from the operator's
  successful action; browser/device verification remains part of Stage 10.
- [x] In the isolated Manager browser, verify the promotional picker opens with
  collapsed source groups, product search, eligibility guidance, keyboard focus
  containment, and a discard warning for changed selections.
- [x] Apply the promotional-category migration locally and verify that the
  Manager catalog loads again.
- [ ] Complete production readiness evidence in
  `docs/planning/production-gates.md`, including backup/restore, monitoring,
  restart recovery, runbook/manual fallback, and a limited live café shift with
  payment reconciliation and no unresolved financial difference.

## Latest Implementation Notes

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
