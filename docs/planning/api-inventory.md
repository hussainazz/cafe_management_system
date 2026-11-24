# API Inventory

## Finance analytics response units

Reporting option `quantity` is a per-product-unit selection ratio for
fixed-price products and can be fractional. This applies to sales analytics and
pricing experiment impact rows. It is not an order-entry
count; order request quantities remain positive integers. Reporting variant
identity is independent of order-line size.

Legacy orders may contain separate `PACKING` lines. They remain in historical
order totals and unfiltered sales for reconciliation, but the system packaging
product is archived and cannot be added to new orders. Product-level analytics
exclude those legacy fee lines. The API no longer attributes packaging revenue
or reports a packaging recovery calculation.

Pricing experiment history uses product-scoped effective price events.
Simulations apply the recorded line's pricing mode, grams, and option counts;
targets can identify products or options. Observed experiment break-even uses
earlier and later unit contribution, including cost changes, with overlapping
targets counted once. Hypothetical scenario break-even requires complete costs
for the affected cohort. Café-wide contribution and surplus remain unavailable
if any relevant source costs are incomplete. Historical packaging target rows
remain readable, but new packaging targets and simulations are rejected.

These clarifications supersede the earlier packaging-fee reporting and target
rules in the approved Stage 17–19 contracts. They do not add order writes,
catalog-price writes, or deployment authority.

In route access labels below, Staff access includes Manager and Developer for
shared POS workflows; Manager access also includes Developer, except where a
route is explicitly marked Developer-only.

## SEP bridge health-only API (Phase B, ADR 0012)

The separate Windows bridge binds only to `127.0.0.1:18711` by default.
`GET /health` returns versioned health-only capability metadata, never device
readiness or payment status. It permits CLI reads without Origin; browser reads
require exact configured Origin. `OPTIONS /health` permits GET and only the
`x-run-cafe-diagnostic` request header. No credentials are shared. Host validation,
bounded input/deadlines, and exact-origin CORS apply; no purchase/diagnostic
terminal route exists. This is not a VPS `/api/v1` endpoint.

The POS `/pos/diagnostics/payment-bridge` page ships unavailable unless the
server's `SEP_BRIDGE_DIAGNOSTICS_ENABLED` flag is exactly `true`. It uses the
existing session read and performs bridge requests only after an explicit
click. `SEP_BRIDGE_PORT` configures its loopback port. See
[`apps/sep-bridge/README.md`](../../apps/sep-bridge/README.md) for commands and
actual Firefox acceptance requirements.

## SEP payment-attempt API (Phases D/E, disabled by default)

