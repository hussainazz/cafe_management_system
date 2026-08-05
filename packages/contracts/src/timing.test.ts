import { describe, expect, it } from "vitest";

import { DEFAULT_TABLE_SEATING_LIMIT_MINUTES, calculateTableEta } from "./index.js";

describe("calculateTableEta", () => {
  it("adds the table seating limit to the slowest product preparation deadline", () => {
    const eta = calculateTableEta({
      seatedAt: new Date("2026-08-05T08:00:00.000Z"),
      seatingLimitMinutes: DEFAULT_TABLE_SEATING_LIMIT_MINUTES,
      itemPreparationDeadlineMinutes: [5, 12, 8],
    });

    expect(eta.estimatedPreparationMinutes).toBe(12);
    expect(eta.estimatedTableMinutes).toBe(57);
    expect(eta.estimatedReleaseAt.toISOString()).toBe("2026-08-05T08:57:00.000Z");
  });

  it("still returns the seating limit when an active table has no items yet", () => {
    const eta = calculateTableEta({
      seatedAt: new Date("2026-08-05T08:00:00.000Z"),
      seatingLimitMinutes: 30,
      itemPreparationDeadlineMinutes: [],
    });

    expect(eta.estimatedPreparationMinutes).toBe(0);
    expect(eta.estimatedTableMinutes).toBe(30);
    expect(eta.estimatedReleaseAt.toISOString()).toBe("2026-08-05T08:30:00.000Z");
  });
});
