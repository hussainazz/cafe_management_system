# Initial Entity Relationship Diagram

## Purpose And Status

This is the initial v1 persistence model. It translates the approved scope into
entity ownership and relationships before the Stage 1 Prisma schema and first
migration are created. It is not itself a database migration or an API contract.

All timestamps are stored in UTC. Every monetary field is an integer Toman
value. The separate database-constraint list will define the exact PostgreSQL
constraints and indexes for this model.

## Mermaid ERD

```mermaid
erDiagram
    User {
        uuid id PK
        string passwordHash
        enum role
        boolean isActive
        datetime createdAt
        datetime updatedAt
    }

    RefreshSession {
        uuid id PK
        uuid userId FK
        string tokenHash
        datetime expiresAt
        datetime revokedAt
        datetime createdAt
    }

    AuthEvent {
        uuid id PK
        uuid userId FK
        string eventType
        string requestId
        datetime occurredAt
    }

    Category {
        uuid id PK
        string name
        integer displayOrder
        boolean isActive
        datetime archivedAt
    }

    Product {
        uuid id PK
        uuid categoryId FK
        string name
        integer priceAmount
        integer displayOrder
        boolean isActive
        boolean isAvailable
        datetime archivedAt
    }

    ProductImage {
        uuid id PK
        uuid productId FK "unique"
        string storageKey
        string altText
    }

    OptionGroup {
        uuid id PK
        string name
        boolean isActive
    }

    ProductOptionGroup {
        uuid productId FK
        uuid optionGroupId FK
        integer displayOrder
    }

    Option {
        uuid id PK
        uuid optionGroupId FK
        string name
        integer priceAmount
        boolean isActive
        boolean isAvailable
        integer displayOrder
        datetime archivedAt
    }

    CafeTable {
        uuid id PK
        string name
        integer displayOrder
        boolean isActive
        datetime archivedAt
    }

    Order {
        uuid id PK
        string orderNumber
        uuid tableId FK
        uuid createdById FK
        enum channel
        enum state
        enum paymentStatus
        integer version
        enum discountKind
        integer discountValue
        integer discountAmount
        string discountReason
        integer subtotalAmount
        integer totalAmount
        integer paidAmount
        integer balanceAmount
        uuid deletedById FK
        datetime deletedAt
        string deletionReason
        datetime createdAt
        datetime updatedAt
    }

    OrderItem {
        uuid id PK
        uuid orderId FK
        uuid productId FK
        string productNameSnapshot
        integer basePriceSnapshot
        integer quantity
        string note
        integer discountAmount
        integer lineTotalAmount
        integer displayOrder
    }

    OrderItemOption {
        uuid id PK
        uuid orderItemId FK
        uuid optionId FK
        string optionNameSnapshot
        integer priceSnapshot
        integer quantity
    }

    PaymentSettlement {
        uuid id PK
        uuid orderId FK
        uuid recordedById FK
        string idempotencyKey
        integer totalAmount
        datetime recordedAt
    }

    SettlementAllocation {
        uuid id PK
        uuid settlementId FK
        uuid orderItemId FK
        integer quantity
        integer amount
    }

    Payment {
        uuid id PK
        uuid settlementId FK
        enum method
        integer amount
        string reference
        datetime recordedAt
    }

    SettlementReversal {
        uuid id PK
        uuid settlementId FK
        uuid recordedById FK
        string reason
        datetime recordedAt
    }

    IdempotencyRecord {
        uuid id PK
        uuid actorId FK
        string operation
        string key
        string requestFingerprint
        integer responseStatus
        json resultSnapshot
        datetime expiresAt
        datetime createdAt
    }

    AuditLog {
        uuid id PK
        uuid actorId FK
        string requestId
        string operation
        string entityType
        uuid entityId
        json beforeSnapshot
        json afterSnapshot
        string reason
        datetime occurredAt
    }

    CafeSettings {
        uuid id PK
        uuid updatedById FK
        datetime updatedAt
    }

    User ||--o{ RefreshSession : owns
    User ||--o{ AuthEvent : produces
    Category ||--o{ Product : groups
    Product ||--o| ProductImage : has
    Product ||--o{ ProductOptionGroup : enables
    OptionGroup ||--o{ ProductOptionGroup : applies_to
    OptionGroup ||--o{ Option : contains
    CafeTable |o--o{ Order : assigned_to
    User ||--o{ Order : creates
    Order ||--|{ OrderItem : contains
    Product ||--o{ OrderItem : referenced_by
    OrderItem ||--o{ OrderItemOption : snapshots
    Option ||--o{ OrderItemOption : referenced_by
    Order ||--o{ PaymentSettlement : has
    User ||--o{ PaymentSettlement : records
    PaymentSettlement ||--|{ SettlementAllocation : allocates
    OrderItem ||--o{ SettlementAllocation : settled_by
    PaymentSettlement ||--|{ Payment : contains
    PaymentSettlement ||--o| SettlementReversal : reversed_by
    User ||--o{ SettlementReversal : records
    User ||--o{ IdempotencyRecord : submits
    User ||--o{ AuditLog : acts_in
    User ||--o{ CafeSettings : updates
```

