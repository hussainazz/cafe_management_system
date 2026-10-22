# Current Stage Status

## Staff catalog, payment history, and settlement permissions — 22 October 2026

- Approved behavior: Staff and Managers can manage catalog/prices and catalog
  sale discounts, and browse payment history; accounting summaries stay
  Manager-only. Staff and Managers can correct or reverse settlements.
- Reversal reasons are optional by default. A Manager-only setting can require
  a reason for reversals; tender corrections never require one.
- Added the persisted Manager-only reversal policy toggle, Staff API/POS
  access, Staff catalog/payment navigation, and route and UI regression tests.
- Review follow-up: fixed Staff table names on older unpaid orders using the
  operational table API, and retained the selected payment-history filter after
  reversal, correction, or deletion. Replaced a premature reversal-button
  assertion and added navigation, API transport, policy rejection/retry, and
  partial-amount correction regression coverage.
- Verification: API and POS typechecks passed; POS passed 21 files / 145 tests.
  The complete isolated API suite passed during implementation; post-review
  focused API checks pass 44 order tests and 20 administration tests. The 3
  image tests also passed during implementation. The local development
  migration and isolated test reset both applied the new field successfully.
- Release verification: API build passed; the isolated API test runner exited
  successfully; contracts passed 4 files / 18 tests; POS typecheck and all
  21 files / 145 tests passed. The production POS build used
  `cafe-20261022-e30d1fd`.
- Published 26 per-file commits to `main` and `origin/main` at
  `e30d1fd42dd1450c7cd5fdf6b5fc82dc8353fbd1`.
- Activated coordinated API/contracts/POS release `cafe-20261022-e30d1fd` on
  22 October. Artifact SHA-256:
  `36cae2e6befbd52c5df3779403cf7ef3e2b8562f30bb7743160d5612fc277af6`.
  Migration `20261022120000_staff_settlement_permissions` is applied; all 40
  migrations are current. API readiness, API menu, public menu proxy, `/menu`,
  `/pos`, and local/public `/pos/release` passed. The menu returned 16
  categories and 141 products; the release endpoint returned the new ID with
  `no-store`. API, POS, web, and Nginx are active; API/POS `NRestarts=0`; no
  recent API/POS error logs were present.
- Pre-release database backup validated with `pg_restore --list`:
  `/opt/cafe-menu-release-backups/cafe-db-before-cafe-20261022-e30d1fd.dump`.
  Runtime rollback archive validated with `tar -tzf`:
  `/opt/cafe-menu-release-backups/rollback-before-cafe-20261022-e30d1fd.tar.gz`.
- Remote branches: `main` only. Left: local branch
  `fix/partial-item-unpaid-edit` remains attached to an existing worktree with
  uncommitted changes; preserve that worktree until those changes are safely
  consolidated, then remove the branch.

## POS palette and compact-control refinement — 17 October 2026

- Refined the POS color tokens, product-picker spacing, and live table status
  labels for the current café interface.
- Verification: POS suite passed 21 files / 129 tests, POS typecheck passed,
  and the production build completed with `POS_RELEASE_ID=pos-20261017-f28c430`.
  pnpm reported its Node 25 engine warning; the build and test commands execute
  with Node 24.21.0.
- Published commits `14c13af`, `9147d4f`, and `f28c430` to `main` and
  `origin/main`.
- Activated the POS-only artifact on 17 October. Archive SHA-256:
  `1472d103d1c98fc376bef10df8389738ec4301731cd43ef719f5fced72355c81`.
  The validated rollback archive is
  `/opt/cafe-menu-release-backups/pos-before-pos-20261017-f28c430.tar.gz`.
  Local and public `/pos/release` returned the release ID with `no-store`,
  public `/pos` returned HTTP 200, `cafe-pos.service` is active with
  `NRestarts=0`, and no recent POS error logs were present. API, web, and Nginx
  remained active.

## POS polish and scrolling follow-up — 16 October 2026

- Applied the explicitly requested Impeccable polish on
  `codex/pos-polish-scroll-performance`, preserving the current POS design,
  Persian copy, financial behavior, and the existing deployment notes below.
- Removed the viewport-fixed gradient attachment across POS surfaces, themed
  native scrollbars, and added shared visible keyboard focus for links and
  disclosure summaries.
