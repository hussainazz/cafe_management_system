import { describe, expect, it } from "vitest";
import { newWaiterCallSoundKeys } from "./waiter-call-sound";

describe("waiter-call sound notifications", () => {
  it("does not announce the initial waiter-call snapshot", () => {
    expect(newWaiterCallSoundKeys([{ tableId: "table-1", version: 1 }], null)).toEqual([]);
  });

  it("returns only calls that were not present in the previous snapshot", () => {
    expect(newWaiterCallSoundKeys(
      [{ tableId: "table-1", version: 1 }, { tableId: "table-2", version: 4 }],
      new Set(["table-1:1"]),
    )).toEqual(["table-2:4"]);
  });
});
