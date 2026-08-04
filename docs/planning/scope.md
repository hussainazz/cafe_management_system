# Café Management System Scope

## Document Control

**Status:** implementation baseline  
**Primary stack:** TypeScript, Node.js, Fastify, PostgreSQL, Prisma, Next.js  
**Initial operating model:** one café, one branch, one source of truth  
**Baseline date:** 28 July 2026  
**Decision status:** baseline decisions are fixed unless replaced by an Architecture Decision Record (ADR).

This document owns product scope, business rules, architecture boundaries, and fixed v1 decisions. Delivery sequence lives in `roadmap.md`; backend tasks live in `backend-backlog.md`; production readiness lives in `production-gates.md`.

## Executive Summary

The project is an integrated café operations platform with four task-focused surfaces: a public digital menu, a Staff POS, a Manager administration area, and a Staff preparation queue. They share one backend, one PostgreSQL database, and one set of business rules.

The v1 system is intentionally simple: staff create every order; customers can browse the QR menu but cannot send an order. This lets the first production release concentrate on reliable POS operation, correct prices and payments, and a clean audit trail before customer self-ordering is introduced.

Product goals:

- Keep the menu, POS, preparation queue, and administration data synchronized.
- Make routine staff order entry fast and resistant to mistakes.
- Make prices, discounts, payments, and state changes authoritative on the server.
- Provide useful daily sales and operational reporting without manual reconciliation.
- Remain maintainable by one developer while leaving clear extension points for later features.

v1 success criteria:

- A Staff user can create a table or takeaway order, send it to the Staff preparation queue, record one or more cash or card-terminal payments, print a receipt, and logically delete an order when required.
- A customer can scan a QR code and browse the current menu on a phone. They cannot create, submit, pay for, or track an order in v1.
- A product-price change never changes the price on a historical order or receipt.
- A retry cannot create duplicate orders or duplicate payment records.
- Two simultaneous POS edits do not silently overwrite each other.
- The database can be restored from a tested backup and the application can be rolled back or forward-fixed after a failed release.

## Product Boundaries

| Area           | Baseline decision                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Business scope | One café and one branch. Multi-tenant SaaS behavior is outside v1.                                                                             |
| Roles          | Only Manager and Staff exist. Staff performs both POS and preparation work.                                                                    |
| Customers      | Customers are anonymous menu viewers in v1. There are no customer accounts, guest-order sessions, or self-ordering endpoints.                  |
| Currency       | Every amount is an integer count of **Toman**. Floating-point values and Rial conversion are forbidden.                                        |
| Time           | Store timestamps in UTC. Display timestamps and calculate business-day reports in `Asia/Tehran`.                                               |
| Ordering       | Every v1 order is created by a logged-in Staff user through POS.                                                                               |
| Payments       | Staff manually record one or more cash or card-terminal payments. Split tender is allowed; there is no online payment or terminal integration. |
| Prices         | Each catalog price is already the finished price. There are no taxes or service charges.                                                       |
| Preparation    | One bar prepares every v1 order. There is no kitchen or product-to-station routing.                                                            |
| Receipts       | v1 uses a print-friendly browser receipt. Silent ESC/POS printing and printer control are separate integrations.                               |
| Deployment     | One Iranian VPS hosts one authoritative application/database stack. There is no dual writable cloud/local setup.                               |

User-facing surfaces:

| Surface           | Primary user | v1 purpose                                                                                                                                 |
| ----------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Digital Menu      | Customer     | Browse the menu, categories, item details, options, availability, and final Toman prices. No cart submission or order tracking.            |
| POS               | Staff        | Create and edit table or takeaway orders, assign tables where applicable, register payment, logically delete an order, and print receipts. |
| Preparation Queue | Staff        | See pending items/orders in preparation order. v1 does not need a separate preparation-state machine.                                      |
| Administration    | Manager      | Manage catalog, Staff accounts, settings, reports, and audit history.                                                                      |

Explicit non-goals for v1:

- Customer self-ordering, customer carts submitted to the café, table-order QR security, guest order tracking, customer accounts, loyalty, wallets, coupons, and marketing automation.
- Inventory, recipes, ingredient deduction, waste, suppliers, and purchase orders.
- Reservations, multi-branch management, multi-tenancy, franchise reporting, and third-party delivery synchronization.
- Online payments, direct card-terminal control, automatic refunds, and accounting integrations.
- Tax, VAT, service-charge, or item-level tax calculation.
- Full offline synchronization, a café-local authoritative server, or conflict resolution between two writable databases.
- Native mobile apps, advanced forecasting, automatic printer routing, and a CDN requirement.

Scope rule: a future feature may influence a clean module boundary, but it must not add tables, abstractions, services, or infrastructure to v1 unless a current v1 use case needs it.