- Coalesced category scrollbar measurement and product-option popover
  positioning to one animation frame, canceling pending work on cleanup.
  Popover state no longer updates when its coordinates are unchanged; product
  grouping is memoized across scroll-driven order-editor updates.
- Corrected mobile RTL category scrolling: thumb anchoring, negative scroll
  offsets, wheel direction, pointer mapping, and PageUp/PageDown/Home/End.
- Verification: all 21 POS test files / 129 tests pass, POS typecheck passes,
  and `git diff --check` passes. The new popover regression reproduces 20
  immediate layout reads before the fix and one scheduled read afterward;
  a second regression covers RTL wheel/keyboard and thumb synchronization.
  Existing pnpm Node 25 engine warning remains.
- Local browser checks covered table board, order entry, drawer, accounting,
  catalog, Settings, and inventory at representative 1280, 874, and 390 px
  widths, including both themes. Inspected screens have no page-wide
  horizontal overflow; mobile category Home/End and thumb position agree;
  final browser warning/error log is empty. No business records were saved.
- Left: check scrolling on the actual café computer. These changes address
  measured scroll-event work and a plausible shared repaint cost; café-device
  smoothness has not been established.
- Published branch `codex/pos-polish-scroll-performance` with one commit per
  changed file. The production POS build `pos-20261016-76dbe2f` was uploaded
  with live SFTP progress and activated by swapping only the POS `.next`
  output. The uploaded archive SHA-256 matched the local artifact.
- Before activation, `/opt/cafe-menu-release-backups/pos-before-pos-20261016-76dbe2f.tar.gz`
  was created and validated. Local and public `/pos/release` return the new
  release ID; public `/pos` returns HTTP 200; `cafe-pos.service` is active with
  `NRestarts=0`. API, web, PostgreSQL, and uploaded product images were not
  changed.

## Coordinated VPS activation — 16 October 2026

- Activated `cafe-20261016-a10c5ab` from clean published `main` at
  `a10c5ab5f3efa9874c3e9d03f9adb8562e24fc0e`. This replaces the running
  8 October API/menu plus 12 October POS receipt release and includes the
  previously prepared `cafe-20261015-b6f0c53600` features and all later
  application edits through the published commit.
- Fresh verification passed: API 21 files / 151 tests, POS 21 files / 127 tests,
  public menu 2 files / 10 tests, all package typechecks and production builds,
  and 11 localized/international phone normalization samples. pnpm emitted its
  existing Node 25 engine warning; the VPS runs Node 24.21.0.
- Uploaded one 18.8 MB archive with live SFTP percentage/speed/ETA output.
  Archive and staged-file checksums passed. The artifact includes the Debian
  Prisma engine, matching contracts, schema and all 39 migrations, and immutable
  POS build/release identity. Development caches, environments, local uploaded
  images, and unused image originals were excluded; unchanged static assets
  were compared by checksum and retained.
- Validated fresh PostgreSQL custom-format and coordinated runtime backups.
  Applied the nine reviewed pending migrations before starting the new API;
  Prisma reports all 39 migrations current. No production reset or seed ran.
- Direct readiness, menu API, menu proxy, public HTTPS menu/POS/release, logo,
  and Anton font probes passed. Catalog data/prices match the pre-release
  snapshot; API and proxy agree after their documented DTO transformation.
  Uploaded image checksums are unchanged. All three services are active with
  `NRestarts=0` and no error-level release logs.
- Inventory remains inactive (`inventoryActivatedAt` is null), with zero
  consumption and movement rows. Production retained 2,005 orders, 1,985
  settlements, and 181 catalog products at verification time. Inventory
  activation remains an explicit permanent Manager action.
- Runtime identity and source-file hashes are recorded in the VPS
  `/opt/cafe-menu/release-manifest.json`; rollback and database backups use
  `before-cafe-20261016-a10c5ab` names under `/opt/cafe-menu-release-backups`.
  Existing device/visual follow-ups are unchanged.
- Left: rotate obsolete VPS backups to the production-gate retention limit.
  Automatic approval review rejected deleting the older backup archives and
  duplicate previous-runtime staging directory as beyond deployment
  authorization. All old and new backups remain intact pending explicit
  cleanup approval; application activation and verification are complete.

