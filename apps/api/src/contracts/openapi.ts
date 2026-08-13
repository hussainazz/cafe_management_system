import { z, type ZodType } from "zod";

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
}
