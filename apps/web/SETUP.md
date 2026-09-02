# QR Menu Frontend

The public QR menu is a mobile-first, browse-only Next.js application. Its
dark, amber visual system recreates the first frontend direction while the
current backend remains the menu source of truth. The initial menu is rendered
on the server; client JavaScript powers search, filters, category navigation,
product details, options, and language controls.

## Local development

1. Start PostgreSQL and apply the API migrations.
2. Import the Run Cafe catalog if needed:

   ```sh
   pnpm db:seed:run-cafe-menu
   ```

3. Copy `.env.example` to `.env.local` when the API does not use the default
   `http://127.0.0.1:3001` address or product images need a separate base URL.
4. Start both applications from the repository root:

   ```sh
   pnpm dev
   ```

The one public menu is available at `http://localhost:3000/menu`. It has no
cart, checkout, customer ordering, payment, or tracking feature. An eligible
printed table URL at `/t/:token` exchanges the token through Fastify, sets a
short-lived HttpOnly table-context cookie, and redirects to the same `/menu`;
generic menu visits have no waiter-call control.

## Verification

```sh
pnpm --filter @cafe/web typecheck
pnpm --filter @cafe/web test
pnpm --filter @cafe/web build
```

`API_BASE_URL` is server-only. Browser retries use the app's same-origin
`/api/public-menu` route, so the private API address is never exposed to the
browser. `NEXT_PUBLIC_PRODUCT_IMAGE_BASE_URL` is used only to resolve
controlled, self-hosted product-image storage keys.

The current public API does not provide English category or product names. The
English interface therefore keeps API-provided menu names in Persian instead
of inventing translations.
