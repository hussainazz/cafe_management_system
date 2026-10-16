import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ArchiveInventoryEntityRequestSchema,
  AuthRequestHeadersSchema,
  CreateInventoryCountRequestSchema,
  CreatePurchaseRequestSchema,
  CreateRecipeRequestSchema,
  CreateStockItemRequestSchema,
  ErrorResponseSchema,
  GrossProfitReportQuerySchema,
  GrossProfitReportResponseSchema,
  IdempotencyRequestHeadersSchema,
  InventoryCountPathSchema,
  InventoryCountResponseSchema,
  InventoryCountsResponseSchema,
  InventoryCountListQuerySchema,
  InventoryMovementQuerySchema,
  InventoryMovementResponseSchema,
  InventoryMovementsResponseSchema,
  PendingConsumptionQuerySchema,
  PendingConsumptionsResponseSchema,
  PostInventoryCountRequestSchema,
  PostPurchaseRequestSchema,
  ProductCostingConfigurationInputSchema,
  ProductCostingConfigurationResponseSchema,
  ProductCostingPathSchema,
  ProductCostingPreviewRequestSchema,
  ProductCostingPreviewResponseSchema,
  PurchasePathSchema,
  PurchaseListQuerySchema,
  PurchaseResponseSchema,
  PurchasesResponseSchema,
  PurchaseReturnRequestSchema,
  RecipePathSchema,
  RecipeResponseSchema,
  RecipesResponseSchema,
  StockItemPathSchema,
  StockItemResponseSchema,
  StockItemsResponseSchema,
  UpdateInventoryCountRequestSchema,
  UpdatePurchaseRequestSchema,
  UpdateRecipeRequestSchema,
  UpdateStockItemRequestSchema,
  UpdateProductCostingRequestSchema,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireManagerRoute } from "../auth/authorization.js";
