# Current Backend Stage Status

## 11 September 2026 timing-rule update

- Seating and preparation timing is display-only. Orders no longer persist
  preparation or seating-limit snapshots or a calculated release timestamp.
  The POS receives the optional café seating setting and raw active-item
  preparation deadlines, then calculates the remaining table timer locally
  only when the Manager has enabled a seating limit.
- Historical order totals, item prices, option snapshots, payments, and audit
  records remain immutable; the removed timing columns are intentionally not
  part of the archived order model.

This file is the active completion checklist and current stage status for the backend phase. Check it for every related request.

## In Progress Stages

- Stages 5 and 6 (public-menu deployment preparation and public-menu VPS
  deployment/pilot) were deliberately brought forward after the completed
  QR-menu stages for the release deadline. Its limited browse-only pilot
  evidence remains in progress; Stage 7 implementation is complete and Stage
  8 (Manager capability backend) is now the active development stage. Staff and
  Manager will use one POS
  application and one table dashboard; Manager-only capabilities are role-gated
  panels/actions rather than a separate application.
- Stage 7 preparation completed: the forward migration seeds the requested
  16-table layout in display order and the POS table-read contract exposes
  waiter-call eligibility plus availability/occupancy/reminder state.
- Database readiness gate completed on 2 September 2026: all six migrations
  pass fresh/repeat deploy, existing-data upgrade, invalid-data atomic rollback,
  exact physical-table seed, and clean `pg_dump`/`pg_restore` rehearsals. The
  real-PostgreSQL API suite passes 12 files and 52 tests, including direct
  constraint rejection, simultaneous settlement conflicts, table QR
  provisioning, and table-context/waiter-call coverage.
- Stage 7 persistence preparation completed: hashed-only table QR credential
  storage, one-active-credential and one-pending-call partial uniqueness,
  waiter-call lifecycle/version constraints, complete order/payment/catalog/auth
  checks, restrictive history foreign keys, and café-settings singleton
  enforcement are represented in the reviewed schema and forward migration.
- Stage 7 table-context backend increment completed: explicit provisioning and
  rotation generate private SVG/HTML/JSON artifacts for only tables `1`–`10`
  and `جگوار`; `/t/:token` exchanges a hash-only credential for a signed
  12-hour HttpOnly context and redirects to the one `/menu`; scans record one
  non-blocking reminder without occupying a table; QR-authenticated waiter
  calls are deduplicated, acknowledgement marks the table occupied, and full
  payment clears the table; table clearing and rotation invalidate old contexts.
  OpenAPI,
  service/API, provisioning, cookie, invalidation, and public-menu
  proxy/UI tests pass. The 390×844 built-menu flow was live-checked against an
  isolated `_test` database with no browser-console errors.
- Left for the Stage 7 interface: implement the shared basic order, table,
  payment, deletion, receipt, reconnect/conflict, and waiter-call workflows in
  a new sibling `apps/pos` package; keep the existing menu in `apps/web`.
- Stage 7 POS workspace foundation is now present at `apps/pos`: an isolated
  Next.js application on port 3002 with RTL metadata, same-origin API rewrite,
  shared frontend-library dependencies, and no premature operational or
  Manager-only UI. The ordered UI passes remain left.
- Stage 7 authentication handoff is now present: the POS uses the existing
  API login/session contract, and local-only Manager/Staff provisioning commands
  create deterministic development accounts without bypassing cookie-based
  authorization. The table and order interface remains the next UI pass.
- The earlier Stage 7 pass 2 established typed catalog/table/order integration
  and retry-safe `OPEN`-order creation. Its superseded composition screen was
  retired during the approved frontend reset; the typed API client remains,
  while reconnecting the replacement draft to order submission/editing is now
  explicitly left for a separately approved pass.
- Stage 7 POS frontend redesign direction is documented in
  `docs/planning/pos-frontend-design.md`. The first replacement UI-only pass now provides the shared
  authenticated `سفارش` page, left-side one-item menu, salon/takeaway entry,
  16-table dashboard, accessible occupancy control, active-order timing and
  subtotal display, and the responsive category/product/current-order
  composer with required server-catalog option selection. Authenticated live
  endpoints, authored-source lint, POS tests/typecheck, and production build
  pass; attached-browser desktop/mobile interaction proof remains left.
