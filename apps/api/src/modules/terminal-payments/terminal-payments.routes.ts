import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AuthRequestHeadersSchema, ErrorResponseSchema, IdempotencyRequestHeadersSchema, RecordSettlementRequestSchema,
  TerminalActiveResponseSchema, TerminalAttemptResponseSchema, TerminalClaimSchema, TerminalConfigResponseSchema,
  TerminalReconcileSchema, TerminalResultSchema,
} from "@cafe/contracts";
import { env } from "../../config/env.js";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { activeTerminalAttempt, claimTerminalAttempt, prepareTerminalAttempt, readTerminalAttempt, reconcileTerminalAttempt, reportTerminalResult } from "./terminal-payments.service.js";

const strictBody = (schema: z.ZodType) => async (request: FastifyRequest) => { schema.parse(request.body); };
const params = z.object({ attemptId: z.uuid() }).strict();
const errors = Object.fromEntries([400, 401, 403, 404, 409, 422, 500, 503].map(code => [code, zodToJsonSchema(ErrorResponseSchema)]));
const proofHeaders = z.object({ "x-sep-signature": z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();

export const terminalPaymentRoutes: FastifyPluginAsync = async app => {
  app.get("/terminal-payments/config", { preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(AuthRequestHeadersSchema), response: { 200: zodToJsonSchema(TerminalConfigResponseSchema), ...errors } } }, async request => ({ data: { enabled: env.SEP_TERMINAL_ENABLED, manualVerificationRequired: true }, meta: { requestId: request.id } }));
  app.get("/terminal-payments/active", { preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(AuthRequestHeadersSchema), querystring: zodToJsonSchema(z.object({ orderId: z.uuid().optional() }).strict()), response: { 200: zodToJsonSchema(TerminalActiveResponseSchema), ...errors } } }, async request => {
    const { orderId } = z.object({ orderId: z.uuid().optional() }).parse(request.query);
    return { data: await activeTerminalAttempt(app.prisma, request.authenticatedUser!, orderId), meta: { requestId: request.id } };
  });
  app.get("/terminal-payments/:attemptId", { preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(AuthRequestHeadersSchema), params: zodToJsonSchema(params), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => ({ data: await readTerminalAttempt(app.prisma, request.authenticatedUser!, params.parse(request.params).attemptId), meta: { requestId: request.id } }));
  app.post("/orders/:orderId/terminal-payment", { preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(IdempotencyRequestHeadersSchema), params: zodToJsonSchema(z.object({ orderId: z.uuid() })), body: zodToJsonSchema(RecordSettlementRequestSchema), response: { 201: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async (request, reply) => {
    const { orderId } = z.object({ orderId: z.uuid() }).parse(request.params);
    const key = request.headers["idempotency-key"];
    const result = await prepareTerminalAttempt(app.prisma, request.authenticatedUser!, orderId, RecordSettlementRequestSchema.parse(request.body), typeof key === "string" ? key : "", request.id);
    if (result.replayed) reply.header("idempotency-replayed", "true");
    return reply.code(201).send({ data: result.attempt, meta: { requestId: request.id } });
  });
  // These endpoints require installation HMAC, not a browser session or CORS permission.
  app.post("/terminal-payments/claim", { bodyLimit: 4096, preValidation: strictBody(TerminalClaimSchema), schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(TerminalClaimSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => ({ data: await claimTerminalAttempt(app.prisma, TerminalClaimSchema.parse(request.body), request.headers["x-sep-signature"], request.id), meta: { requestId: request.id } }));
  app.post("/terminal-payments/result", { bodyLimit: 4096, preValidation: strictBody(TerminalResultSchema), schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(TerminalResultSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => ({ data: await reportTerminalResult(app.prisma, TerminalResultSchema.parse(request.body), request.headers["x-sep-signature"], request.id), meta: { requestId: request.id } }));
  app.post("/terminal-payments/:attemptId/reconcile", { bodyLimit: 4096, preValidation: strictBody(TerminalReconcileSchema), preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(AuthRequestHeadersSchema), params: zodToJsonSchema(params), body: zodToJsonSchema(TerminalReconcileSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => ({ data: await reconcileTerminalAttempt(app.prisma, request.authenticatedUser!, params.parse(request.params).attemptId, TerminalReconcileSchema.parse(request.body), request.id), meta: { requestId: request.id } }));
};
