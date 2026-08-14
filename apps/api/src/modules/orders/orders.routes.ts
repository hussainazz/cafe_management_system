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
  TransferOrderTableRequestSchema,
  UpdateOrderRequestSchema,
  type CreateOrderRequest,
  type DeleteOrderRequest,
  type OrderListQuery,
  type TransferOrderTableRequest,
  type UpdateOrderRequest,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireStaff } from "../auth/authorization.js";
import { createOrder, deleteOrder, listOrders, readOrder, transferOrderTable, updateOrder } from "./orders.service.js";

export const ordersRoutes: FastifyPluginAsync = async (app) => {
  const headers = zodToJsonSchema(AuthRequestHeadersSchema);
  const orderParams = zodToJsonSchema(OrderIdPathSchema);
  const errors = { 400: zodToJsonSchema(ErrorResponseSchema), 401: zodToJsonSchema(ErrorResponseSchema), 403: zodToJsonSchema(ErrorResponseSchema), 404: zodToJsonSchema(ErrorResponseSchema), 409: zodToJsonSchema(ErrorResponseSchema), 422: zodToJsonSchema(ErrorResponseSchema) };
  app.get<{ Querystring: OrderListQuery }>("/orders", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "List orders", headers, querystring: zodToJsonSchema(OrderListQuerySchema), response: { 200: zodToJsonSchema(OrderListResponseSchema), ...errors } } }, async (request) => { const result = await listOrders(app.prisma, request.authenticatedUser!, request.query); return { data: { orders: result.orders }, meta: { requestId: request.id, page: result.page } }; });
  app.get<{ Params: { orderId: string } }>("/orders/:orderId", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Read an order", headers, params: orderParams, response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await readOrder(app.prisma, request.authenticatedUser!, request.params.orderId), meta: { requestId: request.id } }));
  app.patch<{ Params: { orderId: string }; Body: UpdateOrderRequest }>("/orders/:orderId", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Edit an open order", headers, params: orderParams, body: zodToJsonSchema(UpdateOrderRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await updateOrder(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
  app.post<{ Params: { orderId: string }; Body: TransferOrderTableRequest }>("/orders/:orderId/transfer-table", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Transfer an open table order", headers, params: orderParams, body: zodToJsonSchema(TransferOrderTableRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await transferOrderTable(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
  app.post<{ Params: { orderId: string }; Body: DeleteOrderRequest }>("/orders/:orderId/delete", { preHandler: requireStaff, schema: { tags: ["Orders"], summary: "Logically delete an open order", headers, params: orderParams, body: zodToJsonSchema(DeleteOrderRequestSchema), response: { 200: zodToJsonSchema(OrderDetailResponseSchema), ...errors } } }, async (request) => ({ data: await deleteOrder(app.prisma, request.authenticatedUser!, request.params.orderId, request.body, request.id), meta: { requestId: request.id } }));
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