## Main branch consolidation — 16 October 2026

- Consolidated all pending API, POS, public-menu, contract, migration, asset,
  review-note, and planning edits into `main`, publishing each file separately.
- Fixed the Manager card typecheck error by making its unused hint optional
  and omitting the empty hint paragraph. All workspace package typechecks pass;
  this supersedes the missing-hint/typecheck blockers recorded below.
- Fresh verification: isolated API suite passed 21 files / 151 tests,
  POS passed 21 files / 127 tests, public menu passed 2 files / 10 tests,
  and `git diff --check` passed. POS tests passed again after the hint fix.
- Verification used Node 25.9.0; pnpm warned that the project requires Node 24.
  Existing device/visual follow-ups remain as recorded. This consolidation
  does not change the separate production activation status.

- 16 October: added the selected service-bell ripple treatment to waiter-call
  arrival: two staggered signal arcs settle in about one second, with stronger
  inset press feedback on «رسیدگی». Table numbers stay fixed; reduced motion
  suppresses the signal arcs. Browser inspection confirms the staggered timing
  and that both arcs become invisible afterward; desktop/mobile layouts reviewed.

## Waiter-call tile refinement — 16 October 2026

- Restored the normal table-number size during pending waiter calls, added a
  shadow and foreground layer to the response button, and shortened its visible
  label to «رسیدگی». Reviewed in the local POS with table 3's pending mock call;
  the number retains its normal size and the button stays visibly separated.
- Follow-up: the response button overlays the full-height tile instead of
  reserving a footer row, preserving the number's normal vertical position.
- Delight: replaced the warning triangle with a service bell, added a single
  bell arrival cue and brief shadow emphasis, and strengthened response-button
  hover, press, and keyboard-focus feedback. Reduced motion removes movement.
  Desktop/mobile review completed; tightened the call timer to keep it on one
  line at narrow widths. Live arrival timing still needs operator acceptance.

Last reconciled: 15 October 2026. This file is the active completion checklist;
implementation history belongs in Git and feature-specific records, not in a
second chronological backlog.

## Promotional picker visual update — 16 October 2026

- Matched the reference's compact two-column category rows, stacked counts,
  search/category toolbar, selection tint, and footer without item images.
  Category checkboxes select eligible source products; individual selection,
  guarded dismissal, and save behavior remain available.
- Visual review at 903×581 completed. Focused catalog tests pass.
  POS typecheck remains blocked by existing test query typing errors and
  the missing Manager panel hint. Narrow-screen device acceptance remains open.

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
| 15 — Menu-option recipe configuration | Implementation complete; focused regression verification remains | Product-first single-panel UI, option-level full recipes, API resolution, contracts, generated client, and local development migration are in place; API/POS typechecks and the live Manager screen pass. |
| 16 — Customer-facing menu item notes | Complete | Manager catalog storage/API and menu popup support are implemented. Manager create/edit/clear, authorization, public response, and live POS-to-menu browser checks pass. |
| 17 — POS product selection refresh | Corrected card layout implemented and verified; unrelated POS typecheck blocker remains | Persistent inline choices, per-card configurations, icon add actions, anchored option popovers, and a custom category-list scrollbar are implemented; focused interaction tests and responsive browser checks pass. |

## Payment dialog clarification — 16 October 2026

- Independent design and evidence critique completed: 26/40. Default desktop
  and mobile dialogs fit. Follow-up findings: zero-tender readiness, Persian
  amount normalization, touch targets/disabled cues, mixed-tender adjustment
  behavior, and table identity. No payment was submitted during review.

- [x] Clarified selected-item/payment amount labels, unpaid quantity context,
  and the record-payment action. The second wording pass uses «اقلام این پرداخت»
  and separates unpaid counts from historical recorded counts.
  Single-method mismatches now show guidance
  and distinguish a remaining amount from an excess. Payment rules are unchanged.
- All 13 focused settlement tests and desktop browser review pass; mobile
  acceptance remains pending. POS
  typecheck remains blocked by the existing missing `hint` prop in
  `manager-workspace.tsx:893`.

## Product editor redesign — 16 October 2026

