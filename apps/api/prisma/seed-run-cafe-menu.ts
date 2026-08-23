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
آبمیوه طبیعی|آب پرتقال:235,هندونه:235,طالبی:235
اسموتی|ولوت بری:355,منگوبری:355,هاوایی:355,توت فرنگی:305,ملونی:355,سیب دارچین:305,رد دریم:355
ماکتل|لیموناد:305,موهیتو:305,چری بری:355,رد موهیتو:355,بلومون:355,رد مون:355,سردنوش تابستونی:305
شیک|شوکو بری:355,وانیل:305,شکلات:305,موز شکلات:355,موز وانیل:355,بادام زمینی:355,بادوم زمینی موز:375,بیسکوئیت:355,Oreo:355,کیت کت:355,نوتلا:425,نوتلا توت فرنگی:455,موز نوتلا:455,مانگونا:355,توت فرنگی:355,پروتئین:355,قهوه:375,اسپرسو گردویی:375,نسکافه:375,فراپاچینو:355
دسر|تیرامیسو:320,مینی تیرامیسو:135,کروسان شکلاتی:210,چیز کیک لوتوس:245,کوکی کره ای:20,کروسان نوتلا توت فرنگی:230,کروسان ویژه:280,سیمیت پنیر گردو:160,اِشتِرودِل پنیر گردو:155,باقلوا:60,چیزکیک انبه:320,کیک شکلاتی:320
تست بار|تست ژامبون:275,کره بادوم زمینی:185,شکلات:185,پنیر گردو:175
پنینی|بیکن گوشت گرم:435,ژامبون گوشت گرم:395,بیکن گوشت سرد:395,ژامبون گوشت:355,پپرونی گرم:435
چیپس|چیز چیپس:290,چیپس بیکن:345,بیگ چیپس:405,هات چیپس:375
افزودنی|اب معدنی:30,نوشابه:100,سودا لیمویی:100,Vitamin C:85,هایپ:180,سیروپ:45,شات شیر:35,عسل:45,اسکپ بستنی:85,دلستر لیوانی:90,ابجو بدون الکل با دورچین:190
`.trim();

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

  const synchronizedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const categoryIds: string[] = [];
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
      createdCategories,
      createdProducts,
      archivedCategories,
      archivedProducts,
    };
  });

  console.log("Run Cafe catalog synchronized", result);
}

main().finally(() => prisma.$disconnect());
