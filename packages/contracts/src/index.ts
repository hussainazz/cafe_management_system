import { z } from "zod";

export const DEFAULT_TABLE_SEATING_LIMIT_MINUTES = 45;

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.string(),
  timestamp: z.string(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ProductPreparationDeadlineMinutesSchema = z.number().int().min(1);

export const TableSeatingLimitMinutesSchema = z
  .number()
  .int()
  .min(1)
  .default(DEFAULT_TABLE_SEATING_LIMIT_MINUTES);

export type TableEtaInput = {
  seatedAt: Date;
  seatingLimitMinutes: number;
  itemPreparationDeadlineMinutes: readonly number[];
};

export type TableEta = {
  estimatedPreparationMinutes: number;
  estimatedTableMinutes: number;
  estimatedReleaseAt: Date;
};

export function calculateTableEta(input: TableEtaInput): TableEta {
  const estimatedPreparationMinutes = Math.max(0, ...input.itemPreparationDeadlineMinutes);
  const estimatedTableMinutes = input.seatingLimitMinutes + estimatedPreparationMinutes;

  return {
    estimatedPreparationMinutes,
    estimatedTableMinutes,
    estimatedReleaseAt: new Date(input.seatedAt.getTime() + estimatedTableMinutes * 60_000),
  };
}
