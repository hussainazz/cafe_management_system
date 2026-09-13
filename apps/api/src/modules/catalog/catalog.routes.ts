import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AuthRequestHeadersSchema,
  ErrorResponseSchema,
  ProductSaleDiscountRequestSchema,
  ProductSaleDiscountResponseSchema,
  type ProductSaleDiscountRequest,
} from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { requireManagerRoute } from "../auth/authorization.js";

const ProductIdPathSchema = z.object({ productId: z.uuid() });

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  const errors = [400, 401, 403, 404, 422].reduce<Record<number, object>>((all, status) => {
    all[status] = zodToJsonSchema(ErrorResponseSchema);
    return all;
  }, {});
  app.patch<{ Params: { productId: string }; Body: ProductSaleDiscountRequest }>(
    "/admin/products/:productId/sale-discount",
    {
      preHandler: requireManagerRoute,
      schema: {
        tags: ["Catalog"], summary: "Configure a product sale discount",
        headers: zodToJsonSchema(AuthRequestHeadersSchema),
        params: zodToJsonSchema(ProductIdPathSchema), body: zodToJsonSchema(ProductSaleDiscountRequestSchema),
        response: { 200: zodToJsonSchema(ProductSaleDiscountResponseSchema), ...errors },
      },
    },
    async (request) => {
      const product = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id: request.params.productId },
          data: {
            saleDiscountKind: request.body.saleDiscount?.kind ?? null,
            saleDiscountValue: request.body.saleDiscount?.value ?? null,
          },
          select: { id: true, saleDiscountKind: true, saleDiscountValue: true },
        });
        await tx.auditLog.create({ data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "UPDATE_PRODUCT_SALE_DISCOUNT", entityType: "PRODUCT", entityId: updated.id, afterSnapshot: updated } });
        return updated;
      });
      return { data: product, meta: { requestId: request.id } };
    },
  );
};
