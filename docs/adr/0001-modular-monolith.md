# ADR 0001: Use A Modular Monolith

## Status

Accepted

## Context

The v1 product serves one cafe and one branch with four user-facing surfaces: digital menu, Staff POS, Manager administration, and Staff preparation queue. These surfaces share one backend, one PostgreSQL database, and one set of business rules.

The system must prioritize correct order, payment, price, audit, and table behavior before adding operational complexity.

## Decision

Build the backend as a Fastify modular monolith.

Keep domain boundaries explicit through feature modules such as identity, catalog, ordering, tables, preparation, payments, reporting, and operations. Deploy one API process that owns business rules, persistence, authentication, OpenAPI, and WebSocket notifications.

## Consequences

- Cross-module workflows can use local transactions without distributed coordination.
- One developer can maintain and deploy the system with less operational overhead.
- Module boundaries still need discipline in code review because deployment boundaries do not enforce them.
- Microservices or separate writable services are out of scope for v1 unless a future ADR replaces this decision.