- [x] Applied Impeccable layout/typeset refinement to all product editor tabs:
  name-first form order, grouped status switches, explicit upload/preview/archive
  groups, consistent type roles and supported font weights, 16px inputs,
  readable Persian helper rhythm, narrow-screen stacked option fields, and
  footer safe-area spacing. Existing product behavior and copy are preserved.
- Current verification: layout/type detector scans and diff check are clean;
  desktop/mobile browser checks show no overflow in the inspected panels.
  Catalog tests pass 5/5 and focused image-upload progress passes 1/1.
  The wider Manager suite has two payment-history control failures outside
  this surface; POS typecheck retains the existing Manager missing `hint` prop.

- [x] Replaced the narrow product drawer with a centered cream/olive dialog,
  live product summary, four accessible tabs, accordion option groups, a split
  image-management panel, and fixed Save/Cancel actions. Existing product,
  shared-option price, override, discount, upload, and archive rules are retained.
- [x] Desktop and 390px mobile browser layout reviewed. Draft values survive
  tab changes; keyboard tab navigation has focused regression coverage.
- Verification: catalog and Manager tests pass 21/21, including image-upload
  progress through the new image tab. The broader POS run still has the
  existing order recovery test failure. The Manager missing `hint` typecheck
  error remain outside this change. No café records were saved during review.

## POS product selection refresh — 16 October 2026

- [x] Catalog category rename layout now places the name above equal-width
  Save/Cancel actions. Switching categories closes the previous editor and
  discards its unsaved draft. All three focused catalog tests pass.
  Browser acceptance remains pending: local verification encountered a Manager
  workspace compile error and an unavailable API on port 3001. POS typecheck
  also reports the existing missing `hint` prop in `manager-workspace.tsx`.

- [x] Correct the reference interpretation: show short option groups and existing
  shot variants inside cards immediately; selections never expand the grid.
- [x] Keep independent configurations per product/variant, icon-only add actions,
  accessible required/optional radio and checkbox controls, and tile quantity controls.
- [x] Portal complex groups beside their card, with search, internal scrolling,
  a fixed action footer, viewport repositioning, and close/Escape/outside handling.
- [x] Default available coffee-line choices to ۵۰/۵۰ and existing shot variants
  to دبل, while preserving explicit cashier changes per variant.
- [x] Replace the tile add action with minus/count/plus after adding its current
  configuration; synchronize with draft order quantities and restore add at zero.
- [x] Hide the browser scrollbar on the category list and use the POS custom
  scrollbar in both table and takeaway orders, positioned clear of category
  labels on desktop and along the bottom of the horizontal list on narrow
  screens.
- [x] Verify 26 focused product-picker/order-desk tests. Browser checks cover
  the real grid at 390 px, long-option fixtures at 1280×720 and 390×844,
  stable grid coordinates, no horizontal overflow, and lower-edge placement.

Left: the POS-wide typecheck is blocked by an existing missing `hint` prop in
`manager-workspace.tsx`; the changed product-selection files have no type errors.
Lint was run and its errors remain non-blocking under the project instruction.

## Active delivery — Inventory activation and coordinated VPS release

- [x] Add permanent Manager activation, inactive API/UI states, and guards for
  every inventory order/payment hook. Exclude orders created before activation.
- [x] Verify activation authorization, permanence, absence of inactive writes,
  and the pre-activation order boundary with the isolated test database.
- [x] Build and deploy the coordinated schema, ORM, API, POS, and menu release
  with inventory inactive, verified database/runtime backups, and public probes.

## Completion Record

- 16 October: the payment reconciliation summary now appears after staff add
  another payment method. The shared settlement sheet applies this to table
  and takeaway payments.

- 16 October: corrected conflicting tender-grid rules so the payment amount
  fills the available row width, including split tenders and mobile layouts.
  Corrected selection-button padding and tick dimensions to center the icon.

- 16 October: reduced the payment panel to a compact 520 px maximum width,
  tightened rows and totals, and matched the quantity stepper to the reference
  with warm filled end buttons, a thin enclosing border, and a centered count.

- 16 October: payment panel now follows the supplied cream-and-sage reference,
  with a larger heading and payable total, selectable item rows, left-side
  quantity controls, compact tender rows, and a reconciliation summary with
  the remaining tender balance. Existing settlement and correction flows are
  preserved. All 13 focused payment tests pass; local browser review covers
  the panel and totals. POS typecheck remains blocked by the existing missing
  Manager `hint` prop.

