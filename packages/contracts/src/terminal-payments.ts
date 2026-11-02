import { z } from "zod";

const Money = z.number().int().min(1).max(2_147_483_647);
const Time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Reference = z.string().regex(/^[0-9]{1,12}$/);
const Code = z.string().regex(/^[0-9A-Z]{2,3}$/);
export const TerminalAttemptStatusSchema = z.enum(["PENDING", "UNKNOWN", "SUCCEEDED", "FAILED"]);
export const TerminalIntentSchema = z.object({
  attemptId: z.uuid(), bridgeId: z.uuid(), terminalId: z.string().regex(/^[0-9]{8}$/),
  orderId: z.uuid(), orderVersion: z.number().int().positive(), cardAmount: Money,
  unit: z.literal("TOMAN"), checkoutHash: z.string().regex(/^[a-f0-9]{64}$/), nonce: z.uuid(),
  issuedAtUnix: Time, expiresAtUnix: Time, signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type TerminalIntent = z.infer<typeof TerminalIntentSchema>;

export const TerminalAttemptSchema = z.object({
  id: z.uuid(), orderId: z.uuid(), bridgeId: z.uuid(), terminalId: z.string(),
  cardAmount: Money, settlementAmount: Money, payments: z.array(z.object({ method: z.enum(["CASH", "CARD_TERMINAL", "CARD_TRANSFER"]), amount: Money })).min(1).max(10), orderVersion: z.number().int().positive(), version: z.number().int().positive(),
  status: TerminalAttemptStatusSchema, createdAt: z.iso.datetime(), dispatchedAt: z.iso.datetime().nullable(),
  resultReceivedAt: z.iso.datetime().nullable(), responseCode: Code.nullable(), rrn: Reference.nullable(), trace: Reference.nullable(),
  settlementId: z.uuid().nullable(), resolvedAt: z.iso.datetime().nullable(),
  manualVerificationRequired: z.literal(true), authorization: TerminalIntentSchema.nullable(),
});
export type TerminalAttempt = z.infer<typeof TerminalAttemptSchema>;
const Meta = z.object({ requestId: z.string() });
export const TerminalAttemptResponseSchema = z.object({ data: TerminalAttemptSchema, meta: Meta });
export const TerminalActiveResponseSchema = z.object({ data: TerminalAttemptSchema.nullable(), meta: Meta });
export const TerminalConfigResponseSchema = z.object({ data: z.object({ enabled: z.boolean(), manualVerificationRequired: z.literal(true) }), meta: Meta });

export const TerminalClaimSchema = z.object({ attemptId: z.uuid(), bridgeId: z.uuid(), nonce: z.uuid(), sentAtUnix: Time }).strict();
export type TerminalClaim = z.infer<typeof TerminalClaimSchema>;
export const TerminalTimingDurationsSchema = z.object({
    bridgeAcceptMs: z.number().int().nonnegative().max(86_400_000).optional(),
    dispatchQueueMs: z.number().int().nonnegative().max(86_400_000).optional(),
    intentValidationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    deviceMutexMs: z.number().int().nonnegative().max(86_400_000).optional(),
    backendClaimMs: z.number().int().nonnegative().max(86_400_000).optional(),
    setLanMs: z.number().int().nonnegative().max(86_400_000).optional(),
    sdkInitializationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    connectionTestMs: z.number().int().nonnegative().max(86_400_000).optional(),
    purchaseReinitializationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    purchaseCallMs: z.number().int().nonnegative().max(86_400_000).optional(),
    sdkCleanupMs: z.number().int().nonnegative().max(86_400_000).optional(),
    sdkVerificationMs: z.number().int().nonnegative().max(86_400_000).optional(),
    workerProcessMs: z.number().int().nonnegative().max(86_400_000).optional(),
    sdkFactoryMs: z.number().int().nonnegative().max(86_400_000).optional(),
    prePurchaseMs: z.number().int().nonnegative().max(86_400_000).optional(),
    diagnosticWriteMs: z.number().int().nonnegative().max(86_400_000).optional(),
    workerTotalMs: z.number().int().nonnegative().max(86_400_000).optional(),
  }).strict();
export const TerminalResultSchema = z.object({
  attemptId: z.uuid(), bridgeId: z.uuid(), terminalId: z.string().regex(/^[0-9]{8}$/),
  sentAtUnix: Time, finishedAtUnix: Time, responseCode: Code.nullable(), rrn: Reference.nullable(), trace: Reference.nullable(),

}).strict();
export type TerminalResult = z.infer<typeof TerminalResultSchema>;
const ReconcileBase = z.object({ expectedVersion: z.number().int().positive(), basis: z.enum(["TERMINAL_RECEIPT", "BANK_RECORD"]) });
export const TerminalReconcileSchema = z.discriminatedUnion("decision", [
  ReconcileBase.extend({ decision: z.literal("SUCCEEDED"), receiptChecked: z.literal(true), cardAmount: Money, rrn: Reference.optional(), trace: Reference.optional() }).strict(),
  ReconcileBase.extend({ decision: z.literal("FAILED"), terminalIdleConfirmed: z.literal(true), bridgeStoppedConfirmed: z.literal(true), noChargeConfirmed: z.literal(true) }).strict(),
]);
export type TerminalReconcile = z.infer<typeof TerminalReconcileSchema>;

export const TerminalTimingSchema = z.object({
  attemptId: z.uuid(), bridgeId: z.uuid(), terminalId: z.string().regex(/^[0-9]{8}$/),
  sentAtUnix: Time, timingsMs: TerminalTimingDurationsSchema,
}).strict();
export const PosTerminalTimingSchema = z.object({
  reportId: z.uuid(), phase: z.enum(["prepare_roundtrip", "bridge_roundtrip", "status_roundtrip", "result_observed"]),
  elapsedMs: z.number().int().nonnegative().max(86_400_000),
  outcome: z.enum(["ok", "error", "timeout"]),
}).strict();
