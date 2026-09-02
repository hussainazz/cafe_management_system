# API Inventory

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

- **Public**: anonymous QR-menu browsing plus the narrowly scoped table-scan and waiter-call commands documented below.
- **Staff**: authenticated Staff or Manager.
- **Manager**: authenticated Manager only.
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
| `POST` | `/api/v1/auth/login`      | Public   | 2     | Authenticate an active Staff or Manager username/password pair and establish an application session. |
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
| `GET`  | `/api/v1/pos/catalog`            | Staff  | 2     | Read active categories, sellable products, allowed options, availability, product preparation-deadline minutes, final Toman prices, and each product's single image metadata for POS. |
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
reference because terminal entry is manual and not synchronized with the
application. Card-to-card transfer references are optional. The operation
requires an idempotency key and the current order version.

| Method  | Path                                                        | Access | Stage | Purpose                                                                                                                                                                                                                                                                                               |
| ------- | ----------------------------------------------------------- | ------ | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`  | `/api/v1/orders`                                            | Staff  | 2     | Create a table or takeaway `OPEN` order with payment status `UNPAID` from catalog selections; requires an idempotency key.                                                                                                                                                                            |
| `GET`   | `/api/v1/orders`                                            | Staff  | 2     | Search/list orders for POS history and recovery, with documented lifecycle state, payment-status, channel, table, and time filters.                                                                                                                                                                   |
| `GET`   | `/api/v1/orders/:orderId`                                   | Staff  | 2     | Read an order with item/option/timing snapshots, payment status, settlement allocations/tenders, totals, estimated preparation minutes, estimated table release time where applicable, and permitted operational metadata.                                                                            |
| `PATCH` | `/api/v1/orders/:orderId`                                   | Staff  | 2     | Apply a controlled edit, including a reasoned item/order discount, to an `OPEN` order; requires the current version. After settlement, edits may affect only additions/unsettled quantities; settled quantities, posted allocations, tenders, discounts affecting them, and receipts are immutable.    |
| `POST`  | `/api/v1/orders/:orderId/transfer-table`                    | Staff  | 2     | Move an `OPEN` table order to another active table; requires the current order version.                                                                                                                                                                                                               |
| `PATCH` | `/api/v1/admin/products/:productId/sale-discount`           | Manager | 2     | Configure or remove a fixed/percentage product sale discount. It applies only to newly-created item snapshots.                                                                                                                                                                                        |
| `POST`  | `/api/v1/orders/:orderId/record-settlement`                 | Staff  | 2     | Atomically settle selected unallocated item quantities with one or more cash, card-terminal, or card-to-card transfer tenders; requires an idempotency key and current order version.                                                                                                                 |
| `POST`  | `/api/v1/orders/:orderId/delete`                            | Staff  | 2     | Logically delete an order while retaining items, settlements, tenders, reversals, and audit history; requires the current order version and accepts an optional reason.                                                                                                                               |
| `GET`   | `/api/v1/orders/:orderId/bar-ticket`                        | Staff  | 2     | Return concise, print-ready preparation data: order number, `Asia/Tehran` display time, table/takeaway context, item quantities, selected options, item preparation-deadline snapshots, order estimated preparation minutes, and notes only. It excludes prices, discounts, totals, and payment data. |
| `GET`   | `/api/v1/orders/:orderId/receipt`                           | Staff  | 2     | Return stable, print-ready whole-order customer-receipt data derived from item snapshots and active settlements, including financial totals.                                                                                                                                                          |
| `GET`   | `/api/v1/orders/:orderId/settlements/:settlementId/receipt` | Staff  | 2     | Return print-ready customer-receipt data for one payer settlement, including allocated items, Toman totals, and tender summary.                                                                                                                                                                       |

No route exists for physically deleting orders, editing a posted tender or
settlement, or creating a customer order.

## Public QR Menu And Waiter-Call

Public QR-menu reads expose only the current menu, temporary availability,
single product image metadata, and final Toman prices required for browsing.
The public QR writes are table-context commands only: a scan can remind the
shared dashboard that an eligible table was not marked occupied, and a
waiter-call can be submitted only from an eligible occupied table. They require
an opaque credential, are duplicate-safe through database state, and grant no
order, payment, receipt, tracking, or catalog authority.

| Method | Path                                  | Access | Stage | Purpose                                                                                                                                                                                |
| ------ | ------------------------------------- | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/public/menu`                 | Public | 3     | Read the complete browse-only menu, including active categories, products, options, availability, each product's single image, and final prices; preparation deadlines remain private. |
| `GET`  | `/api/v1/public/products/:productId`  | Public | 3     | Read one current, publicly visible product plus available option groups/options, without exposing the Staff-only preparation deadline.                                                  |
| `POST` | `/api/v1/public/table-scans`          | Public | 5     | Process a valid credential scan; when its eligible table is still available, create or refresh a dashboard occupancy reminder without changing occupancy or exposing customer data. |
| `POST` | `/api/v1/public/waiter-calls`         | Public | 5     | Create or return the one pending waiter-call for the eligible occupied table identified by a valid credential; raw credentials are never logged or stored.                           |

