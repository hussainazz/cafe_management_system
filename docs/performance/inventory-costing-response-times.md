# Inventory costing response-time benchmark

Latest measurement: 13 October 2026 against the authorized local
`cafe_management_test` database. The benchmark uses Fastify inject, one warmup
request, then eight timed requests per operation. Times include route handling,
response serialization, and local PostgreSQL work. They exclude browser,
TCP, TLS, and network time.

The fixture has one stock item, one recipe component, one product, one line per
count, and one fully paid pending order for each receipt-retry sample.

| Operation | Samples | p50 | p95 |
| --- | ---: | ---: | ---: |
| Purchase posting | 8 | 46.31 ms | 67.65 ms |
| Receipt posting with one pending-order retry | 8 | 62.67 ms | 76.48 ms |
| Physical-count posting with one stock item | 8 | 38.84 ms | 65.73 ms |
| Bounded one-day gross-profit report | 8 | 47.34 ms | 61.95 ms |

The previous 12 October measurement was 60.56/70.94 ms for purchase posting,
83.12/111.23 ms for receipt-time retry, 46.00/55.39 ms for count posting, and
31.64/48.71 ms for the gross-profit report. Local test load and timing variance
can affect these small samples; the latest figures replace the prior single
measurement in the active record.

The repeatable benchmark is
[`apps/api/test/performance/inventory-costing-benchmark.test.ts`](../../apps/api/test/performance/inventory-costing-benchmark.test.ts).
These figures describe a small local test fixture. They do not predict café
device, VPS, or public-network latency.
