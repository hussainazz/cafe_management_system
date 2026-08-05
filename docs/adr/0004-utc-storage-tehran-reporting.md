# ADR 0004: Store UTC And Report In Asia/Tehran

## Status

Accepted

## Context

The application is used by a cafe operating in Iran. Operational screens, receipts, and reports need local Tehran time, while persisted timestamps must remain consistent and unambiguous.

## Decision

Store timestamps in UTC. Display timestamps and calculate reports using
`Asia/Tehran` calendar boundaries.

The cafe is always open, so v1 does not define a configurable business-day
cutoff.

## Consequences

- Stored timestamps remain consistent across server, database, backups, and logs.
- User-facing times and sales reports match the cafe's local operating context.
- Report queries must apply `Asia/Tehran` calendar boundaries intentionally.
- There is no late-night business-day rollover setting in v1.
