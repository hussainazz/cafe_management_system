# Inventory finance phases review, 15 November 2026

Follow-up status: F1–F8 and the Stage 18–19 coverage follow-ups were fixed and
verified locally later on 15 November. See [the completion record](inventory-finance-completion-2026-11-15.md).
The findings and source-line references below describe the review-time code.

The three phases are implemented, but their current test coverage is not
sufficient to accept all financial calculations. The existing suites pass while
controlled service-level examples reproduce the defects below. Correct these
and add independent numerical regression assertions before relying on pricing
experiment results.

## Scope and verification

Reviewed the uncommitted implementation in the existing `main` checkout against
Stages 17–19, ADR 0013, inventory costing, and the production testing gates:

1. Packaging economics and catalog price history.
2. Sales, contribution, and peak-hour analytics, including first-entry time.
3. Pricing experiments, comparisons, decomposition, and simulations.

Verification run during this review:

| Check | Result |
| --- | --- |
| `pnpm --filter @cafe/api test` | Passed, 29 files / 254 tests. The authorized isolated database reset applied all 53 migrations. |
| `pnpm --filter @cafe/pos test` | Passed, 35 files / 244 tests. |
| `pnpm --filter @cafe/contracts test` | Passed, 8 files / 28 tests. |
| API, POS, contracts typechecks | All passed. |
| `git diff --check` | Passed. |

API totals are summed across the separate file processes used by
`test/run-isolated-suite.mjs`. No source fixes, persistent regression tests,
builds, browser/device acceptance, production access, or deployment were part
of this review. The migration/restore rehearsal was inspected, not rerun; the
fresh isolated API reset above is separate evidence. No coverage percentage
was measured. There is no configured numerical coverage gate in the reviewed
API Vitest configuration.

Reproduction code, actual output, and verification logs are saved in
`/home/hosein/.codex/outputs/inventory-review-2026-11-15/`.
`inventory-review-probes.mts` calls the actual reporting services with controlled
in-memory Prisma query results; it does not connect to a database. These probes
demonstrate service calculations and are not substitutes for API/PostgreSQL
regression tests. Run from this checkout with:

```sh
pnpm --filter @cafe/api exec tsx /home/hosein/.codex/outputs/inventory-review-2026-11-15/inventory-review-probes.mts
```

## Findings

### F1, P1: Option simulations multiply an already-total option quantity again

In `apps/api/src/modules/inventory/pricing-experiment.service.ts:913`, option
quantity becomes a per-group unit adjustment. Lines 923 and 939 then multiply
it by the group's sold quantity. Order pricing stores the option count for the
whole line, as confirmed by `orders.service.ts:196`, rather than per product
unit.

Reproduction: two 10,000-Toman products with two selected 3,000-Toman options
have revenue of 26,000. Increasing the option by 1,000 should produce 28,000
at unchanged volume. The service returns 30,000. Contribution, monthly
equivalents, and break-even inherit the inflated benefit. Test option counts
equal to and smaller than line quantity, repeated lines, and multiple orders.

### F2, P1: Weighted product simulations use item count instead of kilograms

`pricing-experiment.service.ts:907` applies product/category price adjustments
per `group.quantity`. The grouping does not retain the pricing mode or weight
needed to convert a per-kilogram adjustment into line revenue. Live order
pricing performs that conversion in `orders.service.ts:207`.

Reproduction: a 500-gram sale at 10,000 Toman/kg has revenue of 5,000. A
1,000-Toman/kg increase should produce 5,500. Simulation returns 6,000.
Preserve pricing units and weight when aggregating simulations, and cover
weighted products and weighted options with numerical examples.

### F3, P1: Packaging targets affect packaging products outside their category

`pricing-experiment.service.ts:903` applies the selected packaging rule to
`summary.packagingLineUnits` across the entire report. Target classification at
line 120 also identifies any takeaway order with any packaging charge as
affected. Neither path checks the selected packaging product ID. The catalog
supports a distinct PACKING product per category. The UI further selects only
the first PACKING product in
`apps/pos/app/components/inventory-pricing-experiments.tsx:110`.

Reproduction: two orders use different category packaging products, with fees
of 500 and 700. Their total revenue is 21,200. Raising only the first fee by
1,000 should produce 22,200 with one affected packaging unit. The service
returns 23,200 and two affected units. Scope rule application, target
classification, unit counts, and packaging selection to the target identity.

### F4, P1: Line size changes the identity of an option variant

`apps/api/src/modules/inventory/gross-profit.service.ts:54` includes absolute
line-level option quantities in `packagingVariantKey`. Packaging reporting,
sales analytics, and pricing experiments reuse this key. Two units with two
large-size selections and one unit with one large-size selection therefore
become different variants despite identical per-unit choices.

Reproduction: before, two large coffees produce 26,000 revenue and cost
10,000; after, one large coffee produces 16,000 and costs 5,000. A one-product
comparison should have one variant, a 4,500 price effect, and no mix effect.
The report has two product rows, a zero price effect, and a 4,500 mix effect.
Its components still sum correctly, which explains why reconciliation-only
tests miss the error. Normalize fixed-price option selections by line quantity
and test the individual decomposition factors against independent values.

### F5, P1: Overlapping targets double-count the whole-group break-even benefit

`pricing-experiment.service.ts:634` measures the complete realized product-line
price change separately for each target. Line 659 then sums these target
benefits, including when product and option targets cover the same sale.