There are no public cart, order, payment, receipt, tracking, session, or
Staff-metadata routes in v1. The waiter-call response contains only safe call
state and table-display context.

## Shared POS Waiter-Calls

Staff and Manager use these same contracts from the shared table dashboard.

| Method | Path                                             | Access | Stage | Purpose                                                                                                      |
| ------ | ------------------------------------------------ | ------ | ----- | ------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/waiter-calls`                           | Staff  | 5     | List active waiter-calls in stable request-time order for the shared table dashboard.                       |
| `POST` | `/api/v1/tables/:tableId/occupy`                 | Staff  | 5     | Explicitly mark an eligible or non-eligible physical table occupied and clear its scan reminder.            |
| `POST` | `/api/v1/tables/:tableId/make-available`         | Staff  | 5     | Explicitly return a physical table to available after its service is complete.                              |
| `POST` | `/api/v1/tables/:tableId/acknowledge-waiter-call`| Staff  | 5     | Open the highlighted table and atomically acknowledge and resolve its pending call; stale actions conflict. |

## Manager Catalog, Staff, And Settings

Manager writes archive/deactivate referenced records rather than physically
remove them. Each product has at most one current image. Product images are
uploaded through the API and subsequently served through a controlled image
route; the database stores image metadata and storage references, not image
bytes.

| Method  | Path                                                                   | Access  | Stage | Purpose                                                                                                                                           |
| ------- | ---------------------------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/admin/categories`                                             | Manager | 6     | List categories, including inactive/archived records when requested.                                                                              |
| `POST`  | `/api/v1/admin/categories`                                             | Manager | 6     | Create a category.                                                                                                                                |
| `PATCH` | `/api/v1/admin/categories/:categoryId`                                 | Manager | 6     | Update category fields, active state, or display order.                                                                                           |
| `POST`  | `/api/v1/admin/categories/:categoryId/archive`                         | Manager | 6     | Archive a category while preserving historical references.                                                                                        |
| `GET`   | `/api/v1/admin/products`                                               | Manager | 6     | List products and their catalog configuration.                                                                                                    |
| `POST`  | `/api/v1/admin/products`                                               | Manager | 6     | Create a product with its category, price, preparation-deadline minutes, and option-group configuration.                                          |
| `PATCH` | `/api/v1/admin/products/:productId`                                    | Manager | 6     | Update product details, final price, Manager-controlled sale discount, preparation-deadline minutes, active state, availability, display order, or allowed option groups.           |
| `POST`  | `/api/v1/admin/products/:productId/archive`                            | Manager | 6     | Archive a product without changing historical order snapshots.                                                                                    |
| `PUT`   | `/api/v1/admin/products/:productId/image`                              | Manager | 6     | Validate and upload or replace the product's single image, then store its metadata record.                                                        |
| `PATCH` | `/api/v1/admin/products/:productId/image`                              | Manager | 6     | Update the product image metadata, such as alt text.                                                                                              |
| `POST`  | `/api/v1/admin/products/:productId/image/archive`                      | Manager | 6     | Remove the product image from current display without deleting needed history.                                                                    |
| `GET`   | `/api/v1/admin/option-groups`                                          | Manager | 6     | List reusable option groups and their options.                                                                                                    |
| `POST`  | `/api/v1/admin/option-groups`                                          | Manager | 6     | Create an option group.                                                                                                                           |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId`                           | Manager | 6     | Update an option group or its active state.                                                                                                       |
| `POST`  | `/api/v1/admin/option-groups/:optionGroupId/options`                   | Manager | 6     | Create an option in an option group.                                                                                                              |
| `PATCH` | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId`         | Manager | 6     | Update option name, final extra price, availability, active state, or display order.                                                              |
| `POST`  | `/api/v1/admin/option-groups/:optionGroupId/options/:optionId/archive` | Manager | 6     | Archive an option while preserving order-item snapshots.                                                                                          |
| `GET`   | `/api/v1/admin/tables`                                                 | Manager | 6     | List all physical tables and their lifecycle state.                                                                                               |
| `POST`  | `/api/v1/admin/tables`                                                 | Manager | 6     | Create a physical table.                                                                                                                          |
| `PATCH` | `/api/v1/admin/tables/:tableId`                                        | Manager | 6     | Update table name, seating-limit minutes, active state, or display order.                                                                         |
| `POST`  | `/api/v1/admin/tables/:tableId/archive`                                | Manager | 6     | Archive a table while preserving its order history.                                                                                               |
| `GET`   | `/api/v1/admin/users`                                                  | Manager | 6     | List Staff and Manager accounts, excluding credential and session secrets.                                                                        |
| `POST`  | `/api/v1/admin/users`                                                  | Manager | 6     | Create a Staff or Manager account.                                                                                                                |
| `PATCH` | `/api/v1/admin/users/:userId`                                          | Manager | 6     | Update allowed account fields or role.                                                                                                            |
| `POST`  | `/api/v1/admin/users/:userId/deactivate`                               | Manager | 6     | Deactivate an account and revoke its sessions while retaining history.                                                                            |
| `POST`  | `/api/v1/admin/users/:userId/reactivate`                               | Manager | 6     | Reactivate an account without altering history.                                                                                                   |
| `GET`   | `/api/v1/admin/settings`                                               | Manager | 6     | Read the single-cafe settings record.                                                                                                             |
| `PATCH` | `/api/v1/admin/settings`                                               | Manager | 6     | Update configurable cafe settings, including the default table seating limit, with an audit entry. There is no business-day cutoff setting in v1. |