- Left after this first replacement pass: review and validate the UI in an
  attached browser, then implement separately approved Stage 7 passes for
  draft submission and controlled active-order editing, payments/settlements,
  receipts/printing, table transfer, discounts, waiter-call handling,
  reconnect/conflict recovery, and logical deletion/clear. Manager-only
  panels remain later-stage work.
- 6 September 2026 redesign pass: the shared light-mode POS now uses a
  table-first operational layout, QR-authenticated waiter-call acknowledgement
  that establishes occupancy, order creation/append, an all-unsettled
  settlement action, logical deletion, and print styling. Typecheck, focused
  POS tests, and a production build pass. Still left: browser/device evidence,
  selected-item and mixed-tender settlement UI, API-backed receipt/bar-ticket
  presentation, transfer, reasoned discounts, and explicit stale/reconnect
  recovery UX.
- 7 September 2026 POS polish pass: the active order-inspection and
  all-unsettled payment flows now use a mobile-safe dismissible sheet, explicit
  dialog semantics, visible payment-method selection, focused close control,
  Escape dismissal, and non-color-only status/copy. POS tests, typecheck,
  production build, and `git diff --check` pass. Attached-browser desktop and
  mobile interaction evidence remains left; this refinement does not complete
  the separately scoped settlement, receipt, transfer, discount, or recovery
  passes.
- 7 September 2026 POS responsive pass: the normal-mobile layout honors
  viewport safe areas and dynamic viewport height, touch controls expand for
  coarse pointers, hover-only styling is withheld from touch devices, and the
  tablet inspection view keeps two readable table columns. POS tests,
  typecheck, production build, and `git diff --check` pass. Real-device and
  attached-browser responsive evidence remains left.
- 7 September 2026 POS typography pass: the shared operational type scale now
  distinguishes titles, body labels, metadata, and microcopy consistently,
  uses Persian-appropriate line-height, and aligns English-digit money and
  quantities with tabular figures. The order-context remaining balance no
  longer collapses to microcopy size. The type detector, POS tests, typecheck,
  production build, and `git diff --check` pass; rendered browser/device proof
  remains left.
