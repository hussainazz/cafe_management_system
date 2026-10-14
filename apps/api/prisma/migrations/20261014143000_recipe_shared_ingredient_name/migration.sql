-- Separate a precise costed recipe variant from its shared ingredient label.
ALTER TABLE "recipes" ADD COLUMN "ingredientName" TEXT;

UPDATE "recipes"
SET "ingredientName" = COALESCE("archivedName", "name");

ALTER TABLE "recipes" ALTER COLUMN "ingredientName" SET NOT NULL;