Implemented routes and exact signing field order are recorded in
[the terminal backend contract](sep-terminal-backend.md#implemented-http-and-signing-contract).
They reuse current Staff/Manager authentication and settlement contracts. The
separate financial loopback host adds POST /payments and POST /status with signed
intent authentication; GET /health never contacts the terminal. The Phase B host
above remains a separate health-only executable.

## Purpose And Status

This is the approved v1 API surface inventory. It maps the scope to stable
resource and command boundaries before endpoint implementation begins. It is a
planning contract, not the generated OpenAPI document: an endpoint becomes
implemented only when its validated request and response schemas are added to
the API and OpenAPI is generated from them.

All application endpoints use the `/api/v1` prefix. The operational health
endpoints are the only current implementation; every other entry is planned
for the delivery stage shown below. Shared request/response envelopes,
pagination, idempotency-header format, and conflict/error details are defined
in `request-response-conventions.md`.

Legend:

- **Public**: anonymous QR-menu browsing plus the narrowly scoped table-context exchange and waiter-call commands documented below.
- **Staff**: authenticated Staff, Manager, or Developer for shared POS
  workflows.
- **Manager**: authenticated Manager or Developer, except routes explicitly
  marked Developer-only.
- **Internal**: infrastructure or authenticated application-session support;
  never a public-menu capability.

## Operational And Contract Endpoints

| Method | Path                   | Access   | Stage | Purpose                                                                                       |
| ------ | ---------------------- | -------- | ----- | --------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/health/live`  | Internal | 1     | Process liveness check; does not require database access.                                     |
| `GET`  | `/api/v1/health/ready` | Internal | 1     | Dependency readiness check, including PostgreSQL connectivity.                                |
| `GET`  | `/documentation`       | Internal | 1     | Swagger UI for the generated OpenAPI contract; deployment access is restricted operationally. |
| `GET`  | `/documentation/json`  | Internal | 1     | Generated OpenAPI document for tooling and contract tests.                                    |

## Identity And Sessions

| Method | Path                      | Access   | Stage | Purpose                                                                               |
| ------ | ------------------------- | -------- | ----- | ------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/auth/login`      | Public   | 2     | Authenticate an active Staff, Manager, or Developer username/password pair and establish an application session. |
| `POST` | `/api/v1/auth/refresh`    | Internal | 2     | Rotate a valid refresh session and issue the next access session.                     |
| `POST` | `/api/v1/auth/logout`     | Staff    | 2     | Revoke the current refresh session.                                                   |
| `GET`  | `/api/v1/auth/me`         | Staff    | 2     | Return the current authenticated user and role.                                       |
| `POST` | `/api/v1/auth/logout-all` | Staff    | 2     | Revoke all active sessions for the current user.                                      |

The first Manager is created by a one-time Stage 1 operations command (for
example, a deployment-only `pnpm` script) that refuses to run once a Manager
exists. It is not an HTTP endpoint, is not included in OpenAPI, and cannot be
called by a browser or application client.

## POS Catalog And Tables

These Staff reads provide the current sellable catalog and shared table-dashboard
data needed for POS entry. Manager users consume the same operational contracts;
they do not receive a second table-dashboard API.

| Method | Path                             | Access | Stage | Purpose                                                                                                                                                                               |
| ------ | -------------------------------- | ------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/pos/catalog`            | Staff  | 2     | Read unarchived source categories, sellable products, allowed options, availability, product preparation-deadline minutes, final Toman prices, and each product's single image metadata for POS. |
| `GET`  | `/api/v1/tables`                 | Staff  | 2     | List active physical tables with current active-order summary, seating-limit minutes, estimated preparation minutes, and estimated table release time.                                |
| `GET`  | `/api/v1/tables/:tableId`        | Staff  | 2     | Read one table, its seating-limit minutes, active order timing summary, and active order(s).                                                                                          |
| `GET`  | `/api/v1/tables/:tableId/orders` | Staff  | 2     | Read the active and historical orders for one table, subject to documented filters.                                                                                                   |

## Orders, Payments, And Receipts

Order write routes are named commands where a business operation changes
multiple records. The server remains authoritative for prices, discounts,
totals, balance, state transitions, and snapshots.

`record-settlement` accepts selected order-item quantities plus one or more
tenders. The server calculates allocation and settlement amounts, rather than
accepting a client total. A settlement may contain `CASH`, `CARD_TERMINAL`, and
`CARD_TRANSFER` tenders. Card-terminal tenders store no reconciliation
reference for the manual path. ADR 0012 approves a separate durable attempt
and authenticated terminal evidence for optional SEP integration; new financial
routes are not implemented yet. Card-to-card transfer references are optional. The operation
requires an idempotency key and the current order version.

| Method  | Path                                                        | Access | Stage | Purpose                                                                                                                                                                                                                                                                                               |
| ------- | ----------------------------------------------------------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/api/v1/orders`                                            | Staff  | 2     | Create a table or takeaway `OPEN` order with payment status `UNPAID` from catalog selections; requires an idempotency key.                                                                                                                                                                            |
| `GET`   | `/api/v1/orders`                                            | Staff  | 2     | Search/list orders for POS history and recovery, with documented lifecycle state, payment-status, channel, table, and time filters.                                                                                                                                                                   |
| `GET`   | `/api/v1/orders/:orderId`                                   | Staff  | 2     | Read an order with item/option/timing snapshots, payment status, settlement allocations/tenders, totals, estimated preparation minutes, estimated table release time where applicable, and permitted operational metadata.                                                                            |
| `PATCH` | `/api/v1/orders/:orderId`                                   | Staff  | 2     | Apply a controlled edit, including an item/order discount with an optional reason, to an `OPEN` order; requires the current version. After settlement, edits may affect only additions/unsettled quantities; settled quantities, posted allocations, tenders, discounts affecting them, and receipts are immutable. |
| `POST`  | `/api/v1/orders/:orderId/transfer-table`                    | Staff  | 2     | Move an `OPEN` table order to another active table; requires the current order version.                                                                                                                                                                                                               |
| `GET`   | `/api/v1/staff-consumption/personnel-profiles`               | Staff  | 2     | List saved personnel profiles by name for attributing staff-consumption orders.                                                                                                                                                                                                                       |
| `POST`  | `/api/v1/staff-consumption/personnel-profiles`               | Staff  | 2     | Create a name-only personnel profile; duplicate names are rejected and creation is audited to the signed-in user.                                                                                                                                                                                     |
| `GET`   | `/api/v1/staff-consumption`                                  | Staff  | 2     | Cursor-page closed staff-consumption entries, including the selected personnel name and the signed-in creator.                                                                                                                                                                                       |
| `POST`  | `/api/v1/staff-consumption`                                  | Staff  | 2     | Create a takeaway-channel staff-benefit entry from item snapshots and a selected personnel profile; requires an idempotency key and records no cash, card, or transfer tender.                                                                                                                                 |
| `POST`  | `/api/v1/staff-consumption/:orderId/discount`                | Staff  | 2     | Apply a fixed or percentage discount to a closed staff-consumption entry, with server-calculated totals and version checking.                                                                                                                                                                         |
| `PATCH` | `/api/v1/admin/products/:productId/sale-discount`           | Staff   | 2     | Configure or remove a fixed/percentage product sale discount. It applies only to newly-created item snapshots.                                                                                                                                                                                        |
| `POST`  | `/api/v1/orders/:orderId/record-settlement`                 | Staff  | 2     | Atomically settle selected unallocated item quantities with one or more cash, card-terminal, or card-to-card transfer tenders; requires an idempotency key and current order version.                                                                                                                 |
| `POST`  | `/api/v1/orders/:orderId/delete`                            | Staff  | 2     | Logically delete an order while retaining items, settlements, tenders, reversals, and audit history; requires the current order version and accepts an optional reason.                                                                                                                               |
| `GET`   | `/api/v1/orders/:orderId/bar-ticket` | Staff | 2 | Read full preparation data without changing any print baseline; excludes prices and payments. |
| `POST` | `/api/v1/orders/:orderId/bar-ticket/prepare` | Staff | 2 | Capture exact server snapshot and return preparationId plus full first/unchanged ticket or only changed-content additions/increases. Preparation does not advance the acknowledged baseline. |
| `POST` | `/api/v1/orders/:orderId/bar-ticket/acknowledge` | Staff | 2 | Retry-safe body `{ preparationId }` advances the baseline only to this exact prepared snapshot; older acknowledgments cannot replace newer ones. Called after browser afterprint, which may also fire on cancellation. |
| `GET`   | `/api/v1/orders/:orderId/receipt`                           | Staff  | 2     | Return stable, print-ready whole-order customer-receipt data derived from item snapshots and active settlements, including each item's base-price snapshot and financial totals.                                                                                                                                                          |
| `GET`   | `/api/v1/orders/:orderId/settlements/:settlementId/receipt` | Staff  | 2     | Return print-ready customer-receipt data for one payer settlement, including each allocated item's base-price snapshot, Toman totals, and tender summary.                                                                                                                                                                       |

No route exists for physically deleting orders, editing a posted tender or
settlement, or creating a customer order.

## Public QR Menu And Waiter-Call

Public QR-menu reads expose only the current menu, temporary availability,
single product image metadata, and final Toman prices required for browsing.
The public catalog is one shared `/menu`. An eligible-table `/t/:token` entry
exchanges the printed credential for a signed, HttpOnly 12-hour context cookie,
records the available-table scan reminder, and redirects to `/menu`. A
waiter-call can be submitted only from an eligible context with an authenticated
customer table visit. Commands
are rate-limited and duplicate-safe, and grant no order, payment, receipt,
tracking, identity, or catalog authority.

| Method | Path                                  | Access | Stage | Purpose                                                                                                                                                                                |
| ------ | ------------------------------------- | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/public/menu`                 | Public | 3     | Read the complete browse-only menu, including unarchived source and promotional categories with eligible products. Promotional entries reuse current product, customer-facing menu note, options, availability, image, and final price data from each product's canonical source record; preparation deadlines remain private. |
| `GET`  | `/api/v1/public/products/:productId`  | Public | 3     | Read one current, publicly visible product, its customer-facing menu note, and available option groups/options, without exposing the Staff-only preparation deadline.                                                  |
| `GET`  | `/t/:token`                           | Public | 5     | Web entrypoint: exchange an eligible active printed token, set table context, record an available-table reminder, and redirect to the same `/menu`. Invalid links redirect with a safe warning. |
| `POST` | `/api/v1/public/table-context/exchange` | Public QR bearer | 5 | Hash and resolve the raw QR token without logging it, set the signed context cookie, and return only the safe table label; the web `/t/:token` entrypoint is its intended caller. |
| `GET`  | `/api/v1/public/table-context`        | Public cookie | 5 | Return safe table label, occupancy, call eligibility, and pending state for a current context; generic menu visits return inactive context. |
| `POST` | `/api/v1/public/customer-otp/request` | Public table context | 7 | Start development/test OTP verification for submitted full name and phone. |
| `POST` | `/api/v1/public/customer-otp/verify` | Public table context | 7 | Verify one OTP and create the remembered customer session plus credential-bound table visit. |
| `GET`/`DELETE` | `/api/v1/public/customer-auth` | Public cookie | 7 | Read customer-auth visit state or revoke the remembered session. |
| `POST` | `/api/v1/public/waiter-calls`         | Customer table visit | 7 | Create or return the one pending waiter-call for the credential-bound table visit. |

There are no public cart, order, payment, receipt, tracking, session, or
Staff-metadata routes in v1. The waiter-call response contains only safe call
state and table-display context.

## Shared POS Waiter-Calls

Staff, Manager, and Developer use these same contracts from the shared table dashboard.

| Method | Path                                             | Access | Stage | Purpose                                                                                                      |
| ------ | ------------------------------------------------ | ------ | ----- | ------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/waiter-calls`                           | Staff  | 5     | List active waiter-calls in stable request-time order for the shared table dashboard.                       |
| `POST` | `/api/v1/tables/:tableId/occupy`                 | Staff  | 5     | Explicitly mark an eligible or non-eligible physical table occupied and clear its scan reminder.            |
| `POST` | `/api/v1/tables/:tableId/make-available`         | Staff  | 5     | Return a table to available, clear reminders, resolve any pending call, and invalidate prior guest contexts. |
| `POST` | `/api/v1/tables/:tableId/acknowledge-waiter-call`| Staff  | 5     | Open the highlighted table and atomically acknowledge and resolve its pending call; stale actions conflict. |

## Staff Catalog, Manager Staff Accounts, And Settings

Staff, Manager, and Developer catalog writes archive/deactivate referenced records rather
than physically remove them. Staff-account and café-setting operations remain
Manager-and-Developer-only. Each product has at most one current image. Product images are
uploaded through the API and subsequently served through a controlled image
route; the database stores image metadata and storage references, not image
bytes.

| Method  | Path                                                                   | Access  | Stage | Purpose                                                                                                                                           |
| ------- | ---------------------------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/admin/categories`                                             | Staff   | 6     | List categories, including inactive/archived records when requested.                                                                              |
| `POST`  | `/api/v1/admin/categories`                                             | Staff   | 6     | Create a category.                                                                                                                                |
| `PATCH` | `/api/v1/admin/categories/:categoryId`                                 | Staff   | 6     | Update category fields, active state, or display order.                                                                                           |
| `POST`  | `/api/v1/admin/categories/:categoryId/archive`                         | Staff   | 6     | Archive a category while preserving historical references.                                                                                        |
| `PATCH` | `/api/v1/admin/categories/:categoryId/products`                        | Staff   | 10    | Replace product memberships for a promotional category; product source categories and catalog data remain unchanged.                              |
| `GET`   | `/api/v1/admin/products`                                               | Staff   | 6     | List products and their catalog configuration.                                                                                                    |
| `POST`  | `/api/v1/admin/products`                                               | Staff   | 6     | Create a product with its category, price, optional customer-facing menu note, preparation-deadline minutes, and option-group configuration.                                          |
| `PATCH` | `/api/v1/admin/products/:productId`                                    | Staff   | 6     | Update product details, customer-facing menu note, final price, catalog sale discount, preparation-deadline minutes, active state, availability, display order, or allowed option groups.           |
| `POST`  | `/api/v1/admin/products/:productId/archive`                            | Staff   | 6     | Archive a product without changing historical order snapshots.                                                                                    |
| `PUT`   | `/api/v1/admin/products/:productId/image`                              | Staff   | 6     | Validate and upload or replace the product's single image, then store its metadata record.                                                        |
| `PATCH` | `/api/v1/admin/products/:productId/image`                              | Staff   | 6     | Update the product image metadata, such as alt text.                                                                                              |
| `POST`  | `/api/v1/admin/products/:productId/image/archive`                      | Staff   | 6     | Remove the product image from current display without deleting needed history.                                                                    |
| `GET`   | `/api/v1/product-images/:storageKey`                                   | Public  | 8     | Serve one opaque, validated self-hosted product image with cache headers; storage paths are never exposed.                                         |
| `GET`   | `/api/v1/admin/option-groups`                                          | Staff   | 6     | List reusable option groups and their options.                                                                                                    |
| `POST`  | `/api/v1/admin/option-groups`                                          | Staff   | 6     | Create an option group.                                                                                                                           |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId`                           | Staff   | 6     | Update an option group or its active state.                                                                                                       |
| `POST`  | `/api/v1/admin/option-groups/:optionGroupId/options`                   | Staff   | 6     | Create an option in an option group.                                                                                                              |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId`         | Staff   | 6     | Update option name, final extra price, availability, active state, or display order.                                                              |
| `POST`  | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId/archive` | Staff   | 6     | Archive an option while preserving order-item snapshots.                                                                                          |
| `GET`   | `/api/v1/admin/tables`                                                 | Manager | 6     | List all physical tables and their lifecycle state.                                                                                               |
| `POST`  | `/api/v1/admin/tables`                                                 | Manager | 6     | Create a physical table.                                                                                                                          |
| `PATCH` | `/api/v1/admin/tables/:tableId`                                        | Manager | 6     | Update table name, seating-limit minutes, active state, or display order.                                                                         |
| `POST`  | `/api/v1/admin/tables/:tableId/archive`                                | Manager | 6     | Archive a table while preserving its order history.                                                                                               |
| `GET`   | `/api/v1/admin/users`                                                  | Manager | 8     | List Staff accounts only, excluding credential and session secrets.                                                                               |
| `POST`  | `/api/v1/admin/users`                                                  | Manager | 8     | Create a Staff account.                                                                                                                           |
| `PATCH` | `/api/v1/admin/users/:userId`                                          | Manager | 8     | Update allowed Staff-account fields; role changes are unavailable.                                                                                |
| `POST`  | `/api/v1/admin/users/:userId/deactivate`                               | Manager | 6     | Deactivate an account and revoke its sessions while retaining history.                                                                            |
| `POST`  | `/api/v1/admin/users/:userId/reactivate`                               | Manager | 6     | Reactivate an account without altering history.                                                                                                   |
| `GET`   | `/api/v1/admin/settings`                                               | Manager | 6     | Read the single-cafe settings record.                                                                                                             |
| `PATCH` | `/api/v1/admin/settings`                                               | Manager | 6     | Update café settings, including the default table seating limit and whether settlement reversals require a reason; audited. |

## Manager Reporting And Audit; Staff Settlement Actions

The first accounting report uses UTC storage but accepts only `today` or
`yesterday`, resolved using `Asia/Tehran` calendar boundaries. This two-day
query limit does not delete or expire older orders or payment records.

| Method | Path                                              | Access  | Stage | Purpose                                                                                                                        |
| ------ | ------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/admin/payments`                          | Staff   | 6     | Cursor-paginated payment history over retained settlements/tenders, with links to existing settlement receipts.               |
| `GET`  | `/api/v1/admin/reports/daily`                     | Manager | 6     | Return the daily accounting summary for `period=today` or `period=yesterday`; reject arbitrary dates and ranges.               |
| `GET`  | `/api/v1/admin/audit-log`                         | Manager | 6     | Search bounded retained audit history using safe fields only.                                                                  |
| `POST` | `/api/v1/admin/settlements/:settlementId/reverse` | Staff   | 6     | Reverse one posted settlement with a reason only when the Manager/Developer-only cafe setting requires it; never edit its original tenders or allocations.                         |
| `POST` | `/api/v1/admin/settlements/:settlementId/edit`    | Staff   | 6     | Correct tender methods without a reason, retaining the old settlement and atomically recording replacement tenders.             |

## Manager Inventory Operations And Developer Analysis Workflows

Inventory endpoints are approved by scope update and ADR 0011. Inventory
configuration and operations are available to Manager and Developer. The
overview, sales-channel, peak/contribution, gross-profit, and pricing-experiment
views are Developer-only. Posting routes require an
`Idempotency-Key`; versioned edits require the expected version. Each route
must have shared request/response schemas and generated OpenAPI coverage in the
implementation change.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/admin/inventory/stock-items` | Manager, Developer | 12, 17 | List stock items, base units, pack conversions, optional reference purchase package and price, packaging-material classification, tracking state, optional Manager-configured low-stock threshold in base units, and current valuation. |
| `POST` | `/api/v1/admin/inventory/stock-items` | Manager, Developer | 12, 17 | Create a stock item with explicit base unit, optional packaging-material classification, item-specific pack conversions, reference purchase package, and either complete-package-plus-loose or direct-total opening quantity; calculate opening Toman value server-side and initialize the balance and opening ledger entry. |
| `PATCH` | `/api/v1/admin/inventory/stock-items/:stockItemId` | Manager, Developer | 12, 17 | Version-check editable configuration, packaging-material classification, and reference purchase package; initialize an untracked item's opening balance once from the package-count or direct-total method, without resetting tracked stock. |
| `POST` | `/api/v1/admin/inventory/stock-items/:stockItemId/archive` | Manager, Developer | 12 | Archive an unused or referenced item without deleting ledger history. |
| `GET` | `/api/v1/admin/inventory/purchases` | Manager, Developer | 12 | Cursor-page purchases with optional supplier/item search, status, and received-time filters. |
| `POST` | `/api/v1/admin/inventory/purchases` | Manager, Developer | 12 | Create a received-purchase draft with supplier text and itemized direct costs. |
| `PATCH` | `/api/v1/admin/inventory/purchases/:purchaseId` | Manager, Developer | 12 | Version-check edits to a draft purchase. |
| `POST` | `/api/v1/admin/inventory/purchases/:purchaseId/post` | Manager, Developer | 12 | Post a receipt once, append movements, update moving averages, and retry eligible pending orders. |
| `POST` | `/api/v1/admin/inventory/purchases/:purchaseId/returns` | Manager, Developer | 12 | Record a dated stock return as a compensating ledger event. |
| `GET` | `/api/v1/admin/inventory/recipes` | Manager, Developer | 12 | List precise recipe variants, their shared ingredient names, and measured named components. |
| `POST` | `/api/v1/admin/inventory/recipes` | Manager, Developer | 12 | Create a precise recipe variant and shared ingredient name after validating component units and cycle-free references. |
| `PATCH` | `/api/v1/admin/inventory/recipes/:recipeId` | Manager, Developer | 12 | Version-check a precise recipe and shared ingredient name edit without changing saved order snapshots. |
| `POST` | `/api/v1/admin/inventory/recipes/:recipeId/archive` | Manager, Developer | 12 | Archive a recipe while retaining referenced configurations and history. |
| `GET` | `/api/v1/admin/products/:productId/costing` | Manager, Developer | 12, 21 | Read a product's recipe, purchased-item, or enabled estimated-cost configuration and option rules, including independent served-alongside estimates. |
| `PUT` | `/api/v1/admin/products/:productId/costing` | Manager, Developer | 12, 21 | Version-check product costing and option rules; estimate-mode toggles retain the saved ingredient configuration. Resolve incomplete item snapshots on eligible pending paid orders and retry each affected whole order. |
| `POST` | `/api/v1/admin/products/:productId/costing/preview` | Manager, Developer | 12, 21 | Resolve selected options and return known ingredient quantities, estimated costs, total known cost, and incompleteness reasons. |
| `GET` | `/api/v1/admin/inventory/counts` | Manager, Developer | 12 | Cursor-page counts with optional stock-item search, kind/status, and created-time filters. |
| `POST` | `/api/v1/admin/inventory/counts` | Manager, Developer | 12 | Create a physical-count draft with observed quantities and values; require one shared reason if any observed quantity differs from its recorded balance. |
| `PATCH` | `/api/v1/admin/inventory/counts/:countId` | Manager, Developer | 12 | Version-check edits to a physical-count draft and its shared discrepancy reason. |
| `POST` | `/api/v1/admin/inventory/counts/:countId/post` | Manager, Developer | 12 | Post a count once, explicitly reconcile selected pending orders, and establish counted balances. |
| `GET` | `/api/v1/admin/inventory/movements` | Manager, Developer | 12 | Cursor-page inventory history with date-range, stock-item, movement-type, or POS order-number filters; include the visible order number on order-related movements. |
| `GET` | `/api/v1/admin/inventory/pending-consumption` | Manager, Developer | 12, 21 | Read whole orders awaiting stock or count reconciliation, including safe-integer COGS totals. |
| `GET` | `/api/v1/admin/reports/gross-profit` | Developer | 13, 17, 21 | Report bounded Tehran-date net sales, theoretical COGS, gross profit/margin, coverage, pending status, and compatible inventory consumption estimates. Product and served-alongside estimates contribute to COGS but never to stock movements. Takeaway packaging is included in product COGS; no separate packaging revenue is reported. Report totals use safe-integer amounts. |
| `GET` | `/api/v1/admin/reports/sales-channels` | Developer | 18 | Report bounded dine-in/takeaway revenue, order distribution, AOV, and channel origin. |
| `GET` | `/api/v1/admin/reports/sales-analytics` | Developer | 18, 21 | Report bounded order/item demand, contribution, and peak-hour analytics with safe-integer estimated-cost totals. |
| `GET` | `/api/v1/admin/price-history` | Manager, Developer | 17 | Cursor-page price baseline and change records by bounded Tehran-date range, product, option, or price dimension. Include stable event IDs, before/after amounts and discounts, actor, source, and whether effective time is known. |

## Developer Pricing Experiments (Stage 19, ADR 0013)

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/admin/pricing-experiments` | Developer | 19 | List bounded experiment metadata, target prices, linked Phase 1 change events, and data-quality flags. |
| `POST` | `/api/v1/admin/pricing-experiments` | Developer | 19 | Create an analysis-only experiment with an effective timestamp, evaluation/comparison duration, target prices, and optional notes. Never write catalog prices. |
| `GET` | `/api/v1/admin/pricing-experiments/:experimentId` | Developer | 19 | Return the pre/post analysis, product and option impact, contribution decomposition, break-even volume, fixed-cost coverage, and data-quality limits. |
| `POST` | `/api/v1/admin/reports/pricing-experiments/simulate` | Developer | 19 | Calculate a non-mutating product/category/option pricing scenario and selected volume sensitivity. |

Inventory routes declare `400`, `401`, `403`, `404`, `409`, `422`, `429`,
`500`, and `503` error envelopes in their runtime response schemas. Validation
retains safe field paths; a stale inventory version includes the current version
in details when known. Blank supplier strings are invalid; use `null` or omit the field.
Stored quantities fit `DECIMAL(20,6)`, and package multiplication must be exact
to six decimal places. Inventory write conflicts, recognized range/constraint
failures, dependency failures, and unrecognized failures follow the shared
error mapping in `request-response-conventions.md`.

Stock-item setup creates the opening ledger entry, or initializes an existing
untracked item once; tracked items cannot be reopened. Manager count drafts are
physical counts over selected tracked items. If any observed quantity differs
from the recorded quantity, the count must retain one non-empty shared reason.
When a reference purchase package is supplied, the API resolves its conversion
for the same stock item and calculates opening value from package price and
opening quantity. Positive opening stock without a usable reference package is
rejected by the calculated-value path. The saved reference is a draft default
for later purchases; each purchase still records its own conversion, quantity,
and direct cost. Changing the reference has no stock-ledger or historical
purchase effect.
When a draft is edited, send each retained line's `id`; omit `id` for a new
line. The API matches snapshots by line ID and keeps the saved conversion
factor when the stock item and unit stay the same. A deliberate refresh against
the active conversion can set `useCurrentConversion: true`. In a mixed update,
ID-less lines are new and use the current active conversion. Fully legacy
updates without line IDs or `useCurrentConversion` retain exact matching by
stock item, unit, and quantity; a legacy replacement that should use a changed
conversion must set `useCurrentConversion: true`. This keeps metadata edits and
row deletion from changing a different saved line after a conversion is renamed
or recalibrated.

## Realtime Events

WebSocket transport and authentication details are deferred to the
request/response-conventions task. These are the only planned v1 notification
types. Events are emitted only after their database transaction commits, and
clients must refetch affected API resources after reconnecting.

| Event                  | Audience       | Stage | Client response                                                 |
| ---------------------- | -------------- | ----- | --------------------------------------------------------------- |
| `order.created`        | Staff          | 2     | Refetch affected table and order data.                          |
| `order.updated`        | Staff          | 2     | Refetch the affected order and table data.                      |
| `order.deleted`        | Staff          | 2     | Remove or refetch the affected active order/table view.         |
| `settlement.recorded`  | Staff          | 2     | Refetch the affected order and table summary.                   |
| `settlement.reversed`  | Staff, Manager | 6     | Refetch the affected order, table summary, and Manager reports. |
| `catalog.updated`      | Staff, Manager | 6     | Refetch current POS catalog and Manager catalog data.           |
| `availability.updated` | Staff, Manager | 6     | Refetch current POS catalog and availability-dependent views.   |
| `waiter-call.created`  | Staff, Manager | 5     | Refetch active waiter-calls and the shared table dashboard.      |
| `waiter-call.updated`  | Staff, Manager | 5     | Refetch the affected waiter-call and shared table dashboard.     |

## Exclusions And Change Control

- The inventory does not authorize an endpoint merely by naming it. Route and
  service-layer authorization remains mandatory.
- No endpoint exposes Prisma models, password hashes, tokens, refresh-session
  records, cookies, terminal secrets, or unsafe audit snapshots.
- The table-context exchange and waiter-call commands are the only approved public writes
  in the initial POS scope. Any additional public write, customer ordering, online payment,
  multi-branch behavior, or order/payment-model change requires an ADR and scope
  update before it is added here. Inventory and gross-profit work is the specific
  approved exception documented by ADR 0011 and `inventory-costing.md`.
- Add a route to this inventory and its generated OpenAPI contract in the same
  change that implements it. Remove or replace a planned route only through a
  planning update that preserves the approved scope.

## Permanent stock-turnover enablement

- `GET /admin/settings` includes nullable `inventoryActivatedAt`. Null means
  automatic order-driven stock turnover is disabled. Manager and Developer
  inventory routes for purchases, recipes, and product costing remain available
  after normal Manager authentication; gross-profit reporting is Developer-only.
- Manager-and-Developer `POST /admin/settings/inventory/activate` accepts `{}` and returns
  `AdminSettingsResponseSchema`. It atomically records the first turnover
  enablement time and an `ACTIVATE_INVENTORY` audit entry. Retries preserve the
  same time.
- While turnover is disabled, full-payment costing recognition and gross-profit
  reporting still work. Their records are marked untracked and cause no stock
  movement or pending retry. After enablement, order-created-at eligibility
  controls stock deductions, pending consumption, retries, and restorations;
  earlier orders are not backfilled.
- Checkouts read availability and moving-average costs under the same ingredient
  locks used by receipts and restorations. A shortage leaves the whole order
  pending while payment succeeds. Receipt posting can retry a pending checkout
  that committed while the receipt waited for stock. A cancellation racing a
  retry either prevents the deduction or restores the committed movement.
- Saving product costing can resolve an incomplete item snapshot on an eligible
  paid order that still has pending consumption. Recompute only the affected
  incomplete item snapshots; preserve item snapshots that were complete at
  payment. Retry the whole order only after every item snapshot is complete and
  every required tracked balance is sufficient. A posted order or an order
  created before activation is never backfilled by this path.
- Settings updates cannot alter or clear enablement. Database protection also
  rejects changing the timestamp or deleting settings after enablement.

## Takeaway packaging

Product costing input and output include `takeawayPackaging`, an array of
`{ stockItemId, quantity }`. Each stock item appears once, is active at save time,
and has a positive exact quantity in its base unit. Limit 100 rows. Quantities
are per sold unit even for weighted products. New configurations default to
empty; omitted mappings on updates retain existing mappings. Explicit `[]`
clears them. Existing Manager authorization and version checks apply.

Product costing also accepts optional `servedAlongside` rows with a positive
per-sold-unit quantity and exactly one active source: a stock item
(`{ sourceKind: STOCK_ITEM, stockItemId, quantity }`) or reusable recipe
(`{ sourceKind: RECIPE, recipeId, quantity }`). The list is bounded to 100.
These product-level additions apply to every option selection and channel in
previews and order snapshots. Omitted rows retain the saved list on update;
explicit `[]` clears it. They are not part of a reusable recipe, so selecting
that recipe elsewhere inherits only its main ingredients.

Product costing accepts `useEstimatedCost` and `estimatedCostAmount`. When the
toggle is enabled, an integer Toman estimate is required; zero is valid. The
amount is per sold unit, or per kilogram for a weighted product. The recipe or
purchased-item fields are optional while the estimate is enabled. The saved
underlying costing mode and ingredient/option configuration remain unchanged
while estimate mode is active, so disabling it restores the previous
configuration. Estimated product cost replaces the main product/option recipe
cost and does not create ingredient requirements. Existing takeaway packaging
and served-alongside entries remain independently costed.

A served-alongside estimated entry has the shape
`{ sourceKind: ESTIMATED_COST, name, estimatedCostAmount, previousSource? }`.
The amount is an integer Toman cost per parent sold unit. Optional
`previousSource` stores the alternate stock-item/recipe mapping and quantity
when switching an existing row, so the user can return to ingredient costing
without losing that setup. Estimated entries contribute to preview totals and
order snapshots but are excluded from ingredient components and stock
deduction. Ingredient-based served-alongside entries keep their existing
validation, valuation, and deduction behavior. Older servedAlongside rows remain
valid without a mode field.

Cost previews return estimated amounts in `knownCostAmount`; the `components`
array continues to list only inventory-backed ingredient quantities. Saved
order-consumption snapshots include the estimated Toman amount and breakdown.
Complete estimated costs count toward cost coverage, gross profit, gross margin,
sales analytics, and pricing analysis. Historical snapshots are not rewritten
by later costing changes. Estimated-only orders can be recognized as complete
without a pending-consumption row or inventory movement; recipe-based
side-add-ons on those orders still require sufficient tracked stock after
inventory turnover is enabled.

Cost preview accepts optional `channel: TABLE | TAKEAWAY`, default TABLE.
TAKEAWAY adds packaging to resolved ingredient/option requirements. Costing
snapshots preserve the resolved quantities and original sale channel.
Gross-profit product rows include `channel`; group by product ID and channel.
Totals and daily figures sum each sale once. Old snapshots retain old costs
without backfilling packaging. Cost and margin remain Developer-only.

### Quantity rules and complete takeaway recipes

`takeawayPackaging` rows optionally include `mode` (`PER_UNIT`, default;
`PER_GROUP`; `PER_ORDER`), `groupSize` (integer 2..10000, required only for
PER_GROUP), and optional inclusive `minQuantity`/`maxQuantity` (positive integers
up to 1000000, minimum <= maximum). Conditions count the sum of this product's
quantities across order rows/options. Complete groups use floor(total/groupSize),
allocated by cumulative row counts. PER_ORDER posts once for that product, not
once for every order row. Preview treats its quantity as the full product count.

Product costing also accepts nullable `takeawayRecipeId` and
`takeawayOptionRecipes: [{ optionId, recipeId, recipeQuantity }]`. These are
complete ingredient recipes for TAKEAWAY only, with inherited normal recipes
when absent. Option overrides take precedence over the base override. New
configurations default to null/[]; omitted fields preserve saved overrides on
update, and explicit null/[] clears them. IDs must reference active recipes,
option IDs must belong to the product and be unique, and output units must match
the product's selling unit. Existing nested recipe routes also support the new
Manager reusable preparation editor without creating catalog products.