- Stage 7 remaining implementation checklist (recorded 8 September 2026):
  - 8 September 2026 operational-rule update: a final settlement closes the
    order; for table orders it atomically frees the table and invalidates the
    prior table context. The implementation and integration proof are in
    progress.
  - Logical deletion and table clearing are complete as a controlled POS
    workflow: clear confirmation, retained-history notice, table-context
    cleanup when the deleted order is the table's final active order, and
    focused clear retry are implemented. Focused POS tests,
    typecheck, production build, and `git diff --check` pass; attached-browser
    validation remains left.
  - Table transfer is complete: Staff and Manager can drag or use the accessible `انتقال میز` action to move an open table order to an empty table or atomically swap it with another table order; server transactions preserve one active order per table, table occupancy/context cleanup, timing snapshots, audit history, and stale-version protection. Browser/device validation remains item 8.
  - Payments are complete: the shared POS supports selected unallocated item
    quantities, one-to-ten reconciled cash/card-terminal/card-transfer tenders,
    optional transfer references, server-authoritative settlement retries, and
    updated partial/paid balances. Focused POS tests, typecheck, production
    build, and `git diff --check` pass; attached-browser/device validation
    remains item 8.
  3. Current draft flow is complete: table/takeaway drafts submit with a
     retained create idempotency key; `UNPAID` `OPEN` orders support item,
     quantity, and note replacement; partially paid/paid orders allow only
     additions or quantity increases. Leaving unsaved work prompts to submit,
     discard, or continue editing. POS tests, typecheck, production build, and
     `git diff --check` pass; attached-browser/device validation remains item 8.
  - Order-create trace diagnostics are complete: the POS creates one request ID
    per submit and records its selected table UUID/name in the browser console;
    the API logs received, persisted/replayed, and rejected safe trace fields,
    and the existing `CREATE_ORDER` audit snapshot preserves the client name
    beside the server-resolved table name. API/POS typechecks and API
    integration tests pass; attached-browser incident reproduction remains
    item 8.
  - Table-order request validation now preserves the selected deterministic
    table UUID through Fastify validation and reparses it before service use;
    an absent table ID is rejected before it can become an unconstrained Prisma
    query. The deterministic UUID regression test and API/POS typechecks pass.
    A final authenticated browser retry remains item 8 because the dev API
    watcher restart expired the local browser session.
  - Print implementation is complete in code: dedicated authenticated 80 mm
    browser-print documents now render the minimal bar ticket, whole-order
    customer receipt, and itemized settlement receipt from immutable API
    snapshots. Customer receipts now print one total only and put their
    Persian-calendar Tehran timestamp in the footer. The table-board active
    order panel exposes both bar-ticket and receipt actions. Contract/API
    tests, POS tests, and typechecks pass. Actual
    browser print and physical 80 mm printer/paper-advance validation remain
    required before marking item 4 complete.
  4. Add API-backed bar-ticket and receipt views/printing for whole orders and
     individual settlements.
  5. Waiter-call handling is complete in code: pending cards show a
     privacy-safe elapsed request time and an explicit, single-flight
     acknowledgement action that opens the table after reconciliation. Visible
     POS tabs refresh tables, open orders, and calls every 15 seconds and on
     return to the tab without clearing last-known calls on a partial refresh
     failure. Focused POS tests, typecheck, production build, and `git diff
     --check` pass; attached browser/device validation remains required before
     this item is marked fully verified.
  - Customer-authenticated waiter calls are implemented in code: table QR
    visitors verify full name, phone, and development/test OTP before a
    credential-bound four-hour visit may call a waiter; generic `/menu` remains
    anonymous. The forward migration, focused isolated API integration test,
    API/web/POS typechecks, POS tests, and `git diff --check` pass; authenticated
    browser/device proof remains before this replacement authorization model is
    considered fully verified.
  - Recovery UX is complete in code: every POS API failure now classifies into
    an explicit stale-version conflict, network/offline, or service-failure
    recovery state. The status indicator follows browser online/offline events;
    cached workspace data stays visible, and recovery refetches the operational
    board plus the inspected order before clearing the warning. Focused POS
    tests, typecheck, and `git diff --check` pass; attached-browser/device
    validation remains item 7.
  Implementation dependency note: before completing selected-item settlement,
  ensure draft submission and controlled `OPEN`-order editing are available,
  because settlement operates on an authoritative active order. The checklist
  order above remains the requested tracking order.
- Moved to Stage 8: implement the shared POS interface for reasoned item- and
  order-level discounts, preserving the existing server authority,
  settlement-immutability rules, required reason, and Staff/Manager access.
- Stage 8 ordered implementation checklist:
  1. Complete: the shared POS now exposes reasoned fixed/percentage item- and
     order-level discounts with required non-empty reason, server-calculated
     snapshots, Staff/Manager access, keyboard recovery, and settlement
     immutability.
  2. Complete: documented Manager-only catalog, option, image, price,
     availability, display-order, preparation-deadline, table seating-limit,
     Staff-account, and café-settings APIs are present with audit coverage and
     self-hosted image delivery.
  3. Complete: Manager-only cursor-paginated payment history retains all
     settlements/tenders, surfaces reversal state and settlement-receipt paths,
     and preserves Staff access to individual order and settlement receipts.
  4. Complete: Manager-only daily accounting accepts only `today` or
     `yesterday` in `Asia/Tehran`, reports resolved UTC bounds, sales/paid
     totals, payment-method totals, discounts, reversals, and retained deleted
     orders.
  5. Complete: Manager-only safe audit history has cursor/filter queries, and
     measured payment-history, daily-report, and audit indexes retain all
     historical financial and audit rows.
  6. Complete: Manager-only full-settlement reversal requires a non-empty
     reason, preserves posted tenders and allocations, recalculates order
     balances/status atomically, restores a fully settled table order to
     occupied work, and records audit history.
  7. Complete: today/yesterday report fixtures, Manager/Staff permission
     boundaries, API/OpenAPI contracts, and query-plan coverage pass. API
     typecheck and the isolated migration/fresh-deploy/restore rehearsal pass,
     and all 14 deterministic integration files pass (63 tests). The
     shared-database suite runs each integration file in a separate sequential
     Vitest process to prevent cross-file fixture interference.
