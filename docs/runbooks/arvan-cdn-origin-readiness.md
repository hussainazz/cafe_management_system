# ArvanCloud CDN origin readiness

## Status

Phase one origin protections are active. The canonical product-media
architecture below is the phase-two target; it is implemented and verified
locally by focused tests, typechecks, builds, and bundled-image HTTP requests
through both web and POS development origins. Browser rendering and production
deployment/header verification remain pending. CDN proxying and DNS are
unchanged. The public domain currently resolves directly to the VPS. The
production Let's Encrypt certificate was not replaced and `www.runncafe.ir` was
not removed.

## Production change record — 24 November 2026

Before changing Nginx, the full `/etc/nginx` tree was archived and validated:

- Archive: `/opt/cafe-menu-release-backups/nginx-config-before-arvan-cdn-20261124T101414Z.tar.gz`
- SHA-256: `fba80b0a38b8df54fc336e9ec9bc00eda2f3c3b9c816d81b0b3ecf1182002725`

The active config is represented by:

- `operations/nginx/cafe-menu-vhost.conf`
- `operations/nginx/cafe-menu-analytics-locations.conf`
- `operations/nginx/cafe-menu-cache-locations.conf`
- `operations/nginx/arvan-real-ip.conf`

Nginx now owns the cache policy for dynamic responses. It hides an upstream
`Cache-Control` header and emits one `private, no-store` header on `/pos`,
`/pos/*` except fingerprinted POS assets, all root `/api/*` responses except
the public product-image proxy, `/t/*`, `/menu`, root HTML, and HTTP/HTTPS
redirects. The
existing `Set-Cookie` headers are not hidden. QR correlation still uses the
Nginx request ID and `menu_qr_visit` cookie.

All proxied application requests now send Nginx's trusted `$remote_addr` as
`X-Real-IP` and `X-Forwarded-For`. Nginx only replaces `$remote_addr` from the
`ar-real-ip` header when the immediate peer is in the official ArvanCloud IP
list. The list was checked on 24 November 2026 and is in
[`arvan-real-ip.conf`](../../operations/nginx/arvan-real-ip.conf). Arvan says
its edge ranges may change and publishes the maintained list at
<https://www.arvancloud.ir/en/ips.txt>; its real-IP project documents the
`ar-real-ip` header at
<https://github.com/arvancloud/ar-ngxrealip>.

## Public cacheable URL patterns

These paths return public content. Arvan should cache only successful `GET` or
`HEAD` responses, respect the origin's cache headers, and avoid caching any
response that is `private`, `no-store`, or carries `Set-Cookie`.

| Public URL pattern | Target origin header after deployment | CDN treatment |
| --- | --- | --- |
| `/media/products/bundled/<sha256>.(jpg\|png\|webp)` | `public, max-age=2592000, immutable` on 200/304; `no-store, max-age=0` on errors | Nginx serves files directly from the generated web-public directory. Cache successful 200 only; 30-day browser and CDN TTL. The lowercase SHA-256 filename is the content version. |
| `/media/products/uploads/<UUID>.(jpg\|png\|webp)` | `public, max-age=2592000, immutable` for current validated public product images; `no-store, max-age=0` for invalid, inactive, private, archived, missing, or error responses | Nginx proxies directly to Fastify. Fastify checks the current public `ProductImage` record, strict UUID key, size, and image signature. Cache successful 200 only. Replacement creates a new UUID URL. |
| `/api/product-images/<UUID>.(jpg\|png\|webp)` | Legacy public menu proxy; existing one-year immutable response for successful images | Keep for old clients during migration. Do not use in new menu/POS HTML or broaden the Arvan page rule to this path. |
| `/api/v1/product-images/*`, `/pos/api/v1/product-images/*` | Legacy application routes; not the new public namespace | Keep backward compatible, outside public CDN rules. POS remains private/no-store at Nginx. |
| `/items_pictures/<path>` | `public, max-age=86400, stale-while-revalidate=604800` | Legacy public files remain available; preserve current origin policy while old clients migrate. |
| `/items/<path>` | Legacy public static images; current origin sends `public, max-age=0` | Keep revalidation behavior for old links. |
| `/_next/static/<build-id>/<path>` | `public, max-age=31536000, immutable` | Cache for one year; the build ID versions the assets. |
| `/pos/_next/static/<build-id>/<path>` | `public, max-age=31536000, immutable` | Cache for one year; this is the POS app's fingerprinted asset namespace. |
| `/run-cafe-logo.webp`, `/Logo.png`, `/icon.svg` | Public, `max-age=0` | Safe to serve publicly with revalidation; do not override the origin TTL. |

