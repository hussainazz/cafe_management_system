import { z, type ZodType } from "zod";

function preferNullInAnyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(preferNullInAnyOf);
  if (!value || typeof value !== "object") return value;

  const result = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, preferNullInAnyOf(entry)]));
  if (Array.isArray(result.anyOf)) {
    result.anyOf = [...result.anyOf].sort((left, right) => Number(isNullSchema(right)) - Number(isNullSchema(left)));
  }
  return result;
}

function isNullSchema(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "null");
}

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  // Fastify's default AJV validator coerces null to zero when a nullable
  // numeric union lists its number branch first. Prefer the explicit null
  // branch so nullable request values retain their meaning.
  return preferNullInAnyOf(z.toJSONSchema(schema, { target: "draft-7" })) as Record<string, unknown>;
}
