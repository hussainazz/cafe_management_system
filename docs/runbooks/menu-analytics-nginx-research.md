# Menu analytics from Nginx access logs

## Finding

Nginx access logs are a good fit for these server-observed metrics: `/menu`
request counts, QR redirect landings, peak request hours, response-body bytes,
asset download bytes, and rough distinct-IP counts. Nginx records requests and
response fields; a small scheduled aggregator is still needed to produce
daily/monthly summaries and preserve them beyond raw-log rotation.

Nginx's built-in `combined` log format records `"$request"`, which includes
the request target. For this project that can expose the opaque `/t/:token`
credential. Use a custom JSON format with `escape=json`, log a mapped `$uri`
that replaces `/t/...` with `/t/[redacted]`, and omit `$request`,
`$request_uri`, `$args`, cookies, and the Referer. Nginx supports both custom
log formats and map variables in the `http` context. See the [access-log
module](https://nginx.org/en/docs/http/ngx_http_log_module.html) and the
[map module](https://nginx.org/en/docs/http/ngx_http_map_module.html).

`$body_bytes_sent` measures bytes sent in the response body and excludes
response headers. It is suitable for an estimate of payload bytes returned by
the VPS. `$time_iso8601` provides local time in ISO 8601 form; report bucketing
must use `Asia/Tehran`. These are server-sent body bytes, not complete network
wire usage, and do not include header, TLS, or transport overhead. The log
module documents these fields and their semantics in its
[variables reference](https://nginx.org/en/docs/http/ngx_http_log_module.html).

## QR redirect correlation

Carry Nginx's `$request_id` from the redacted `/t/:token` request in a short-
lived, HttpOnly, Secure, SameSite=Lax cookie. Log the ID on the QR request and
map that one cookie value to a dedicated field only on `/menu`; clear the cookie
on the `/menu` response. Matching the two values links the redirect to its
landing without changing the visible URL or exposing the table token. The
cookie value is a request identifier, not an authentication credential. Nginx
supports logging request IDs, mapping cookie variables, and adding response
headers; see the [core-module variables](https://nginx.org/en/docs/http/ngx_http_core_module.html),
[map module](https://nginx.org/en/docs/http/ngx_http_map_module.html), and
[headers module](https://nginx.org/en/docs/http/ngx_http_headers_module.html).

Count a paired `/menu` landing once in `/menu` request totals and mark it as
QR-origin. Do not add the `/t/:token` redirect count to page-view totals. Keep
unpaired redirects as a separate diagnostic count; they may represent an
abandoned or failed landing.

## Aggregation limits

- Access logs count HTTP requests, not people or confirmed page renders.
  Reloads, crawlers, prefetches, and retries can add requests; shared NAT IPs
  can combine customers, while one customer can use several IPs.
- Bytes sent can be grouped by `/menu`, public-menu data, product-image paths,
  and static assets. A browser-cached asset may produce a `304` with no body,
  so this measures bytes the VPS returned, not bytes used by every client.
- Raw Nginx logs have finite retention. To provide complete monthly figures
  after rotation, persist daily aggregates. Monthly unique-IP estimates must
  merge daily distinct-IP sketches or another deduplicating representation;
  summing daily unique-IP counts double-counts repeat IPs. This is an analytics
  design inference from the distinct-count requirement.
- Keep raw IPs out of permanent summaries. An approximate distinct-count
  sketch can be updated from IPs in memory while raw access logs continue to
  follow the existing retention policy.

## Sources

- [Nginx HTTP Log module](https://nginx.org/en/docs/http/ngx_http_log_module.html)
- [Nginx HTTP Map module](https://nginx.org/en/docs/http/ngx_http_map_module.html)
- [Nginx HTTP Core module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