import { requireInventoryActive } from "./inventory-activation.js";
import { grossProfitReport } from "./gross-profit.service.js";
import {
  archiveRecipe,
  archiveStockItem,
  createCount,
  createPurchase,
  createRecipe,
  createStockItem,
  getProductCosting,
  listCounts,
  listInventoryMovements,
  listPendingConsumptions,
  listPurchases,
  listRecipes,
  listStockItems,
  postInventoryCount,
  postPurchase,
  previewProductCosting,
  returnPurchaseStock,
  setProductCosting,
  updateCount,
  updatePurchase,
  updateRecipe,
  updateStockItem,
} from "./inventory.service.js";

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  return schema.parse(value);
}
function meta(request: { id: string }) { return { requestId: request.id }; }
function pathId(params: unknown) { return Object.values(params as Record<string, unknown>)[0] as string; }

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const headers = zodToJsonSchema(AuthRequestHeadersSchema);
  const idempotencyHeaders = zodToJsonSchema(IdempotencyRequestHeadersSchema);
  const errors = Object.fromEntries([400, 401, 403, 404, 409, 422, 429, 500, 503].map((status) => [status, zodToJsonSchema(ErrorResponseSchema)]));
  const manager = { preHandler: async (request: FastifyRequest) => {
    await requireManagerRoute(request);
    await requireInventoryActive(app.prisma);
  } };

  app.get("/admin/inventory/stock-items", { ...manager, schema: { tags: ["Manager inventory"], headers, response: { 200: zodToJsonSchema(StockItemsResponseSchema), ...errors } } }, async (request) => ({ data: { stockItems: await listStockItems(app.prisma) }, meta: meta(request) }));
  app.post("/admin/inventory/stock-items", { ...manager, schema: { tags: ["Manager inventory"], headers, body: zodToJsonSchema(CreateStockItemRequestSchema), response: { 201: zodToJsonSchema(StockItemResponseSchema), ...errors } } }, async (request: any, reply) => { const data = await createStockItem(app.prisma, request.authenticatedUser!, parsed(CreateStockItemRequestSchema, request.body), request.id); reply.code(201); return { data, meta: meta(request) }; });
  app.patch("/admin/inventory/stock-items/:stockItemId", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(StockItemPathSchema), body: zodToJsonSchema(UpdateStockItemRequestSchema), response: { 200: zodToJsonSchema(StockItemResponseSchema), ...errors } } }, async (request: any) => ({ data: await updateStockItem(app.prisma, request.authenticatedUser!, pathId(request.params), parsed(UpdateStockItemRequestSchema, request.body), request.id), meta: meta(request) }));
  app.post("/admin/inventory/stock-items/:stockItemId/archive", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(StockItemPathSchema), body: zodToJsonSchema(ArchiveInventoryEntityRequestSchema), response: { 200: zodToJsonSchema(StockItemResponseSchema), ...errors } } }, async (request: any) => { const body = parsed(ArchiveInventoryEntityRequestSchema, request.body); return { data: await archiveStockItem(app.prisma, request.authenticatedUser!, pathId(request.params), body.expectedVersion, request.id), meta: meta(request) }; });

  app.get("/admin/inventory/purchases", { ...manager, schema: { tags: ["Manager inventory"], headers, querystring: zodToJsonSchema(PurchaseListQuerySchema), response: { 200: zodToJsonSchema(PurchasesResponseSchema), ...errors } } }, async (request: any) => { const query = parsed(PurchaseListQuerySchema, request.query); const result = await listPurchases(app.prisma, query); return { data: result, meta: meta(request) }; });
  app.post("/admin/inventory/purchases", { ...manager, schema: { tags: ["Manager inventory"], headers, body: zodToJsonSchema(CreatePurchaseRequestSchema), response: { 201: zodToJsonSchema(PurchaseResponseSchema), ...errors } } }, async (request: any, reply) => { const data = await createPurchase(app.prisma, request.authenticatedUser!, parsed(CreatePurchaseRequestSchema, request.body), request.id); reply.code(201); return { data, meta: meta(request) }; });
  app.patch("/admin/inventory/purchases/:purchaseId", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(PurchasePathSchema), body: zodToJsonSchema(UpdatePurchaseRequestSchema), response: { 200: zodToJsonSchema(PurchaseResponseSchema), ...errors } } }, async (request: any) => ({ data: await updatePurchase(app.prisma, request.authenticatedUser!, pathId(request.params), parsed(UpdatePurchaseRequestSchema, request.body), request.id), meta: meta(request) }));
  app.post("/admin/inventory/purchases/:purchaseId/post", { ...manager, schema: { tags: ["Manager inventory"], headers: idempotencyHeaders, params: zodToJsonSchema(PurchasePathSchema), body: zodToJsonSchema(PostPurchaseRequestSchema), response: { 200: zodToJsonSchema(PurchaseResponseSchema), ...errors } } }, async (request: any) => { const body = parsed(PostPurchaseRequestSchema, request.body); const key = request.headers["idempotency-key"] as string; return { data: await postPurchase(app.prisma, request.authenticatedUser!, pathId(request.params), body.expectedVersion, key, request.id), meta: meta(request) }; });
  app.post("/admin/inventory/purchases/:purchaseId/returns", { ...manager, schema: { tags: ["Manager inventory"], headers: idempotencyHeaders, params: zodToJsonSchema(PurchasePathSchema), body: zodToJsonSchema(PurchaseReturnRequestSchema), response: { 201: zodToJsonSchema(InventoryMovementResponseSchema), ...errors } } }, async (request: any, reply) => { const body = parsed(PurchaseReturnRequestSchema, request.body); const key = request.headers["idempotency-key"] as string; const data = await returnPurchaseStock(app.prisma, request.authenticatedUser!, pathId(request.params), body, key, request.id); reply.code(201); return { data, meta: meta(request) }; });

  app.get("/admin/inventory/recipes", { ...manager, schema: { tags: ["Manager inventory"], headers, response: { 200: zodToJsonSchema(RecipesResponseSchema), ...errors } } }, async (request) => ({ data: { recipes: await listRecipes(app.prisma) }, meta: meta(request) }));
  app.post("/admin/inventory/recipes", { ...manager, schema: { tags: ["Manager inventory"], headers, body: zodToJsonSchema(CreateRecipeRequestSchema), response: { 201: zodToJsonSchema(RecipeResponseSchema), ...errors } } }, async (request: any, reply) => { const data = await createRecipe(app.prisma, request.authenticatedUser!, parsed(CreateRecipeRequestSchema, request.body), request.id); reply.code(201); return { data, meta: meta(request) }; });
  app.patch("/admin/inventory/recipes/:recipeId", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(RecipePathSchema), body: zodToJsonSchema(UpdateRecipeRequestSchema), response: { 200: zodToJsonSchema(RecipeResponseSchema), ...errors } } }, async (request: any) => ({ data: await updateRecipe(app.prisma, request.authenticatedUser!, pathId(request.params), parsed(UpdateRecipeRequestSchema, request.body), request.id), meta: meta(request) }));
  app.post("/admin/inventory/recipes/:recipeId/archive", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(RecipePathSchema), body: zodToJsonSchema(ArchiveInventoryEntityRequestSchema), response: { 200: zodToJsonSchema(RecipeResponseSchema), ...errors } } }, async (request: any) => { const body = parsed(ArchiveInventoryEntityRequestSchema, request.body); return { data: await archiveRecipe(app.prisma, request.authenticatedUser!, pathId(request.params), body.expectedVersion, request.id), meta: meta(request) }; });

  app.get("/admin/products/:productId/costing", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(ProductCostingPathSchema), response: { 200: zodToJsonSchema(ProductCostingConfigurationResponseSchema), ...errors } } }, async (request: any) => ({ data: await getProductCosting(app.prisma, pathId(request.params)), meta: meta(request) }));
  app.put("/admin/products/:productId/costing", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(ProductCostingPathSchema), body: zodToJsonSchema(UpdateProductCostingRequestSchema), response: { 200: zodToJsonSchema(ProductCostingConfigurationResponseSchema), ...errors } } }, async (request: any) => { const input = parsed(UpdateProductCostingRequestSchema, request.body); const { expectedVersion, ...data } = input; return { data: await setProductCosting(app.prisma, request.authenticatedUser!, pathId(request.params), { ...data, expectedVersion } as any, request.id), meta: meta(request) }; });
  app.post("/admin/products/:productId/costing/preview", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(ProductCostingPathSchema), body: zodToJsonSchema(ProductCostingPreviewRequestSchema), response: { 200: zodToJsonSchema(ProductCostingPreviewResponseSchema), ...errors } } }, async (request: any) => { const input = parsed(ProductCostingPreviewRequestSchema, request.body); return { data: await previewProductCosting(app.prisma, pathId(request.params), input.optionIds, input.quantity, input.weightGrams ?? null), meta: meta(request) }; });

  app.get("/admin/inventory/counts", { ...manager, schema: { tags: ["Manager inventory"], headers, querystring: zodToJsonSchema(InventoryCountListQuerySchema), response: { 200: zodToJsonSchema(InventoryCountsResponseSchema), ...errors } } }, async (request: any) => { const query = parsed(InventoryCountListQuerySchema, request.query); const result = await listCounts(app.prisma, query); return { data: result, meta: meta(request) }; });
  app.post("/admin/inventory/counts", { ...manager, schema: { tags: ["Manager inventory"], headers, body: zodToJsonSchema(CreateInventoryCountRequestSchema), response: { 201: zodToJsonSchema(InventoryCountResponseSchema), ...errors } } }, async (request: any, reply) => { const data = await createCount(app.prisma, request.authenticatedUser!, parsed(CreateInventoryCountRequestSchema, request.body), request.id); reply.code(201); return { data, meta: meta(request) }; });
  app.patch("/admin/inventory/counts/:countId", { ...manager, schema: { tags: ["Manager inventory"], headers, params: zodToJsonSchema(InventoryCountPathSchema), body: zodToJsonSchema(UpdateInventoryCountRequestSchema), response: { 200: zodToJsonSchema(InventoryCountResponseSchema), ...errors } } }, async (request: any) => ({ data: await updateCount(app.prisma, request.authenticatedUser!, pathId(request.params), parsed(UpdateInventoryCountRequestSchema, request.body), request.id), meta: meta(request) }));
  app.post("/admin/inventory/counts/:countId/post", { ...manager, schema: { tags: ["Manager inventory"], headers: idempotencyHeaders, params: zodToJsonSchema(InventoryCountPathSchema), body: zodToJsonSchema(PostInventoryCountRequestSchema), response: { 200: zodToJsonSchema(InventoryCountResponseSchema), ...errors } } }, async (request: any) => { const input = parsed(PostInventoryCountRequestSchema, request.body); const key = request.headers["idempotency-key"] as string; return { data: await postInventoryCount(app.prisma, request.authenticatedUser!, pathId(request.params), input, key, request.id), meta: meta(request) }; });

  app.get("/admin/inventory/movements", { ...manager, schema: { tags: ["Manager inventory"], headers, querystring: zodToJsonSchema(InventoryMovementQuerySchema), response: { 200: zodToJsonSchema(InventoryMovementsResponseSchema), ...errors } } }, async (request: any) => { const result = await listInventoryMovements(app.prisma, parsed(InventoryMovementQuerySchema, request.query)); return { data: { movements: result.movements }, meta: { requestId: request.id, page: result.page } }; });
  app.get("/admin/inventory/pending-consumption", { ...manager, schema: { tags: ["Manager inventory"], headers, querystring: zodToJsonSchema(PendingConsumptionQuerySchema), response: { 200: zodToJsonSchema(PendingConsumptionsResponseSchema), ...errors } } }, async (request: any) => { const result = await listPendingConsumptions(app.prisma, parsed(PendingConsumptionQuerySchema, request.query)); return { data: { consumptions: result.consumptions }, meta: { requestId: request.id, page: result.page } }; });
  app.get("/admin/reports/gross-profit", { ...manager, schema: { tags: ["Manager inventory"], headers, querystring: zodToJsonSchema(GrossProfitReportQuerySchema), response: { 200: zodToJsonSchema(GrossProfitReportResponseSchema), ...errors } } }, async (request: any) => { const result = await grossProfitReport(app.prisma, parsed(GrossProfitReportQuerySchema, request.query)); return { data: result.data, meta: { requestId: request.id, range: { from: result.range.from.toISOString(), to: result.range.to.toISOString() } } }; });
};
