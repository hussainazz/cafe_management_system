import type { PrismaClient } from "../../../generated/prisma/client.js";

export async function readPosCatalog(prisma: PrismaClient) {
  const categories = await prisma.category.findMany({
    where: { isActive: true, archivedAt: null },
    orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    include: {
      products: {
        where: { isActive: true, archivedAt: null },
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        include: {
          image: { select: { storageKey: true, altText: true } },
          productOptionGroups: {
            orderBy: { displayOrder: "asc" },
            include: {
              optionGroup: {
                select: {
                  id: true,
                  name: true,
                  isActive: true,
                  archivedAt: true,
                },
              },
              allowedOptions: {
                orderBy: { displayOrder: "asc" },
                include: { option: { select: { id: true, name: true, priceAmount: true, isAvailable: true, isActive: true, archivedAt: true } } },
              },
            },
          },
        },
      },
    },
  });

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      products: category.products.map((product) => ({
        id: product.id,
        name: product.name,
        priceAmount: product.priceAmount,
        preparationDeadlineMinutes: product.preparationDeadlineMinutes,
        isAvailable: product.isAvailable,
        image: product.image,
        optionGroups: product.productOptionGroups
          .filter(({ optionGroup }) => optionGroup.isActive && optionGroup.archivedAt === null)
          .map(({ optionGroup, minSelections, maxSelections, allowedOptions }) => ({
            id: optionGroup.id,
            name: optionGroup.name,
            minSelections,
            maxSelections,
            options: allowedOptions.filter(({ option }) => option.isActive && option.isAvailable && !option.archivedAt).map(({ option, priceAmountOverride }) => ({ ...option, priceAmount: priceAmountOverride ?? option.priceAmount })),
          })),
      })),
    })),
  };
}
