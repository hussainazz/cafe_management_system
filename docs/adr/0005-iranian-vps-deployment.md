# ADR 0005: Deploy On One Iranian VPS

## Status

Accepted

## Context

The v1 system serves one cafe and one branch. Production operation must not depend on foreign runtime services, foreign CDNs, external authentication, Vercel, Google Fonts, or foreign object storage.

The cafe needs one authoritative writable application and database stack.

## Decision

Deploy one self-hosted authoritative stack on an Iranian VPS.

Use Docker Compose for the production baseline. Run Next.js, Fastify, PostgreSQL, and self-hosted image storage behind Caddy or Nginx for HTTPS and WebSocket proxying.

Do not add an Iranian CDN by default. Measure after VPS deployment and add a CDN only if real production measurements show a need.

## Consequences

- The system can remain reachable during loss of international connectivity when domestic internet and VPS/DNS access still work.
- If the cafe's own internet connection fails, v1 cannot create authoritative orders and needs a manual fallback procedure.
- Backups, restore drills, rollback or forward-fix plans, log rotation, alerts, and production secrets are required before pilot.
- Dual writable local/cloud operation is out of scope for v1.
