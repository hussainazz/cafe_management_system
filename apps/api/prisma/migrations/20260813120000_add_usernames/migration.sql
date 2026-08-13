ALTER TABLE "users" ADD COLUMN "username" TEXT;

UPDATE "users"
SET "username" = 'manager-' || substring("id" FROM 1 FOR 8)
WHERE "username" IS NULL;

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;

ALTER TABLE "users"
ADD CONSTRAINT "users_username_format_check"
CHECK ("username" ~ '^[a-z0-9._-]{3,64}$');

CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
