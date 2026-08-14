import type { FastifyPluginAsync } from "fastify";
import {
  AuthRequestHeadersSchema,
  CreateOrderRequestSchema,
  CreateOrderResponseSchema,
  DeleteOrderRequestSchema,
  ErrorResponseSchema,
  IdempotencyRequestHeadersSchema,
  OrderDetailResponseSchema,
  OrderIdPathSchema,
  OrderListQuerySchema,
  OrderListResponseSchema,
  RecordSettlementRequestSchema,
  RecordSettlementResponseSchema,
  ReverseSettlementRequestSchema,
  ReverseSettlementResponseSchema,
  BarTicketResponseSchema,
  OrderReceiptResponseSchema,
  SettlementReceiptResponseSchema,
  SettlementIdPathSchema,
  SettlementPathSchema,
  TransferOrderTableRequestSchema,
  UpdateOrderRequestSchema,
  type CreateOrderRequest,
  type DeleteOrderRequest,
  type OrderListQuery,
  type RecordSettlementRequest,
  type ReverseSettlementRequest,
  type TransferOrderTableRequest,
  type UpdateOrderRequest,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { barTicket, createOrder, deleteOrder, listOrders, orderReceipt, readOrder, recordSettlement, reverseSettlementById, settlementReceipt, transferOrderTable, updateOrder } from "./orders.service.js";

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  const headers = zodToJsonSchema(AuthRequestHeadersSchema);
  const orderParams = zodToJsonSchema(OrderIdPathSchema);
  const settlementParams = zodToJsonSchema(SettlementIdPathSchema);
  const settlementOnlyParams = zodToJsonSchema(SettlementPathSchema);
  const errors = { 400: zodToJsonSchema(ErrorResponseSchema), 401: zodToJsonSchema(ErrorResponseSchema), 403: zodToJsonSchema(ErrorResponseSchema), 404: zodToJsonSchema(ErrorResponseSchema), 409: zodToJsonSchema(ErrorResponseSchema), 422: zodToJsonSchema(ErrorResponseSchema) };
  app.get<{ Querystring: OrderListQuery }>("/orders", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "List orders", headers, querystring: zodToJsonSchema(OrderListQuerySchema), response: { 200: zodToJsonSchema(OrderListResponseSchema), ...errors } } }, async (request) => { const result = await listOrders(app.prisma, request.authenticatedUser!, request.query); return { data: { orders: result.orders }, meta: { requestId: request.id, page: result.page } }; });
  app.get<{ Params: { orderId: string } }>("/orders/:orderId", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Read an order", headers, params: orderParams, response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await readOrder(app.prisma, request.authenticatedUser!, request.params.orderId), meta: { requestId: request.id } }));
  app.patch<{ Params: { orderId: string }; Body: UpdateOrderRequest }>("/orders/:orderId", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Edit an open order", headers, params: orderParams, body: zodToJsonSchema(UpdateOrderRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await updateOrder(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
  app.post<{ Params: { orderId: string }; Body: TransferOrderTableRequest }>("/orders/:orderId/transfer-table", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Transfer an open table order", headers, params: orderParams, body: zodToJsonSchema(TransferOrderTableRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await transferOrderTable(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
  app.post<{ Params: { orderId: string }; Body: DeleteOrderRequest }>("/orders/:orderId/delete", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Logically delete an open order", headers, params: orderParams, body: zodToJsonSchema(DeleteOrderRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await deleteOrder(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
  app.post<{ Params: { orderId: string }; Body: RecordSettlementRequest }>("/orders/:orderId/record-settlement", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Record a selected-item settlement", headers: zodToJsonSchema(IdempotencyRequestHeadersSchema), params: orderParams, body: zodToJsonSchema(RecordSettlementRequestSchema), response: { 201: zodToJsonSchema(RecordSettlementResponseSchema), ...errors } } }, async (request, reply) => {
    const key = request.headers["idempotency-key"];
    const result = await recordSettlement(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, typeof key === "string" ? key : "", request.id);
    if (result.replayed) reply.header("idempotency-replayed", "true");
    return reply.status(201).send({ data: result.order, meta: { requestId: request.id } });
  });
  app.post<{ Params: { settlementId: string }; Body: ReverseSettlementRequest }>("/admin/settlements/:settlementId/reverse", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Reverse a settlement", headers, params: settlementOnlyParams, body: zodToJsonSchema(ReverseSettlementRequestSchema), response: { 200: zodToJsonSchema(ReverseSettlementResponseSchema), ...errors } } }, async (request) => ({ data: await reverseSettlementById(app.prisma, request.authenticatedUser!, request.params.settlementId, request.body, request.id), meta: { requestId: request.id } }));
  app.get<{ Params: { orderId: string } }>("/orders/:orderId/bar-ticket", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Read print-ready bar ticket data", headers, params: orderParams, response: { 200: zodToJsonSchema(BarTicketResponseSchema), ...errors } } }, async (request) => ({ data: await barTicket(app.prisma, request.authenticatedUser!, request.params.orderId), meta: { requestId: request.id } }));
  app.get<{ Params: { orderId: string } }>("/orders/:orderId/receipt", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Read whole-order receipt data", headers, params: orderParams, response: { 200: zodToJsonSchema(OrderReceiptResponseSchema), ...errors } } }, async (request) => ({ data: await orderReceipt(app.prisma, request.authenticatedUser!, request.params.orderId), meta: { requestId: request.id } }));
  app.get<{ Params: { orderId: string; settlementId: string } }>("/orders/:orderId/settlements/:settlementId/receipt", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Read payer-settlement receipt data", headers, params: settlementParams, response: { 200: zodToJsonSchema(SettlementReceiptResponseSchema), ...errors } } }, async (request) => ({ data: await settlementReceipt(app.prisma, request.authenticatedUser!, request.params.orderId, request.params.settlementId), meta: { requestId: request.id } }));
  app.post<{ Body: CreateOrderRequest }>(
    "/orders",
    {
      preHandler: requireStaff,
      schema: {
        tags: ["Orders"],
        summary: "Create an open table or takeaway order",
        headers: zodToJsonSchema(IdempotencyRequestHeadersSchema),
        body: zodToJsonSchema(CreateOrderRequestSchema),
        response: {
          201: zodToJsonSchema(CreateOrderResponseSchema),
          400: zodToJsonSchema(ErrorResponseSchema),
          401: zodToJsonSchema(ErrorResponseSchema),
          403: zodToJsonSchema(ErrorResponseSchema),
          409: zodToJsonSchema(ErrorResponseSchema),
          422: zodToJsonSchema(ErrorResponseSchema),
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"];
      const result = await createOrder(
        app.prisma,
        request.authenticatedUser!,
        request.body,
        typeof idempotencyKey === "string" ? idempotencyKey : "",
        request.id,
      );
      if (result.replayed) {
        reply.header("idempotency-replayed", "true");
      }
      return reply.status(201).send({ data: result.order, meta: { requestId: request.id } });
    },
  );
};
