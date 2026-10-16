# Inventory Costing And Gross Profit

## Status And Authority

**Status:** approved for implementation on 12 October 2026. This is the detailed
feature scope for the inventory-costing phase. Product boundaries remain in
`scope.md`; backend acceptance and sequence remain in `backend-backlog.md`;
current progress remains in `../current-left.md`.

## Purpose And Boundaries

Add a Manager-only stock, purchase, recipe, physical-count, and gross-profit
workspace to the existing POS. This phase calculates gross profit only:

```text
gross profit = net sales - theoretical COGS
gross margin = gross profit / net sales * 100
```

Operating expenses such as wages, rent, and utilities are excluded. Supplier
accounts, purchase orders, dedicated waste or staff-consumption entry,
historical sales imports, and automatic portion-yield conversion are excluded.
The product remains one café, one branch, and one authoritative API/database.

## Stock Units And Valuation

- Each stock item has one base unit: grams, milliliters, or pieces.
- Purchase packs use named, item-specific conversions to base quantities.
  Kilograms convert to grams and liters convert to milliliters only through an
  explicit conversion. Never infer a weight-to-volume conversion.
- Quantities and fractional unit costs use exact decimal arithmetic. Monetary
  amounts are integer Toman. Derive unit cost from total value and exact base
  quantity; round only when posting a total monetary value, using deterministic
  half-up rounding. Display-rounded unit prices never drive calculations.
- Stock-item setup records the starting base-unit quantity and total stock value
  in Toman, including an explicit zero balance. Creating an item initializes
  its tracked balance and auditable opening entry. Do not reconstruct old sales
  or deduct stock for historical orders. Existing untracked items may be
  initialized once from stock-item setup; an opening balance cannot reset a
  tracked item.
- Manager count entry is physical-count only and selects tracked stock items.
  If any observed quantity differs from its recorded quantity, require one
  shared reason for the whole count. Physical counts append adjustments and
  retain the reason with the count; a value-only difference does not require a
  quantity-discrepancy reason.
- Purchases and physical counts append inventory movements and update the
  current quantity and carrying value transactionally. Posted transactions
  are immutable; corrections append linked compensating movements.
- Moving-average valuation is maintained per stock item. Receipts use the
  entered direct cost in Toman; no tax, delivery, labor, or overhead is
  silently added.
- Archiving a stock item hides it from active stock-selection and management
  lists but retains its database history for accounting and audit. A new active
  stock item may reuse an archived item's name; names remain unique among
  active, non-archived stock items.

## Purchases, Recipes, And Cost Configuration

- A purchase records received time, optional supplier text, received lines,
  the selected purchase-unit conversion, exact received base quantity, and
  final direct cost in Toman. Posting is idempotent and creates movements.
- Stock-item setup does not ask Managers to enter a category. Keep the
  existing category value for compatibility. For piece-based stock, expose one
  optional count-per-package value; weight and volume stock retain named pack
  conversions.
- Purchase history uses the existing cursor pagination and supports supplier
  or stock-item search, status filtering, and a received-time range.
- A recipe contains a precise preparation name (for example, `Latte 50/50`)
  and a shared ingredient name (for example, `Latte`). Recipe variants may use
  different precise names while sharing the same ingredient name. The POS
  selects the precise recipe for costing; the shared name is the future-facing
  label for menu integration. A recipe contains measured components, each
  referring either to a stock item or another precise recipe, allowing reusable
  preparations such as an espresso dose. Reject circular recipe references.
- Each product has either a recipe costing configuration or a purchased-stock
  configuration. Purchased desserts may include a configured recipe of direct
  extras. Whole cakes use their actual sold unit; automatic slice-yield
  conversion is excluded.
- Option costing rules target named recipe components and may replace a
  component, change its quantity, or add ingredients. Resolve the base recipe,
  then individual option rules, then an explicitly configured exact option
  combination override. Reject ambiguous or conflicting rules.
- Manager recipe setup is product-first: choose an active menu product, then
  configure its active menu options. Each configured option has a complete
  recipe of its own, with components selected from active stock items or
  existing recipes and measured in the selected source's unit. Reuse the
  existing cycle-free recipe graph and costing snapshots. Keep legacy option
  rules and combination overrides readable and resolvable for existing
  configurations; new full-recipe option mappings take precedence for the
  selected option and cannot be combined ambiguously.
