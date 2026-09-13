import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AdminImageArchiveResponseSchema,
  AdminImageMetadataSchema,
  AdminImageResponseSchema,
  AuthRequestHeadersSchema,
  ErrorResponseSchema,
} from "@cafe/contracts";
import { env } from "../../config/env.js";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { requireManagerRoute } from "../auth/authorization.js";

const formats = new Map<string, { extension: "jpg" | "png" | "webp"; signature: number[] }>([
  ["image/jpeg", { extension: "jpg", signature: [0xff, 0xd8, 0xff] }],
  ["image/png", { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] }],
  ["image/webp", { extension: "webp", signature: [0x52, 0x49, 0x46, 0x46] }],
]);
const safeKey = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

function imagePath(key: string) {
  if (!safeKey.test(key) || basename(key) !== key) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
  }
  return join(env.PRODUCT_IMAGE_STORAGE_DIR, key);
}

export const imageRoutes: FastifyPluginAsync = async (app) => {
  const headers = { ...zodToJsonSchema(AuthRequestHeadersSchema), additionalProperties: true };
  const productParams = zodToJsonSchema(z.object({ productId: z.uuid() }));
  const errors = {
    400: zodToJsonSchema(ErrorResponseSchema),
    401: zodToJsonSchema(ErrorResponseSchema),
    403: zodToJsonSchema(ErrorResponseSchema),
    404: zodToJsonSchema(ErrorResponseSchema),
    409: zodToJsonSchema(ErrorResponseSchema),
    413: zodToJsonSchema(ErrorResponseSchema),
    422: zodToJsonSchema(ErrorResponseSchema),
  };

  app.put(
    "/admin/products/:productId/image",
    {
      preHandler: requireManagerRoute,
      schema: {
        tags: ["Manager administration"],
        summary: "Upload or replace a product image",
        headers,
        params: productParams,
        consumes: ["multipart/form-data"],
        response: { 200: zodToJsonSchema(AdminImageResponseSchema), ...errors },
      },
    },
    async (request: any) => {
      const productId = request.params.productId as string;
      const product = await app.prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!product) {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested product was not found.");
      }
      const part = await request.file();
      const altText = typeof part?.fields.altText?.value === "string"
        ? part.fields.altText.value.trim()
        : "";
      const format = part ? formats.get(part.mimetype) : undefined;
      const content = part ? await part.toBuffer() : Buffer.alloc(0);
      if (!part || !format || !altText || altText.length > 500 || !format.signature.every((value, index) => content[index] === value)) {
        throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "A valid JPEG, PNG, or WebP image and alt text are required.");
      }

      const old = await app.prisma.productImage.findUnique({ where: { productId } });
      const storageKey = `${crypto.randomUUID()}.${format.extension}`;
      await mkdir(env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true });
      await writeFile(imagePath(storageKey), content, { flag: "wx" });
      let committed = false;
      try {
        const image = await app.prisma.$transaction(async (tx) => {
          const updated = await tx.productImage.upsert({
            where: { productId },
            create: { productId, storageKey, altText },
            update: { storageKey, altText },
          });
          await tx.auditLog.create({
            data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "UPSERT_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: productId, afterSnapshot: updated },
          });
          return updated;
        });
        committed = true;
        if (old) await unlink(imagePath(old.storageKey)).catch(() => undefined);
        return { data: { storageKey: image.storageKey, altText: image.altText }, meta: { requestId: request.id } };
      } catch (error) {
        if (!committed) await unlink(imagePath(storageKey)).catch(() => undefined);
        throw error;
      }
    },
  );

  app.patch(
    "/admin/products/:productId/image",
    {
      preHandler: requireManagerRoute,
      schema: { tags: ["Manager administration"], summary: "Update product image alt text", headers, params: productParams, body: zodToJsonSchema(AdminImageMetadataSchema), response: { 200: zodToJsonSchema(AdminImageResponseSchema), ...errors } },
    },
    async (request: any) => {
      const { altText } = AdminImageMetadataSchema.parse(request.body);
      const image = await app.prisma.$transaction(async (tx) => {
        const updated = await tx.productImage.update({ where: { productId: request.params.productId }, data: { altText } });
        await tx.auditLog.create({
          data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "UPDATE_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: request.params.productId, afterSnapshot: updated },
        });
        return updated;
      });
      return { data: { storageKey: image.storageKey, altText: image.altText }, meta: { requestId: request.id } };
    },
  );

  app.post(
    "/admin/products/:productId/image/archive",
    {
      preHandler: requireManagerRoute,
      schema: { tags: ["Manager administration"], summary: "Archive a product image", headers, params: productParams, response: { 200: zodToJsonSchema(AdminImageArchiveResponseSchema), ...errors } },
    },
    async (request: any) => {
      const image = await app.prisma.$transaction(async (tx) => {
        const deleted = await tx.productImage.delete({ where: { productId: request.params.productId } });
        await tx.auditLog.create({
          data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "ARCHIVE_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: request.params.productId, afterSnapshot: { storageKey: deleted.storageKey } },
        });
        return deleted;
      });
      await unlink(imagePath(image.storageKey)).catch(() => undefined);
      return { data: { productId: request.params.productId }, meta: { requestId: request.id } };
    },
  );

  app.get(
    "/product-images/:storageKey",
    {
      schema: {
        tags: ["Public menu"],
        summary: "Read an immutable product image",
        params: { type: "object", required: ["storageKey"], properties: { storageKey: { type: "string" } } },
        response: {
          200: { type: "string", format: "binary" },
          404: zodToJsonSchema(ErrorResponseSchema),
        },
      },
    },
    async (request: any, reply) => {
      const key = request.params.storageKey as string;
      const mime = key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : null;
      if (!mime) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      try {
        reply.header("cache-control", "public, max-age=31536000, immutable").type(mime);
        return reply.send(await readFile(imagePath(key)));
      } catch {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      }
    },
  );
};