Reproduction: a product base price rises from 10,000 to 12,000 and its option
from 3,000 to 4,000. Total realized price rises from 13,000 to 16,000; cost
stays 5,000. The benefit is 3,000 and the tolerable decline is 3,000/11,000,
or 27.27%. The report counts 3,000 for each target and returns 54.55%.
Calculate whole-group benefit once per underlying sale group. Cover combined
product, option, and packaging targets.

### F6, P1: Simulations return break-even percentages with incomplete costs

`pricing-experiment.service.ts:920` uses group costs to calculate affected
contribution, but lines 926–927 do not require complete cost coverage before
returning a break-even percentage. The scenario later correctly suppresses
full contribution while still exposing that percentage at line 963.

Reproduction: a 10,000-Toman sale has unknown full cost and 2,000 of known
cost. Simulating a 1,000 increase returns `contributionAmount: null` and
`costsComplete: false`, but `breakEvenVolumeDeclinePercent: "11.11"`.
The missing costs can materially change the threshold. Suppress the threshold
unless all affected variable costs are complete, including relevant packaging
inputs. Test mixtures of complete and incomplete groups.

### F7, P2: Option price-history matching ignores the target product

`pricing-experiment.service.ts:152` matches option events by option ID and
dimension without matching their product ID. Phase 1 records product-specific
events for shared options and overrides, so an event can describe another
product's price.

Reproduction: product B changes a shared option override from 3,000 to 4,000.
An experiment targeting the same option on product A reports MATCHED using
B's event. If both products have matching events, the correct event can instead
become AMBIGUOUS. Respect product-specific applicability and handle genuinely
global option events explicitly. Cover both shared base-price changes and
product overrides.

### F8, P2: Discount history compares a base price with an effective price

`pricing-experiment.service.ts:164` prefers `previousAmount`, while line 168
and displayed realized-price metadata prefer `previousEffectivePriceAmount`.
Discount events preserve the unchanged product base price in `previousAmount`
and the discounted selling price separately in `previousEffectivePriceAmount`.

Reproduction: a product's base price stays 13,000 while its effective price
changes from 12,000 to 11,000 through a larger discount. A target with previous
price 12,000 and proposed price 11,000 is classified MISMATCHED, while the same
response says `originalPriceMatches: true`. Use a consistent price dimension
for both status and original-price matching. Cover existing discounts when
changing base prices as well as changing the discount itself.

## Additional reporting semantics to settle

- Operational net sales exclude PACKING while financial net sales include it.
  The same order on the same date reports 10,000 operational revenue and
  10,500 financial revenue. See `sales-analytics.service.ts:55` and line 220,
  compared with line 269. Confirm the intended definition and disclose the
  difference, or reconcile the revenue population. The current tests have no
  explicit charged-packaging example for this comparison.
- The observed experiment break-even numerator uses realized price change,
  rather than change in unit contribution. With price 10,000 to 11,000 and
  cost 4,000 to 6,000, contribution falls from 6,000 to 5,000, yet the report
  shows a tolerable decline of 20%. This can describe a price-only
  counterfactual at the new cost; it does not preserve the observed earlier
  contribution. Clarify the baseline and label, and test cost changes explicitly.

## Coverage assessment

| Area | Existing evidence | Assessment and missing checks |
| --- | --- | --- |
| Phase 1 accounting and price writes | Real PostgreSQL/API tests cover nested packaging, duplicate lines, variant allocation, one-Toman rounding, legacy ambiguity, missing valuation, zero material cost, reversals, date boundaries, no-op writes, concurrency, and authorization. | Stronger than later phases. Add line-size-invariant variant tests. Existing upgrade baseline verification checks a plain product; extend populated fixtures to discounted products, shared options, and overrides. |
| Phase 2 analytics | Two integration tests cover separate timestamps, 30-minute buckets, filters, schedule boundaries, fallback, split settlements, exclusions, and roles. Two component tests cover rendering and filter submission. | Useful baseline, insufficient financial assertions. Add fully costed and mixed-cost buckets, negative/zero contribution, packaging reconciliation, multiple products/dates, and independent peak/AOV expectations. |
| Phase 2 first-entry lifecycle | The analytics integration test manually overwrites `enteredAt` to exercise reports. | No direct assertions that create stamps new lines, quantity edits preserve first entry, adding a line gives a new entry time, and legacy nulls remain null through edits. These should exercise the real order mutation API. |
| Phase 3 experiments | Two integration tests, six methodology tests, three request-contract tests, one workflow component test, and one CSV test. | Insufficient for the calculation scope. Add regressions for F1–F8, exact Shapley components, cost changes, new/disappearing variants, partial/custom windows, shared options, and financial null propagation. |
| Phase 3 dashboard | The component test mocks report retrieval as 404 and exercises metadata creation plus simulation. | The successful report dashboard is untested. Render READY, IN_PROGRESS, and INCONCLUSIVE responses, negative contribution, missing costs/history, multi-category packaging, period switching, and CSV export with actual rows. |
| Browser/device flow | The completion notes explicitly record that browser/device acceptance was not run. | Class names and SVG presence in jsdom do not verify mobile layout. Walk through a real Manager report and simulation at phone and POS sizes with real API responses. |
| Migration and release | This review successfully reset the isolated test database through all 53 migrations. A separate rehearsal script exists. | Do not confuse this with populated-production baseline verification or browser acceptance. The Phase 1 release/baseline gate remains open. |

## Required follow-up

Fix F1–F8 under the already-approved reporting scope, with focused numerical
regressions that fail on this implementation. Resolve the two reporting
semantics above. Add first-entry lifecycle and successful dashboard coverage.
Run the affected suites and typechecks, then complete the browser journey and
release-specific baseline verification before interpreting live experiments.
