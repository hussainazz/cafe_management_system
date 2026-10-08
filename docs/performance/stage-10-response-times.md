# Stage 10 response-time benchmarks

Recorded 7 October 2026 for checklist items 10.20–10.22. These measurements
are baselines for the listed requests and workloads. They are not service-level
targets.

## How to read p50 and p95

Sort the measured request times from shortest to longest. p50 is the time at or
below which half of the requests completed. p95 is the time at or below which
95 percent completed. For example, a p95 of 100 ms means 95 percent of the
measured requests took 100 ms or less; the slowest 5 percent took longer.

The benchmark uses the nearest-rank percentile. With 20 timed samples, p50 is
the 10th value in the sorted list and p95 is the 19th. These percentiles are
not averages. Twenty samples give a useful first baseline, but p95 can move
noticeably when one request is slow.

## Isolated API and report timings

The repeatable benchmark is
[`apps/api/test/performance/stage10-benchmark.test.ts`](../../apps/api/test/performance/stage10-benchmark.test.ts).
Run it from `apps/api` with the isolated test configuration:

```sh
pnpm exec node --env-file=.env.test test/run-isolated-suite.mjs test/performance/stage10-benchmark.test.ts
```

The benchmark checks that both database settings point to
`127.0.0.1:5433/cafe_management_test`. It warms each route with 3 requests and
then times 20 sequential successful requests. Each timed interval starts after
any setup data has been created. It includes Fastify route handling, response
serialization, test PostgreSQL work, and local image-file reads. It excludes
TCP, TLS, browser rendering, and public-network time.

The workload uses successful Staff login; one-item takeaway order create, edit,
delete, and settlement requests; a one-day report; the public-menu API; and an
image response. The report fixture has 500 orders, 500 items, 250 settlements,
and 250 payments. The menu fixture has 8 categories and 200 products. The local
image is a 256 KiB synthetic payload with a PNG signature, stored under `/tmp`.

| Request | p50 | p95 |
| --- | ---: | ---: |
| Login | 113.71 ms | 298.56 ms |
| Order create | 83.05 ms | 166.89 ms |
| Order edit | 111.15 ms | 368.97 ms |
| Order delete | 61.78 ms | 109.09 ms |
| Payment settlement | 99.92 ms | 140.87 ms |
| Public menu API, 8 categories and 200 products | 53.66 ms | 75.26 ms |
| Product image API, 256 KiB synthetic payload | 4.44 ms | 6.39 ms |
| Daily report API, 500 orders and 250 settlements | 53.22 ms | 93.22 ms |

The focused benchmark passed with 1 benchmark test. These numbers describe the
local test setup. They do not predict production response times.

## Live public-path timings

On 7 October 2026, `curl` sent 3 warmup requests and then 20 sequential
requests to each public path from this workstation. Every recorded response
returned HTTP 200. The requests included the network path to `runncafe.ir`.
Total time is curl's full response time. First-byte time is curl's
`time_starttransfer`. The byte count is curl's `size_download`.

The command shape was:

```sh
curl --fail --silent --show-error --output /dev/null \
  --write-out '%{http_code},%{time_starttransfer},%{time_total},%{size_download}\n' \
  <url>
```

| Request | Downloaded bytes | p50 total | p95 total | p50 first byte | p95 first byte |
| --- | ---: | ---: | ---: | ---: | ---: |
| `GET https://runncafe.ir/menu` | 221,674 | 0.922 s | 1.445 s | 0.722 s | 1.041 s |
| `GET https://runncafe.ir/api/public-menu` | 44,111 | 0.607 s | 0.925 s | 0.552 s | 0.807 s |
| `GET https://runncafe.ir/api/product-images/<menu image key>` | 149,356 | 0.569 s | 0.844 s | 0.429 s | 0.645 s |

The image key came from the live public-menu response. The URL uses the
same-origin image proxy. This is one workstation's snapshot, not a browser test
or a sample from several customer networks. Use measurements from real customer
devices and network locations before making a CDN decision.