## Manager Reporting, Audit, And Settlement Reversals

The first accounting report uses UTC storage but accepts only `today` or
`yesterday`, resolved using `Asia/Tehran` calendar boundaries. This two-day
query limit does not delete or expire older orders or payment records.

| Method | Path                                              | Access  | Stage | Purpose                                                                                                                        |
| ------ | ------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/v1/admin/payments`                          | Manager | 6     | Cursor-paginated payment history over retained settlements/tenders, with links to existing settlement receipts.               |
| `GET`  | `/api/v1/admin/reports/daily`                     | Manager | 6     | Return the daily accounting summary for `period=today` or `period=yesterday`; reject arbitrary dates and ranges.               |
| `GET`  | `/api/v1/admin/audit-log`                         | Manager | 6     | Search bounded retained audit history using safe fields only.                                                                  |
| `POST` | `/api/v1/admin/settlements/:settlementId/reverse` | Manager | 6     | Reverse one posted settlement with a required reason; never edit its original tenders or allocations.                         |

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
- The table-scan and waiter-call commands are the only approved public writes
  in the initial POS scope. Any additional public write, customer ordering, online payment,
  inventory, multi-branch behavior, or order/payment-model change requires an
  ADR and scope update before it is added here.
- Add a route to this inventory and its generated OpenAPI contract in the same
  change that implements it. Remove or replace a planned route only through a
  planning update that preserves the approved scope.