- Stage 9 ordered implementation checklist:
  1. Complete in code: the shared POS drawer exposes a client-side `مدیریت`
     workspace only to the authenticated Manager role; Staff retains the
     unchanged `سفارش` workspace and does not initiate Manager reads.
  2. Complete in code: Manager panels provide typed category, product, option
     group/option, product-image, price, preparation-deadline, availability,
     display-order, and physical-table management, with explicit archive
     confirmations that retain history.
  3. Complete in code: Manager can create and edit Staff accounts, deactivate
     them with an explicit session-revocation confirmation, and reactivate
     them; role changes remain unavailable.
  4. Complete in code: settings, cursor-based payment history, today/yesterday
     Tehran accounting, confirmed reasoned settlement reversal, and safe audit
     history panels use the existing Manager-authorized API contracts.
  5. Complete in code: Manager actions have loading, empty/degraded-data,
     validation, confirmation, retry, and single-flight states. Shared
     contract/API/POS typechecks, focused API Manager integration tests, POS
    tests, production build, and `git diff --check` pass. Authenticated
    desktop/mobile browser validation remains required before the stage exit
    gate is treated as fully verified.
  - 10 September 2026 release-correctness hardening: table-settlement reversal
    now locks/checks the physical table and a partial unique index prevents more
    than one open table order; swaps preserve that invariant transactionally.
    Daily reports are event-dated (including cross-day reversal coverage) and
    aggregate order/item/settlement/tender totals in PostgreSQL rather than
    materializing their history in Node.js.
    Product-image and Manager mutations/audits are atomic, shared Manager
    input contracts govern category/product/table writes, and the isolated
    runner includes OpenAPI and password tests. All Manager JSON CRUD routes
    now have explicit request/response, path, auth-header, and error-envelope
    OpenAPI schemas. Product-image endpoints retain their specialized multipart
    transport and are covered by their isolated regression file.
    Focused Manager/order regressions, API/POS typechecks, and
    `git diff --check` pass. New Manager workspace DOM tests cover retained
    partial-load failures, stable audit filtering while input changes, and
    required-reason validation with an explicit cancel path for settlement
    reversal.
    Authenticated desktop/mobile browser validation remains required before
    Stage 9 can be called fully verified.
  - 11 September 2026 canonical-catalog redesign is in progress: active option
    groups become unique shared catalogs with product-specific allowed-option
    subsets, selection ranges, and optional price overrides. Legacy duplicate
    groups and `طعم` remain archived for immutable order history only. Seating
    duration moves from physical tables to the café-settings singleton while
    each existing/new table order retains its own timing snapshot.

## Future Validation Work

- Stage 7 POS browser/device validation remains intentionally deferred: validate
  desktop/mobile interaction, keyboard operation, touch targets, and actual
  café receipt-printer/paper-size behavior after the Manager backend work is
  ready for an end-to-end pass.
- Target GHCR release machinery is now scaffolded: API and menu images have
  independent version tracks, production Compose uses exact image references,
  and the release runbook records pull, migration, digest, and rollback rules.
  POS image/version publication remains left until POS is a separate deployable
  frontend.
- Live VPS audit is complete for the 2026-09-01 snapshot. Production hardening
  remains: GitHub/GHCR ownership and first-image publication, deliberate VPS
  Compose migration, public Nginx routing and HTTPS renewal, backup retention
  and clean restore, logs/alerts, and the operator/manual-fallback runbook. The
  observed runtime is systemd + Nginx with local-build artifact releases;
  Docker Compose/Caddy remains a target baseline, not the active path.
- The brought-forward public-menu deployment is live and has local-build
  artifact, migration, rollback, secret, API/web health, public HTTPS, and
  rendered-photo verification. It is not evidence that the later shared POS or
  financial/pilot production gates are complete.
- VPS artifact-release lesson recorded on 3 September 2026: local Prisma
  generation must bundle the VPS `debian-openssl-3.0.x` engine as well as the
  local native engine, and API releases must carry the matching compiled
  contracts package. The exact pre-restart artifact checks are now mandatory in
  `docs/planning/production-gates.md`; the release was recovered after both
  were deployed from local builds.

## Completed Stages

### Stage 4 - QR-Menu Frontend

Done:

