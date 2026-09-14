ALTER TABLE "customers" ADD COLUMN "phoneNumberEncrypted" TEXT;
ALTER TABLE "customer_otp_challenges" DROP COLUMN "fullName";
ALTER TABLE "customers" ALTER COLUMN "fullName" DROP NOT NULL;
