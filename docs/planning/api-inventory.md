# API Inventory

## Purpose And Status

This is the approved v1 API surface inventory. It maps the scope to stable
resource and command boundaries before endpoint implementation begins. It is a
planning contract, not the generated OpenAPI document: an endpoint becomes
implemented only when its validated request and response schemas are added to
the API and OpenAPI is generated from them.

All application endpoints use the `/api/v1` prefix. The operational health
endpoints are the only current implementation; every other entry is planned
for the delivery stage shown below. Request/response envelopes, pagination,
idempotency-header format, and conflict/error details are intentionally owned
by the remaining Stage 0 request/response-conventions task.

Legend:

- **Public**: anonymous QR-menu access only.
- **Staff**: authenticated Staff or Manager.
- **Manager**: authenticated Manager only.
- **Internal**: infrastructure or authenticated application-session support;
  never a public-menu capability.

## Operational And Contract Endpoints

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/health/live` | Internal | 1 | Process liveness check; does not require database access. |
| `GET` | `/api/v1/health/ready` | Internal | 1 | Dependency readiness check, including PostgreSQL connectivity. |
| `GET` | `/documentation` | Internal | 1 | Swagger UI for the generated OpenAPI contract; deployment access is restricted operationally. |
| `GET` | `/documentation/json` | Internal | 1 | Generated OpenAPI document for tooling and contract tests. |

## Identity And Sessions

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `POST` | `/api/v1/auth/login` | Public | 2 | Authenticate an active Staff or Manager account and establish an application session. |
| `POST` | `/api/v1/auth/refresh` | Internal | 2 | Rotate a valid refresh session and issue the next access session. |
| `POST` | `/api/v1/auth/logout` | Staff | 2 | Revoke the current refresh session. |
| `GET` | `/api/v1/auth/me` | Staff | 2 | Return the current authenticated user and role. |
| `POST` | `/api/v1/auth/logout-all` | Staff | 2 | Revoke all active sessions for the current user. |

The first Manager is created by a one-time Stage 1 operations command (for
example, a deployment-only `pnpm` script) that refuses to run once a Manager
exists. It is not an HTTP endpoint, is not included in OpenAPI, and cannot be
called by a browser or application client.

## POS Catalog And Tables

These Staff reads provide the current sellable catalog and table data needed
for POS entry. They do not expose Manager editing capability.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/pos/catalog` | Staff | 2 | Read active categories, sellable products, allowed options, availability, final Toman prices, and each product's single image metadata for POS. |
| `GET` | `/api/v1/tables` | Staff | 2 | List active physical tables with current active-order summary. |
| `GET` | `/api/v1/tables/:tableId` | Staff | 2 | Read one table and its active order(s). |
| `GET` | `/api/v1/tables/:tableId/orders` | Staff | 2 | Read the active and historical orders for one table, subject to documented filters. |

## Orders, Payments, And Receipts

Order write routes are named commands where a business operation changes
multiple records. The server remains authoritative for prices, discounts,
totals, balance, state transitions, and snapshots.

`record-settlement` accepts selected order-item quantities plus one or more
tenders. The server calculates allocation and settlement amounts, rather than
accepting a client total. A settlement may contain `CASH`, `CARD_TERMINAL`, and
`CARD_TRANSFER` tenders; card-to-card transfers require a reference. The
operation requires an idempotency key and the current order version.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `POST` | `/api/v1/orders` | Staff | 2 | Create a table or takeaway `OPEN` order with payment status `UNPAID` from catalog selections; requires an idempotency key. |
| `GET` | `/api/v1/orders` | Staff | 2 | Search/list orders for POS history and recovery, with documented lifecycle state, payment-status, channel, table, and time filters. |
| `GET` | `/api/v1/orders/:orderId` | Staff | 2 | Read an order with item/option snapshots, payment status, settlement allocations/tenders, totals, and permitted operational metadata. |
| `PATCH` | `/api/v1/orders/:orderId` | Staff | 2 | Apply a controlled edit to an `OPEN` order only while its payment status is `UNPAID`; requires the current order version. |
| `POST` | `/api/v1/orders/:orderId/transfer-table` | Staff | 2 | Move an `OPEN`, `UNPAID` table order to another active table; requires the current order version. |
| `POST` | `/api/v1/orders/:orderId/record-settlement` | Staff | 2 | Atomically settle selected unallocated item quantities with one or more cash, card-terminal, or card-to-card transfer tenders; requires an idempotency key and current order version. |
| `POST` | `/api/v1/orders/:orderId/delete` | Staff | 2 | Logically delete an order while retaining items, settlements, tenders, reversals, and audit history; a reason is optional. |
| `GET` | `/api/v1/orders/:orderId/bar-ticket` | Staff | 2 | Return concise, print-ready preparation data: order number, `Asia/Tehran` display time, table/takeaway context, item quantities, selected options, and notes only. It excludes prices, discounts, totals, and payment data. |
| `GET` | `/api/v1/orders/:orderId/receipt` | Staff | 2 | Return stable, print-ready whole-order customer-receipt data derived from item snapshots and active settlements, including financial totals. |
| `GET` | `/api/v1/orders/:orderId/settlements/:settlementId/receipt` | Staff | 2 | Return print-ready customer-receipt data for one payer settlement, including allocated items, Toman totals, and tender summary. |

