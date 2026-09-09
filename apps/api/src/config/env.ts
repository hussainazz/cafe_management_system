import "dotenv/config";
import { z } from "zod";

const EnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  ACCESS_TOKEN_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),
  TABLE_QR_TOKEN_SECRET: z.string().min(32).optional(),
  TABLE_CONTEXT_COOKIE_SECRET: z.string().min(32).optional(),
  CUSTOMER_PHONE_LOOKUP_SECRET: z.string().min(32).optional(),
  CUSTOMER_OTP_SECRET: z.string().min(32).optional(),
  CUSTOMER_SESSION_SECRET: z.string().min(32).optional(),
  CUSTOMER_OTP_DEV_CODE: z.string().regex(/^\d{6}$/).optional(),
  PRODUCT_IMAGE_STORAGE_DIR: z.string().min(1).default("./data/product-images"),
});

const result = EnvironmentSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

if (
  result.data.NODE_ENV === "production" &&
  (!result.data.TABLE_QR_TOKEN_SECRET || !result.data.TABLE_CONTEXT_COOKIE_SECRET ||
    !result.data.CUSTOMER_PHONE_LOOKUP_SECRET || !result.data.CUSTOMER_OTP_SECRET ||
    !result.data.CUSTOMER_SESSION_SECRET || result.data.CUSTOMER_OTP_DEV_CODE)
) {
  console.error(
    "Table QR/context and customer authentication secrets are required in production; CUSTOMER_OTP_DEV_CODE is forbidden",
  );
  process.exit(1);
}

export const env = {
  ...result.data,
  TABLE_QR_TOKEN_SECRET: result.data.TABLE_QR_TOKEN_SECRET ?? result.data.REFRESH_TOKEN_SECRET,
  TABLE_CONTEXT_COOKIE_SECRET:
    result.data.TABLE_CONTEXT_COOKIE_SECRET ?? result.data.ACCESS_TOKEN_SECRET,
  CUSTOMER_PHONE_LOOKUP_SECRET: result.data.CUSTOMER_PHONE_LOOKUP_SECRET ?? result.data.REFRESH_TOKEN_SECRET,
  CUSTOMER_OTP_SECRET: result.data.CUSTOMER_OTP_SECRET ?? result.data.REFRESH_TOKEN_SECRET,
  CUSTOMER_SESSION_SECRET: result.data.CUSTOMER_SESSION_SECRET ?? result.data.REFRESH_TOKEN_SECRET,
};
