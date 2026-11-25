import { mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UserRole } from "../../generated/prisma/client.js";
import { hashPassword } from "../../src/auth/password.js";
import { env } from "../../src/config/env.js";
import { buildApp } from "../../src/app.js";

const app = buildApp();
const key = "00000000-0000-4000-8000-000000000001.png";
let managerNumber = 0;
const uploadedKeys: string[] = [];
beforeAll(async () => { await app.ready(); await mkdir(env.PRODUCT_IMAGE_STORAGE_DIR, { recursive: true }); });
afterAll(async () => { await app.close(); await unlink(join(env.PRODUCT_IMAGE_STORAGE_DIR, key)).catch(() => undefined); for (const uploadedKey of uploadedKeys) await unlink(join(env.PRODUCT_IMAGE_STORAGE_DIR, uploadedKey)).catch(() => undefined); await rmdir(env.PRODUCT_IMAGE_STORAGE_DIR).catch(() => undefined); await rmdir(dirname(env.PRODUCT_IMAGE_STORAGE_DIR)).catch(() => undefined); });

async function managerCookies() {
  const username = `image.manager.${++managerNumber}`;
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role: UserRole.MANAGER } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}
async function staffCookies() {
  const username = `image.staff.${++managerNumber}`;
  await app.prisma.user.create({ data: { username, passwordHash: await hashPassword("CafePassword2026"), role: UserRole.STAFF } });
  const response = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { username, password: "CafePassword2026" } });
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

