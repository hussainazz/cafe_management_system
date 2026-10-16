CREATE TABLE "product_option_recipe_costings" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "recipeId" TEXT NOT NULL,
    "recipeQuantity" DECIMAL(20,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_option_recipe_costings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_option_recipe_costings_productId_optionId_key"
ON "product_option_recipe_costings"("productId", "optionId");

CREATE INDEX "product_option_recipe_costings_optionId_idx"
ON "product_option_recipe_costings"("optionId");

CREATE INDEX "product_option_recipe_costings_recipeId_idx"
ON "product_option_recipe_costings"("recipeId");

ALTER TABLE "product_option_recipe_costings"
ADD CONSTRAINT "product_option_recipe_costings_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_option_recipe_costings"
ADD CONSTRAINT "product_option_recipe_costings_optionId_fkey"
FOREIGN KEY ("optionId") REFERENCES "options"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_option_recipe_costings"
ADD CONSTRAINT "product_option_recipe_costings_recipeId_fkey"
FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
