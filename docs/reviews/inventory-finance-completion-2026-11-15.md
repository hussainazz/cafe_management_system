# Inventory analytics and pricing completion, 15 November 2026

Stages 18 and 19 are complete locally, including the correctness and coverage
follow-ups from [the inventory finance review](inventory-finance-review-2026-11-15.md).
The shared Phase 1 variant helper was corrected as a dependency. This record
does not close the independent production baseline/release gate.

## Correctness changes

| Review item | Resolution |
| --- | --- |
| F1, option simulations | Apply historical option counts once, including partial selections and repeated lines. |
| F2, weighted simulations | Apply historical pricing mode and grams to product and option changes with integer Toman arithmetic. |
| F3, packaging scope | Scope fees and affected order cohorts to the selected PACKING product. The UI offers all category-specific charges. |
| F4, option variants | Normalize fixed-price selections per unit across packaging, sales analytics, and experiment grouping. Fractional reporting ratios are allowed without changing order-entry integer quantities. |
| F5, overlapping targets | Compute whole-group contribution gains once per sale cohort at the later sales mix. Individual target rows are not additive. Option price changes use historical option-price snapshots. |
| F6, incomplete costs | Withhold scenario break-even when the affected cohort has incomplete costs. Unknown costs elsewhere still suppress full café contribution and surplus. |
| F7, shared-option history | Require the product-specific event recorded for the target product. |
| F8, discounted history | Match earlier and proposed prices consistently using recorded effective prices. |

Operational and financial unfiltered sales now include the same packaging
revenue population while preserving their separate timestamp definitions.
Observed experiment break-even compares earlier and later unit contribution,
including cost changes. A price increase outweighed by higher costs does not
produce a positive tolerable volume decline.

Live browser verification also exposed a double-formatting problem in analytics
money labels. The labels now format the original numeric amount directly, with
a regression assertion against invalid output. Empty percentage/AOV values
remain unavailable. Report refresh retries the same selected experiment after
an error. Short custom periods correctly disclose unmatched weekdays.

## Automated evidence

| Check | Result |
| --- | --- |
| Full isolated API suite | 30 files / 267 tests passed. Reset applied all 53 current migrations to `cafe_management_test`. |
| Full POS suite | 35 files / 250 tests passed. |
| Contracts suite | 8 files / 28 tests passed. |
| Final API regressions | 11 tests passed after the final assertions, including fractional reporting ratios. |
| Final affected component tests | 2 files / 9 tests passed after the final UI copy and ratio-display changes. |
| Contracts, API, and POS typechecks | Passed. |
| Contracts, API, and POS production builds | Passed. |
| Original controlled review examples | All ten examples now return the independently expected results. |
| `git diff --check` | Passed. |

The API total includes 13 added tests: 11 PostgreSQL/API regressions and two
additional methodology cases. The POS total includes six added workflow cases.
Existing reconciliation-only assertions were strengthened with independent
price, volume, mix, and cost expectations.

The new integration coverage also exercises actual order creation and edits:
new lines receive first-entry timestamps, quantity changes preserve them,
added lines receive new timestamps, and legacy nulls remain null. Financial
fixtures cover known and incomplete costs, negative contributions, packaging,
filtered/empty buckets, peak periods, AOV, and exact contribution break-even.
Dashboard tests load contract-validated successful responses in READY,
IN_PROGRESS, and INCONCLUSIVE states and cover negative amounts, unavailable
metrics, report retry, comparison-period changes, packaging selection, and CSV
export with populated product rows.

No numerical coverage percentage is claimed. These checks target the financial
and workflow branches identified by the review.

## Browser evidence

The local Manager journey was exercised at `http://127.0.0.1:3002/pos` with the
development API and database, using the existing Manager session:

- Analytics loaded real responses and changed to half-hour intervals, producing
  48 time columns plus the weekday heading.
- At 390×844, the page had no horizontal document overflow. Wide heatmaps,
  tables, and charts scrolled inside their own containers.
- At 1280×800, the pricing dashboard rendered five daily charts and the
  comparison tables without page overflow.
- One labeled local analytical QA experiment was created. Its missing history
  and incomplete costs correctly produced an inconclusive report. No catalog
  price was changed.
- All category-specific packaging choices appeared. Both a packaging scenario
  and a product scenario with a custom -12.5% volume sensitivity completed.
  The product scenario used five recorded local units; its unchanged-volume
  revenue increased by exactly 5,000 Toman for a 1,000-Toman unit increase.
- The loaded report downloaded a populated 190-line UTF-8 CSV. Browser console
  inspection returned no warning/error entries during the completed journey.

Screenshots, CSV evidence, controlled-example output, and test/build logs are
stored outside the repository under
`/home/hosein/.codex/outputs/inventory-completion-2026-11-15/`.
The browser viewport override was reset after responsive testing.

## Boundaries

No new schema migration was needed for these fixes. The full API suite reset
only the authorized isolated test database. Development services were started
for verification; the existing development database was not reset. No
production database/service, menu price, uploaded image, commit, push, or
deployment was changed.

Phase 1's populated-production baseline and release verification remains open.
Physical café-device acceptance is a release check; browser viewport testing
does not claim acceptance on the actual Windows POS hardware. The unrelated
sold-products historical-undercount follow-up remains tracked separately.
