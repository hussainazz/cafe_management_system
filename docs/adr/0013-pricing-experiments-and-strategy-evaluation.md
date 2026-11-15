# ADR 0013: Manager pricing experiments and strategy evaluation

## Status

Accepted on 15 November 2026 as part of the explicit Phase 3 implementation
request. This decision extends Manager reporting; it does not authorize a menu
price change or a production release.

## Decision

Add Manager-only pricing experiment records and a report that compares equal
pre-change and post-change full-day periods in `Asia/Tehran`. Preserve each
experiment's name, effective timestamp, evaluation duration, comparison
duration, product/option/packaging targets, before and proposed prices, and
optional notes as analysis metadata. Creating or simulating an experiment never
writes catalog prices.

Where Phase 1 catalog history supports a match, associate a target with its
recorded change event. Report missing, ambiguous, or mismatched history and
do not fill an unknown original price from the current catalog. Compare
historical sales using persisted order-item and option snapshots. Use the
existing fully-paid order eligibility, settlement-allocation,
recognized-consumption, cost-snapshot, and packaging-attribution rules.

The report separates affected items from unaffected items and shows observed
changes as observational evidence. Price, volume, mix, and unit-cost components
use a Shapley decomposition over those four factors, so the reported components
reconcile to observed contribution change when the relevant cost and packaging
data are complete. Otherwise report a residual and the unavailable inputs.
Neither an observed before/after change nor an unaffected-product comparison
proves that the price change caused the result.

Use 265,000,000 Toman as the confirmed RUN Café monthly fixed-cost assumption.
Convert eligible contribution to a 30-day monthly equivalent. Show fixed-cost
coverage only from complete eligible contribution. Show operating
surplus/shortfall only when the applicable variable costs are complete.

Support hypothetical product-, category-, option-, and packaging-price
scenarios with volume sensitivities. Simulations use recorded volume and cost
snapshots, state their assumptions, and never mutate catalog prices or create
orders. They are sensitivity calculations, not demand forecasts or
recommendations.

## Consequences

- Experiment metadata and target prices are auditable and separate from the
  catalog and order ledger.
- Reports must keep unknown cost, incomplete history, partial days, confounders,
  and unmatched weekday samples visible.
- A report may conclude that the evidence is inconclusive. Revenue growth alone
  is never a success criterion.
- The Manager UI belongs under Inventory/Analytics and must use Persian RTL
  formatting.
- Live pricing experiments remain dependent on the Phase 1 price-history
  baseline being released and verified.
