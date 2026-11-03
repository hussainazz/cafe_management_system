import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import {
  AuthRequestHeadersSchema, ErrorResponseSchema, IdempotencyRequestHeadersSchema, RecordSettlementRequestSchema,
  TerminalActiveResponseSchema, TerminalAttemptResponseSchema, TerminalClaimSchema, TerminalConfigResponseSchema,
  TerminalReconcileSchema, TerminalResultSchema, TerminalTimingSchema, PosTerminalTimingSchema,
} from "@cafe/contracts";
import { env } from "../../config/env.js";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { activeTerminalAttempt, claimTerminalAttempt, prepareTerminalAttempt, readTerminalAttempt, reconcileTerminalAttempt, reportTerminalResult } from "./terminal-payments.service.js";

import { createTimingRecorder } from "./terminal-timing.js";
import { timingMessage, verifyTerminalMessage } from "./terminal-signatures.js";

const strictBody = (schema: z.ZodType) => async (request: FastifyRequest) => { schema.parse(request.body); };
const params = z.object({ attemptId: z.uuid() }).strict();
const errorSchema = zodToJsonSchema(ErrorResponseSchema);
const errors = { 400: errorSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 422: errorSchema, 500: errorSchema, 503: errorSchema };
const proofHeaders = z.object({ "x-sep-signature": z.string().regex(/^[a-f0-9]{64}$/) }).passthrough();