## Actors, Permissions, And Workflows

There are no application roles beyond Manager and Staff in v1. A person’s real-world job title does not determine application permissions; POS and preparation work both use the **Staff** role.

| Capability                                                                  | Staff | Manager |
| --------------------------------------------------------------------------- | :---: | :-----: |
| Sign in and use POS                                                         |  Yes  |   Yes   |
| Create, edit, and submit pending orders                                     |  Yes  |   Yes   |
| Assign or move a table on an open order                                     |  Yes  |   Yes   |
| View the Staff preparation queue                                            |  Yes  |   Yes   |
| Record a cash or card-terminal payment                                      |  Yes  |   Yes   |
| Delete an order, including an already-paid order, without a required reason |  Yes  |   Yes   |
| Print/reprint receipts                                                      |  Yes  |   Yes   |
| Manage categories, products, options, images, prices, and availability      |  No   |   Yes   |
| Manage Staff accounts and role assignment                                   |  No   |   Yes   |
| Change café settings                                                        |  No   |   Yes   |
| View reports and full audit history                                         |  No   |   Yes   |

Authorization is enforced by permissions in routes and service methods, not only by hiding buttons. Since v1 has only two roles, the initial permission set can be simple and explicit rather than over-designed.

v1 staff-created order flow:

1. A Staff user selects the order type: table or takeaway.
2. They add products, options, quantities, and notes in POS.
3. The server validates availability and calculates all totals from current catalog data.
4. The server creates the order with state `PENDING`, snapshots the item names and finished Toman prices, and adds it to the Staff preparation queue.
5. Staff prepares the order. This physical work does not change the v1 order state.
6. When the customer pays, Staff records one or more cash or card-terminal payments. The order becomes `PAID` when the recorded payment total reaches its final total.
7. If the order must be removed from the active table/POS list, Staff chooses `DELETED`. This is a logical deletion; historical financial and audit records remain preserved. No deletion reason is required.

v1 order states:

| State     | Meaning                                                                                                           | Allowed next action                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PENDING` | Staff has registered the order. It is visible to the Staff preparation queue and is not fully paid.               | Record one or more payments; transition to `PAID` when their total reaches the final total; delete → `DELETED`; permitted content/table edit remains possible. |
| `PAID`    | Staff has recorded one or more cash or card-terminal payments whose total reaches the final order total.          | Delete → `DELETED` when the order should be removed from the active table/POS view; retain payment/audit history.                                              |
| `DELETED` | The order was removed from active work, with or without payment. It is never physically erased from the database. | No normal transition. A correction is an audited action, not a silent rewrite.                                                                                 |

`DELETED` does not mean database deletion. A paid order must remain reportable and reconcilable; every deleted order must retain an audit record showing who deleted it and when. A deletion reason is optional and is not required for a paid order.

Future customer table ordering is post-v1 only. When this phase begins, write an ADR and state table before implementation. Customer submission requires dedicated rate limiting, idempotency, table validation, and safe public tokens.

Corrections and exceptional flows:

- The server recalculates totals; the POS never supplies an authoritative total.
- A same-key retry returns the original order/payment result rather than creating another record.
- Each delete action is audited with its actor and timestamp. A deletion reason is optional; Staff and Manager have the same authority to delete a paid order. A Manager should be required for any correction that rewrites or reverses a payment record.
- A stale POS update receives a clear conflict response rather than silently overwriting a newer edit.

## MVP V1 Definition

| Capability             | Required v1 behavior                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundation             | Environment validation, database migrations, seed/bootstrap flow, structured errors, request IDs, logging, health/readiness endpoints.                                        |
| Authentication         | Staff login, secure sessions, logout, account deactivation, and Manager/Staff authorization.                                                                                  |
| Catalog                | Categories, products, options, images, display order, final Toman price, active state, and temporary availability.                                                            |
| POS order entry        | Table/takeaway orders; quantities, options, notes, server totals, controlled edits, logical deletion, and order history.                                                      |
| Table operations       | Assign, transfer, view active orders, and clear table orders through the defined paid/delete flow. No order or table split/merge.                                             |
| Preparation            | A lightweight Staff preparation queue showing pending work, with real-time refresh or polling. No separate preparation status is required.                                    |
| Customer menu          | Mobile-first QR menu for browse/search/filter, availability, item options, and final Toman price. No checkout or order submission.                                            |
| Payments               | One or more manual cash and card-terminal records per order, including split tender; total-paid calculation; payment reference where useful; audit trail. No online payments. |
| Discounts              | One permissioned order-level fixed or percentage discount with reason. There are no taxes or service charges.                                                                 |
| Receipts               | Print-friendly HTML receipt containing item snapshots, Toman totals, payment summary, order number, and `Asia/Tehran` display time.                                           |
| Reports                | Daily/weekly/monthly sales, orders, average value, payment mix, item/category sales, discounts, deleted orders, and hourly sales.                                             |
| Administration         | Catalog, availability, Staff accounts, settings, reports, and audit log.                                                                                                      |
| Quality and operations | Critical tests, OpenAPI documentation, Docker deployment, HTTPS, backups, restore test, monitoring, and release rollback/forward-fix.                                         |

Pilot acceptance scenarios:

- Create a normal takeaway order, see it in the Staff preparation queue, record a cash payment, and print a receipt.
- Create and transfer a table order, record a card-terminal payment, then choose to clear that table’s orders.
- Delete an unpaid order and a paid order; verify that neither is physically removed and both have an actor and timestamp in audit history. Verify that Staff can delete the paid order without providing a reason.
- Change a product price and confirm that an earlier receipt remains unchanged.
- Retry an order or payment request and confirm that only one record exists.
- Use two POS terminals to edit the same pending order and confirm that stale data receives a conflict response.
- Restart the application during a busy workflow and confirm clients recover state from the API.
- Restore a backup into a clean environment and run the critical smoke tests.

## Domain Model And Business Rules

| Module      | Owns                                                                                          |
| ----------- | --------------------------------------------------------------------------------------------- |
| Identity    | Users, credentials, sessions, Manager/Staff role, permissions, authentication events.         |
| Catalog     | Categories, products, images, option groups/options, availability, and display order.         |
| Ordering    | Orders, order items, price snapshots, notes, channel, state transitions, idempotency.         |
| Tables      | Physical tables and assignment/clearing of active orders.                                     |
| Preparation | Staff preparation queue projections for pending order items.                                  |
| Payments    | Manual payment entries, correction/reversal policy, order numbering, and balance calculation. |
| Reporting   | Read-oriented sales queries and exports based on committed data.                              |
| Operations  | Café settings, audit logs, system health, and operational metadata.                           |

Money, pricing, and tax rules:

- The database stores money as signed-safe integer Toman values. It never stores Rial or floating-point money.
- Product and option prices are final customer prices. No tax, VAT, service charge, or tax calculation exists in v1.
- The backend is the only authority for unit price, option price, discount, line total, grand total, paid total, and balance.
- Each order item stores a snapshot of product name, base price, selected options and their prices, quantity, discount allocation, and final line total.
- Historical orders never recalculate from the current catalog. Referenced products are archived, not hard-deleted.
- Rounding and discount allocation rules are tested pure functions before UI work begins.

Payment, deletion, integrity, and audit rules:

- An order and a payment are separate records. v1 supports one or more cash and card-terminal payment records per order, so split tender is allowed.
- A payment record contains an idempotency key, full or partial amount in Toman, method, actor, timestamp, and an optional terminal/reference number.
- Posted payment records are not edited or physically deleted. A mistake is handled through a permissioned reversal/correction with a reason, and this action is audited.
- Recording each payment, recalculating the balance, conditionally updating the order to `PAID` when the payment total reaches the final total, and writing the audit entry occur in one transaction.
- Marking an order `DELETED` preserves the order, its items, any payment records, and audit history. Reports can include or exclude deleted orders explicitly; they must never disappear accidentally.
- Database constraints enforce positive quantities, non-negative prices/discounts, valid states, unique identifiers, foreign keys, and required price snapshots.
- Every multi-record order or payment operation runs in a PostgreSQL transaction.
- An order version field or equivalent compare-and-swap condition prevents lost updates between terminals.
- Idempotency records bind a key to actor/session, operation, request fingerprint, result, and expiration policy.
- WebSocket notifications occur only after a committed transaction. Reconnecting clients fetch the API state because notifications may be missed.
- Products, categories, users, and tables are deactivated or archived when referenced by history.
- Orders, payments, payment corrections, and audit logs are retained; normal application actions never hard-delete them.
- Audit entries record actor, request ID, operation, entity, safe before/after fields, timestamp, and any provided reason. They exclude passwords, tokens, cookies, and unnecessary personal data.

## Application Architecture

The system begins as a modular monolith. It keeps feature boundaries and strong transactions without microservice deployment overhead.

```text
Digital Menu | Staff POS | Manager Admin | Staff Preparation Queue
                         ↓
            Next.js web application (separate routes)
                         ↓
        Fastify modular monolith (REST + WebSockets)
                         ↓
              PostgreSQL — source of truth
                         ↓
              Product image storage
