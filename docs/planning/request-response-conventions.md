# Request And Response Conventions

## Purpose And Status

This document is the Stage 0 contract for v1 HTTP request, response, error,
pagination, idempotency, and concurrency behavior. It applies to application
endpoints in `api-inventory.md`. Each implemented endpoint must express this
contract through validated request/response schemas and generated OpenAPI.

The current health endpoints are operational checks. They retain their small
plain-object responses and are not a precedent for application resource APIs.

## Shared HTTP Rules

- Application endpoints use the `/api/v1` prefix. `/documentation` and health
  endpoints are internal operational endpoints.
- Application request and response bodies use JSON unless an endpoint is
  explicitly documented as an upload, image-serving, or download endpoint.
- API timestamps are UTC ISO 8601 strings, for example
  `2026-08-06T09:30:00.000Z`. DTO fields explicitly named as display times in
  receipts, bar tickets, and reports may use `Asia/Tehran` presentation values.
- Monetary values are integer Tomans. Monetary field names end in `Amount`;
  floating-point money values are never accepted or returned.
- Resource IDs are opaque UUID strings. `orderNumber` is a separate,
  human-facing stable identifier and is never substituted for an order ID.
- Responses use purpose-built DTOs. Prisma models, credential material,
  session secrets, password hashes, and internal storage references are never
  exposed.
- Request schemas reject unknown fields. An omitted optional field means "do
  not change/not supplied"; `null` is accepted only where the endpoint schema
  explicitly permits clearing a value.

### Request IDs

Clients may provide one `X-Request-Id` header matching
`[A-Za-z0-9._:-]{8,128}`. The API generates a UUID when the header is absent
or invalid. The effective ID is returned in `X-Request-Id`, included in error
responses, and attached to application logs and audit records.

### Authentication And Caching

- Public QR-menu reads are anonymous and read-only. All other application
  routes require an authenticated Staff or Manager session unless the API
  inventory says otherwise.
- Missing, invalid, or expired authentication returns `401`; an authenticated
  user without the required role returns `403`.
- Authenticated and mutating responses use `Cache-Control: no-store`.
  Public-menu caching may be introduced only with an explicitly documented
  policy that cannot expose staff metadata or stale availability unexpectedly.

## Response Shapes

Successful application responses use these envelopes:

```json
{
  "data": {},
  "meta": { "requestId": "req_7R8HkqW2" }
}
```

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  },
  "meta": { "requestId": "req_7R8HkqW2" }
}
```

Create routes return `201` with the created resource DTO. Updates and command
routes return `200` with the resulting resource or command-result DTO. `204`
is reserved for deliberately bodyless actions such as a future logout route;
otherwise the response includes the standard envelope. A replayed idempotent
request returns the originally stored response status and body plus
`Idempotency-Replayed: true`.

Every mutable, versioned resource DTO includes its current integer `version`.

## Errors

Errors use one safe, stable envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "details": [
      {
        "path": "items[0].quantity",
        "code": "too_small",
        "message": "Must be at least 1."
      }
    ],
    "requestId": "req_7R8HkqW2",
    "timestamp": "2026-08-06T09:30:00.000Z"
  }
}
```

`details` is optional and only contains safe field-level validation or business
rule information. It never includes raw validator internals, stack traces,
tokens, credentials, or database error text.

| Status | Stable codes                                                                                                        | Use                                                               |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `400`  | `BAD_REQUEST`, `VALIDATION_ERROR`                                                                                   | Malformed JSON, invalid parameters, or schema validation failure. |
| `401`  | `AUTHENTICATION_REQUIRED`, `SESSION_EXPIRED`                                                                        | No valid application session.                                     |
| `403`  | `FORBIDDEN`                                                                                                         | Valid session lacks the required permission.                      |
| `404`  | `NOT_FOUND`                                                                                                         | Resource does not exist or is not visible to the caller.          |
| `409`  | `CONFLICT`, `STALE_VERSION`, `INVALID_STATE`, `IDEMPOTENCY_CONFLICT`, `IDEMPOTENCY_IN_PROGRESS`                     | Current state prevents the requested operation.                   |
| `422`  | `BUSINESS_RULE_VIOLATION`, `UNAVAILABLE_PRODUCT`, `SETTLEMENT_ALLOCATION_CONFLICT`, `PAYMENT_RECONCILIATION_FAILED` | Request is structurally valid but violates a domain rule.         |
| `429`  | `RATE_LIMITED`                                                                                                      | Rate limit reached.                                               |
| `500`  | `INTERNAL_ERROR`                                                                                                    | Unexpected server failure.                                        |
| `503`  | `SERVICE_UNAVAILABLE`                                                                                               | Required dependency is unavailable.                               |

