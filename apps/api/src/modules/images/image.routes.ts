import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  AdminImageArchiveResponseSchema,
  AdminImageResponseSchema,
  AuthRequestHeadersSchema,
  ErrorResponseSchema,
} from "@cafe/contracts";
import { env } from "../../config/env.js";
import { zodToJsonSchema } from "../../contracts/openapi.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { requireStaff } from "../auth/authorization.js";

const formats = new Map<string, { extension: "jpg" | "png" | "webp" }>([
  ["image/jpeg", { extension: "jpg" }],
  ["image/png", { extension: "png" }],
  ["image/webp", { extension: "webp" }],
]);
const safeKey = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const canonicalKey = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i;

function imagePath(key: string) {
  if (!safeKey.test(key) || basename(key) !== key) {
    throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
  }
  return join(env.PRODUCT_IMAGE_STORAGE_DIR, key);
}

function hasExpectedSignature(content: Buffer, mime: string) {
  if (mime === "image/jpeg") {
    return content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
  }
  if (mime === "image/png") {
    return content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  return content.length >= 12 && content.toString("ascii", 0, 4) === "RIFF" && content.toString("ascii", 8, 12) === "WEBP";
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
      preHandler: requireStaff,
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
      const product = await app.prisma.product.findUnique({ where: { id: productId }, select: { id: true, name: true } });
      if (!product) {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested product was not found.");
      }
      const part = await request.file();
      const content = part ? await part.toBuffer() : Buffer.alloc(0);
      const altText = product.name;
      const format = part ? formats.get(part.mimetype) : undefined;
      if (!part || !format || !hasExpectedSignature(content, part.mimetype)) {
        throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "A valid JPEG, PNG, or WebP image is required.");
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

  app.post(
    "/admin/products/:productId/image/archive",
    {
      preHandler: requireStaff,
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

  app.get(
    "/media/products/uploads/:storageKey",
    {
      schema: {
        tags: ["Public menu"],
        summary: "Read a currently public, versioned product image",
        params: { type: "object", required: ["storageKey"], properties: { storageKey: { type: "string" } } },
        response: {
          200: { type: "string", format: "binary" },
          404: zodToJsonSchema(ErrorResponseSchema),
        },
      },
    },
    async (request: any, reply) => {
      reply.header("cache-control", "no-store, max-age=0");
      const key = request.params.storageKey as string;
      const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
      const mime = extension === "jpg" ? "image/jpeg" : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : null;
      if (!mime || !canonicalKey.test(key)) {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      }

      const image = await app.prisma.productImage.findFirst({
        where: {
          storageKey: key,
          product: {
            is: {
              isPublic: true,
              isActive: true,
              archivedAt: null,
              category: { is: { archivedAt: null } },
            },
          },
        },
        select: { storageKey: true },
      });
      if (!image) {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      }

      let content: Buffer;
      try {
        content = await readFile(imagePath(key));
      } catch {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      }
      if (content.byteLength === 0 || content.byteLength > 5 * 1024 * 1024 || !hasExpectedSignature(content, mime)) {
        throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found.");
      }

      reply
        .header("cache-control", "public, max-age=2592000, immutable")
        .header("content-length", String(content.byteLength))
        .header("x-content-type-options", "nosniff")
        .type(mime);
      return reply.send(content);
    },
  );
};