describe("product image delivery", () => {
  it("accepts a valid multipart PNG upload and rejects an invalid signature", async () => {
    const category = await app.prisma.category.create({ data: { name: "Uploads", displayOrder: 2 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Upload product", priceAmount: 1, preparationDeadlineMinutes: 1, displayOrder: 2 } });
    const boundary = "stage8-image-boundary";
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const uploaded = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/image`, cookies: await staffCookies(), headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: body });
    expect(uploaded.statusCode, uploaded.body).toBe(200);
    const firstKey = uploaded.json().data.storageKey as string;
    uploadedKeys.push(firstKey);
    expect(firstKey).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(uploaded.json().data.altText).toBe("Upload product");
    const invalid = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/image`, cookies: await managerCookies(), headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="bad.png"\r\nContent-Type: image/png\r\n\r\nnope\r\n--${boundary}--\r\n`) });
    expect(invalid.statusCode).toBe(400);

    const firstImage = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${firstKey}` });
    expect(firstImage.statusCode).toBe(200);
    expect(firstImage.headers["content-type"]).toContain("image/png");
    expect(firstImage.headers["cache-control"]).toBe("public, max-age=2592000, immutable");

    const replacementBody = Buffer.concat([body.subarray(0, body.length - Buffer.byteLength(`\r\n--${boundary}--\r\n`)), Buffer.from([1]), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const replacement = await app.inject({ method: "PUT", url: `/api/v1/admin/products/${product.id}/image`, cookies: await staffCookies(), headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: replacementBody });
    expect(replacement.statusCode).toBe(200);
    const replacementKey = replacement.json().data.storageKey as string;
    uploadedKeys.push(replacementKey);
    expect(replacementKey).not.toBe(firstKey);
    const staleImage = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${firstKey}` });
    expect(staleImage.statusCode).toBe(404);
    expect(staleImage.headers["cache-control"]).toBe("no-store, max-age=0");
    const replacementImage = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${replacementKey}` });
    expect(replacementImage.statusCode).toBe(200);
    expect(replacementImage.headers["cache-control"]).toBe("public, max-age=2592000, immutable");
  });
  it("serves opaque image keys and archives their current metadata and file", async () => {
    const category = await app.prisma.category.create({ data: { name: "Images", displayOrder: 1 } });
    const product = await app.prisma.product.create({ data: { categoryId: category.id, name: "Image product", priceAmount: 1, preparationDeadlineMinutes: 1, displayOrder: 1 } });
    await app.prisma.productImage.create({ data: { productId: product.id, storageKey: key, altText: "تصویر محصول" } });
    await writeFile(join(env.PRODUCT_IMAGE_STORAGE_DIR, key), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const served = await app.inject({ method: "GET", url: `/api/v1/product-images/${key}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
    expect(served.headers["cache-control"]).toContain("immutable");
    const canonical = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${key}` });
    expect(canonical.statusCode).toBe(200);
    expect(canonical.headers["content-type"]).toContain("image/png");
    expect(canonical.headers["cache-control"]).toBe("public, max-age=2592000, immutable");
    expect((await app.inject({ method: "GET", url: "/api/v1/product-images/../secret.png" })).statusCode).toBe(404);
    const archived = await app.inject({ method: "POST", url: `/api/v1/admin/products/${product.id}/image/archive`, cookies: await staffCookies() });
    expect(archived.statusCode).toBe(200);
    await expect(app.prisma.productImage.findUnique({ where: { productId: product.id } })).resolves.toBeNull();
    expect((await app.inject({ method: "GET", url: `/api/v1/product-images/${key}` })).statusCode).toBe(404);
    const archivedCanonical = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${key}` });
    expect(archivedCanonical.statusCode).toBe(404);
    expect(archivedCanonical.headers["cache-control"]).toBe("no-store, max-age=0");
  });

  it("does not serve inactive, private, or invalid stored files from the canonical namespace", async () => {
    const category = await app.prisma.category.create({ data: { name: "Private images", displayOrder: 3 } });
    const privateProduct = await app.prisma.product.create({ data: { categoryId: category.id, name: "Private image", priceAmount: 1, preparationDeadlineMinutes: 1, displayOrder: 3, isPublic: false } });
    const privateKey = "00000000-0000-4000-8000-000000000002.png";
    uploadedKeys.push(privateKey);
    await app.prisma.productImage.create({ data: { productId: privateProduct.id, storageKey: privateKey, altText: "Private image" } });
    await writeFile(join(env.PRODUCT_IMAGE_STORAGE_DIR, privateKey), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const privateImage = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${privateKey}` });
    expect(privateImage.statusCode).toBe(404);
    expect(privateImage.headers["cache-control"]).toBe("no-store, max-age=0");

    const publicProduct = await app.prisma.product.create({ data: { categoryId: category.id, name: "Corrupt image", priceAmount: 1, preparationDeadlineMinutes: 1, displayOrder: 4 } });
    const corruptKey = "00000000-0000-4000-8000-000000000003.webp";
    uploadedKeys.push(corruptKey);
    await app.prisma.productImage.create({ data: { productId: publicProduct.id, storageKey: corruptKey, altText: "Corrupt image" } });
    await writeFile(join(env.PRODUCT_IMAGE_STORAGE_DIR, corruptKey), Buffer.from("not a webp"));
    const corruptImage = await app.inject({ method: "GET", url: `/api/v1/media/products/uploads/${corruptKey}` });
    expect(corruptImage.statusCode).toBe(404);
    expect(corruptImage.headers["cache-control"]).toBe("no-store, max-age=0");
    await unlink(join(env.PRODUCT_IMAGE_STORAGE_DIR, privateKey));
    await unlink(join(env.PRODUCT_IMAGE_STORAGE_DIR, corruptKey));
  });

  it("validates image paths and returns safe not-found errors without orphan files", async () => {
    const manager = await managerCookies();
    const before = await app.prisma.productImage.count();
    const malformed = await app.inject({
      method: "PUT",
      url: "/api/v1/admin/products/not-a-uuid/image",
      cookies: manager,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("VALIDATION_ERROR");

    const missingId = "00000000-0000-4000-8000-000000000099";
    const missingUpload = await app.inject({
      method: "PUT",
      url: `/api/v1/admin/products/${missingId}/image`,
      cookies: manager,
    });
    expect(missingUpload.statusCode).toBe(404);
    expect(missingUpload.json().error.code).toBe("NOT_FOUND");
    expect(await app.prisma.productImage.count()).toBe(before);
  });
});