## How To Read The Diagram

An entity box represents one database table. Each line inside it is a field
(often called a column). One saved record is a row in that table: for example,
one row in `Product` represents one menu product, while one row in `OrderItem`
represents one line on one customer order.

| Diagram notation | Meaning                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id PK`          | **Primary key**. A stable identifier for one row. UUIDs let the application create identifiers safely without relying on a visible sequential number.                                                                  |
| `...Id FK`       | **Foreign key**. A stored link to another table's `id`, such as `PaymentSettlement.orderId` linking a settlement to the order it settles. The exact referential rules are intentionally deferred to the database-constraints task. |
| `enum`           | A value chosen from a small, controlled set. Examples are the two user roles and the three order states. This prevents spelling variants from becoming data.                                                           |
| `boolean`        | A true/false value, usually for whether something can currently be used or shown.                                                                                                                                      |
| `datetime`       | A time stored in UTC. The application converts it to `Asia/Tehran` only when displaying it or calculating report boundaries.                                                                                           |
| `json`           | Structured supporting data stored as one value. Here it is limited to safe audit snapshots and idempotency response snapshots, rather than core relational data.                                                       |
| `                |                                                                                                                                                                                                                        | --o{`                                                                                                                                                                                                           | One record on the left can relate to zero or more records on the right. For example, one order contains one or more order items. |
| `o               | --o{`                                                                                                                                                                                                                  | The right-side record can have zero or one left-side record, while the left-side record can relate to many right-side records. A takeaway order therefore has no table, but a table has many historical orders. |

The ERD intentionally shows the planned business model, not the final Prisma
syntax. Whether a field is nullable, unique, indexed, or constrained is
specified in the next Stage 0 task rather than implied only by the diagram.

## Field Guide

### Identity

#### User

| Field          | Explanation                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of a Manager or Staff user. Other records use it to record who performed an action.                     |
| `passwordHash` | A one-way password hash, never the password itself. It is needed to verify sign-in securely.                              |
| `role`         | The user's controlled permission level: `MANAGER` or `STAFF`. Application authorization checks this server-side.          |
| `isActive`     | Whether this account may currently sign in and act. Deactivation preserves history instead of deleting a referenced user. |
| `createdAt`    | When the account was created.                                                                                             |
| `updatedAt`    | When an account property was most recently changed.                                                                       |

#### RefreshSession

| Field       | Explanation                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `id`        | Internal identity of one sign-in session.                                                                                             |
| `userId`    | Link to the user who owns the session.                                                                                                |
| `tokenHash` | One-way hash of the refresh token. Storing a hash allows revocation without retaining a usable token in the database.                 |
| `expiresAt` | The latest time this session can be used to obtain a fresh access token.                                                              |
| `revokedAt` | When the session was invalidated, for logout, account deactivation, or suspected compromise. It is empty while the session is active. |
| `createdAt` | When the session was issued.                                                                                                          |

#### AuthEvent

| Field        | Explanation                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `id`         | Internal identity of an authentication event.                                                               |
| `userId`     | Link to the affected user when one is known.                                                                |
| `eventType`  | The kind of event, such as successful sign-in, failed sign-in, logout, or session revocation.               |
| `requestId`  | Correlation identifier shared with the API request logs, so an operator can investigate one request safely. |
| `occurredAt` | When the event happened.                                                                                    |

### Catalog

#### Category

| Field          | Explanation                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of a menu category.                                                                                 |
| `name`         | Staff-facing and customer-facing category name, such as `Coffee` or `Desserts`.                                       |
| `displayOrder` | The intended order when categories are shown in the menu or POS. It avoids using creation time as presentation order. |
| `isActive`     | Whether the category is currently shown for normal catalog use.                                                       |
| `archivedAt`   | When the category was retired. It remains stored when historic products reference it.                                 |

#### Product

| Field          | Explanation                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`           | Internal identity of a catalog product.                                                                            |
| `categoryId`   | Link to the category used to group the product.                                                                    |
| `name`         | Current catalog name, used for current menu and POS display.                                                       |
| `priceAmount`  | Current finished customer price in integer Toman. This is not used to recalculate old orders.                      |
| `displayOrder` | Display order inside its category.                                                                                 |
| `isActive`     | Whether the product is part of the active catalog.                                                                 |
| `isAvailable`  | Temporary sellability switch. A product can stay active but be unavailable today without losing its configuration. |
| `archivedAt`   | When the product was retired. It remains available for historical traceability.                                    |

#### ProductImage

| Field          | Explanation                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of one image record.                                                                                             |
| `productId`    | Unique link to the product the image illustrates. A v1 product can have at most one current image.                                  |
| `storageKey`   | The safe identifier or path used to find the file in self-hosted image storage. The database stores metadata, not the image bytes. |
| `altText`      | Text alternative for accessibility and a useful fallback when an image cannot load.                                                |

#### OptionGroup And ProductOptionGroup

| Field                              | Explanation                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `OptionGroup.id`                   | Internal identity of a reusable choice group, such as `Milk choice` or `Extra shots`.                                                   |
| `OptionGroup.name`                 | Current label staff and customers see for that group.                                                                                   |
| `OptionGroup.isActive`             | Whether the group can currently be selected for catalog configuration.                                                                  |
| `ProductOptionGroup.productId`     | Link to a product that permits this group.                                                                                              |
| `ProductOptionGroup.optionGroupId` | Link to the reusable group enabled for that product. This join record models a many-to-many relationship without duplicating the group. |
| `ProductOptionGroup.displayOrder`  | The order in which this choice group appears for that particular product.                                                               |

#### Option

| Field           | Explanation                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| `id`            | Internal identity of one selectable choice within an option group.                                       |
| `optionGroupId` | Link to the group that contains this option.                                                             |
| `name`          | Current label, such as `Oat milk` or `Extra shot`.                                                       |
| `priceAmount`   | Current extra price in integer Toman. It may be zero. Historical orders use the option snapshot instead. |
| `isActive`      | Whether the option is still part of the catalog configuration.                                           |
| `isAvailable`   | Temporary availability switch for a currently active option.                                             |
| `displayOrder`  | Presentation order within the group.                                                                     |
| `archivedAt`    | When the option was retired while keeping historical references.                                         |

### Tables And Orders

#### CafeTable

| Field          | Explanation                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of a physical table in the one café.                                       |
| `name`         | Human-friendly table label, such as `Table 4`; it does not need to expose the internal UUID. |
| `displayOrder` | The order used to lay out tables in the POS.                                                 |
| `isActive`     | Whether staff may assign new orders to the table.                                            |
| `archivedAt`   | When the table was retired while keeping its historical orders.                              |

#### Order

| Field            | Explanation                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Internal identity of the order. APIs and related records use this rather than the visible order number.                                                                         |
| `orderNumber`    | Stable, human-readable number used by the POS, bar ticket, and customer receipt. Browser printing does not need a separate printed identifier or printer-job table.                 |
| `tableId`        | Optional link to the assigned table. It is empty for a takeaway order.                                                                                                          |
| `createdById`    | Link to the logged-in Staff or Manager who created the order.                                                                                                                   |
| `channel`        | Controlled order origin: `TABLE` or `TAKEAWAY` in v1.                                                                                                                           |
| `state`          | Current lifecycle state: `OPEN` or `DELETED`. It is distinct from payment status and is not a physical database deletion flag.                                                  |
| `paymentStatus`  | Current payment state: `UNPAID`, `PARTIALLY_PAID`, or `PAID`, derived from active settlement allocations and persisted for POS reads.                                           |
| `version`        | A revision number that increments on an accepted edit or settlement change. The POS supplies the version it last saw, allowing the server to reject stale writes.              |
| `discountKind`   | Whether the one permitted order-level discount is fixed Toman or a percentage. It is empty when no discount is applied.                                                         |
| `discountValue`  | The value originally entered for the discount: either a Toman amount or a percentage, depending on `discountKind`.                                                              |
| `discountAmount` | The final calculated Toman value deducted from the order. Storing it avoids changing history if calculation rules later change.                                                 |
| `discountReason` | Optionally The required business explanation for a discount.                                                                                                                    |
| `subtotalAmount` | Sum of order-item totals before the order-level discount, in Toman.                                                                                                             |
| `totalAmount`    | Final amount due after the discount, in Toman. There are no tax or service-charge additions in v1.                                                                              |
| `paidAmount`     | Total across active settlements, in Toman. It supports selected-item settlement, split tender, quick reads, and report calculations.                                           |
| `balanceAmount`  | Amount still due after active settlements, in Toman. It is derived by the server, not trusted from the POS.                                                                    |
| `deletedById`    | Link to the user who logically deleted the order. It is empty until deletion.                                                                                                   |
| `deletedAt`      | When logical deletion happened. The row, its items, settlements, tenders, and reversals remain stored.                                                                         |
| `deletionReason` | Optional explanation provided on deletion. The scope explicitly does not require one.                                                                                           |
| `createdAt`      | When the order was first committed.                                                                                                                                               |
| `updatedAt`      | When an allowed order field was last changed.                                                                                                                                   |

#### OrderItem

| Field                 | Explanation                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                  | Internal identity of one line on an order.                                                                 |
| `orderId`             | Link to the order containing this line.                                                                    |
| `productId`           | Link to the product selected at the time of sale, retained for traceability.                               |
| `productNameSnapshot` | Product name copied into the order at sale time. A later product rename must not rewrite an old bar ticket or customer receipt. |
| `basePriceSnapshot`   | Product base price copied at sale time in integer Toman. A later price change must not alter history.      |
| `quantity`            | Number of units of this configured product line.                                                           |
| `note`                | Optional staff instruction for the order. It is not a catalog definition.                                   |
| `discountAmount`      | Portion of the order-level discount allocated to this line for correct historical totals and item reports. |
| `lineTotalAmount`     | Final total for this line, including quantity, selected options, and allocated discount.                   |
| `displayOrder`        | The order in which the line was entered and should appear on the POS, bar ticket, and customer receipt.     |

#### OrderItemOption

| Field                | Explanation                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `id`                 | Internal identity of one selected option on an order line.                                                         |
| `orderItemId`        | Link to the order item receiving this option.                                                                      |
| `optionId`           | Link to the catalog option selected at sale time, retained for traceability.                                       |
| `optionNameSnapshot` | Option name copied at sale time so catalog renames do not alter old bar tickets or customer receipts.                         |
| `priceSnapshot`      | Extra option price copied at sale time in integer Toman.                                                           |
| `quantity`           | Number of times this option applies to the parent line, allowing a future-safe representation of repeated add-ons. |

### Payments, Reliability, And Audit

#### PaymentSettlement

| Field            | Explanation                                                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Internal identity of one payer checkout. It does not identify or create a customer account.                                                         |
| `orderId`        | Link to the order containing the item quantities being settled.                                                                                      |
| `recordedById`   | Link to the Staff or Manager who recorded the settlement.                                                                                             |
| `idempotencyKey` | Client-provided retry key for the whole settlement command. Retrying it returns the original result without creating duplicate tenders or allocations. |
| `totalAmount`    | Server-calculated Toman total of the allocated item quantities. It equals the sum of this settlement's tenders.                                       |
| `recordedAt`     | When the settlement was committed.                                                                                                                    |

#### SettlementAllocation

| Field          | Explanation                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of one selected order-item quantity in a settlement.                                                                                       |
| `settlementId` | Link to the payer checkout that settles the quantity.                                                                                                        |
| `orderItemId`  | Link to the immutable order-item snapshot being settled.                                                                                                    |
| `quantity`     | Positive selected quantity from the order item. Active allocations across settlements cannot exceed the order-item quantity.                               |
| `amount`       | Server-calculated Toman amount for this selected quantity, including deterministic discount allocation. It is retained for historical reconciliation.       |

#### Payment

| Field          | Explanation                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of one posted tender record.                                                                                                 |
| `settlementId` | Link to the settlement this tender contributes to. A settlement can contain multiple tenders for split payment.                               |
| `method`       | Controlled method: `CASH`, `CARD_TERMINAL`, or `CARD_TRANSFER`.                                                                               |
| `amount`       | Positive Toman amount of this tender. Tenders in a settlement sum exactly to its `totalAmount`.                                               |
| `reference`    | Required reconciliation reference for `CARD_TRANSFER`; optional terminal reference for `CARD_TERMINAL`; empty for cash.                        |
| `recordedAt`   | When the tender was committed.                                                                                                                  |

#### SettlementReversal

| Field          | Explanation                                                                                               |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `id`           | Internal identity of one full-settlement reversal.                                                        |
| `settlementId` | Link to the posted settlement being reversed. One settlement can be reversed at most once.                |
| `recordedById` | Link to the Manager who performed the reversal.                                                           |
| `reason`       | Required explanation for the reversal, supporting audit and reconciliation.                               |
| `recordedAt`   | When the reversal was committed.                                                                           |

#### IdempotencyRecord

| Field                | Explanation                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | Internal identity of the retry-protection record.                                                                               |
| `actorId`            | Link to the authenticated user or session owner that submitted the operation. A key is therefore not reusable by another actor. |
| `operation`          | The protected business action, such as creating an order or recording a settlement.                                             |
| `key`                | Opaque client-generated retry key sent with the original request and any retry.                                                 |
| `requestFingerprint` | Safe digest of the important request content. It detects reuse of the same key for a different operation payload.               |
| `responseStatus`     | HTTP status returned for the original successful or handled result, so a retry can receive the same outcome.                    |
| `resultSnapshot`     | Safe response data saved for replay to a retry. It must not contain credentials or secrets.                                     |
| `expiresAt`          | When this retry record can be safely discarded under the retention policy.                                                      |
| `createdAt`          | When the protected request was first accepted.                                                                                  |

#### AuditLog

| Field            | Explanation                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | Internal identity of one audit entry.                                                                                                                           |
| `actorId`        | Link to the user who performed the action, when there is one.                                                                                                   |
| `requestId`      | Correlation identifier shared with API logs and related writes from the same request.                                                                           |
| `operation`      | Business action that occurred, such as order deletion, settlement recording, or catalog change.                                                                  |
| `entityType`     | Name of the affected kind of record, such as `Order` or `Product`.                                                                                              |
| `entityId`       | Identifier of the specific affected record. Together with `entityType`, this makes the log generic without forcing every business table to store audit columns. |
| `beforeSnapshot` | Safe, limited representation of relevant values before the action. It deliberately excludes passwords, tokens, cookies, and unnecessary personal data.          |
| `afterSnapshot`  | Safe, limited representation of relevant values after the action.                                                                                               |
| `reason`         | Optional or required business reason, depending on the action. It is preserved with the audit event.                                                            |
| `occurredAt`     | When the auditable action happened.                                                                                                                             |

#### CafeSettings

| Field               | Explanation                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`                | Internal identity of the one-cafe settings record. It still has an identifier so it can be updated and audited consistently. |
| `updatedById`       | Link to the Manager who last changed the settings.                                                                           |
| `updatedAt`         | When the settings were most recently changed.                                                                                |

## Relationship Notes

| Area          | Model decision                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity      | A `User` has zero or more revocable `RefreshSession` and `AuthEvent` records. Roles remain limited to `MANAGER` and `STAFF`.                                                                                      |
| Catalog       | A `Category` groups products. Every v1 product goes to the single bar; it can have zero or one image and many option groups through `ProductOptionGroup`.                                                         |
| Tables        | A table order references one `CafeTable`; a takeaway order has no table. A table can have many historical orders.                                                                                                 |
| Order history | `OrderItem` and `OrderItemOption` retain product and option names and prices as snapshots. Catalog references support traceability, but historical display and totals use the snapshots.                          |
| Payments      | An order has payer settlements. Each settlement allocates selected item quantities and contains one or more cash, card-terminal, or card-to-card transfer tenders. A Manager reversal applies to the whole settlement; posted records are retained rather than edited or removed. |
| Receipts      | A concise bar ticket is derived from `Order`, `CafeTable`, `OrderItem`, and `OrderItemOption`; it contains only the order number, local display time, table/takeaway context, quantities, item/option snapshots, and notes. A detailed customer receipt is derived from the same snapshots and, where applicable, `PaymentSettlement`, `SettlementAllocation`, and `Payment` data. Neither variant requires a persisted receipt or printer-job entity in v1. |
| Idempotency   | `IdempotencyRecord` stores the actor, operation, key, request fingerprint, and replayable result for order creation and settlement recording. It is not a customer-facing concept.                             |
| Audit         | `AuditLog` is a generic immutable activity record. `entityType` and `entityId` identify the affected record without coupling every domain table to a separate audit foreign key.                                  |
| Operations    | `CafeSettings` is the single-cafe settings record. Reports use `Asia/Tehran` calendar boundaries directly; v1 has no configurable business-day cutoff because the cafe is always open.                         |

## Lifecycle And Scope Boundaries

- `Order` is created by a logged-in user with state `OPEN` and payment status `UNPAID`. Active settlement allocations determine `UNPAID`, `PARTIALLY_PAID`, or `PAID`; only the lifecycle state transitions to `DELETED`. `DELETED` is logical deletion, so the order, items, settlements, tenders, reversals, and audit trail remain available.
- Products, categories, options, users, and tables are archived or deactivated when historical records reference them. Historical records are never rebuilt from current catalog data.
- A bar ticket is browser-rendered from the order and immutable item snapshots. It prints only the order number, `Asia/Tehran` display time, table/takeaway context, item quantities, selected options, and notes; it excludes prices, discounts, totals, and payment data. A customer receipt is a detailed financial printout: a whole-order version uses the order, snapshots, and active settlement data, while a settlement version shows that payer checkout's selected quantities and tenders. The stable `orderNumber` is printed on every variant; no separate receipt or printer-job table is required in v1.
- There are no entities for customer accounts, carts, customer order submission, inventory, recipes, reservations, multi-branch ownership, kitchen or product-to-station routing, online payments, taxes, or service charges.

## Implementation Boundary

The existing Stage 1 Prisma schema intentionally contains only the bootstrap
`User` model. This ERD is the approved target model for the first database
implementation; field names and normalization can be adjusted during migration
design only when they preserve the scope rules and this relationship model.