- 16 October: takeaway orders now reuse the occupied-table summary component
  with identical header, quantity badges, settled/unsettled rows, balance, and
  payment/receipt actions. The edit action opens the existing order editor;
  saving returns to the summary. Takeaway summaries omit table transfer.
  Focused order-desk tests pass 19/19; browser review confirms the shared
  panel presentation. POS typecheck retains the unrelated Manager `hint` error.
- 16 October: takeaway mode now uses the same compact header pill as selected
  tables, with its order context and close action. The duplicate takeaway box
  above product categories is removed; closing returns to the table board and
  protects unsaved drafts through the existing leave-order dialog.
- 16 October: selected table context now replaces the header mode switch with
  a compact RTL sage pill and close action. The selected pill uses the
  supplied single-row dark sage reference, without the redundant hall label. Removed the duplicate table box
  from the product sidebar. Closing reuses the existing unsaved-change dialog
  and returns to the table board. All 26 focused order-desk/product-picker
  tests pass; local browser review covers the reference and narrow layouts.
  POS typecheck remains blocked by the existing missing Manager `hint` prop.

- 16 October: POS catalog categories now follow their source or promotional type.
  Source categories appear in POS and promotional categories stay menu-only.
  Removed category visibility controls from the catalog panel, moved rename and
  delete actions into the selected category row, removed category type labels,
  and replaced the actions with icon buttons. The drag handle stays in a fixed
  left-side slot in RTL rows, and the selected category keeps its name, actions,
  and handle on one line at every sidebar width. Category deletion archives
  either category kind while retaining its history. The local POS layout was
  visually reviewed at 874×581.
- 15 October: bar-ticket item quantities use a rounded box beside the item
  name, with a dark outline for thermal printing. Selected options use heavier
  text. The changes remain local; VPS deployment is on hold.
- 15 October: product categories fit columns automatically within a flexible
  sidebar. The layout adapts to available space without a fixed desktop-width
  cutoff; compact mobile screens retain the horizontal category list.
- 15 October: the existing-order editor recalculates the order total in place
  as saved quantities and newly added items change, using saved price snapshots
  and the order's existing item and order discounts.
- 15 October: changed elapsed time on POS order/table tiles and waiter-call
  labels to zero-padded `HH:MM`.
- 15 October: refreshed the POS table board with the Warm Sage Cream palette:
  a softly lit cream canvas, warm ivory available tables, and graduated sage
  states for occupied tables and active orders. The active channel control now
  uses the same sage gradient. The local POS browser view was visually reviewed.
- 15 October: gave pending waiter-call tiles a dedicated status area and action
  footer. The table number no longer competes with the alert icon, and the
  full-width response action retains a usable touch target. Reviewed at the
  local POS widths 837×581 and 390×844.

Stage 10 closed on 12 October 2026. The café has used the menu and POS in live
operation for one month, completing browser/device acceptance, printing,
security, release, and production-readiness work. Stage-specific test,
migration, security, performance, and pilot evidence is retained in the linked
feature records and implementation notes below.

- 15 October: reduced the POS page's outer padding, the gap between table tiles,
  and the spacing between the selected-order panel and table grid. The updated
  layout was visually reviewed in the local POS browser. The top bar now matches
  the full POS workspace width instead of extending beyond its side edges. On
  narrower screens, long order-item lists are height-limited and scroll within
  the order panel. Expanding a saved item gives its selected row stronger
  contrast while leaving unselected rows unchanged. The payment modal's
  confirmation button is labeled «تسویه». The occupied-table panel separates
  settled and remaining quantities into distinct rows, puts settled rows last,
  and marks them with reduced opacity and a subtle strike line. Its header now
  gives the table identity more weight and places payment status below it in
  place of elapsed time. The compact header and close control follow the
  attached receipt-inspired layout, and the list uses subtle row separators,
  receipt-like alignment, and a compact built-in scrollbar. The fixed footer
  keeps payment, common actions, and the quieter transfer action visible. The
  panel now uses the POS sage palette for selected-order cues and a tighter
  footer to give the receipt list more vertical room.