`/_next/image` is not used by the current apps and is not in the cache allowlist.
The tracked `apps/menu-svelte` source and `PLAN.md` are absent from this
checkout; only generated/ignored build output exists. Any reactivated SvelteKit
menu must use the shared `@cafe/contracts` product-media helpers and the same
`/media/products/*` URLs. Do not use a generic `/api/*` cache rule.

## Canonical product-media implementation (phase two)

The application changes are prepared locally but are not deployed. There is no
database migration or storage-layout change in this phase.

- `@cafe/contracts` owns the URL helpers used by the web menu and POS. Uploaded
  keys retain their existing UUID-based storage keys and map to
  `/media/products/uploads/<UUID>.<ext>`. Replacement allocates a new key, so
  the old URL cannot resolve to the replacement image.
- `operations/generate-product-media.mjs` scans the bundled web and POS assets
  under `items_pictures/` and the legacy `items/` directory, validates their
  image signatures, deduplicates byte-identical files, and generates
  `/media/products/bundled/<sha256>.<ext>` URLs. The generated files are
  packaged under `apps/web/public/media/products/bundled/`; no source image is
  moved or removed. Rebuilding regenerates content hashes when image bytes
  change.
- Nginx serves hashed bundled files directly from the web-public directory.
  Nginx sends uploaded-image requests to the API's public read-only handler.
  That handler accepts only GET/HEAD and a strict UUID filename, checks that
  the image is the current image of an active, non-archived public product,
  validates the stored image signature and size, and never accepts a path.
  Successful responses have a verified image Content-Type and
  `public, max-age=2592000, immutable`; errors have `no-store`.
- `/api/product-images/*`, `/api/v1/product-images/*`,
  `/pos/api/v1/product-images/*`, `/items_pictures/*`, and `/items/*` remain
  available for compatibility. New web and POS product-image references use
  only `/media/products/*`. Upload, replacement, archive, image fallback, and
  existing storage behavior remain in the application flows.
- `NEXT_PUBLIC_PRODUCT_IMAGE_BASE_URL` is no longer used to generate browser
  image URLs. The shared same-origin helper is the source of truth. The POS
  Next development server proxies canonical bundled images to web and uploaded
  images to API; production Nginx serves/proxies those paths directly.
- Nginx scopes its public immutable cache headers to successful canonical
  image responses. The default remains no-store for dynamic routes; no cache
  rule is added for `/pos/*`, `/api/*`, `/t/*`, `/menu`, HTML, auth, or QR
  exchange. Existing trusted client-IP forwarding, QR correlation, ACME, and
  cache-protection configuration from phase one must remain intact.

## Phase-two deployment and origin verification (pending)

Do not deploy from a checkout containing unrelated pending migrations or
application changes. Before release, inspect the live release identity and
diff the intended artifact against that exact release. Include the generated
hashed bundled files and application outputs, but exclude environment files,
the developer's `apps/api/data/product-images/`, and all runtime uploads. No
schema deployment, upload transfer, DNS edit, certificate operation, Arvan
proxy activation, or production-data change is required for this architecture.

Before editing Nginx, save a fresh, validated copy of the current Nginx config
tree and checksums of the active phase-one files. Install
`cafe-menu-product-media-http.conf` in `conf.d` and the updated
`cafe-menu-cache-locations.conf` as the application location snippet. Keep
`arvan-real-ip.conf`, `cafe-menu-analytics-locations.conf`, the active vhost,
ACME webroot locations, certificate files, and Certbot renewal configuration
unchanged. Stage the API and hashed assets first, then install and validate the
Nginx locations before activating web/POS artifacts that emit canonical URLs.
Run `nginx -t` before a graceful reload. The phase-one full-tree archive above
is not the rollback source for phase two because it predates the active
trusted-IP, QR, ACME, and cache-protection configuration.

After deployment, repeat this direct-origin matrix on the origin address with
the production Host header and TLS SNI. Record status, Content-Type,
Cache-Control count/value, Location, and Set-Cookie for each row:

