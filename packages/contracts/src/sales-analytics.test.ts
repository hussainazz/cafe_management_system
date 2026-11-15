import { describe, expect, it } from "vitest";
import { SalesAnalyticsQuerySchema } from "./index.js";

describe("SalesAnalyticsQuerySchema", () => {
  it("accepts a bounded 93-calendar-day report and coerces interval and weekday query values", () => {
    expect(SalesAnalyticsQuerySchema.parse({
      fromDate: "2026-01-01", toDate: "2026-04-03", intervalMinutes: "30", daysOfWeek: ["0", "4"],
    })).toMatchObject({ intervalMinutes: 30, daysOfWeek: [0, 4] });
  });

  it("rejects wider date ranges, unsupported intervals, and unknown query keys", () => {
    expect(SalesAnalyticsQuerySchema.safeParse({ fromDate: "2026-01-01", toDate: "2026-04-04" }).success).toBe(false);
    expect(SalesAnalyticsQuerySchema.safeParse({ fromDate: "2026-01-01", toDate: "2026-01-02", intervalMinutes: "15" }).success).toBe(false);
    expect(SalesAnalyticsQuerySchema.safeParse({ fromDate: "2026-01-01", toDate: "2026-01-02", unknown: "value" }).success).toBe(false);
  });
});