- The roadmap order was revised for the deadline, and a Next.js App Router frontend shell now consumes the typed anonymous menu API with server-rendered initial data.
- The Persian RTL, mobile-first menu includes category navigation, live search, product cards, product details with priced item options, current availability indicators, final Toman prices, and explicit browse-only messaging with no checkout, order, payment, or tracking capability.
- Loading, empty, error, missing-image, responsive, and reduced-motion states are implemented.
- Frontend typecheck, 3 focused tests, and production build pass; representative browser rendering was verified at 390×844 and 1440×1000 against the local API and imported Run Cafe catalog.
- The public-menu frontend uses the current API through a frontend adapter; its dark-and-amber direction and backend contract remain unchanged.
- Customer-facing preparation time and the availability-only toggle were removed; preparation deadlines remain available to the POS workflow, while item availability can still be communicated on individual menu entries.
- Product popups show the supplied final prices for product-specific coffee blends, coffee amounts, cup quantities, syrups, and flavors. The synchronizer applies 55 explicit price/availability configurations and 34 option-bearing product configurations, including unavailable Mini Tiramisu.
- The visual direction was refreshed around Run Cafe's warm, dark, intimate specialty-coffee identity with restrained amber lighting, wood tones, and low-distraction browsing.
- The revised customer menu passes frontend typecheck, all 3 focused web tests, production build, and a representative 390×844 browser rendering against the synchronized development catalog.
- The mobile menu was hardened against the six highest-priority Iranian phone viewports (360×800, 384×832, 385×854, 390×844, 393×873, and 412×915): hero density, safe-area spacing, consistent branding, category-scroll affordance, 44px touch targets, and persistent compact option sheets were verified with Playwright without horizontal overflow or browser errors.
- Development access from phones on the `192.168.1.x` LAN is explicitly allowed by Next.js; Playwright verified hydration through the LAN URL, working category navigation, and working product dialogs without blocked client chunks.
- The public menu hero now uses the concise Run Cafe title and requested food description without welcome/stat lines; the redundant all-category chip was removed, category chips navigate the continuously scrollable full menu, and scroll-spy keeps the active category synchronized while browsing.
- Public-menu category visuals now use four consistent semantic icon groups: sparkle for special/new, one shared drink icon (including Matcha Bar), one dessert icon, and one food icon.
- The mobile category strip now uses momentum horizontal scrolling without a native scrollbar; active-chip centering no longer affects vertical page position, and the edge cue hides correctly when the final RTL category is reached.
- Product dialogs now present only item, price, availability, and option details; the redundant browse-only barista note was removed.
- The supplied Run Cafe photography is integrated through 20 product placements with deliberate reuse for hot/iced Americano, latte, caramel macchiato, tea, and duplicate Red Moon entries; optimized self-hosted copies keep mobile payloads bounded, the supplied 2017 logo brands the footer, and popup photography uses centered contain framing with solid-black letterboxing.
- The redundant top navigation and language toggle were removed; the compact hero now pairs the English “Run Cafe” title on the left with animated artwork on the right and no subtitle. Desktop artwork remains unchanged, while phones use a consistently aligned 128px orbit with proportionally scaled internal icons; all six target phone viewports were verified without overflow or interaction errors.
- Local menu photography now resolves through explicit product-to-asset mappings in `public/items_pictures`: supplied Ice Bar images are limited to their matching iced drinks, the tea image is reserved for black tea, and unmatched products retain their existing artwork. Focused web tests, typecheck, and the production build pass.
- The newly supplied item photography is now copied into `apps/web/public/items_pictures` and mapped to the previously unpictured iced espresso/mocha/chocolate drinks, cortado, hot drinks, shakes, smoothie, toast/chips items, and updated ham toast asset.
- The newly supplied mango cheesecake photography is mapped to `چیزکیک انبه`.
- The chocolate shake photo is now restricted to `شیک`; the same-named `تست بار` toast has no local photo.
- Public-menu commit `4232552` is live after packaging a production-only Next.js archive without `.next/dev` or `.next/cache`; checksum, staged contents, rollback backup, build/release identity, internal/public menu responses, rendered image URLs, service state, logs, and restart count were verified. The production-gates document now makes this archive workflow mandatory for future menu releases.
- Black tea (`چای هل و زغفران`) now uses its dedicated photo; the hot caramel macchiato uses the hot latte photo; and only chocolate croissants use the croissant photo. Menu prices use the requested compact thousands form without separators (for example, `۱۶۵`), option text is larger in product dialogs, and the synchronized juice catalog now calls watermelon `هندوانه`.

