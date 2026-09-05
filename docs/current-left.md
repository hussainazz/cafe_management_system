# Current Backend Stage Status

This file is the active completion checklist and current stage status for the backend phase. Check it for every related request.

## In Progress Stages

- Stage 5 (shared POS foundation) is next. Staff and Manager will use one POS
  application and one table dashboard; Manager-only capabilities are role-gated
  panels/actions rather than a separate application.
- Stage 5 preparation completed: the forward migration seeds the requested
  16-table layout in display order and the POS table-read contract exposes
  waiter-call eligibility plus availability/occupancy/reminder state.
- Database readiness gate completed on 2 September 2026: all six migrations
  pass fresh/repeat deploy, existing-data upgrade, invalid-data atomic rollback,
  exact physical-table seed, and clean `pg_dump`/`pg_restore` rehearsals. The
  real-PostgreSQL API suite passes 12 files and 52 tests, including direct
  constraint rejection, simultaneous settlement conflicts, table QR
  provisioning, and table-context/waiter-call coverage.
- Stage 5 persistence preparation completed: hashed-only table QR credential
  storage, one-active-credential and one-pending-call partial uniqueness,
  waiter-call lifecycle/version constraints, complete order/payment/catalog/auth
  checks, restrictive history foreign keys, and café-settings singleton
  enforcement are represented in the reviewed schema and forward migration.
- Stage 5 table-context backend increment completed: explicit provisioning and
  rotation generate private SVG/HTML/JSON artifacts for only tables `1`–`10`
  and `جگوار`; `/t/:token` exchanges a hash-only credential for a signed
  12-hour HttpOnly context and redirects to the one `/menu`; scans record one
  non-blocking reminder without occupying a table; waiter-calls are limited to
  eligible occupied tables and deduplicated; table clearing and rotation
  invalidate old contexts; table opening resolves the pending call. OpenAPI,
  service/API, provisioning, cookie, rate-limit, invalidation, and public-menu
  proxy/UI tests pass. The 390×844 built-menu flow was live-checked against an
  isolated `_test` database with no browser-console errors.
- Left for the Stage 5 interface: implement the shared basic order, table,
  payment, deletion, receipt, reconnect/conflict, and waiter-call workflows in
  a new sibling `apps/pos` package; keep the existing menu in `apps/web`.
- Left for Stage 6 after the shared POS foundation: Manager-only payment
  history, catalog/users/settings/audit APIs, and one daily accounting report
  limited to the current or previous `Asia/Tehran` day. The full historical
  order/payment/audit data must remain retained regardless of this report limit.
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
