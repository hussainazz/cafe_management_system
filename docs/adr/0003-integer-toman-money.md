# ADR 0003: Store Money As Integer Toman

## Status

Accepted

## Context

The cafe operates with Toman prices. v1 has no tax, VAT, service charge, Rial conversion, online payment, or split payment behavior.

Order totals, discounts, payments, receipts, reports, and historical price snapshots must be exact and reproducible.

## Decision

Store every money amount as an integer count of Toman.

Do not use floating-point money values. Do not store Rial values. Catalog prices and option prices are final customer prices. The backend is the authority for all totals, discounts, paid amounts, and balances.

## Consequences

- Arithmetic is deterministic and avoids floating-point rounding defects.
- Receipt and report totals can be reconciled directly against stored values.
- Any future Rial conversion, tax, service charge, online payment, or split payment behavior requires a new decision and explicit tests.
- Database constraints should enforce non-negative prices and discounts where applicable.
