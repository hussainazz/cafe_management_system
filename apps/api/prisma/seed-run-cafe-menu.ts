import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

// Authoritative Run Cafe catalog supplied on 23 August 2026.
// Prices are stored in Toman, so the catalog's "thousand Toman" values are multiplied by 1,000.
const menu = `
ویژه و جدید|ولوت بری:355,هندونه:235,تیرامیسو:320,هات چیپس:375,پپرونی گرم:435,رد مون:355,کیک شکلاتی:320
بار گرم قهوه|اسپرسو سینگل:165,اسپرسو دبل:185,آمریکانو سینگل:175,آمریکانو دبل:195,اسپرسو ماکیاتو:195,کورتادو:225,کاپوچینو:245,لاته:245,کارامل ماکیاتو:285,موکا:285,ترک:185,نسکافه:255,وایت اسپرسو:295,یونانی:255
بار سرد قهوه|آیس اسپرسو سینگل:165,آیس اسپرسو دبل:185,آیس آمریکانو سینگل:175,آیس آمریکانو دبل:195,آیس لاته:245,آیس کارامل ماکیاتو:285,آیس موکا:285,آفوگاتو:255,آیس اورنج:285,تونیک اسپرسو:285,کوک اسپرسو:285,دالگونیا:255,آیس چاکلت فندق:295,شیر کاکائو سرد:215
قهوه دمی|V 60:345,Aeropress:345,Siphone:345,فرانسه:345
نوشیدنی گرم|هات چاکلت:295,وایت چاکلت:295,پینک چاکلت:295,چای ماسالا:295,چای کرک:295,شیرکاکائو:215,شیر بیسکوییت:295,شیر نوتلا:345,شیر داغ:165,شیر عسل:195
چای و دمنوش|ایس تی هلو:235,آیس تی سیب:235,آیس تی ترش:235,آیس تی لیمو نعنا:235,چای هل و زغفران:160,چای ترش:190,چای سبز:190,چای کوهی:190,چای آویشن:190,دمنوش درمانی:225,گل گاو زبان:190,دمنوش آرامش بخش:225,دمنوش به لیمو:190,دمنوش بابونه:190,دمنوش بهارنارنج:190,دمنوش اسطو خودوس:190
ماچا بار|ماچا لته:255,آیس ماچا لته:255,آیس منگو ماچا:305,آیس بری ماچا:315,ماچا گاتو:295
آبمیوه طبیعی|آب پرتقال:235,هندوانه:235,طالبی:235
اسموتی|ولوت بری:355,منگوبری:355,هاوایی:355,توت فرنگی:305,ملونی:355,سیب دارچین:305,رد دریم:355
ماکتل|لیموناد:305,موهیتو:305,چری بری:355,رد موهیتو:355,بلومون:355,رد مون:355,سردنوش تابستونی:305
شیک|شوکو بری:355,وانیل:305,شکلات:305,موز شکلات:355,موز وانیل:355,بادام زمینی:355,بادوم زمینی موز:375,بیسکوئیت:355,Oreo:355,کیت کت:355,نوتلا:425,نوتلا توت فرنگی:455,موز نوتلا:455,مانگونا:355,توت فرنگی:355,پروتئین:355,قهوه:375,اسپرسو گردویی:375,نسکافه:375,فراپاچینو:355
دسر|تیرامیسو:320,مینی تیرامیسو:135,کروسان شکلاتی:210,چیز کیک لوتوس:245,کوکی کره ای:20,کروسان نوتلا توت فرنگی:230,کروسان ویژه:280,سیمیت پنیر گردو:160,اِشتِرودِل پنیر گردو:155,باقلوا:60,چیزکیک انبه:320,کیک شکلاتی:320
تست بار|تست ژامبون:275,کره بادوم زمینی:185,شکلات:185,پنیر گردو:175
پنینی|بیکن گوشت گرم:435,ژامبون گوشت گرم:395,بیکن گوشت سرد:395,ژامبون گوشت:355,پپرونی گرم:435
چیپس|چیز چیپس:290,چیپس بیکن:345,بیگ چیپس:405,هات چیپس:375
افزودنی|اب معدنی:30,نوشابه:100,سودا لیمویی:100,Vitamin C:85,هایپ:180,سیروپ:45,شات شیر:35,عسل:45,اسکپ بستنی:85,دلستر لیوانی:90,ابجو بدون الکل با دورچین:190
`.trim();