- 15 October: replaced the Manager drawer entry with direct Settings, Accounting,
  Menu and Products, and Inventory entries. Settings now contains the nested
  Café Settings, Tables, and Audit tabs; legacy saved Manager workspace state
  opens Settings.
- 15 October: compacted the payment-history date, shift, and clock filters into
  one row at tablet widths, removed the payment-history hint, and added an
  explicit «همه» order filter.

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

## Active Completion Checklist — Menu-Option Recipe Configuration (Stage 15)

- [x] Complete backward-compatible storage and API handling for assigning a
  full reusable recipe to a product's public menu option. The migration is
  applied to local development; older costing configurations remain readable.
- [x] Simplify the Manager workflow to one panel where a manager selects a
  menu product, sees its active public options, and enters each option's full
  ingredient list.
- [x] Preserve unit labels, nested recipe selection, legacy costing rules,
  cost previews, and existing order-cost snapshots.
- [x] Make stock-item and existing-recipe selection searchable within each
  menu-option ingredient row.
- [x] Confirm recipe-name search narrows the picker in the authenticated POS
  browser without saving a recipe change.
- [x] Build contracts and pass API/POS typechecks; visually confirm the
  «لاته» product shows its three active menu options in the single panel.
- [ ] Run focused integration/regression verification for option recipe saves,
  costing previews, and simultaneous option selections before closing Stage 15.

## Active Completion Checklist — Customer-Facing Menu Item Notes (Stage 16)

- [x] Add one optional product explanation editable and removable by a Manager
  in the POS catalog. Keep it distinct from order-item preparation notes.
- [x] Persist the note and include it in the public-menu DTO without exposing it
  as an order-item note.
- [x] Show the note in the item detail popup beneath all option choices, or
  beneath the item details when there are no options; hide the note when empty.
- [x] Verify create, edit, clear, Manager authorization, and public DTO behavior.
- [x] Complete live browser E2E from POS catalog editing through the customer
  menu popup.

Verification: the focused API integration run passed 23/23 tests across Manager
catalog, public-menu, and POS-catalog reads. The POS catalog component passed
2/2 tests; the web menu utility suite passed 7/7; API, POS, and web typechecks
passed. Live browser verification saved, edited, displayed below the latte's
three option choices, then cleared the note through the POS and refreshed the
customer menu. Temporary local test text was cleared afterward.

## Active Completion Checklist — Inventory Stock And Purchase UX

- [x] Remove category entry from stock setup while preserving the stored value.
- [x] Replace piece-unit pack conversions with one optional count-per-package
  field beside the base-unit selector.
- [x] Add server-filtered purchase search, received-time/status filters, and
  cursor pagination to the Manager purchase history.
- [x] Run contracts build, API/POS typechecks, and `git diff --check`.
- [ ] Inspect the updated Manager panels in an authenticated browser session;
  the current browser session returned to sign-in during this pass.

## Active Completion Checklist — Inventory Count History

- [x] Add server-filtered stock-item search, kind/status filters, Tehran date
  range, and cursor pagination to inventory count history.

## Active Completion Checklist — Accounting Dashboard Refresh

- [x] Reorganize accounting into a vertical financial summary, compact filter
  controls, and a full-width payment history table. Preserve the existing
  report values, Tehran date semantics, payment-time behavior, sort controls,
  payment actions, and record identities.
- [x] Add today, yesterday, and last-seven-day presets, always-visible
  date/time filters, visible active-range feedback, metric cards, and status
  badges. Review the current data in both themes at desktop width.
- [x] Move discounts into the report details and add cards for card-to-card
  and cash totals from the existing filtered accounting response.
- [x] Move the filtered order count into the report details and remove its
  summary card.
- [x] Label the gross total «کل» and recorded settlements «تسویه شده».
- [x] Remove the custom-time option from the shift menu and add accessible
  previous/next-day controls beside both date fields.
- [x] Remove per-settlement ID text and strengthen the order, amount, and date
  typography in the payment-history table.
- [x] Add mutually exclusive filters for orders with at least two active
  settlements, discounted orders, and unpaid open orders created before the
  selected Tehran date range.
  Prior-day unpaid orders appear in a separate paginated list; the other two
  filters narrow settlement history.
