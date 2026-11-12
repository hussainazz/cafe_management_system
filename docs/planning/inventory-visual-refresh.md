# Inventory screenshot implementation

## Approved direction

The owner selected supplied Image 4 for the overview, Image 1 for the stock
inspector and Image 2 for the gross-profit report. Inventory uses charcoal
panels, amber actions, green financial/status accents, Estedad and Persian RTL.
The surrounding POS identity remains intact. Product images are deliberately
omitted from every inventory-related panel, per the owner's later correction.

This delivery extends the earlier uncommitted inventory refresh. The fixed owner
references are the composition and quality authority; no concept lottery,
generated comp or retrospective seed is claimed. The direction record is
`.impeccable/inventory-direction.md` at the repository root.

## Functional scope

- Overview shows active stock value/coverage, optional-threshold or zero-stock
  attention, pending consumption, daily financial trends, a searchable stock
  table with local pagination, and recent movements.
- Stock remains distinct from menu products. Its right-hand desktop inspector
  shows base-unit quantity, carrying value, moving-average unit cost, configured
  warning threshold, pack conversions and item-filtered movement history.
- The owner explicitly approved optional Manager-configured `lowStockThreshold`
  in each item's base unit. Null disables configured low-stock alerts; comparison
  is exact to six decimal places and includes equality. Untracked quantities
  remain unknown. Zero stock remains separately visible. Threshold edits use
  existing Manager authorization, version checks and audit snapshots and never
  post ledger movements or initiate purchases.
- The Manager profit report adds daily Tehran recognition-date revenue, COGS,
  gross profit and margin from the same whole-order paid snapshots used by the
  existing report. Quiet days have zero amounts and unavailable margins; missing
  costs remain null, losses remain signed, and null days create chart gaps.
  Isolated non-null margins have visible markers. Category contribution states
  that it uses the current menu classification.
- Purchase-first navigation, purchase posting/return safeguards, recipe saved-cost
  previews, physical-count reconciliation and movement filtering are retained.
  No forecasting, automatic purchasing, supplier accounts or invented historical
  category attribution is added.

## Implementation and verification

The additive threshold migration is `20261111120000_optional_stock_threshold`.
It has been applied only to the authorized local development database. The
current 47-migration set passes fresh/repeat deploy, existing-data upgrade,
exact-seed, atomic-failure and clean-backup/restore verification.

The final full POS suite passes 213 tests across 31 files with two workers.
Inventory API integration passes 24 tests and activation integration passes 9;
API/POS typechecks and the POS production build pass. The one Impeccable static
scan returned no findings. No repository lint gate was run, per the owner's rule.

Browser inspection covers overview, stock inspector and profit report on desktop
and phone layouts, plus mobile purchase/recipe/count forms and navigation open
and closed states. Measured DOM viewports are 1713×918 and 390×844; the provider's
returned JPEG sizes are recorded separately in
`.impeccable/review/inventory-20261111/capture-manifest.json`. Native key/scroll
no-op captures were discarded and replaced using locator-driven actions with
measured scroll positions. No screenshot scaling or compositing was used.

The final density correction places a complete first stock row and the alert
empty-state message within the initial desktop viewport. Existing physical café
computer and production acceptance items remain in `../current-left.md`.

The independent final review returned a ship disposition for all six scored
corrections. Its bounded verdict is
`.impeccable/review/inventory-20261111/verdict-pass-final.md`; it does not claim a
whole-surface score.

The final inventory-only system is recorded in `apps/pos/DESIGN.md` and
`apps/pos/.impeccable/design.json` at the repository root. It preserves the
surrounding POS identity and the owner's no-product-images requirement.

There has been no commit, push, production deployment or product-image transfer.