export const terminalPaymentRoutes: FastifyPluginAsync = async app => {
  const record = createTimingRecorder(app);
  const spans = new WeakMap<FastifyRequest, { started: number; attemptId: string | null; stage: string }>();
  app.addHook("onRequest", async request => {
    const route = request.routeOptions.url ?? "";
    if (request.method === "POST" && route.includes("terminal-payment") && !route.endsWith("timing"))
      spans.set(request, { started: performance.now(), attemptId: null, stage: route });
  });
  app.addHook("onResponse", async (request, reply) => {
    const span = spans.get(request);
    if (span) record(request, span.attemptId, { source: "API", schemaVersion: 1, stage: span.stage,
      statusCode: reply.statusCode, durationMs: Math.round(performance.now() - span.started) });
  });
  const monitorBody = z.object({ bridgeId: z.uuid(), terminalId: z.string().regex(/^[0-9]{8}$/), sentAtUnix: z.number().int() }).strict();
  app.post("/terminal-payments/monitor-idle", { bodyLimit: 1024, preValidation: strictBody(monitorBody), schema: { tags: ["Terminal payments"], summary: "Check whether the terminal is idle", headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(monitorBody), response: { 200: zodToJsonSchema(z.object({ data: z.object({ bridgeId: z.uuid(), terminalId: z.string(), idle: z.boolean() }).strict() }).strict()), ...errors } } }, async (request, reply) => {
    const body = monitorBody.parse(request.body);
    const message = ["sep-monitor-v1", body.bridgeId, body.terminalId, body.sentAtUnix].join("\n");
    if (!env.SEP_BRIDGE_HMAC_KEY || body.bridgeId !== env.SEP_BRIDGE_ID || body.terminalId !== env.SEP_TERMINAL_ID ||
        Math.abs(Date.now() / 1000 - body.sentAtUnix) > 90 ||
        !verifyTerminalMessage(message, request.headers["x-sep-signature"], env.SEP_BRIDGE_HMAC_KEY)) return reply.code(401).send();
    const active = await app.prisma.terminalPaymentAttempt.findFirst({
      where: { bridgeId: body.bridgeId, status: { in: ["PENDING", "UNKNOWN"] } }, select: { id: true },
    });
    reply.header("Cache-Control", "no-store");
    return { data: { bridgeId: body.bridgeId, terminalId: body.terminalId, idle: env.SEP_TERMINAL_ENABLED && !active } };
  });

  app.post("/terminal-payments/:attemptId/timing", { preHandler: requireStaff, bodyLimit: 2048,
    preValidation: strictBody(PosTerminalTimingSchema), schema: { tags: ["Terminal payments"], summary: "Record POS terminal timing", headers: zodToJsonSchema(AuthRequestHeadersSchema), params: zodToJsonSchema(params), body: zodToJsonSchema(PosTerminalTimingSchema), response: { 200: zodToJsonSchema(z.object({ data: z.object({ recorded: z.boolean() }).strict() }).strict()), ...errors } } }, async (request, reply) => {
    const { attemptId } = params.parse(request.params);
    const body = PosTerminalTimingSchema.parse(request.body);
    if (!await app.prisma.terminalPaymentAttempt.findUnique({ where: { id: attemptId }, select: { id: true } })) return reply.code(404).send();
    if (!await record(request, attemptId, { source: "POS", schemaVersion: 1, ...body }, body.reportId)) return reply.code(503).send();
    return { data: { recorded: true } };
  });
  app.post("/terminal-payments/timing", { bodyLimit: 4096, preValidation: strictBody(TerminalTimingSchema), schema: { tags: ["Terminal payments"], summary: "Record signed terminal bridge timing", headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(TerminalTimingSchema), response: { 200: zodToJsonSchema(z.object({ data: z.object({ id: z.uuid(), bridgeId: z.uuid() }).strict() }).strict()), ...errors } } }, async (request, reply) => {
    const body = TerminalTimingSchema.parse(request.body);
    if (!env.SEP_BRIDGE_HMAC_KEY || body.bridgeId !== env.SEP_BRIDGE_ID || Math.abs(Date.now() / 1000 - body.sentAtUnix) > 90 ||
        !verifyTerminalMessage(timingMessage(body), request.headers["x-sep-signature"], env.SEP_BRIDGE_HMAC_KEY)) return reply.code(401).send();
    const attempt = await app.prisma.terminalPaymentAttempt.findUnique({ where: { id: body.attemptId } });
    if (!attempt || attempt.bridgeId !== body.bridgeId || attempt.terminalId !== body.terminalId) return reply.code(409).send();
    const persisted = await record(request, body.attemptId, { source: "BRIDGE", schemaVersion: 1, timingProtocol: "sep-timing-v1", terminalId: body.terminalId,
      timingsMs: body.timingsMs, completeness: body.timingsMs.workerTotalMs === undefined ? "interrupted" : "completed",
      dispatchGapMs: attempt.dispatchedAt ? attempt.dispatchedAt.getTime() - attempt.createdAt.getTime() : null }, body.attemptId);
    if (!persisted) return reply.code(503).send();
    return { data: { id: body.attemptId, bridgeId: body.bridgeId } };
  });

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
    const span = spans.get(request); if (span) { span.attemptId = result.attempt.id; span.stage = "prepare_api"; }
    if (result.replayed) reply.header("idempotency-replayed", "true");
    return reply.code(201).send({ data: result.attempt, meta: { requestId: request.id } });
  });
  // These endpoints require installation HMAC, not a browser session or CORS permission.
  app.post("/terminal-payments/claim", { bodyLimit: 4096, preValidation: strictBody(TerminalClaimSchema), schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(TerminalClaimSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => {
    const attempt = await claimTerminalAttempt(app.prisma, TerminalClaimSchema.parse(request.body), request.headers["x-sep-signature"], request.id);
    const span = spans.get(request); if (span) { span.attemptId = attempt.id; span.stage = "claim_api"; }
    return { data: attempt, meta: { requestId: request.id } };
  });
  app.post("/terminal-payments/result", { bodyLimit: 4096, preValidation: strictBody(TerminalResultSchema), schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(proofHeaders), body: zodToJsonSchema(TerminalResultSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => {
    const body = TerminalResultSchema.parse(request.body);
    const attempt = await reportTerminalResult(app.prisma, body, request.headers["x-sep-signature"], request.id);
    const span = spans.get(request); if (span) { span.attemptId = attempt.id; span.stage = "result_api"; }
    return { data: attempt, meta: { requestId: request.id } };
  });
  app.post("/terminal-payments/:attemptId/reconcile", { bodyLimit: 4096, preValidation: strictBody(TerminalReconcileSchema), preHandler: requireStaff, schema: { tags: ["Terminal payments"], headers: zodToJsonSchema(AuthRequestHeadersSchema), params: zodToJsonSchema(params), body: zodToJsonSchema(TerminalReconcileSchema), response: { 200: zodToJsonSchema(TerminalAttemptResponseSchema), ...errors } } }, async request => ({ data: await reconcileTerminalAttempt(app.prisma, request.authenticatedUser!, params.parse(request.params).attemptId, TerminalReconcileSchema.parse(request.body), request.id), meta: { requestId: request.id } }));
};