- [ ] Align the remaining `manager-workspace.test.tsx` cases with the current
  section-based Manager navigation; several still expect the removed in-panel
  navigation.

Verification: contracts build, API/POS typechecks, and `git diff --check` pass.
Focused accounting UI checks pass for the summary, payment table typography,
exclusive filter behavior, separate prior-day unpaid list, and absence of
settlement IDs. The focused admin integration tests pass for multi-stage
settlement and discount filters: two active settlements appear, a one-settlement
order does not, and reversed settlements are excluded from the installment
count. Invalid filter values are rejected. The focused finance component test
covers the metric values, method totals, discount details, date presets, custom
clock bounds, and date stepping. The shift menu contains only all-hours,
first-shift, and second-shift options. The filter toggle was removed; date,
shift, and time controls, reset, and apply now appear immediately. Browser
review confirmed the
summary and table values update for today, yesterday, seven days, custom date
plus clock-time bounds, shift filtering, and reset. The full Manager component
suite has known pre-existing navigation failures because some tests mount the
section-based workspace without selecting a section and expect the prior
in-panel tabs. No
payment, order, or accounting data was changed.
- [x] Update the count-list contract, API documentation, and UI.
- [x] Run contracts build, API/POS typechecks, and `git diff --check`.
- [x] Inspect count history in an authenticated browser session.

Verified behavior: the Manager count panel displays creation times and filters
the count list by stock-item name and count type. The current local dataset has
four counts, so the first page was inspected; the next-page path was not
exercised against a second page.

## Active Completion Checklist — Physical Counts And Stock Opening Balance

- [x] Move opening quantity/value initialization into stock-item setup, with an
  auditable opening entry and one-time initialization for legacy untracked
  items.
- [x] Restrict the Manager count editor to physical counts and require one
  shared reason whenever any counted quantity differs from its recorded
  balance.
- [x] Update contracts, API documentation, and the inventory migration.
- [x] Run contracts build, API/POS typechecks, and `git diff --check`.
- [ ] Inspect stock setup and physical-count panels in the authenticated
  browser session without posting QA data; the open browser is signed out and
  does not expose an active Manager session.

Planning updated 14 October 2026 to reflect the approved opening-balance and
count-reason rules. Migration `20261014183000_stock_opening_physical_count_reason`
is applied to the local development database. Contracts and API/POS typechecks
pass. Browser verification remains pending because the available browser
session is signed out; no inventory records were created or posted.

## Active Completion Checklist — Inventory Movement History And Navigation

- [x] Show POS order numbers beside order-related inventory movements.
- [x] Add selectable movement search modes for stock-item name, POS order
  number, or change type, combined with a Tehran date range and cursor
  pagination.
- [x] Rename the Manager section to «انبار», move purchases first, and move
  gross profit to the final tab position.
- [x] Update contracts, API documentation, and the active stage notes.
- [x] Run contracts build, API/POS typechecks, and `git diff --check`.
- [ ] Inspect the movement table and tab order in an authenticated browser
  session; the available POS page is signed out.

Requirements recorded 14 October 2026. The code and documentation are updated;
contracts build, API/POS typechecks, and `git diff --check` pass. Browser
inspection remains pending because the available session is signed out.

Verified behavior: component identifiers may repeat across different recipes;
they must be unique within each recipe. Product costing option rules target a
component in the selected product recipe and can replace it with a specific
stock item or recipe. When multiple selected options affect the same component,
configure exact option-combination overrides; separate option rules targeting
that same key conflict. The public-menu response currently contains no recipe
or ingredient list, so the curated public ingredient summary is not implemented.

## Latest Implementation Notes

- 14 October: added a Manager-managed customer-facing product note separate
  from order-item preparation notes. The POS catalog supports writing,
  updating, and clearing it; the public menu exposes it only in the product
  detail popup, below option choices. Focused API, POS, web checks and live
  browser verification are recorded in Stage 16 above.

- 14 October: replaced the long ingredient source dropdowns in menu-option
  recipes with searchable, keyboard-operable pickers for active stock items and
  reusable recipes. Searching «لاته» narrows recipe choices; the selected
  source ID and unit guidance remain unchanged. POS typecheck and
  `git diff --check` pass.
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
