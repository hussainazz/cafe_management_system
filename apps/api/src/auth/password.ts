import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";

const scrypt = promisify(scryptCallback);
const hashKeyLength = 64;
const passwordHashPrefix = "scrypt";

const BootstrapPasswordSchema = z
  .string()
  .min(12, "must be at least 12 characters")
  .max(128, "must be at most 128 characters")
  .regex(/[a-z]/, "must include a lowercase letter")
  .regex(/[A-Z]/, "must include an uppercase letter")
  .regex(/[0-9]/, "must include a number");

export function validateBootstrapPassword(password: string | undefined): string {
  if (password === undefined) {
    throw new Error("BOOTSTRAP_MANAGER_PASSWORD is required");
  }

  const result = BootstrapPasswordSchema.safeParse(password);

  if (!result.success) {
    throw new Error(
      `BOOTSTRAP_MANAGER_PASSWORD ${result.error.issues.map((issue) => issue.message).join(", ")}`,
    );
  }

  return result.data;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(password, salt, hashKeyLength)) as Buffer;

  return `${passwordHashPrefix}$${salt.toString("hex")}$${Buffer.from(derivedKey).toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  const [prefix, saltHex, derivedKeyHex] = passwordHash.split("$");

  if (prefix !== passwordHashPrefix || !saltHex || !derivedKeyHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(derivedKeyHex, "hex");

  if (salt.length !== 16 || storedKey.length !== hashKeyLength) {
    return false;
  }

  const derivedKey = Buffer.from((await scrypt(password, salt, hashKeyLength)) as Buffer);

  return timingSafeEqual(storedKey, derivedKey);
}