| Request | Expected result |
| --- | --- |
| Existing bundled SHA-256 image, GET and HEAD | 200; correct image type; one `public, max-age=2592000, immutable`; no Set-Cookie |
| Existing current uploaded UUID image, GET and HEAD | 200; correct image type; one `public, max-age=2592000, immutable`; no Set-Cookie |
| Missing or malformed bundled/uploaded key | 404; one `no-store`; no Location or Set-Cookie |
| Archived, inactive, private, replaced, invalid-signature, or oversized uploaded image | 404/appropriate client error; one `no-store`; no Location or Set-Cookie |
| `/api/product-images/*`, `/api/v1/product-images/*`, `/pos/api/v1/product-images/*`, `/items_pictures/*`, `/items/*` | Existing compatibility behavior and current headers; no new broad cache policy |
| `/`, `/menu`, `/pos`, POS release metadata, public/private APIs, customer auth, `/t/<token>`, QR exchange | Existing redirects/auth behavior; one private/no-store policy where phase one specifies it; no CDN eligibility |
| POS API without credentials | 401; one private/no-store; no Set-Cookie except existing auth flow behavior |
| `/_next/static/*` and `/pos/_next/static/*` | Existing fingerprinted asset behavior; no impact from media locations |
| `/.well-known/acme-challenge/<token>` and a missing token | HTTP-01 file reaches webroot; missing token is 404/no-store; no edge redirect required |
| Loopback request with forged forwarded-IP headers | Nginx logs/forwards the actual peer address, preserving phase-one trust boundary |

Then load the public menu and the authenticated POS catalog in a browser, confirm
both render the same `/media/products/*` URLs, and verify image fallback. In the
POS, replace one image and confirm the new product response references a new
UUID URL while the old URL returns no-store 404; archive the product and
confirm its canonical URL is no longer served. These checks are deployment
gates; do not mark the phase complete from unit tests or builds alone.

For phase-two rollback, first restore the previous web/POS artifact while
retaining the backward-compatible API, then restore the saved pre-phase-two
`cafe-menu-cache-locations.conf` and remove the newly installed
`cafe-menu-product-media-http.conf`. Run `nginx -t` and reload. Keep the active
vhost, `arvan-real-ip.conf`, analytics locations, ACME webroot, certificates,
and Certbot renewal configuration intact. Do not restore the earlier phase-one
archive above. Keep `/media/products/*` bypassed at the edge until rollback is
verified. If the edge proxy is ever activated in a later phase, retain the
canonical origin routes until edge/browser cache expiry or purge is complete.
The compatibility endpoints and old static paths remain available throughout
rollback, so previous clients continue to load images.

## Recommended ArvanCloud rules

Use a default cache bypass. The single canonical product-image page rule is:

```text
URL pattern:            runncafe.ir/media/products/*
Status:                 rule already created; CDN proxy remains disabled
Cache level:            URI
Cache 200:              30 days
Cache any other status: 0 seconds
Browser cache:          30 days
Cache query arguments:  off
Ignore Cache-Control:   off
Ignore Set-Cookie:      off
Ignore Vary:            off
Methods:                GET and HEAD only
```