- Recipe previews resolve selected product options and show required stock
  quantities and current known cost. Missing recipe, stock, cost, or opening
  setup is explicitly incomplete; never substitute zero.

## Order Snapshots And Stock Consumption

- Inventory ships inactive. A Manager activates it once from Café Settings;
  persist the activation timestamp and audit the action. Activation is permanent
  and cannot be cleared or moved through the API or ORM.
- While inactive, block all inventory management, costing, and gross-profit API
  operations and show the installed inventory workspace as inactive. Skip all
  order costing snapshots, recognition, pending consumption, stock movements,
  retries, and restorations. Normal orders and payments continue unchanged.
- Track only orders created at or after activation. Orders created earlier
  stay excluded even when edited, paid, deleted, or reversed after activation.
  Never backfill pre-activation orders or queue them for later consumption.
- Save a resolved costing snapshot for each order item. Unsettled content edits
  update their corresponding snapshots; catalog edits never rewrite saved
  historical recipes.
- Recognize theoretical item costs only when the whole order first becomes
  fully paid. Capture the cost snapshot using current moving averages. Partial
  payments have no consumption or gross-profit recognition.
- Deduct stock for the whole order in one transaction only if every required
  quantity is available. If any stock item is short, deduct nothing and create
  one pending-consumption record for the entire order. Checkout remains
  available.
- A posted receipt retries pending orders in full-payment order. Fulfill each
  complete order in full only when every required item is available; do not
  reserve or consume partial ingredients. Actual movement value uses the
  moving average at posting time, while theoretical profit retains the cost
  snapshot from full payment.
- Before posting a physical count, the Manager identifies pending orders whose
  ingredients are already included in the observed count. Reconcile those
  orders without another deduction, then establish the observed balance.
- Count history is bounded and newest-first, with server-side stock-item
  search, count kind/status filters, and a Tehran-calendar creation-time range.
- Later recipe or valuation setup affects future orders. It never fills a
  historical cost gap automatically.

## Corrections And Reporting

- Tender-method corrections do not affect inventory or profit.
- A settlement reversal that makes an order no longer fully paid restores its
  previously deducted stock. Deleting a recognized order also restores stock,
  including count-reconciled consumption, exactly once. Restore recorded
  carrying value, not the current recipe or current average cost.
- Cancel pending consumption when its sale loses eligibility. Never restore
  quantities that were neither deducted nor absorbed by a posted count.
- A reversal or deletion removes the sale and theoretical profit from its
  original reporting period. Physical return movements remain dated ledger
  events, and physical-count history is retained.
- Use bounded arbitrary date ranges with the existing Persian date controls
  and `Asia/Tehran` boundaries. Recognize net sales on whole-order full
  payment, after persisted catalog, item, and order discounts, using existing
  authoritative revenue allocation.
- Report per-product and café net sales, theoretical COGS, gross profit, gross
  margin, cost coverage, and pending-consumption status. Compute café margin
  from aggregate amounts, never from averaged product margins. Margin is
  unavailable when net sales are zero or cost completeness does not support a
  full aggregate.
- Calculate inventory-based period consumption from opening valuation,
  receipts, and closing valuation, with returns and count reconciliations
  explicit. Label arbitrary-period actual COGS as an estimate unless supported
  by physical-count boundaries. Show unresolved pending consumption, missing
  valuations, and variance. Compare theoretical and inventory-based COGS only
  over compatible coverage; variance cannot identify waste, staff use, or
  preparation mistakes.

## Authorization And Delivery

- Inventory configuration, purchases, counts, movements, pending consumption,
  previews, and gross-profit reports are Manager-only. Settlement commands
  remain available through existing Staff/Manager order workflows and trigger
  stock recognition in the API. Staff, receipts, and public-menu DTOs never
  expose cost or margin data.
- Posting commands require idempotency keys. Editable configurations use
  version checks. Corrections are audited. Settlement recognition, count
  reconciliation, movement creation, and balance changes use database
  transactions and concurrency protection.
- Add validated shared contracts and OpenAPI documentation with each API
  implementation. Preserve the coordinated API/POS release and migration
  gates. Deployment and further commits/pushes require separate authorization.

## Delivery Stages

1. Approved planning baseline, schema, contracts, and migration.
2. Purchases, valuation, recipes, settlement integration, and count
   reconciliation.
3. Manager stock/costing panels and gross-profit reports.
4. Integration, browser, migration/restore, and performance verification.
