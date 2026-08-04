# ADR 0007: Keep QR Menu Browse-Only In V1

## Status

Accepted

## Context

Customers can scan QR codes and browse the current menu, but v1 prioritizes reliable Staff-created POS orders, payment recording, historical price snapshots, deletion audit, and reporting.

Customer self-ordering would require additional public security, table validation, rate limiting, idempotency, order state rules, and Staff confirmation workflows.

## Decision

The v1 QR menu is browse-only.

Public menu endpoints and UI may expose categories, products, options, availability, images, and final Toman prices. They must not expose cart submission, order creation, payment, tracking, table authority, or Staff-only metadata.

## Consequences

- Staff-created POS orders remain the only authoritative v1 order path.
- Public menu work can proceed without introducing customer order state or public write endpoints.
- Future customer ordering requires a new ADR and state model before implementation.
- QR menu API tests must verify public response safety and absence of order-submission capability.
