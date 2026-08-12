import { describe, expect, it } from "vitest";
import {
  hashPassword,
  validateBootstrapPassword,
  verifyPassword,
} from "../../src/auth/password.js";

describe("bootstrap manager password", () => {
  it("rejects missing and weak passwords", () => {
    expect(() => validateBootstrapPassword(undefined)).toThrow(
      "BOOTSTRAP_MANAGER_PASSWORD is required",
    );
    expect(() => validateBootstrapPassword("password-only")).toThrow("BOOTSTRAP_MANAGER_PASSWORD");
  });

  it("hashes and verifies a valid password", async () => {
    const password = validateBootstrapPassword("CafeManager2026");
    const passwordHash = await hashPassword(password);

    await expect(verifyPassword(password, passwordHash)).resolves.toBe(true);
    await expect(verifyPassword("WrongPassword2026", passwordHash)).resolves.toBe(false);
  });
});
