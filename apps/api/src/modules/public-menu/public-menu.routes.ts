import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ErrorResponseSchema, PublicMenuQuerySchema, PublicMenuResponseSchema, PublicProductResponseSchema } from "@cafe/contracts";
import type { PublicMenuQuery } from "@cafe/contracts";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { readPublicMenu, readPublicProduct } from "./public-menu.service.js";

const ProductIdPathSchema = z.object({ productId: z.uuid() });

export const publicMenuRoutes: FastifyPluginAsync = async (app) => {
  const errors = [400, 404].reduce<Record<number, object>>((all, status) => {
    all[status] = zodToJsonSchema(ErrorResponseSchema);
    return all;
  }, {});

  app.get<{ Querystring: PublicMenuQuery }>("/public/menu", {
    schema: {
      tags: ["Public menu"], summary: "Read the browse-only QR menu",
      querystring: zodToJsonSchema(PublicMenuQuerySchema),
      response: { 200: zodToJsonSchema(PublicMenuResponseSchema), ...errors },
    },
  }, async (request) => ({ data: await readPublicMenu(app.prisma, request.query), meta: { requestId: request.id } }));

  app.get<{ Params: { productId: string } }>("/public/products/:productId", {
    schema: {
      tags: ["Public menu"], summary: "Read one publicly visible menu product",
      params: zodToJsonSchema(ProductIdPathSchema),
      response: { 200: zodToJsonSchema(PublicProductResponseSchema), ...errors },
    },
  }, async (request) => {
    const product = await readPublicProduct(app.prisma, request.params.productId);
    if (!product) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested menu product was not found.");
    return { data: product, meta: { requestId: request.id } };
  });
};
