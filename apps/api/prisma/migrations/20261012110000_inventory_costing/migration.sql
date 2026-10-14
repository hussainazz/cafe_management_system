-- CreateEnum
CREATE TYPE "InventoryUnit" AS ENUM ('GRAM', 'MILLILITER', 'PIECE');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('OPENING_COUNT', 'PURCHASE_RECEIPT', 'ORDER_CONSUMPTION', 'ORDER_RESTORATION', 'PHYSICAL_COUNT_ADJUSTMENT', 'PURCHASE_RETURN');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "InventoryCountKind" AS ENUM ('OPENING', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "RecipeComponentKind" AS ENUM ('STOCK_ITEM', 'RECIPE');

-- CreateEnum
CREATE TYPE "ProductCostingMode" AS ENUM ('RECIPE', 'PURCHASED_ITEM');

-- CreateEnum
CREATE TYPE "CostingRuleAction" AS ENUM ('REPLACE_COMPONENT', 'CHANGE_QUANTITY', 'ADD_COMPONENT');

-- CreateEnum
CREATE TYPE "OrderConsumptionStatus" AS ENUM ('PENDING', 'POSTED', 'RECONCILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "stock_items" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "baseUnit" "InventoryUnit" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_unit_conversions" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "baseQuantityPerPack" DECIMAL(20,6) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_unit_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "stockItemId" TEXT NOT NULL,
    "quantityOnHand" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "carryingValueAmount" INTEGER NOT NULL DEFAULT 0,
    "trackingStartedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("stockItemId")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "supplier" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_lines" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "conversionId" TEXT,
    "purchaseUnitLabel" TEXT NOT NULL,
    "purchaseQuantity" DECIMAL(20,6) NOT NULL,
    "baseQuantityPerPack" DECIMAL(20,6) NOT NULL,
    "baseQuantityReceived" DECIMAL(20,6) NOT NULL,
    "directCostAmount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outputUnit" "InventoryUnit" NOT NULL,
    "yieldQuantity" DECIMAL(20,6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_components" (
    "id" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "componentKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sourceKind" "RecipeComponentKind" NOT NULL,
    "stockItemId" TEXT,
    "nestedRecipeId" TEXT,
    "quantity" DECIMAL(20,6) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costing_configurations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "mode" "ProductCostingMode" NOT NULL,
    "recipeId" TEXT,
    "recipeQuantity" DECIMAL(20,6),
    "purchasedStockItemId" TEXT,
    "purchasedQuantity" DECIMAL(20,6),
    "extrasRecipeId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_costing_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_costing_rules" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "action" "CostingRuleAction" NOT NULL,
    "componentKey" TEXT NOT NULL,
    "label" TEXT,
    "replacementStockItemId" TEXT,
    "replacementRecipeId" TEXT,
    "quantity" DECIMAL(20,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_costing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_costing_combinations" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_costing_combinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "costing_combination_options" (
    "combinationId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,

    CONSTRAINT "costing_combination_options_pkey" PRIMARY KEY ("combinationId","optionId")
);

-- CreateTable
CREATE TABLE "product_combination_costing_rules" (
    "id" TEXT NOT NULL,
    "combinationId" TEXT NOT NULL,
    "action" "CostingRuleAction" NOT NULL,
    "componentKey" TEXT NOT NULL,
    "label" TEXT,
    "replacementStockItemId" TEXT,
    "replacementRecipeId" TEXT,
    "quantity" DECIMAL(20,6),

    CONSTRAINT "product_combination_costing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "kind" "InventoryCountKind" NOT NULL,
    "status" "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_lines" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "expectedQuantity" DECIMAL(20,6),
    "observedQuantity" DECIMAL(20,6) NOT NULL,
    "differenceQuantity" DECIMAL(20,6),
    "expectedValueAmount" INTEGER,
    "observedValueAmount" INTEGER NOT NULL,
    "differenceValueAmount" INTEGER,

    CONSTRAINT "inventory_count_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_count_pending_orders" (
    "countId" TEXT NOT NULL,
    "orderConsumptionId" TEXT NOT NULL,
    "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_count_pending_orders_pkey" PRIMARY KEY ("countId","orderConsumptionId")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "quantityDelta" DECIMAL(20,6) NOT NULL,
    "valueDeltaAmount" INTEGER NOT NULL,
    "purchaseLineId" TEXT,
    "orderConsumptionId" TEXT,
    "inventoryCountLineId" TEXT,
    "compensatesMovementId" TEXT,
    "createdById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_costing_snapshots" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "configurationVersion" INTEGER,
    "snapshot" JSONB NOT NULL,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "missingReasons" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_costing_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_consumptions" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "paymentSettlementId" TEXT NOT NULL,
    "status" "OrderConsumptionStatus" NOT NULL DEFAULT 'PENDING',
    "recognizedById" TEXT NOT NULL,
    "recognizedAt" TIMESTAMP(3) NOT NULL,
    "theoreticalCogsAmount" INTEGER,
    "knownCogsAmount" INTEGER NOT NULL DEFAULT 0,
    "isCostComplete" BOOLEAN NOT NULL DEFAULT false,
    "costSnapshot" JSONB NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_consumption_items" (
    "id" TEXT NOT NULL,
    "orderConsumptionId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "weightGrams" INTEGER,
    "theoreticalCogsAmount" INTEGER,
    "knownCogsAmount" INTEGER NOT NULL DEFAULT 0,
    "isCostComplete" BOOLEAN NOT NULL DEFAULT false,
    "costSnapshot" JSONB NOT NULL,

    CONSTRAINT "order_consumption_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_items_name_key" ON "stock_items"("name");

-- CreateIndex
CREATE INDEX "stock_items_isActive_category_name_idx" ON "stock_items"("isActive", "category", "name");

-- CreateIndex
CREATE INDEX "stock_unit_conversions_stockItemId_isActive_idx" ON "stock_unit_conversions"("stockItemId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "stock_unit_conversions_stockItemId_label_key" ON "stock_unit_conversions"("stockItemId", "label");

-- CreateIndex
CREATE INDEX "purchases_status_receivedAt_id_idx" ON "purchases"("status", "receivedAt", "id");

-- CreateIndex
CREATE INDEX "purchase_lines_purchaseId_idx" ON "purchase_lines"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_lines_stockItemId_purchaseId_idx" ON "purchase_lines"("stockItemId", "purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_name_key" ON "recipes"("name");

-- CreateIndex
CREATE INDEX "recipes_isActive_name_idx" ON "recipes"("isActive", "name");

-- CreateIndex
CREATE INDEX "recipe_components_stockItemId_idx" ON "recipe_components"("stockItemId");

-- CreateIndex
CREATE INDEX "recipe_components_nestedRecipeId_idx" ON "recipe_components"("nestedRecipeId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_components_recipeId_componentKey_key" ON "recipe_components"("recipeId", "componentKey");

-- CreateIndex
CREATE UNIQUE INDEX "product_costing_configurations_productId_key" ON "product_costing_configurations"("productId");

-- CreateIndex
CREATE INDEX "product_costing_configurations_recipeId_idx" ON "product_costing_configurations"("recipeId");

-- CreateIndex
CREATE INDEX "product_costing_configurations_purchasedStockItemId_idx" ON "product_costing_configurations"("purchasedStockItemId");

-- CreateIndex
CREATE INDEX "product_option_costing_rules_optionId_idx" ON "product_option_costing_rules"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "product_option_costing_rules_productId_optionId_componentKe_key" ON "product_option_costing_rules"("productId", "optionId", "componentKey");

-- CreateIndex
CREATE INDEX "product_costing_combinations_productId_isActive_idx" ON "product_costing_combinations"("productId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "product_costing_combinations_productId_name_key" ON "product_costing_combinations"("productId", "name");

-- CreateIndex
CREATE INDEX "costing_combination_options_optionId_idx" ON "costing_combination_options"("optionId");

-- CreateIndex
CREATE UNIQUE INDEX "product_combination_costing_rules_combinationId_componentKe_key" ON "product_combination_costing_rules"("combinationId", "componentKey");

-- CreateIndex
CREATE INDEX "inventory_counts_status_createdAt_id_idx" ON "inventory_counts"("status", "createdAt", "id");

-- CreateIndex
CREATE INDEX "inventory_count_lines_stockItemId_idx" ON "inventory_count_lines"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_count_lines_countId_stockItemId_key" ON "inventory_count_lines"("countId", "stockItemId");

-- CreateIndex
CREATE INDEX "inventory_count_pending_orders_orderConsumptionId_idx" ON "inventory_count_pending_orders"("orderConsumptionId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_inventoryCountLineId_key" ON "inventory_movements"("inventoryCountLineId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movements_compensatesMovementId_key" ON "inventory_movements"("compensatesMovementId");

-- CreateIndex
CREATE INDEX "inventory_movements_stockItemId_recordedAt_id_idx" ON "inventory_movements"("stockItemId", "recordedAt", "id");

-- CreateIndex
CREATE INDEX "inventory_movements_orderConsumptionId_kind_idx" ON "inventory_movements"("orderConsumptionId", "kind");

-- CreateIndex
CREATE INDEX "inventory_movements_purchaseLineId_idx" ON "inventory_movements"("purchaseLineId");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_costing_snapshots_orderItemId_key" ON "order_item_costing_snapshots"("orderItemId");

-- CreateIndex
CREATE INDEX "order_consumptions_status_recognizedAt_id_idx" ON "order_consumptions"("status", "recognizedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "order_consumptions_orderId_cycleNumber_key" ON "order_consumptions"("orderId", "cycleNumber");

-- CreateIndex
CREATE UNIQUE INDEX "order_consumptions_orderId_paymentSettlementId_key" ON "order_consumptions"("orderId", "paymentSettlementId");

-- CreateIndex
CREATE INDEX "order_consumption_items_orderItemId_idx" ON "order_consumption_items"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "order_consumption_items_orderConsumptionId_orderItemId_key" ON "order_consumption_items"("orderConsumptionId", "orderItemId");

-- AddForeignKey
ALTER TABLE "stock_items" ADD CONSTRAINT "stock_items_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_unit_conversions" ADD CONSTRAINT "stock_unit_conversions_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_conversionId_fkey" FOREIGN KEY ("conversionId") REFERENCES "stock_unit_conversions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_nestedRecipeId_fkey" FOREIGN KEY ("nestedRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "product_costing_configurations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "product_costing_configurations_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "product_costing_configurations_purchasedStockItemId_fkey" FOREIGN KEY ("purchasedStockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "product_costing_configurations_extrasRecipeId_fkey" FOREIGN KEY ("extrasRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_configurations" ADD CONSTRAINT "product_costing_configurations_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_costing_rules" ADD CONSTRAINT "product_option_costing_rules_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_costing_rules" ADD CONSTRAINT "product_option_costing_rules_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_costing_rules" ADD CONSTRAINT "product_option_costing_rules_replacementStockItemId_fkey" FOREIGN KEY ("replacementStockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_costing_rules" ADD CONSTRAINT "product_option_costing_rules_replacementRecipeId_fkey" FOREIGN KEY ("replacementRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_costing_combinations" ADD CONSTRAINT "product_costing_combinations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_combination_options" ADD CONSTRAINT "costing_combination_options_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "product_costing_combinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "costing_combination_options" ADD CONSTRAINT "costing_combination_options_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_combination_costing_rules" ADD CONSTRAINT "product_combination_costing_rules_combinationId_fkey" FOREIGN KEY ("combinationId") REFERENCES "product_costing_combinations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_combination_costing_rules" ADD CONSTRAINT "product_combination_costing_rules_replacementStockItemId_fkey" FOREIGN KEY ("replacementStockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_combination_costing_rules" ADD CONSTRAINT "product_combination_costing_rules_replacementRecipeId_fkey" FOREIGN KEY ("replacementRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_countId_fkey" FOREIGN KEY ("countId") REFERENCES "inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_pending_orders" ADD CONSTRAINT "inventory_count_pending_orders_countId_fkey" FOREIGN KEY ("countId") REFERENCES "inventory_counts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_count_pending_orders" ADD CONSTRAINT "inventory_count_pending_orders_orderConsumptionId_fkey" FOREIGN KEY ("orderConsumptionId") REFERENCES "order_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "purchase_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_orderConsumptionId_fkey" FOREIGN KEY ("orderConsumptionId") REFERENCES "order_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventoryCountLineId_fkey" FOREIGN KEY ("inventoryCountLineId") REFERENCES "inventory_count_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_compensatesMovementId_fkey" FOREIGN KEY ("compensatesMovementId") REFERENCES "inventory_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_costing_snapshots" ADD CONSTRAINT "order_item_costing_snapshots_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_consumptions" ADD CONSTRAINT "order_consumptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_consumptions" ADD CONSTRAINT "order_consumptions_paymentSettlementId_fkey" FOREIGN KEY ("paymentSettlementId") REFERENCES "payment_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_consumptions" ADD CONSTRAINT "order_consumptions_recognizedById_fkey" FOREIGN KEY ("recognizedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_consumption_items" ADD CONSTRAINT "order_consumption_items_orderConsumptionId_fkey" FOREIGN KEY ("orderConsumptionId") REFERENCES "order_consumptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_consumption_items" ADD CONSTRAINT "order_consumption_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks Prisma's schema language cannot currently express.
ALTER TABLE "stock_items"
  ADD CONSTRAINT "stock_items_name_nonempty" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "stock_items_category_nonempty" CHECK (length(btrim("category")) > 0),
  ADD CONSTRAINT "stock_items_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "stock_items_archive_inactive" CHECK ("archivedAt" IS NULL OR "isActive" = false);

ALTER TABLE "stock_unit_conversions"
  ADD CONSTRAINT "stock_unit_conversions_label_nonempty" CHECK (length(btrim("label")) > 0),
  ADD CONSTRAINT "stock_unit_conversions_quantity_positive" CHECK ("baseQuantityPerPack" > 0);

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_quantity_nonnegative" CHECK ("quantityOnHand" >= 0),
  ADD CONSTRAINT "inventory_balances_value_nonnegative" CHECK ("carryingValueAmount" >= 0),
  ADD CONSTRAINT "inventory_balances_untracked_is_empty" CHECK (
    "trackingStartedAt" IS NOT NULL OR ("quantityOnHand" = 0 AND "carryingValueAmount" = 0)
  );

ALTER TABLE "purchases"
  ADD CONSTRAINT "purchases_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "purchases_supplier_nonempty" CHECK ("supplier" IS NULL OR length(btrim("supplier")) > 0),
  ADD CONSTRAINT "purchases_status_posted_at_consistent" CHECK (
    ("status" = 'DRAFT' AND "postedAt" IS NULL) OR ("status" = 'POSTED' AND "postedAt" IS NOT NULL)
  );

ALTER TABLE "purchase_lines"
  ADD CONSTRAINT "purchase_lines_unit_label_nonempty" CHECK (length(btrim("purchaseUnitLabel")) > 0),
  ADD CONSTRAINT "purchase_lines_quantity_positive" CHECK ("purchaseQuantity" > 0),
  ADD CONSTRAINT "purchase_lines_conversion_positive" CHECK ("baseQuantityPerPack" > 0),
  ADD CONSTRAINT "purchase_lines_base_quantity_positive" CHECK ("baseQuantityReceived" > 0),
  ADD CONSTRAINT "purchase_lines_base_quantity_matches_conversion" CHECK (
    "baseQuantityReceived" = "purchaseQuantity" * "baseQuantityPerPack"
  ),
  ADD CONSTRAINT "purchase_lines_cost_nonnegative" CHECK ("directCostAmount" >= 0);

ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_name_nonempty" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "recipes_yield_positive" CHECK ("yieldQuantity" > 0),
  ADD CONSTRAINT "recipes_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "recipes_archive_inactive" CHECK ("archivedAt" IS NULL OR "isActive" = false);

ALTER TABLE "recipe_components"
  ADD CONSTRAINT "recipe_components_key_nonempty" CHECK (length(btrim("componentKey")) > 0),
  ADD CONSTRAINT "recipe_components_label_nonempty" CHECK (length(btrim("label")) > 0),
  ADD CONSTRAINT "recipe_components_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "recipe_components_display_order_nonnegative" CHECK ("displayOrder" >= 0),
  ADD CONSTRAINT "recipe_components_source_consistent" CHECK (
    ("sourceKind" = 'STOCK_ITEM' AND "stockItemId" IS NOT NULL AND "nestedRecipeId" IS NULL)
    OR ("sourceKind" = 'RECIPE' AND "stockItemId" IS NULL AND "nestedRecipeId" IS NOT NULL)
  );

ALTER TABLE "product_costing_configurations"
  ADD CONSTRAINT "product_costing_configurations_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "product_costing_configurations_mode_source_consistent" CHECK (
    ("mode" = 'RECIPE' AND "recipeId" IS NOT NULL AND "recipeQuantity" > 0
      AND "purchasedStockItemId" IS NULL AND "purchasedQuantity" IS NULL)
    OR ("mode" = 'PURCHASED_ITEM' AND "recipeId" IS NULL AND "recipeQuantity" IS NULL
      AND "purchasedStockItemId" IS NOT NULL
      AND ("purchasedQuantity" IS NULL OR "purchasedQuantity" > 0))
  );

ALTER TABLE "product_option_costing_rules"
  ADD CONSTRAINT "product_option_costing_rules_key_nonempty" CHECK (length(btrim("componentKey")) > 0),
  ADD CONSTRAINT "product_option_costing_rules_replacement_consistent" CHECK (
    ("action" = 'REPLACE_COMPONENT' AND num_nonnulls("replacementStockItemId", "replacementRecipeId") = 1
      AND "quantity" > 0)
    OR ("action" = 'CHANGE_QUANTITY' AND "replacementStockItemId" IS NULL
      AND "replacementRecipeId" IS NULL AND "quantity" > 0 AND "label" IS NULL)
    OR ("action" = 'ADD_COMPONENT' AND num_nonnulls("replacementStockItemId", "replacementRecipeId") = 1
      AND "quantity" > 0 AND "label" IS NOT NULL AND length(btrim("label")) > 0)
  );

ALTER TABLE "product_costing_combinations"
  ADD CONSTRAINT "product_costing_combinations_name_nonempty" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "product_costing_combinations_version_positive" CHECK ("version" >= 1);

ALTER TABLE "product_combination_costing_rules"
  ADD CONSTRAINT "product_combination_costing_rules_key_nonempty" CHECK (length(btrim("componentKey")) > 0),
  ADD CONSTRAINT "product_combination_costing_rules_replacement_consistent" CHECK (
    ("action" = 'REPLACE_COMPONENT' AND num_nonnulls("replacementStockItemId", "replacementRecipeId") = 1
      AND "quantity" > 0)
    OR ("action" = 'CHANGE_QUANTITY' AND "replacementStockItemId" IS NULL
      AND "replacementRecipeId" IS NULL AND "quantity" > 0 AND "label" IS NULL)
    OR ("action" = 'ADD_COMPONENT' AND num_nonnulls("replacementStockItemId", "replacementRecipeId") = 1
      AND "quantity" > 0 AND "label" IS NOT NULL AND length(btrim("label")) > 0)
  );

ALTER TABLE "inventory_counts"
  ADD CONSTRAINT "inventory_counts_version_positive" CHECK ("version" >= 1),
  ADD CONSTRAINT "inventory_counts_posted_at_consistent" CHECK (
    ("status" = 'DRAFT' AND "postedAt" IS NULL) OR ("status" = 'POSTED' AND "postedAt" IS NOT NULL)
  );

CREATE UNIQUE INDEX "inventory_counts_one_posted_opening"
  ON "inventory_counts" ("kind")
  WHERE "kind" = 'OPENING' AND "status" = 'POSTED';

ALTER TABLE "inventory_count_lines"
  ADD CONSTRAINT "inventory_count_lines_observed_quantity_nonnegative" CHECK ("observedQuantity" >= 0),
  ADD CONSTRAINT "inventory_count_lines_observed_value_nonnegative" CHECK ("observedValueAmount" >= 0),
  ADD CONSTRAINT "inventory_count_lines_expected_quantity_nonnegative" CHECK ("expectedQuantity" IS NULL OR "expectedQuantity" >= 0),
  ADD CONSTRAINT "inventory_count_lines_expected_value_nonnegative" CHECK ("expectedValueAmount" IS NULL OR "expectedValueAmount" >= 0),
  ADD CONSTRAINT "inventory_count_lines_quantity_difference_consistent" CHECK (
    ("expectedQuantity" IS NULL AND "differenceQuantity" IS NULL)
    OR ("expectedQuantity" IS NOT NULL AND "differenceQuantity" IS NOT NULL)
  ),
  ADD CONSTRAINT "inventory_count_lines_value_difference_consistent" CHECK (
    ("expectedValueAmount" IS NULL AND "differenceValueAmount" IS NULL)
    OR ("expectedValueAmount" IS NOT NULL AND "differenceValueAmount" IS NOT NULL)
  );

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_nonzero_delta" CHECK ("quantityDelta" <> 0 OR "valueDeltaAmount" <> 0),
  ADD CONSTRAINT "inventory_movements_one_source" CHECK (num_nonnulls("purchaseLineId", "orderConsumptionId", "inventoryCountLineId") = 1),
  ADD CONSTRAINT "inventory_movements_kind_source_consistent" CHECK (
    ("kind" IN ('PURCHASE_RECEIPT', 'PURCHASE_RETURN') AND "purchaseLineId" IS NOT NULL
      AND "orderConsumptionId" IS NULL AND "inventoryCountLineId" IS NULL)
    OR ("kind" IN ('ORDER_CONSUMPTION', 'ORDER_RESTORATION') AND "purchaseLineId" IS NULL
      AND "orderConsumptionId" IS NOT NULL AND "inventoryCountLineId" IS NULL)
    OR ("kind" IN ('OPENING_COUNT', 'PHYSICAL_COUNT_ADJUSTMENT') AND "purchaseLineId" IS NULL
      AND "orderConsumptionId" IS NULL AND "inventoryCountLineId" IS NOT NULL)
  ),
  ADD CONSTRAINT "inventory_movements_signs_match_kind" CHECK (
    ("kind" = 'OPENING_COUNT' AND "quantityDelta" > 0 AND "valueDeltaAmount" >= 0)
    OR ("kind" = 'PURCHASE_RECEIPT' AND "quantityDelta" > 0 AND "valueDeltaAmount" >= 0)
    OR ("kind" = 'ORDER_CONSUMPTION' AND "quantityDelta" < 0 AND "valueDeltaAmount" <= 0)
    OR ("kind" = 'ORDER_RESTORATION' AND "quantityDelta" > 0 AND "valueDeltaAmount" >= 0)
    OR ("kind" = 'PHYSICAL_COUNT_ADJUSTMENT')
    OR ("kind" = 'PURCHASE_RETURN' AND "quantityDelta" < 0 AND "valueDeltaAmount" <= 0)
  ),
  ADD CONSTRAINT "inventory_movements_not_self_compensating" CHECK (
    "compensatesMovementId" IS NULL OR "compensatesMovementId" <> "id"
  );

CREATE UNIQUE INDEX "inventory_movements_order_stock_kind_key"
  ON "inventory_movements" ("orderConsumptionId", "stockItemId", "kind")
  WHERE "orderConsumptionId" IS NOT NULL;

ALTER TABLE "order_item_costing_snapshots"
  ADD CONSTRAINT "order_item_costing_snapshots_version_positive" CHECK (
    "configurationVersion" IS NULL OR "configurationVersion" >= 1
  );

ALTER TABLE "order_consumptions"
  ADD CONSTRAINT "order_consumptions_cycle_positive" CHECK ("cycleNumber" >= 1),
  ADD CONSTRAINT "order_consumptions_costs_nonnegative" CHECK (
    "knownCogsAmount" >= 0 AND ("theoreticalCogsAmount" IS NULL OR "theoreticalCogsAmount" >= 0)
  ),
  ADD CONSTRAINT "order_consumptions_completeness_matches_cost" CHECK (
    "isCostComplete" = ("theoreticalCogsAmount" IS NOT NULL)
  ),
  ADD CONSTRAINT "order_consumptions_complete_known_cost_matches_total" CHECK (
    NOT "isCostComplete" OR "knownCogsAmount" = "theoreticalCogsAmount"
  ),
  ADD CONSTRAINT "order_consumptions_resolution_matches_status" CHECK (
    ("status" = 'PENDING' AND "resolvedAt" IS NULL)
    OR ("status" <> 'PENDING' AND "resolvedAt" IS NOT NULL)
  );

ALTER TABLE "order_consumption_items"
  ADD CONSTRAINT "order_consumption_items_name_nonempty" CHECK (length(btrim("productNameSnapshot")) > 0),
  ADD CONSTRAINT "order_consumption_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "order_consumption_items_weight_positive" CHECK ("weightGrams" IS NULL OR "weightGrams" > 0),
  ADD CONSTRAINT "order_consumption_items_costs_nonnegative" CHECK (
    "knownCogsAmount" >= 0 AND ("theoreticalCogsAmount" IS NULL OR "theoreticalCogsAmount" >= 0)
  ),
  ADD CONSTRAINT "order_consumption_items_completeness_matches_cost" CHECK (
    "isCostComplete" = ("theoreticalCogsAmount" IS NOT NULL)
  ),
  ADD CONSTRAINT "order_consumption_items_complete_known_cost_matches_total" CHECK (
    NOT "isCostComplete" OR "knownCogsAmount" = "theoreticalCogsAmount"
  );

-- Posted movement rows form an append-only ledger. Corrections must insert a
-- linked compensating row so reports can retain their physical event history.
CREATE FUNCTION prevent_inventory_movement_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'inventory movements are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_movements_append_only"
  BEFORE UPDATE OR DELETE ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_mutation();

CREATE FUNCTION validate_inventory_movement_links() RETURNS trigger AS $$
DECLARE
  source_stock_item_id TEXT;
  original_quantity NUMERIC(20,6);
  original_value INTEGER;
  original_stock_item_id TEXT;
BEGIN
  IF NEW."purchaseLineId" IS NOT NULL THEN
    SELECT "stockItemId" INTO source_stock_item_id FROM "purchase_lines" WHERE "id" = NEW."purchaseLineId";
  ELSIF NEW."inventoryCountLineId" IS NOT NULL THEN
    SELECT "stockItemId" INTO source_stock_item_id FROM "inventory_count_lines" WHERE "id" = NEW."inventoryCountLineId";
  END IF;

  IF source_stock_item_id IS NOT NULL AND source_stock_item_id <> NEW."stockItemId" THEN
    RAISE EXCEPTION 'inventory movement stock item must match its source';
  END IF;

  IF NEW."compensatesMovementId" IS NOT NULL THEN
    SELECT "stockItemId", "quantityDelta", "valueDeltaAmount"
      INTO original_stock_item_id, original_quantity, original_value
      FROM "inventory_movements" WHERE "id" = NEW."compensatesMovementId";
    IF original_stock_item_id IS DISTINCT FROM NEW."stockItemId"
      OR original_quantity IS DISTINCT FROM -NEW."quantityDelta"
      OR original_value IS DISTINCT FROM -NEW."valueDeltaAmount" THEN
      RAISE EXCEPTION 'compensating inventory movement must exactly reverse its source';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_movements_validate_links"
  BEFORE INSERT ON "inventory_movements"
  FOR EACH ROW EXECUTE FUNCTION validate_inventory_movement_links();

