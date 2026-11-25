# Public-menu traffic analytics

The production report reads Nginx access logs on the VPS and writes daily
aggregate summaries under `/var/lib/cafe-menu-analytics`. It does not query
PostgreSQL or send data to a third party. Raw Nginx logs keep the existing
14-day rotation; summaries retain counts, byte totals, hourly buckets, and
HyperLogLog registers only.

## Install or update

Use the active systemd/Nginx deployment under `/opt/cafe-menu`; do not use the
documented Docker/GHCR target. Before changing production, make a dated backup
of `/etc/nginx/nginx.conf` and `/etc/nginx/sites-enabled/cafe-menu` and verify
the archive with `tar -tzf`.

1. Copy `operations/nginx/menu-analytics-http.conf` to
   `/etc/nginx/conf.d/cafe-menu-analytics.conf`. It must load inside the Nginx
   `http {}` block.
2. Move the global access log directive in `/etc/nginx/nginx.conf` below the
   `include /etc/nginx/conf.d/*.conf;` line and set it to
   `access_log /var/log/nginx/access.log cafe_menu_analytics;` so the named
   format is defined before it is used.
3. Insert `operations/nginx/cafe-menu-analytics-locations.conf` into the HTTPS
   `runncafe.ir` server block before `location /`.
4. Install `operations/menu-analytics.py` as
   `/usr/local/libexec/cafe-menu-analytics.py`, owned by root and mode `0755`.
5. Install the service and timer from `operations/systemd/` under
   `/etc/systemd/system/`, then run `systemctl daemon-reload`.
6. Run `nginx -t`. If it passes, reload Nginx, enable and start
   `cafe-menu-analytics.timer`, then start `cafe-menu-analytics.service` once
   for the initial aggregation. The daily run is scheduled for 00:30
   `Asia/Tehran` (21:00 UTC); start the service manually when a same-day report
   needs a refresh.

The Nginx `/t/` location redacts the full path before access logging and adds a
short-lived HttpOnly cookie containing that request's non-secret `$request_id`.
The access log records the ID on `/t/` and maps the cookie value to a separate
field only on `/menu`. The `/menu` response clears the cookie. The report counts
the `/menu` landing once and presents redirect requests separately, so those
two HTTP requests are never added together as two page views. A failed or
abandoned redirect can remain unpaired.

## Read a report

Run report commands on the VPS as the `cafe` user. The analytics systemd
service receives the `adm` supplementary group to read Nginx logs; the report
command reads only the aggregate summary files:

```sh
sudo -u cafe /usr/bin/python3 /usr/local/libexec/cafe-menu-analytics.py report --day 2026-11-13
sudo -u cafe /usr/bin/python3 /usr/local/libexec/cafe-menu-analytics.py report --month 2026-11
```

Daily and monthly reports include:

- All `/menu` HTTP request counts, GET counts, and successful 2xx responses.
- The highest daily response-body total in the selected period, split into menu
  service and other Nginx-routed services.
- Exact HTTP status-code counts for menu-service and other-service responses.
- QR route requests and redirects, correlated QR menu landings, and unpaired
  redirects. Correlated visit figures are available only after activation.
- The busiest three Tehran hours for GET requests to `/menu`.
- An approximate unique client-IP count. Daily estimates are approximate;
  monthly estimates merge daily HyperLogLog sketches rather than add daily
  counts. The estimate is not a count of people: shared IPs combine customers,
  rotating IPs split them, and bots and reloads remain in request data.
- Response-body bytes for the menu page, public-menu data, other menu APIs,
  menu images, other static files, and all other Nginx-routed services. Image
  recognition includes the canonical `/media/products/*` namespace,
  `/_next/image` when used, compatibility `/api/product-images/`, legacy
  `/items_pictures/*` and `/items/*`, and image response types; it does not
  depend on the request path being `/menu`.
- These bytes exclude headers, TLS, and transport overhead. Browser-cache hits
  can send no body, so this is a server payload estimate rather than a precise
  ISP bill.

The report prints the Tehran dates represented in the summary files. Before
activation, old access logs use the legacy combined format: request and byte
counts can be reconstructed while those logs remain, but their QR redirects
cannot be joined exactly to `/menu` landings. The old raw files expire under
normal 14-day rotation; do not copy or publish them. A report for the current
Tehran day or month marks that day's figures as partial.

## CDN measurements and cache boundary

If a CDN is activated, keep the Nginx figures as origin-side measurements. CDN
cache hits will not reach the VPS, so they cannot show total client delivery.
Add provider-sourced Cache Hit Ratio, bytes delivered to clients, and bytes
fetched from the origin to the report. Preserve the provider's definitions; if
it reports request-hit and byte-hit ratios separately, show both. Do not fill
these fields from Nginx estimates.

When requests arrive through ArvanCloud, the analytics `client_ip` field uses
the real-IP module only for the current official ArvanCloud source ranges and
the documented `ar-real-ip` header. Nginx replaces upstream `X-Real-IP` and
`X-Forwarded-For` with that trusted `$remote_addr`; never append arbitrary
client-supplied forwarding values. See
[`arvan-cdn-origin-readiness.md`](arvan-cdn-origin-readiness.md).

Keep public caching on an explicit image allowlist. The canonical namespace is
`/media/products/*`; only versioned successful image responses are cacheable.
Compatibility `/api/product-images/<storage-key>`, bundled `/items_pictures/`
and `/items/` paths, root menu image assets, and `/_next/image` only if the app
uses it with approved image sources may retain their existing behavior during
migration. Respect immutable version headers and do not cache errors. Other
`/api/` routes, including menu data and customer actions, and all `/pos/`
content must bypass shared public caching. Do not configure a wildcard cache
for `/api/*`.

## Operations

```sh
sudo systemctl status cafe-menu-analytics.timer cafe-menu-analytics.service
sudo journalctl -u cafe-menu-analytics.service --since today
sudo nginx -t
```

The aggregator scans active and rotated `access.log*` files and rewrites daily
summaries for dates still present in raw logs. It preserves older daily
summaries after those logs rotate out. It writes no raw IP address or QR request
ID to those summaries.

For rollback, stop and disable the analytics timer, restore the backed-up Nginx
configuration and reload Nginx after `nginx -t` passes. Remove the analytics
systemd units and script only after the old Nginx configuration is active and
its public `/menu` and `/t/` routes are healthy.
