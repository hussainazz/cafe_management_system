CREATE TABLE "personnel_profiles" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "personnel_profiles_name_key"
  ON "personnel_profiles"("name");
