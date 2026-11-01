# Parallel SvelteKit Menu Migration

**Status:** parallel scaffold initialized; migration and cutover are not approved
by this record.  
**Date:** 31 October 2026

## Repository architecture audit

- The monorepo uses pnpm 11, Node 24, and TypeScript 5.9 at the root. Workspace
  applications are under `apps/*`; contracts/config packages are under
  `packages/*`.
- `apps/web` is the existing Next.js public menu on port 3000. It loads the
  public menu server-side from Fastify and has same-origin routes for images,
  QR table-token exchange, table context, customer auth, and waiter calls.
- `apps/pos` is a separate Next.js POS on port 3002. It remains untouched.
- `apps/api` is the Fastify backend on port 3001. Its CORS registration uses
  `origin: false`. Public menu routes use the exported
  `PublicMenuResponseSchema` from `@cafe/contracts`; the backend remains the
  business and database authority.
- Public-menu product images are stored by API-owned storage key and served
  through the existing Next.js same-origin image proxy. The SvelteKit scaffold
  does not yet render images.
- The active production path documented in this repository is systemd/Nginx
  on the VPS. The repository also contains per-service Docker build files and
  GHCR workflows, but no generic production-build invocation was found in the
  active artifact release path.
- API table context uses an HttpOnly `cafe_table_context` cookie with
  `Path=/`, `SameSite=Lax`, production `Secure`, and no `Domain` attribute.
  Customer authentication uses a host-only `cafe_customer_auth` cookie. The
  existing Next.js routes forward request cookies and API `Set-Cookie` headers.

## Decision

Add `apps/menu-svelte` as an independent SvelteKit 3 application for local
development and future Vercel staging. Keep `apps/web`, `apps/pos`, and
`apps/api` in place. The new app consumes the current public-menu endpoint from
server-side load code and validates the response using the existing
framework-independent shared contract package.

Use an explicit `@sveltejs/adapter-vercel` build by default and allow a
build-time `SVELTEKIT_ADAPTER=node` selection for the official
`@sveltejs/adapter-node` output. Vercel-specific configuration remains in the
adapter selection and deployment settings, not in menu/API business logic.

## Rationale and boundaries

- Parallel development gives the new frontend an independent port, build,
  typecheck, test, and deployment target while keeping the production menu
  behavior unchanged.
- Reusing Fastify avoids duplicating public-menu business logic, database
  access, price/availability rules, and persistence.
- The POS is a distinct staff application; it has no role in the public-menu
  migration and is not modified by this scaffold.
- Workspace selectors isolate the staging build from the Next.js menu and
  POS. The normal recursive `pnpm build` remains the local/CI repository-wide
  build, while `build:production` selects API, current menu, POS, and their
  workspace dependencies without selecting SvelteKit.
- Shared API schemas stay in `packages/contracts`. Any DTO not exported there
  should be added as a framework-independent contract or validated in a small
  app adapter, not copied with separate business behavior.

## Authentication and cookie blocker

The current API sets table/customer cookies without a `Domain` attribute. If a
browser is on a Vercel deployment domain, an API response's host-only cookie
belongs to the VPS API host and will not become a Vercel cookie. Conversely,
the browser will not automatically send a Vercel host cookie to the VPS API.
SvelteKit server-side proxying can forward a cookie only if SvelteKit received
it from the browser; proxying alone does not create shared cookie scope.

Before migrating QR table context, customer authentication, waiter calls, or
mutations, decide and verify the staging/production origin arrangement, cookie
scope and attributes, `Set-Cookie` forwarding and clearing, CSRF/origin checks,
QR token exchange, and image proxy path. Keep CORS disabled for untrusted
origins. This scaffold makes no transactional request and must remain
browse-only until staging isolation and authorization boundaries are approved.

## Build and deployment isolation

- `pnpm dev:menu-svelte` starts only the SvelteKit app on port 3003.
- `pnpm build:menu-svelte` selects SvelteKit and its declared workspace
  dependencies; it does not select `apps/web` or `apps/pos`.
- `pnpm build` remains recursive over the repository for local development
  and CI.
- `pnpm build:production` selects API, existing Next.js menu, POS, and required
  shared workspace dependencies while excluding `@cafe/menu-svelte`.
- Dockerfiles build their named service independently. No active repository
  production release script invoked `pnpm -r build`; the VPS release is
  artifact/systemd based and external commands must be reviewed manually before
  any future frontend cutover.

For Vercel, create a separate project from the same GitHub repository, set
root directory `apps/menu-svelte`, include source files outside that directory,
use pnpm 11 / Node 24, install from the workspace lockfile, and build with
`pnpm --filter @cafe/menu-svelte... build`. Set server-only `API_BASE_URL` per
environment. Prefer native GitHub monorepo unaffected-project skipping.

For the eventual VPS target, build with `SVELTEKIT_ADAPTER=node`, run the
generated Node service separately on loopback, and retain the existing
Next.js service for rollback. The server artifact externalizes the declared
`@cafe/contracts` dependency, so the release bundle must include its built
workspace package and the app's production dependency graph as well as
`apps/menu-svelte/build/`.

## Conditions before production cutover

1. Complete feature-by-feature menu migration and separately approve the final
   customer UI.
2. Confirm staging API environment, security boundaries, and cookie/session
   design; no staging action may create real orders or waiter calls.
3. Pass focused API-contract, accessibility, image-delivery, QR, authentication,
   browser, performance, and supported-device acceptance.
4. Verify the Node production build and run it as a separate service against
   the existing backend.
5. Stage and validate the reverse-proxy switch and rollback artifacts. Keep
   uploaded product images in API-owned runtime storage throughout deployment
   and rollback.
6. Switch only public-menu routing after approval; preserve API and POS
   deployments.
7. Observe the new service and retain the last working Next.js artifact and
   proxy configuration until acceptance is complete.
8. Update the fixed product/deployment scope before retiring `apps/web`.

## Milestones and remaining work

- **M0 — parallel scaffold:** package/workspace, adapter selection, SSR menu
  data check, docs, focused tests, and independent build commands. Implemented
  in this change; local verification is recorded in `docs/current-left.md`.
- **M1 — Vercel staging:** configure the external Vercel project and environment
  variables; prove preview deployments and API reachability. Not performed.
- **M2 — migration design:** inventory existing menu pages, QR, auth, calls,
  image proxy, and accessibility behavior; settle cross-origin cookie and
  staging API decisions. Not started.
- **M3 — feature migration:** implement customer UI and approved browse/context
  capabilities incrementally with end-to-end acceptance. Not started.
- **M4 — VPS release rehearsal/cutover:** Node service, proxy switch,
  monitoring, and rollback rehearsal. Not started; requires future approval
  and production-gate review.
