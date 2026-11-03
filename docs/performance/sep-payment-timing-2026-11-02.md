# SEP terminal timing report — 2 November 2026

Six recent POS attempts, 17:25:55–17:31:44 Iran time (UTC+03:30). Times in the table come from VPS attempt creation; durations come from cashier monotonic measurements. Cashier and VPS clocks differ, so their timestamps were not subtracted.

Four attempts reached and returned from the purchase call, all with SDK code 98 (cancellation). One connection test returned 03 before purchase. One worker hit its 30-second deadline while inside the purchase call. No purchase approval code 00 was recorded in this batch. All six backend records are now FAILED following staff actions; these labels are separate from the measured SDK outcomes.

| Iran time | Order | Toman | Attempt | Connection (s) | Before purchase (s) | Purchase call (s) | Host worker total (s) | Observed outcome |
|---|---:|---:|---|---:|---:|---:|---:|---|
| 17:25:55 | 68 | 30,000 | a991fe25 | 2.090 | 3.545 | 2.460 | 6.087 | Purchase returned 98 |
| 17:27:50 | 69 | 60,000 | 041c697e | 2.001 | 2.761 | 7.937 | 10.789 | Purchase returned 98 |
| 17:28:26 | 70 | 90,000 | 706ee88e | 1.897 | 2.647 | 2.130 | 4.924 | Purchase returned 98 |
| 17:29:04 | 59 | 510,000 | 074a64e9 | 1.895 | — | — | 30.016 | Worker deadline during purchase |
| 17:31:24 | 70 | 90,000 | 6d3f0b8f | 2.098 | — | — | 3.976 | Connection failed 03 |
| 17:31:44 | 70 | 90,000 | 0e0d1f6f | 2.069 | 2.829 | 1.646 | 4.576 | Purchase returned 98 |

Connection is included within preparation. Preparation and purchase are included within the worker total; do not add overlapping columns. Missing durations are unrecorded, not zero. Worker total includes process startup and exit handling. Preparation starts in the worker and ends at entry to the SDK purchase call. The purchase interval includes any terminal, cardholder, or bank wait inside the synchronous SDK call; it does not measure when the amount appeared on the terminal screen.

## Comparable completed purchase calls

| Measurement | Minimum (s) | Median (s) | Mean (s) | Maximum (s) |
|---|---:|---:|---:|---:|
| VPS claim round trip | 0.372 | 0.427 | 0.480 | 0.693 |
| Connection test | 1.897 | 2.035 | 2.014 | 2.090 |
| Preparation before purchase | 2.647 | 2.795 | 2.946 | 3.545 |
| SDK purchase interval | 1.646 | 2.295 | 3.543 | 7.937 |
| Host worker total | 4.576 | 5.505 | 6.594 | 10.789 |

These statistics use the four completed purchase calls only. The connection failure and timed-out worker are excluded. Preparation averages 2.946 seconds; the connection test accounts for about 2.014 seconds of that. Bridge acceptance takes 101–161 ms across these four attempts; queue delay and device-mutex wait round to zero ms. SDK factory/setup is small compared with connection testing.

## Incomplete and delivery records

- The 510,000 Toman attempt passed its connection test in 1.895 seconds and entered PURCHASE_CALL. The host killed the worker at 30.016 seconds total. There is no completed purchase duration or cleanup record, so this is not a completed latency sample.
- The 90,000 Toman attempt at 17:31:24 returned connection code 03 in 2.098 seconds and never entered the purchase call. Its cleanup took 1.044 seconds.
- The 60,000 Toman attempt has a locally measured 7.937-second purchase call returning 98. Its financial evidence delivery remains unacknowledged, while the backend attempt is already FAILED and resultReceivedAt is null. See delivery-audit.json for the server records of late/conflicting evidence.
- Every timing upload in the collected batch is still retrying. The active VPS API lacks the timing routes, and there are zero TERMINAL_PAYMENT_TIMING rows for today. These delivery retries are not additional payment attempts.
- Browser preparation, status polling latency, API spans, and click-to-result totals are therefore unavailable in this report. Worker totals must not be described as complete POS click-to-result time.

## Earlier reference samples

- Earlier 90,000 Toman attempt 3b525473-8add-4148-aee7-72ebd6845b3b: connection code 68 after 10.028 seconds, no purchase entered, host worker 16.363 seconds.
- Deleted original 60,000 Toman attempt ef22d105-0408-4726-ba74-1ac2f1946dd8: local journal remains available; preparation 2.715 seconds, connection 1.897 seconds, purchase 2.158 seconds returning 98, host worker 5.115 seconds.
- The separately authorized connection-only retry returned 00 in 2.245 seconds; it is not a payment sample.

## Exact mappings

- Order 68, 17:25:55: `a991fe25-8c89-4b48-a96a-8e27067fc658`.
- Order 69, 17:27:50: `041c697e-53d0-42c6-b52f-e540cb523cbe`.
- Order 70, 17:28:26: `706ee88e-6cf6-4d94-bf3d-a3599ddc61c1`.
- Order 59, 17:29:04: `074a64e9-4137-4d48-933a-03b5fc6c206c`.
- Order 70, 17:31:24: `6d3f0b8f-884d-4aea-b855-7d40c35bc48d`.
- Order 70, 17:31:44: `0e0d1f6f-d21e-4ae5-a782-fc7b03f73219`.

Evidence: artifacts/sep-timing-20261102/bridge-diagnostics.json, attempts.json, timings.csv, delivery-audit.json. Only allowlisted bridge diagnostics, selected ledger metadata, and timing fields were collected. No payment, retry, reconciliation, or production configuration change was performed for this report.
