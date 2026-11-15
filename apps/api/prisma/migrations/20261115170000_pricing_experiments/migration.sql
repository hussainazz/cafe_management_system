CREATE TYPE "PricingExperimentTargetKind" AS ENUM ('PRODUCT', 'OPTION', 'PACKAGING');

CREATE TABLE "pricing_experiments" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "expectedEvaluationDays" INTEGER NOT NULL,
  "comparisonDays" INTEGER NOT NULL,
  "notes" VARCHAR(1000),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_experiments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_experiments_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "pricing_experiments_days_valid" CHECK (
    "expectedEvaluationDays" BETWEEN 1 AND 90 AND "comparisonDays" BETWEEN 1 AND 90
  ),
  CONSTRAINT "pricing_experiments_creator_fkey" FOREIGN KEY ("createdById")
    REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "pricing_experiment_targets" (
  "id" TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "targetKey" VARCHAR(120) NOT NULL,
  "targetKind" "PricingExperimentTargetKind" NOT NULL,
  "productId" TEXT NOT NULL,
  "optionId" TEXT,
  "productNameSnapshot" VARCHAR(200) NOT NULL,
  "optionNameSnapshot" VARCHAR(200),
  "previousPriceAmount" INTEGER,
  "proposedPriceAmount" INTEGER NOT NULL,
  CONSTRAINT "pricing_experiment_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_experiment_targets_target_shape" CHECK (
    ("targetKind" = 'OPTION' AND "optionId" IS NOT NULL AND "optionNameSnapshot" IS NOT NULL)
    OR ("targetKind" IN ('PRODUCT', 'PACKAGING') AND "optionId" IS NULL AND "optionNameSnapshot" IS NULL)
  ),
  CONSTRAINT "pricing_experiment_targets_amounts_nonnegative" CHECK (
    ("previousPriceAmount" IS NULL OR "previousPriceAmount" >= 0) AND "proposedPriceAmount" >= 0
  ),
  CONSTRAINT "pricing_experiment_targets_experiment_fkey" FOREIGN KEY ("experimentId")
    REFERENCES "pricing_experiments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_experiment_targets_product_fkey" FOREIGN KEY ("productId")
    REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_experiment_targets_option_fkey" FOREIGN KEY ("optionId")
    REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "pricing_experiment_targets_experimentId_targetKey_key"
  ON "pricing_experiment_targets"("experimentId", "targetKey");
CREATE INDEX "pricing_experiments_effectiveAt_createdAt_idx"
  ON "pricing_experiments"("effectiveAt", "createdAt");
CREATE INDEX "pricing_experiments_createdById_createdAt_idx"
  ON "pricing_experiments"("createdById", "createdAt");
CREATE INDEX "pricing_experiment_targets_productId_optionId_idx"
  ON "pricing_experiment_targets"("productId", "optionId");
