import { describe, expect, it } from "vitest";
import { operationalRefreshIntervalMs } from "./operational-refresh";

describe("operational refresh", () => {
  it("refreshes waiter calls and table data every five seconds", () => {
    expect(operationalRefreshIntervalMs).toBe(5_000);
  });
});
