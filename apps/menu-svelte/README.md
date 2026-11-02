# SvelteKit Menu

This is a parallel customer-menu application scaffold. It does not replace or
modify the existing Next.js menu at `apps/web`, POS at `apps/pos`, or Fastify
API at `apps/api`. The initial `/menu` page is a data and connectivity check,
not the final customer interface.

## Repository audit summary

- The repository is a pnpm workspace on Node 24 and pnpm 11. Applications are
  separate packages under `apps/`; `packages/contracts` builds shared Zod
  contracts into `dist/`.
- `apps/web` is a Next.js SSR app on port 3000. Its public-menu route calls
  `GET /api/v1/public/menu` from the server, and its table-context routes
  forward cookies and API `Set-Cookie` values.
- `apps/pos` is a separate Next.js application on port 3002.
- `apps/api` is Fastify on port 3001. It registers CORS with `origin: false`;
  this app leaves that policy unchanged. The public menu response is validated
  by `PublicMenuResponseSchema` from `@cafe/contracts`.
- Product images use API storage keys and an existing same-origin Next.js image
  proxy. This scaffold does not render product images or expose the API host.
- The active production deployment observed in repository operations docs is
  systemd/Nginx on the VPS. Repository Docker files build individual services;
  no production script currently invokes the generic recursive monorepo build.

## Architecture

The SvelteKit server loads the public-menu DTO from the existing Fastify API.
Server-only configuration is read from `$app/env/private`; the API address
is never serialized to browser data. `PublicMenuResponseSchema` validates the
response. The initial view displays only category/product information and
handles unconfigured, failed, timed-out, and invalid responses without leaking
network details.

`@cafe/contracts` remains the framework-independent source of public API
schemas. The Fastify API remains the only business-logic and database owner.
There are no ordering, waiter-call, authentication, or other transactional
actions in this initialization scaffold.

## Local development

Use Node `>=24 <25` and pnpm 11, then install from the repository root:

```sh
pnpm install
cp apps/menu-svelte/.env.example apps/menu-svelte/.env
pnpm dev:api
pnpm dev:menu-svelte
```

The SvelteKit app listens on `http://localhost:3003`; the existing menu, API,
and POS keep ports 3000, 3001, and 3002. Start the API in another shell. Root
`pnpm dev` remains opt-in and does not start this app.

`API_BASE_URL` is server-only. For local development, set it to the local API
origin in `apps/menu-svelte/.env`. For hosted deployments, set it in the
hosting provider's environment settings to the approved HTTPS API origin. No
API credential is needed for anonymous public-menu reads. An unset value
produces a readable configuration state.

## Commands

From the repository root:

```sh
pnpm dev:menu-svelte
pnpm build:menu-svelte
pnpm typecheck:menu-svelte
pnpm --filter @cafe/menu-svelte lint
pnpm test:menu-svelte
pnpm --filter @cafe/menu-svelte format:check
```

Application-local scripts provide `dev`, `build`, `preview`, `typecheck`,
`lint`, `test`, and `format:check`. `pnpm build:menu-svelte` selects the new app
and its declared workspace dependencies; it does not select either Next.js
frontend. `pnpm build` remains the repository-wide recursive build. Use
`pnpm build:production` to build the API, existing menu, POS, and their
workspace dependencies while excluding this staging application.

## API behavior and cookies

The initial loader makes one read-only server request to
`GET /api/v1/public/menu`, with an eight-second timeout and no browser fetch.
The result is validated against `@cafe/contracts`. Failure results are
deliberately generic and do not include the API host or network error text.

The current QR flow exchanges the token at `/t/:token`, receives
`cafe_table_context`, and forwards that HttpOnly cookie on subsequent API
requests. The API currently sets `Path=/; SameSite=Lax`, with `Secure` in
production, and no `Domain` attribute. `cafe_customer_auth` is likewise
host-scoped. A cookie issued by the API host is not automatically scoped to a
Vercel host, and a cookie scoped to a Vercel domain is not sent to the VPS API
as a browser cookie. A same-origin SvelteKit endpoint can forward a cookie
only after the browser has sent it to SvelteKit; server proxying alone does not
solve this cross-host cookie boundary.

Before table context, customer authentication, or mutations are migrated,
choose a shared same-site domain or a reviewed API cookie/proxy design and
verify CSRF protections, cookie attributes, `Set-Cookie` forwarding/clearing,
QR token handling, and image delivery. Do not enable permissive CORS to work
around this boundary. Staging must remain browse-only and must not be wired to
live waiter-call or ordering interactions.

## Vercel staging

The app includes [`vercel.json`](vercel.json) with the SvelteKit framework,
frozen pnpm workspace install, and dependency-ordered build. Create and link a
Vercel project for staging with these dashboard settings:

1. Import `hussainazz/cafe_management_system` in Vercel.
2. Set **Root Directory** to `apps/menu-svelte` and enable **Include source
   files outside of the Root Directory** so the pnpm workspace and
   `packages/contracts` are available.
3. Keep the repository's pnpm 11 package manager and Node 24 compatibility.
   The app package constrains build Node to 24, and the project adapter selects
   the Vercel Node.js 24 function runtime.
4. Let `vercel.json` provide the install and build commands. The output is
   selected by `@sveltejs/adapter-vercel`; do not set a static output
   directory.
5. Add `API_BASE_URL` as a server environment variable for Preview and
   Production environments, with an approved HTTPS API origin. Do not prefix
   it with `PUBLIC_` or put credentials in it.
6. Use Vercel's GitHub monorepo **Skip unaffected projects** setting to avoid
   staging deployments when this app and its workspace dependencies are
   unaffected. Do not add a custom ignored-build script unless native
   detection proves insufficient.
7. Enable Preview deployments for branch review. Keep preview interactions
   read-only until cookie/session architecture and staging API isolation are
   approved.

If workspace dependencies are not found, verify the repository root is
included in the deployment source, `pnpm-workspace.yaml` includes `apps/*` and
`packages/*`, each workspace package has a unique name, and the app declares
`@cafe/contracts` as a dependency. Run the build command from the workspace
root if the platform's build working directory does not discover the root.

## Future VPS deployment

For a self-hosted Node build, set `SVELTEKIT_ADAPTER=node` during build. The
official `@sveltejs/adapter-node` emits a standalone Node server under
`build/`; `API_BASE_URL` is provided at runtime. The generated server keeps
`@cafe/contracts` as a production dependency, so a VPS release bundle must also
include the built contracts package and the app's production dependency graph.
Keep this service separate from the current Next.js menu until browser
acceptance is complete.

Future cutover gates:

1. Complete the menu feature migration and customer-facing UI as separately
   scoped work.
2. Build the Node adapter output and run it under a separate systemd service
   and loopback port.
3. Verify it against the backend without enabling customer transactions.
4. Verify cookie/session scope, CSRF, QR links, product images, accessibility,
   and all customer menu behavior.
5. Prepare and verify a reverse-proxy rollback, then switch only the public
   menu route. Preserve POS and API services and uploaded product-image data.
6. Monitor the new service and retain the previous Next.js release for rollback.
7. Retire `apps/web` only after the new app meets its acceptance gates and the
   planning scope is deliberately updated.

See [`docs/architecture/svelte-menu-migration.md`](../../docs/architecture/svelte-menu-migration.md)
for the decision record and remaining migration gates.
