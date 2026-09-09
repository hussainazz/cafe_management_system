import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env.js";
import { ApplicationError, ErrorCodes } from "../../errors/application-error.js";
import { requireManagerRoute } from "../auth/authorization.js";

const formats = new Map<string, { extension: "jpg" | "png" | "webp"; signature: number[] }>([["image/jpeg", { extension: "jpg", signature: [0xff, 0xd8, 0xff] }], ["image/png", { extension: "png", signature: [0x89, 0x50, 0x4e, 0x47] }], ["image/webp", { extension: "webp", signature: [0x52, 0x49, 0x46, 0x46] }]]);
const safeKey = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
function imagePath(key: string) { if (!safeKey.test(key) || basename(key) !== key) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found."); return join(env.PRODUCT_IMAGE_STORAGE_DIR, key); }

export const imageRoutes: FastifyPluginAsync = async (app) => {
  app.put("/admin/products/:productId/image", { preHandler: requireManagerRoute }, async (request: any) => {
    const part = await request.file();
    const altText = typeof part?.fields.altText?.value === "string" ? part.fields.altText.value.trim() : "";
    const format = part ? formats.get(part.mimetype) : undefined;
    const content = part ? await part.toBuffer() : Buffer.alloc(0);
    if (!part || !format || !altText || altText.length > 500 || !format.signature.every((value, index) => content[index] === value)) throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "A valid JPEG, PNG, or WebP image and alt text are required.");
    const productId = request.params.productId; const old = await app.prisma.productImage.findUnique({ where: { productId } }); const storageKey = `${crypto.randomUUID()}.${format.extension}`;
    await mkdir(env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true }); await writeFile(imagePath(storageKey), content, { flag: "wx" });
    try { const image = await app.prisma.productImage.upsert({ where: { productId }, create: { productId, storageKey, altText }, update: { storageKey, altText } }); await app.prisma.auditLog.create({ data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "UPSERT_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: productId, afterSnapshot: image } }); if (old) await unlink(imagePath(old.storageKey)).catch(() => undefined); return { data: image, meta: { requestId: request.id } }; } catch (error) { await unlink(imagePath(storageKey)).catch(() => undefined); throw error; }
  });
  app.patch("/admin/products/:productId/image", { preHandler: requireManagerRoute }, async (request: any) => { const altText = typeof request.body?.altText === "string" ? request.body.altText.trim() : ""; if (!altText || altText.length > 500) throw new ApplicationError(400, ErrorCodes.VALIDATION_ERROR, "Alt text is invalid."); const image = await app.prisma.productImage.update({ where: { productId: request.params.productId }, data: { altText } }); await app.prisma.auditLog.create({ data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "UPDATE_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: request.params.productId, afterSnapshot: image } }); return { data: image, meta: { requestId: request.id } }; });
  app.post("/admin/products/:productId/image/archive", { preHandler: requireManagerRoute }, async (request: any) => { const image = await app.prisma.productImage.delete({ where: { productId: request.params.productId } }); await unlink(imagePath(image.storageKey)).catch(() => undefined); await app.prisma.auditLog.create({ data: { actorId: request.authenticatedUser!.id, requestId: request.id, operation: "ARCHIVE_PRODUCT_IMAGE", entityType: "PRODUCT", entityId: request.params.productId, afterSnapshot: { storageKey: image.storageKey } } }); return { data: { productId: request.params.productId }, meta: { requestId: request.id } }; });
  app.get("/product-images/:storageKey", async (request: any, reply) => { const key = request.params.storageKey; const mime = key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : key.endsWith(".webp") ? "image/webp" : null; if (!mime) throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found."); try { reply.header("cache-control", "public, max-age=31536000, immutable").type(mime); return reply.send(await readFile(imagePath(key))); } catch { throw new ApplicationError(404, ErrorCodes.NOT_FOUND, "The requested image was not found."); } });
};
