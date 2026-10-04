UPDATE "product_images" AS image
SET "altText" = product."name"
FROM "products" AS product
WHERE product."id" = image."productId";
