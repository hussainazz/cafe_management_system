ALTER TABLE "product_costing_configurations"
 ADD COLUMN "takeawayRecipeId" TEXT,
 ADD COLUMN "takeawayOptionRecipes" JSONB NOT NULL DEFAULT '[]',
 ADD CONSTRAINT "takeaway_recipe_fk" FOREIGN KEY ("takeawayRecipeId") REFERENCES "recipes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 ADD CONSTRAINT "takeaway_option_recipes_array" CHECK (jsonb_typeof("takeawayOptionRecipes") = 'array');