Left:

- None.

### Stage 3 - QR-Menu Backend

Done:

- Public, schema-validated browse-only category, product-detail, search, and category-filter endpoints expose active customer-facing catalog data, final Toman prices, images, priced options, and availability without preparation deadlines, sessions, or public write capabilities.
- Public menu safety, visibility, search/filter, final-price, and anonymous-access integration tests (`public-menu.test.ts`, 2 tests).
- An idempotent Run Cafe catalog synchronizer covering the exact requested category/product names and ordering as supplied on 23 August 2026; it preserves existing prices, uses Toman integer defaults for new products, and archives catalog entries outside the authoritative list.
- The synchronizer applies authoritative per-product base prices, availability, option membership, option order, and option price differences while retaining historical order snapshots and archived option records.

- The Run Cafe catalog was synchronized into the configured development database after the existing migrations were applied. The synchronizer remains available as `pnpm db:seed:run-cafe-menu` and safely updates display order/visibility while retaining archived and historically referenced records.

### Stage 2 - POS Backend

Done:

- Staff and Manager username authentication, signed access sessions, rotating hashed refresh sessions, logout/logout-all revocation, account-deactivation revocation, and safe authentication-event recording.
- Shared Staff/Manager route guards and service-level Manager checks, with tested `401 AUTHENTICATION_REQUIRED` and `403 FORBIDDEN` responses.
- Staff/Manager-protected POS catalog and active-table reads, including current catalog availability, option/image metadata, table seating limits, and active-order release timing.
- Staff table/takeaway order creation with server-calculated Toman totals and timing, immutable product/option snapshots, active-table validation, atomic audit/idempotency records, and retry-safe results.
- Order list/detail reads and controlled `OPEN`-order edits, including optimistic version checks, table transfers, catalog-backed additions, restricted post-settlement edits, and audit records.
- Product sale-discount configuration is Manager-only; Staff and Manager may apply reasoned item/order discounts while settlement immutability permits them. All discounts are server-calculated and snapshotted for historical orders.
- Staff/Manager logical order deletion with optimistic version checks, optional reason, retained financial/history rows, actor/timestamp, and audit record.
- Per-payer selected-item settlement recording with mixed manual tenders, reconciliation, idempotency, version checks, payment-status updates, and audit records.
- Manager-only full settlement reversal with a required reason, immutable posted rows, recalculated payment status, version increment, and audit record.
- Print-ready bar-ticket, whole-order receipt, and payer-settlement receipt API data using immutable order snapshots and `Asia/Tehran` display time.
- Real-PostgreSQL POS backend integration coverage for permissions, idempotent retries, stale and invalid transitions, partial/paid order additions, settled-item immutability, unavailable products, historical snapshots, selected allocations, mixed tenders, optional card-transfer references, reversal, reconciliation, and transaction rollback.

Verified:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes: 9 files and 39 tests.
- The Stage 2 exit gate is covered through authenticated API calls against real PostgreSQL without a frontend dependency.

### Stage 0 - Scope And Domain Baseline

Done:

- `docs/planning/scope.md` and `docs/planning/roadmap.md` define the v1 scope, explicit non-goals, roles, order states, money/time/deployment rules, domain modules, architecture direction, production gates, and database-first/POS-first roadmap.
- ADR files document the fixed major decisions, including ADR 0009 for the shared POS, waiter-call, Manager-only capability boundary, and today/yesterday initial reporting scope.
- The initial ERD, API inventory, database constraints, request/response conventions, error envelope, pagination, idempotency, and concurrency are documented.
- `docs/planning/backend-backlog.md` converts the approved scope into a prioritized backend backlog with acceptance criteria.

### Stage 1 - Database And Backend Foundation

Done:

- Database schema, reviewed Prisma migrations, and a Docker Compose PostgreSQL baseline.
- First-Manager bootstrap flow and isolated test-database workflow.
- Environment validation, structured error envelopes, request IDs, logging, health/readiness routes, graceful shutdown, and generated OpenAPI contract.
- Fresh-environment rehearsal on 13 August 2026: migrations applied to a new database; bootstrap created one Manager and rejected a repeat; liveness/readiness returned healthy responses.

Verified:

- `pnpm typecheck` passes.
- `pnpm --filter @cafe/api test` passes: 6 files and 18 tests.
