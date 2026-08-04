# ADR 0004: Store UTC And Report In Asia/Tehran

## Status

Accepted

## Context

The application is used by a cafe operating in Iran. Operational screens, receipts, and reports need local Tehran time, while persisted timestamps must remain consistent and unambiguous.

## Decision

Store timestamps in UTC. Display timestamps and calculate business-day reports in `Asia/Tehran`.

Define the cafe business-day cutoff before building reporting features that depend on business-day boundaries.

## Consequences

- Stored timestamps remain consistent across server, database, backups, and logs.
- User-facing times and sales reports match the cafe's local operating context.
- Report queries must apply `Asia/Tehran` boundaries intentionally.
- Late-night business-day behavior remains unresolved until the reporting phase defines the cutoff.
