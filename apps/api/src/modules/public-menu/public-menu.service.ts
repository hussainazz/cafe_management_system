import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { PublicMenuQuery } from "@cafe/contracts";

const publicCatalogInclude = {
  image: { select: { storageKey: true, altText: true } },
  productOptionGroups: {
    orderBy: { displayOrder: "asc" },
    include: {
      optionGroup: {
        select: {
          id: true,
          name: true,
          isActive: true,
          options: {
            where: { isActive: true, archivedAt: null },
            orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
            select: { id: true, name: true, priceAmount: true, isAvailable: true },
          },
        },
      },
    },
  },
} as const satisfies Prisma.ProductInclude;

type PublicCatalogProduct = Prisma.ProductGetPayload<{ include: typeof publicCatalogInclude }>;

function finalPriceAmount(product: { priceAmount: number; saleDiscountKind: "FIXED" | "PERCENTAGE" | null; saleDiscountValue: number | null }) {
  if (!product.saleDiscountKind || !product.saleDiscountValue) return product.priceAmount;
  const discount = product.saleDiscountKind === "FIXED"
    ? product.saleDiscountValue
    : Math.floor((product.priceAmount * product.saleDiscountValue) / 100);
  return Math.max(0, product.priceAmount - discount);
}

function toPublicProduct(product: PublicCatalogProduct) {
  return {
    id: product.id,
    name: product.name,
    priceAmount: finalPriceAmount(product),
    preparationDeadlineMinutes: product.preparationDeadlineMinutes,
    isAvailable: product.isAvailable,
    image: product.image,
    optionGroups: product.productOptionGroups
      .filter(({ optionGroup }) => optionGroup.isActive)
      .map(({ optionGroup }) => ({ id: optionGroup.id, name: optionGroup.name, options: optionGroup.options })),
  };
}

export async function readPublicMenu(prisma: PrismaClient, query: PublicMenuQuery) {
  const q = query.q?.toLocaleLowerCase("fa-IR");
  const categories = await prisma.category.findMany({
    where: { ...(query.categoryId ? { id: query.categoryId } : {}), isActive: true, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: {
      products: {
        where: { isActive: true, archivedAt: null },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        include: publicCatalogInclude,
      },
    },
  });

  return {
    categories: categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        products: category.products
          .filter((product) => !q || category.name.toLocaleLowerCase("fa-IR").includes(q) || product.name.toLocaleLowerCase("fa-IR").includes(q))
          .map(toPublicProduct),
      }))
      .filter((category) => category.products.length > 0),
  };
}

export async function readPublicProduct(prisma: PrismaClient, productId: string) {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true, archivedAt: null, category: { isActive: true, archivedAt: null } },
    include: publicCatalogInclude,
  });
  return product ? toPublicProduct(product) : null;
}