```

Deployment units:

- One Fastify API process owns business rules, persistence, authentication, OpenAPI, and WebSocket notifications.
- One Next.js application provides separate menu, POS, queue, and admin routes with their own authorization/layouts.
- PostgreSQL is the transactional source of truth.
- Local/self-hosted image storage holds product images; the database stores metadata and references.
- Caddy or Nginx terminates HTTPS and proxies web, API, and WebSocket traffic.
- Redis and background jobs are not required for the first single-instance deployment.

Recommended monorepo shape:

```text
apps/
  api/          # Fastify modular monolith
  web/          # Next.js menu, POS, Staff preparation queue, manager admin
packages/
  contracts/    # Zod DTO schemas and API types
  config/       # shared lint, TypeScript, test configuration
  ui/           # add only when reuse exists
```

Backend and API rules:

- Do not expose Prisma models as API contracts. API DTO schemas are public contracts; persistence models stay internal to the backend.
- Use feature modules such as `orders`, `catalog`, `payments`, and `identity` with route/controller/service/repository/schema boundaries.
- Use versioned REST endpoints under `/api/v1` and named commands for business actions, such as `record-payment` and `delete-order`.
- Use consistent pagination, filtering, sorting, error codes, and request IDs.
- Require idempotency keys for order creation and payment registration.
- Return a conflict response for stale order versions; do not use silent last-write-wins behavior.

Frontend and operational UX:

- Use React, Next.js, TypeScript, Tailwind CSS, TanStack Query, React Hook Form, and Zod.
- Use Zustand only for small transient state such as an unsaved POS draft. Persisted business truth remains on the server.
- The digital menu is mobile-first, browse-only, and displays final Toman prices and current availability.
- The POS shows connection state, stale-data conflicts, pending/paid/deleted state, payment totals, and the actor responsible for privileged actions.
- The Staff preparation queue is a focused list of pending work and does not expose payment details.
- Browser printing is the v1 receipt boundary. Validate the actual café printer and paper size before pilot.

Authentication, authorization, and security:

- Staff and Manager use short-lived access tokens with rotated, revocable refresh sessions. Store refresh tokens hashed at rest.
- Use secure HTTP-only cookies where the deployment origin permits, with CSRF protection through SameSite policy, origin checks, and a CSRF token when needed.
- Bootstrap the first Manager as a one-time deployment procedure, never as a permanent public registration route.
- Enforce Manager-only catalog, user, settings, full-report, and full-audit operations server-side.
- Require HTTPS, security headers, least-privilege database credentials, secret management, request-size limits, rate-limited login, and safe logging.
- QR menu URLs are public read-only URLs in v1. They do not grant table, order, or payment authority.
- Uploaded images are type-checked, size-limited, renamed, and never executed.

Reporting and audit:

- Initial reports include daily, weekly, and monthly sales; order count; average order value; sales by payment method, channel, hour, category, and product; discounts; payment corrections; deleted orders; and table turnover when table timestamps are complete.
- Report boundaries use `Asia/Tehran`, while stored timestamps remain UTC.
- Report definitions explicitly distinguish item totals, discounts, paid amount, corrected/reversed amount, and deleted orders. There are no tax or service-charge fields.
- Initial reports query transactional tables and are verified against known fixtures. Add indexes based on measured query plans.
- Exports and large ranges are bounded so reporting cannot degrade POS work.

## Technology Baseline

| Concern              | Choice                                                 | Boundary                                                                               |
| -------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Language/runtime     | TypeScript on current Active LTS Node.js               | Strict compiler settings; runtime pinned in repository.                                |
| Backend              | Fastify                                                | Plugin-oriented HTTP/WebSocket host with structured logging and validated contracts.   |
| Validation/contracts | Zod plus generated OpenAPI                             | Runtime validation at boundaries; ORM types remain internal.                           |
| Database             | PostgreSQL                                             | Authoritative transactions, constraints, reporting, and concurrency control.           |
| Database toolkit     | Prisma                                                 | Migrations and normal data access; repositories; parameterized raw SQL when justified. |
| Frontend             | React, Next.js, Tailwind CSS                           | One web deployment with separate menu, POS, Staff preparation, and Manager routes.     |
| Client data          | TanStack Query, React Hook Form, Zod, optional Zustand | Server state is not duplicated in a global client store.                               |
| Testing              | Vitest plus browser E2E tooling                        | Real PostgreSQL integration tests and a small critical browser suite.                  |
| Storage              | Self-hosted image storage                              | Product images only; PostgreSQL stores metadata and references.                        |
| Operations           | Docker Compose and Caddy or Nginx                      | Single VPS/app instance initially; Redis/job queue only after measured need.           |

## Final Objective

The first release should be a trustworthy staff-operated café system, not merely a large codebase. It succeeds when the café can use it under real conditions and its order, payment, and operational history remain correct after retries, concurrent edits, price changes, logical deletion, deployments, and restores.

The guiding principle is simple: finish and verify the authoritative backend first, build each interface against its stable contract, and expand only after the existing production path is correct.
