-- Keep archived recipe history while freeing its display name for an active replacement.
ALTER TABLE "recipes" ADD COLUMN "archivedName" TEXT;

UPDATE "recipes"
SET "archivedName" = "name",
    "name" = '__archived_recipe_' || "id"
WHERE "archivedAt" IS NOT NULL;