type OptionConfiguration = {
  name: string;
  totalPriceAmount: number;
};

type ProductConfiguration = {
  categoryName: string;
  productName: string;
  basePriceAmount: number;
  isAvailable: boolean;
  optionGroup: { name: string; options: OptionConfiguration[] } | null;
};

function configureProduct(
  categoryName: string,
  productName: string,
  basePrice: number,
  optionGroup: { name: string; options: Array<[name: string, totalPrice: number]> } | null = null,
  isAvailable = true,
): ProductConfiguration {
  return {
    categoryName,
    productName,
    basePriceAmount: basePrice * 1_000,
    isAvailable,
    optionGroup: optionGroup
      ? {
        name: optionGroup.name,
        options: optionGroup.options.map(([name, totalPrice]) => ({
          name,
          totalPriceAmount: totalPrice * 1_000,
        })),
      }
      : null,
  };
}

function coffeeBlend(
  categoryName: string,
  productName: string,
  robustaPrice: number,
  blendPrice: number,
  arabicaPrice: number,
) {
  return configureProduct(categoryName, productName, robustaPrice, {
    name: "لاین قهوه",
    options: [
      ["۸۰/۲۰ روبوستا", robustaPrice],
      ["۵۰/۵۰", blendPrice],
      ["۱۰۰٪ عربیکا", arabicaPrice],
    ],
  });
}

