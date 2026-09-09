import { describe, expect, it } from "vitest";
import { recoveryStateFor } from "./recovery-state";

describe("POS recovery state", () => {
  it("does not present a network failure as a completed change", () => {
    expect(recoveryStateFor({ kind: "network", message: "unavailable" })).toMatchObject({
      kind: "offline",
      action: "تلاش برای اتصال و بازخوانی",
    });
  });

  it("asks the operator to refetch rather than retry a stale mutation", () => {
    expect(recoveryStateFor({ kind: "response", status: 409, code: "STALE_VERSION", message: "stale" })).toMatchObject({
      kind: "conflict",
      action: "دریافت نسخهٔ تازه",
    });
  });

  it("keeps an ordinary API failure recoverable", () => {
    expect(recoveryStateFor({ kind: "response", status: 500, message: "خطای سرویس" })).toMatchObject({
      kind: "failure",
      detail: "خطای سرویس",
    });
  });
});