No route exists for physically deleting orders, editing a posted tender or
settlement, or creating a customer order.

## Public QR Menu

All public QR-menu routes are read-only. They expose only the current menu,
temporary availability, single product image metadata, and final Toman prices required for a
customer to browse the menu.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/public/menu` | Public | 3 | Read the complete browse-only menu, including active categories, products, options, availability, each product's single image, and final prices. |
| `GET` | `/api/v1/public/products/:productId` | Public | 3 | Read one current, publicly visible product and its available option groups/options. |

There are no public cart, order, payment, table, tracking, session, or
Staff-metadata routes in v1.

## Manager Catalog, Staff, And Settings

Manager writes archive/deactivate referenced records rather than physically
remove them. Each product has at most one current image. Product images are
uploaded through the API and subsequently served through a controlled image
route; the database stores image metadata and storage references, not image
bytes.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/admin/categories` | Manager | 6 | List categories, including inactive/archived records when requested. |
| `POST` | `/api/v1/admin/categories` | Manager | 6 | Create a category. |
| `PATCH` | `/api/v1/admin/categories/:categoryId` | Manager | 6 | Update category fields, active state, or display order. |
| `POST` | `/api/v1/admin/categories/:categoryId/archive` | Manager | 6 | Archive a category while preserving historical references. |
| `GET` | `/api/v1/admin/products` | Manager | 6 | List products and their catalog configuration. |
| `POST` | `/api/v1/admin/products` | Manager | 6 | Create a product with its category, price, and option-group configuration. |
| `PATCH` | `/api/v1/admin/products/:productId` | Manager | 6 | Update product details, final price, active state, availability, display order, or allowed option groups. |
| `POST` | `/api/v1/admin/products/:productId/archive` | Manager | 6 | Archive a product without changing historical order snapshots. |
| `PUT` | `/api/v1/admin/products/:productId/image` | Manager | 6 | Validate and upload or replace the product's single image, then store its metadata record. |
| `PATCH` | `/api/v1/admin/products/:productId/image` | Manager | 6 | Update the product image metadata, such as alt text. |
| `POST` | `/api/v1/admin/products/:productId/image/archive` | Manager | 6 | Remove the product image from current display without deleting needed history. |
| `GET` | `/api/v1/admin/option-groups` | Manager | 6 | List reusable option groups and their options. |
| `POST` | `/api/v1/admin/option-groups` | Manager | 6 | Create an option group. |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId` | Manager | 6 | Update an option group or its active state. |
| `POST` | `/api/v1/admin/option-groups/:optionGroupId/options` | Manager | 6 | Create an option in an option group. |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId` | Manager | 6 | Update option name, final extra price, availability, active state, or display order. |
| `POST` | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId/archive` | Manager | 6 | Archive an option while preserving order-item snapshots. |
| `GET` | `/api/v1/admin/tables` | Manager | 6 | List all physical tables and their lifecycle state. |
| `POST` | `/api/v1/admin/tables` | Manager | 6 | Create a physical table. |
| `PATCH` | `/api/v1/admin/tables/:tableId` | Manager | 6 | Update table name, active state, or display order. |
| `POST` | `/api/v1/admin/tables/:tableId/archive` | Manager | 6 | Archive a table while preserving its order history. |
| `GET` | `/api/v1/admin/users` | Manager | 6 | List Staff and Manager accounts, excluding credential and session secrets. |
| `POST` | `/api/v1/admin/users` | Manager | 6 | Create a Staff or Manager account. |
| `PATCH` | `/api/v1/admin/users/:userId` | Manager | 6 | Update allowed account fields or role. |
| `POST` | `/api/v1/admin/users/:userId/deactivate` | Manager | 6 | Deactivate an account and revoke its sessions while retaining history. |
| `POST` | `/api/v1/admin/users/:userId/reactivate` | Manager | 6 | Reactivate an account without altering history. |
| `GET` | `/api/v1/admin/settings` | Manager | 6 | Read the single-cafe settings record. |
| `PATCH` | `/api/v1/admin/settings` | Manager | 6 | Update configurable cafe settings with an audit entry. There is no business-day cutoff setting in v1. |

## Manager Reporting, Audit, And Settlement Reversals

Reports use UTC storage but accept/report calendar boundaries in
`Asia/Tehran`. The cafe is always open, so v1 does not define a configurable
business-day cutoff. Exports and date ranges are bounded to protect POS
operation.

| Method | Path | Access | Stage | Purpose |
| ------ | ---- | ------ | ----- | ------- |
| `GET` | `/api/v1/admin/reports/sales-summary` | Manager | 6 | Return bounded daily, weekly, or monthly sales, order count, and average order value. |
| `GET` | `/api/v1/admin/reports/payment-methods` | Manager | 6 | Return sales/payment mix by cash, card terminal, and card-to-card transfer. |
| `GET` | `/api/v1/admin/reports/products` | Manager | 6 | Return item and category sales. |
| `GET` | `/api/v1/admin/reports/hours` | Manager | 6 | Return sales and order count by local Tehran clock hour. |
| `GET` | `/api/v1/admin/reports/discounts` | Manager | 6 | Return discount totals and associated orders. |
| `GET` | `/api/v1/admin/reports/deleted-orders` | Manager | 6 | Return logically deleted orders separately from ordinary sales. |
| `GET` | `/api/v1/admin/reports/settlement-reversals` | Manager | 6 | Return reversal totals and affected settlements/tenders. |
| `GET` | `/api/v1/admin/audit-log` | Manager | 6 | Search the bounded audit history using safe fields only. |
| `POST` | `/api/v1/admin/settlements/:settlementId/reverse` | Manager | 6 | Reverse one posted settlement with a required reason; never edit its original tenders or allocations. |
| `GET` | `/api/v1/admin/exports/sales` | Manager | 6 | Produce a bounded sales export using the same report definitions. |

## Realtime Events

WebSocket transport and authentication details are deferred to the
request/response-conventions task. These are the only planned v1 notification
types. Events are emitted only after their database transaction commits, and
clients must refetch affected API resources after reconnecting.

| Event | Audience | Stage | Client response |
| ----- | -------- | ----- | --------------- |
| `order.created` | Staff | 2 | Refetch affected table and order data. |
| `order.updated` | Staff | 2 | Refetch the affected order and table data. |
| `order.deleted` | Staff | 2 | Remove or refetch the affected active order/table view. |
| `settlement.recorded` | Staff | 2 | Refetch the affected order and table summary. |
| `settlement.reversed` | Staff, Manager | 6 | Refetch the affected order, table summary, and Manager reports. |
| `catalog.updated` | Staff, Manager | 6 | Refetch current POS catalog and Manager catalog data. |
| `availability.updated` | Staff, Manager | 6 | Refetch current POS catalog and availability-dependent views. |

## Exclusions And Change Control

- The inventory does not authorize an endpoint merely by naming it. Route and
  service-layer authorization remains mandatory.
- No endpoint exposes Prisma models, password hashes, tokens, refresh-session
  records, cookies, terminal secrets, or unsafe audit snapshots.
- New public write endpoints, customer ordering, online payments, inventory,
  multi-branch behavior, or any change to the order/payment model requires an
  ADR and scope update before it is added here.
- Add a route to this inventory and its generated OpenAPI contract in the same
  change that implements it. Remove or replace a planned route only through a
  planning update that preserves the approved scope.