const productConfigurations: ProductConfiguration[] = [
  coffeeBlend("بار گرم قهوه", "اسپرسو سینگل", 165, 185, 225),
  coffeeBlend("بار گرم قهوه", "اسپرسو دبل", 185, 205, 245),
  coffeeBlend("بار گرم قهوه", "آمریکانو سینگل", 175, 195, 235),
  coffeeBlend("بار گرم قهوه", "آمریکانو دبل", 195, 215, 255),
  coffeeBlend("بار گرم قهوه", "اسپرسو ماکیاتو", 195, 215, 255),
  coffeeBlend("بار گرم قهوه", "کورتادو", 225, 235, 265),
  coffeeBlend("بار گرم قهوه", "کاپوچینو", 245, 255, 295),
  coffeeBlend("بار گرم قهوه", "لاته", 245, 255, 295),
  coffeeBlend("بار گرم قهوه", "کارامل ماکیاتو", 285, 295, 335),
  coffeeBlend("بار گرم قهوه", "موکا", 285, 295, 335),
  configureProduct("بار گرم قهوه", "ترک", 185),
  configureProduct("بار گرم قهوه", "نسکافه", 255),
  configureProduct("بار گرم قهوه", "وایت اسپرسو", 295),
  configureProduct("بار گرم قهوه", "یونانی", 255),

  coffeeBlend("بار سرد قهوه", "آیس اسپرسو سینگل", 165, 185, 225),
  coffeeBlend("بار سرد قهوه", "آیس اسپرسو دبل", 185, 205, 245),
  coffeeBlend("بار سرد قهوه", "آیس آمریکانو سینگل", 175, 195, 235),
  coffeeBlend("بار سرد قهوه", "آیس آمریکانو دبل", 195, 215, 255),
  coffeeBlend("بار سرد قهوه", "آیس لاته", 245, 255, 295),
  coffeeBlend("بار سرد قهوه", "آیس کارامل ماکیاتو", 285, 295, 335),
  coffeeBlend("بار سرد قهوه", "آیس موکا", 285, 295, 335),
  configureProduct("بار سرد قهوه", "آفوگاتو", 255, {
    name: "مقدار قهوه",
    options: [["سینگل", 255], ["دبل", 275]],
  }),
  configureProduct("بار سرد قهوه", "آیس اورنج", 285, {
    name: "مقدار قهوه",
    options: [["سینگل", 285], ["دبل", 295]],
  }),
  configureProduct("بار سرد قهوه", "تونیک اسپرسو", 285, {
    name: "مقدار قهوه",
    options: [["سینگل", 285], ["دبل", 295]],
  }),
  configureProduct("بار سرد قهوه", "کوک اسپرسو", 285, {
    name: "مقدار قهوه",
    options: [["سینگل", 285], ["دبل", 295]],
  }),
  configureProduct("بار سرد قهوه", "دالگونیا", 255),
  configureProduct("بار سرد قهوه", "آیس چاکلت فندق", 295),
  configureProduct("بار سرد قهوه", "شیر کاکائو سرد", 215),

  ...["V 60", "Aeropress", "Siphone", "فرانسه"].map((productName) => configureProduct("قهوه دمی", productName, 345, {
    name: "دو کاپ",
    options: [["۱ کاپ", 345], ["۲ کاپ", 405]],
  })),

  configureProduct("نوشیدنی گرم", "هات چاکلت", 295),
  configureProduct("نوشیدنی گرم", "وایت چاکلت", 295),
  configureProduct("نوشیدنی گرم", "پینک چاکلت", 295),

  ...["ماچا لته", "آیس ماچا لته"].map((productName) => configureProduct("ماچا بار", productName, 255, {
    name: "سیروپ",
    options: [["ساده", 255], ["عسل", 295], ["وانیل", 295], ["نارگیل", 295], ["سیروپ انتخابی", 295]],
  })),

  configureProduct("شیک", "قهوه", 375, {
    name: "طعم",
    options: [["قهوه شکلات", 375], ["قهوه وانیل", 375]],
  }),
  configureProduct("شیک", "اسپرسو گردویی", 375),
  configureProduct("شیک", "نسکافه", 375),
  configureProduct("شیک", "فراپاچینو", 355, {
    name: "سیروپ",
    options: [["کارامل", 355], ["شکلات", 355], ["وانیل", 355]],
  }),

  configureProduct("دسر", "کوکی کره ای", 20, {
    name: "طعم",
    options: [["شکلات", 20], ["زعفران", 20]],
  }),
  configureProduct("دسر", "کروسان نوتلا توت فرنگی", 230),
  configureProduct("دسر", "کروسان ویژه", 280),
  configureProduct("دسر", "سیمیت پنیر گردو", 160),
  configureProduct("دسر", "تیرامیسو", 320),
  configureProduct("دسر", "مینی تیرامیسو", 135, null, false),

  configureProduct("تست بار", "کره بادوم زمینی", 185, {
    name: "طعم",
    options: [["ساده", 185], ["کره بادوم زمینی و موز", 215]],
  }),
  configureProduct("تست بار", "شکلات", 185, {
    name: "طعم",
    options: [["ساده", 185], ["شکلات و موز", 215]],
  }),
  configureProduct("تست بار", "پنیر گردو", 175),

  configureProduct("افزودنی", "اسکپ بستنی", 85, {
    name: "طعم",
    options: [["وانیل", 85], ["شکلات", 85]],
  }),
  configureProduct("افزودنی", "دلستر لیوانی", 90),
  configureProduct("افزودنی", "ابجو بدون الکل با دورچین", 190),
  configureProduct("افزودنی", "سیروپ", 45, {
    name: "طعم",
    options: [["کارامل", 45], ["فندق", 45], ["وانیل", 45], ["نارگیل", 45], ["دارچین", 45], ["شکلات", 45], ["آیریش", 45], ["رز", 45], ["اسطوخودوس", 45]],
  }),
  configureProduct("افزودنی", "شات شیر", 35),
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main() {
  const catalog = menu.split("\n").map((line) => {
    const categorySeparator = line.indexOf("|");
    if (categorySeparator < 1) throw new Error(`Invalid category row: ${line}`);

    const name = line.slice(0, categorySeparator);
    const products = line.slice(categorySeparator + 1).split(",").map((rawProduct) => {
      const separator = rawProduct.lastIndexOf(":");
      if (separator < 1) throw new Error(`Invalid product row: ${rawProduct}`);

      const productName = rawProduct.slice(0, separator);
      const priceAmount = Number(rawProduct.slice(separator + 1)) * 1_000;
      if (!Number.isFinite(priceAmount)) throw new Error(`Invalid product price: ${rawProduct}`);
      return { name: productName, priceAmount };
    });

    if (new Set(products.map((product) => product.name)).size !== products.length) {
      throw new Error(`Duplicate product in category: ${name}`);
    }
    return { name, products };
  });

  if (new Set(catalog.map((category) => category.name)).size !== catalog.length) {
    throw new Error("Duplicate category in menu catalog");
  }
  const configuredProductKeys = productConfigurations.map(
    ({ categoryName, productName }) => `${categoryName}|${productName}`,
  );
  if (new Set(configuredProductKeys).size !== configuredProductKeys.length) {
    throw new Error("Duplicate product option/price configuration");
  }

  const synchronizedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const categoryIds: string[] = [];
    const productIdsByCatalogKey = new Map<string, string>();
    let createdCategories = 0;
    let createdProducts = 0;
    let archivedCategories = 0;
    let archivedProducts = 0;

    for (const [categoryOrder, desiredCategory] of catalog.entries()) {
      const matchingCategories = await tx.category.findMany({
        where: { name: desiredCategory.name, archivedAt: null },
        orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
      });
      const category = matchingCategories[0]
        ?? await tx.category.create({
          data: { name: desiredCategory.name, displayOrder: categoryOrder + 1 },
        });
      if (matchingCategories.length === 0) createdCategories += 1;

      await tx.category.update({
        where: { id: category.id },
        data: { displayOrder: categoryOrder + 1, isActive: true, archivedAt: null },
      });
      categoryIds.push(category.id);

      const desiredProductIds: string[] = [];
      for (const [productOrder, desiredProduct] of desiredCategory.products.entries()) {
        const matchingProducts = await tx.product.findMany({
          where: { categoryId: category.id, name: desiredProduct.name, archivedAt: null },
          orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        });
        const product = matchingProducts[0]
          ?? await tx.product.create({
            data: {
              categoryId: category.id,
              name: desiredProduct.name,
              priceAmount: desiredProduct.priceAmount,
              preparationDeadlineMinutes: 10,
              displayOrder: productOrder + 1,
            },
          });
        if (matchingProducts.length === 0) createdProducts += 1;

        await tx.product.update({
          where: { id: product.id },
          data: { displayOrder: productOrder + 1, isActive: true, archivedAt: null },
        });
        desiredProductIds.push(product.id);
        productIdsByCatalogKey.set(`${desiredCategory.name}|${desiredProduct.name}`, product.id);

        const duplicateProductIds = matchingProducts.slice(1).map(({ id }) => id);
        if (duplicateProductIds.length > 0) {
          const archived = await tx.product.updateMany({
            where: { id: { in: duplicateProductIds } },
            data: { isActive: false, archivedAt: synchronizedAt },
          });
          archivedProducts += archived.count;
        }
      }

      const archived = await tx.product.updateMany({
        where: {
          categoryId: category.id,
          archivedAt: null,
          id: { notIn: desiredProductIds },
        },
        data: { isActive: false, archivedAt: synchronizedAt },
      });
      archivedProducts += archived.count;

      const duplicateCategoryIds = matchingCategories.slice(1).map(({ id }) => id);
      if (duplicateCategoryIds.length > 0) {
        const archived = await tx.product.updateMany({
          where: { categoryId: { in: duplicateCategoryIds }, archivedAt: null },
          data: { isActive: false, archivedAt: synchronizedAt },
        });
        archivedProducts += archived.count;
        await tx.category.updateMany({
          where: { id: { in: duplicateCategoryIds } },
          data: { isActive: false, archivedAt: synchronizedAt },
        });
        archivedCategories += duplicateCategoryIds.length;
      }
    }

    for (const configuration of productConfigurations) {
      const productKey = `${configuration.categoryName}|${configuration.productName}`;
      const productId = productIdsByCatalogKey.get(productKey);
      if (!productId) throw new Error(`Configured product is missing from catalog: ${productKey}`);

      await tx.product.update({
        where: { id: productId },
        data: {
          priceAmount: configuration.basePriceAmount,
          saleDiscountKind: null,
          saleDiscountValue: null,
          isAvailable: configuration.isAvailable,
        },
      });

      const linkedGroups = configuration.optionGroup
        ? await tx.productOptionGroup.findMany({
          where: { productId, optionGroup: { name: configuration.optionGroup.name } },
          orderBy: { displayOrder: "asc" },
          include: {
            optionGroup: {
              include: { _count: { select: { productOptionGroups: true } } },
            },
          },
        })
        : [];
      const reusableGroup = linkedGroups.find(
        ({ optionGroup }) => optionGroup._count.productOptionGroups === 1,
      )?.optionGroup;

      await tx.productOptionGroup.deleteMany({ where: { productId } });
      if (!configuration.optionGroup) continue;

      const optionGroup = reusableGroup
        ?? await tx.optionGroup.create({ data: { name: configuration.optionGroup.name } });
      await tx.optionGroup.update({
        where: { id: optionGroup.id },
        data: { name: configuration.optionGroup.name, isActive: true },
      });

      const desiredOptionIds: string[] = [];
      for (const [optionOrder, desiredOption] of configuration.optionGroup.options.entries()) {
        const optionPriceAmount = desiredOption.totalPriceAmount - configuration.basePriceAmount;
        if (optionPriceAmount < 0) {
          throw new Error(`Option total is below base price: ${productKey}|${desiredOption.name}`);
        }

        const matchingOptions = await tx.option.findMany({
          where: {
            optionGroupId: optionGroup.id,
            name: desiredOption.name,
            archivedAt: null,
          },
          orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        });
        const option = matchingOptions[0]
          ?? await tx.option.create({
            data: {
              optionGroupId: optionGroup.id,
              name: desiredOption.name,
              priceAmount: optionPriceAmount,
              displayOrder: optionOrder + 1,
            },
          });
        await tx.option.update({
          where: { id: option.id },
          data: {
            priceAmount: optionPriceAmount,
            displayOrder: optionOrder + 1,
            isActive: true,
            isAvailable: true,
          },
        });
        desiredOptionIds.push(option.id);

        const duplicateOptionIds = matchingOptions.slice(1).map(({ id }) => id);
        if (duplicateOptionIds.length > 0) {
          await tx.option.updateMany({
            where: { id: { in: duplicateOptionIds } },
            data: { isActive: false, isAvailable: false, archivedAt: synchronizedAt },
          });
        }
      }

      await tx.option.updateMany({
        where: {
          optionGroupId: optionGroup.id,
          archivedAt: null,
          id: { notIn: desiredOptionIds },
        },
        data: { isActive: false, isAvailable: false, archivedAt: synchronizedAt },
      });
      await tx.productOptionGroup.create({
        data: { productId, optionGroupId: optionGroup.id, displayOrder: 1 },
      });
    }

    const categoriesToArchive = await tx.category.findMany({
      where: { archivedAt: null, id: { notIn: categoryIds } },
      select: { id: true },
    });
    const categoryIdsToArchive = categoriesToArchive.map(({ id }) => id);
    if (categoryIdsToArchive.length > 0) {
      const archived = await tx.product.updateMany({
        where: { categoryId: { in: categoryIdsToArchive }, archivedAt: null },
        data: { isActive: false, archivedAt: synchronizedAt },
      });
      archivedProducts += archived.count;
      await tx.category.updateMany({
        where: { id: { in: categoryIdsToArchive } },
        data: { isActive: false, archivedAt: synchronizedAt },
      });
      archivedCategories += categoryIdsToArchive.length;
    }

    return {
      categories: catalog.length,
      products: catalog.reduce((count, category) => count + category.products.length, 0),
      configuredProducts: productConfigurations.length,
      createdCategories,
      createdProducts,
      archivedCategories,
      archivedProducts,
    };
  });

  console.log("Run Cafe catalog synchronized", result);
}

main().finally(() => prisma.$disconnect());