## Lists, Filters, And Sorting

Collection endpoints use cursor pagination. They accept `limit` and optional
opaque `cursor`; the default limit is `50` and the maximum is `100` unless an
endpoint documents a stricter report/export bound. Responses include `page`
with `limit`, `nextCursor`, and `hasMore`.

Each list has a documented, stable default order. Optional sorting uses a
whitelisted `sort` query value such as `createdAt:desc`; ties are resolved by
`id` so a cursor cannot skip or duplicate records. Clients must not construct
or interpret cursors.

Filters are explicit query parameters, not ad hoc filter expressions. Common
examples are `state`, `paymentStatus`, `channel`, `tableId`, `from`, `to`,
`q`, `includeInactive`, and `includeDeleted`. `from` and `to` are UTC ISO 8601
timestamps. Report endpoints may instead accept explicitly named local
calendar parameters such as `fromDate`, `toDate`, or `period`, interpreted in
`Asia/Tehran` and returned with their resolved UTC range in response metadata.

## Idempotency

`POST /api/v1/orders` and
`POST /api/v1/orders/:orderId/record-settlement` require an
`Idempotency-Key` header. Other endpoints accept it only when their inventory
entry explicitly adds that requirement.

Keys must match `[A-Za-z0-9._:-]{16,128}`. The server scopes a key to the
authenticated actor and operation, stores a request fingerprint and completed
response snapshot, and retains it for at least 24 hours. The persistence shape
and uniqueness constraint are defined in `database-constraints.md`.

- A repeated key with the same fingerprint performs no duplicate write and
  returns the stored status/body with `Idempotency-Replayed: true`.
- A repeated key with a different fingerprint returns `409`
  `IDEMPOTENCY_CONFLICT`.
- A duplicate request while the original is still executing returns `409`
  `IDEMPOTENCY_IN_PROGRESS`; clients may retry with the same key.

Idempotency protects retry safety. It does not replace the order-version check
required for changes to an existing order.

## Concurrency And State Changes

Orders and other mutable resources that expose `version` use optimistic
concurrency. Their writes include an integer `expectedVersion` in the JSON
body. The server performs a compare-and-swap update in the transaction and
increments `version` on every accepted mutation.

When the supplied version is stale, the API returns `409` `STALE_VERSION` with
the current version in safe error details; it does not silently overwrite newer
data. Reads and successful write responses include the latest version so the
client can retry from current state. A domain state rule that forbids the
operation, such as editing order contents after the first settlement, returns
`409` `INVALID_STATE` even when the version matches.

Order creation has no prior version and relies on its required idempotency key.
Settlement recording requires both an idempotency key and `expectedVersion`.
All order, settlement, tender, allocation, state, version, idempotency, and
audit writes for one command commit atomically; realtime events are emitted
only after that commit.

Realtime events contain an `eventId`, `type`, `occurredAt`, `resource`, the
new resource `version` when applicable, and `requestId`. Events signal that a
client should reconcile from the API; they are not an alternate write channel
or a substitute for version checks.

## Schema And OpenAPI Requirements

Zod request and response DTO schemas are the implementation source of truth.
OpenAPI is generated from those schemas rather than hand-maintained separately.
Every implemented route defines success and expected error responses, request
headers/query/path/body schemas as applicable, and appears in both generated
OpenAPI and `api-inventory.md` in the same change.