The `cache_any=0s`, `cache_ignore_cc=false`, and `cache_ignore_sc=false`
settings matter alongside the two 30-day durations: origin errors and any
future private/no-store or cookie-bearing response must stay uncacheable. Arvan
names these settings `cache_200`, `cache_any`, `cache_browser`,
`cache_ignore_cc`, and `cache_ignore_sc` in its page-rule model. See the
[ArvanCloud CDN API model](https://github.com/arvancloud/cdn-go/blob/main/model_page_rule.go).
If the current panel rule does not expose equivalent behavior, keep the proxy
disabled until the rule can guarantee that only successful versioned images
are cached.

All other paths remain bypassed by default. In particular, do not cache `/`,
`/menu`, `/pos/*`, `/t/*`, `/api/*`, legacy image routes, customer context,
authentication, QR exchange, redirects, or errors. Do not add generic API or
POS exceptions. The canonical Nginx locations accept only GET/HEAD, return
no-store for every non-success status, and never set QR/auth cookies.

Keep `/.well-known/acme-challenge/*` uncached and allow it to reach the origin
over HTTP port 80 without an edge redirect, WAF challenge, or path rewrite.
The origin webroot returns `Cache-Control: no-store` and serves Certbot's
HTTP-01 files from `/var/lib/letsencrypt`.

Use HTTPS from Arvan to the origin with certificate verification enabled.
After activation, test both TLS legs and verify that the edge preserves the
origin's single `Cache-Control` header. Origin Nginx analytics then measures
origin traffic only; use Arvan's Cache Hit Ratio and client-delivery/origin
bytes for edge totals.

## Let's Encrypt renewal and `www`

The active certificate lineage is `runncafe.ir`, with SANs `runncafe.ir` and
`www.runncafe.ir`, serial `06F4758EE5BA19A8369637DEF08F4EDC0905`, and expiry
2027-01-24 15:54:51 UTC. `certbot.timer` is active. Certbot now uses the webroot
authenticator at `/var/lib/letsencrypt` and the Nginx installer. The staging
reconfiguration succeeded for both SANs; the installed production certificate
serial and SANs remained unchanged. A direct origin HTTP preflight returned
200 for a temporary challenge file, and a missing token returns 404/no-store.

The CDN-mediated renewal path cannot be proven until the proxy is activated.
The Arvan rules above must pass every HTTP-01 challenge request to the origin
without caching or redirecting it. Certbot's staging reconfiguration tests the
current direct-origin DNS path, not a future Arvan edge path. Certbot documents
that `reconfigure` tests changes against its staging server before saving them:
<https://eff-certbot.readthedocs.io/en/stable/using.html>.

The current certificate still requires both hostnames to validate during
renewal. If `www` is permanently removed from DNS, an HTTP-01 renewal for the
current SAN set will fail for `www`. After separate approval, issue an
apex-only certificate for `runncafe.ir` and update that lineage before removing
the `www` DNS record. No certificate replacement or DNS change was made here.

## Phase-one verification results

- `nginx -t` passed before and after the graceful reload. Nginx is active with
  zero restarts; API, POS, and web services were not restarted.
- Direct-origin `/menu`, `/pos`, `/pos/release`, `/api/public-menu`, and
  `/api/table-context` returned HTTP 200 with exactly one private/no-store
  `Cache-Control` header. Unauthenticated `/pos/api/v1/orders` and
  `/pos/api/v1/auth/me` returned 401 with exactly one private/no-store header.
- `/` and an invalid `/t/` exchange returned redirects with no-store. The QR
  response still set `menu_qr_visit`; no real QR token was used.
- Uploaded product images and web/POS fingerprinted assets returned HTTP 200
  with their existing public cache headers. `/items_pictures/*`, legacy
  `/items/*`, and brand assets retained their existing origin headers.
- A loopback request carrying forged `ar-real-ip`, `X-Real-IP`, and
  `X-Forwarded-For` values remained logged as `127.0.0.1`; active Nginx
  forwarding config contains no `$proxy_add_x_forwarded_for`.
- Certbot `reconfigure` completed its staging validation. A separate
  `certbot renew --dry-run` confirmation was stopped during Certbot's
  randomized delay before challenge validation; the successful `reconfigure`
  staging run is the renewal validation recorded above. The production
  certificate serial stayed unchanged.
- No application tests, database operations, payments, print jobs, DNS changes,
  CDN activation, edge certificate purchase, or real QR-token changes were
  performed.

## Phase-two local verification results — 24 November 2026

- Contracts, web, POS, API, and menu-analytics focused tests passed. Contracts,
  web, POS, and API typechecks passed. Production builds passed for web, POS,
  and API.
- The local public menu returned 16 categories and 142 products, including 29
  product records with image keys. The first local uploaded key referenced a
  missing local storage file and returned 404/no-store through API, web proxy,
  and POS proxy as designed. Isolated API integration tests exercised a valid
  uploaded image, replacement URL versioning, archive behavior, and cache
  headers.
- A content-hashed bundled WebP returned HTTP 200 with `image/webp` through
  both the local web and POS development origins. Both responses contained the
  same bytes. The local browser-control host was unavailable, so visual
  rendering in a browser remains unverified.
- Nginx is not installed on the development host, so the phase-two snippets
  were inspected but could not be checked with local `nginx -t`. Syntax and
  the full direct-origin header matrix remain deployment gates.
- The local development database was advanced by the additive
  `20261124100000_stock_reference_purchase` migration already present in this
  checkout; it was not applied to production. No production artifact, database,
  Nginx configuration, DNS, CDN proxy, or certificate was changed in phase two.

## Rollback

The full pre-change Nginx archive is the rollback source. To restore it:

```sh
sudo tar -xzf /opt/cafe-menu-release-backups/nginx-config-before-arvan-cdn-20261124T101414Z.tar.gz -C /
sudo rm -f /etc/nginx/conf.d/arvan-real-ip.conf
sudo rm -f /etc/nginx/snippets/cafe-menu-analytics-locations.conf
sudo rm -f /etc/nginx/snippets/cafe-menu-cache-locations.conf
sudo nginx -t
sudo systemctl reload nginx
```

If reverting Certbot to its prior Nginx authenticator as well, restore the
renewal file from
`/opt/cafe-menu-release-backups/certbot-renewal-before-arvan-cdn-20261124T103257Z.conf`,
then verify it with `sudo certbot renew --dry-run --cert-name runncafe.ir`.
The Nginx archive restores the old `/pos` `s-maxage` response behavior, so keep
CDN caching disabled for POS if using that full rollback.
