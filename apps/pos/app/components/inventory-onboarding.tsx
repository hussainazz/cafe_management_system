"use client";

import { InventoryIcon } from "./icons";

export type InventoryManagementView = "purchases" | "stock" | "recipes" | "preparations" | "counts" | "history";

const guides: Record<InventoryManagementView, { title: string; purpose: string; steps: string[]; next: InventoryManagementView; action: string }> = {
  purchases: {
    title: "راهنمای ثبت خرید",
    purpose: "خرید را پیش‌نویس کنید؛ پس از بررسی، رسید را در موجودی ثبت کنید.",
    steps: [
      "کالا باید در «اقلام موجودی» تعریف شده باشد. واحد خرید را مطابق فاکتور انتخاب کنید؛ مثلاً کیلوگرم به‌جای گرم.",
      "مقدار خرید و هزینه‌ی کل هر ردیف را وارد کنید و پیش‌نویس را بسازید. پیش‌نویس موجودی را تغییر نمی‌دهد.",
      "در فهرست خریدها، «اقلام خرید» را باز کنید. پس از بررسی مقدار و هزینه، «ثبت رسید در موجودی» را بزنید.",
    ], next: "stock", action: "رفتن به اقلام موجودی",
  },
  stock: {
    title: "راهنمای تعریف کالای انبار",
    purpose: "مواد اولیه و بسته‌بندی را با واحد مبنا و موجودی آغازین تعریف کنید.",
    steps: [
      "واحد مبنا را بر اساس مصرف انتخاب کنید؛ مثلاً گرم برای قهوه یا میلی‌لیتر برای شیر. مقدار آغازین را با همین واحد بنویسید.",
      "ارزش آغازین، هزینه‌ی کل موجودی است. برای خرید بسته‌ای، تبدیل واحد بسازید؛ مثلاً هر کیلوگرم برابر با ۱۰۰۰ گرم.",
      "پس از ثبت کالا، خریدهای بعدی را در «خریدها» وارد کنید. برای مشاهده‌ی جزئیات و سابقه، نام کالا را در جدول بزنید.",
    ], next: "purchases", action: "رفتن به خریدها",
  },
  recipes: {
    title: "راهنمای اتصال مواد به محصول",
    purpose: "مواد هر محصول را مشخص کنید تا هزینه‌ی دستور ذخیره‌شده قابل محاسبه باشد.",
    steps: [
      "محصول منو را انتخاب کنید. مواد اصلی یا مواد هر گزینه را از اقلام موجودی یا دستورهای مشترک اضافه کنید.",
      "مقدار مصرف را با واحد کنار هر ماده وارد کنید. اگر مواد بیرون‌بر متفاوت است، دستور جداگانه را فعال کنید؛ بسته‌بندی بخش مستقل دارد.",
      "دستورها را ذخیره کنید، سپس هزینه‌ی دستور ذخیره‌شده را محاسبه کنید. اگر هزینه کامل نیست، علت‌های نمایش‌داده‌شده را بررسی کنید.",
    ], next: "preparations", action: "رفتن به دستورهای مشترک",
  },
  preparations: {
    title: "راهنمای ساخت دستور مشترک",
    purpose: "ترکیبی را که در چند محصول مصرف می‌شود، یک بار تعریف کنید.",
    steps: [
      "نام، واحد و مقدار خروجی را مشخص کنید؛ مثلاً یک نوبت تهیه‌ی سس با خروجی ۱۰۰۰ گرم.",
      "مواد لازم برای کل این خروجی را وارد کنید. هر جزء می‌تواند کالای انبار یا دستور مشترک دیگری باشد.",
      "دستور را ذخیره کنید و در «دستور تهیه و هزینه» به محصول وصل کنید. ذخیره‌ی دستور به‌تنهایی موجودی را تغییر نمی‌دهد.",
    ], next: "recipes", action: "رفتن به دستور تهیه و هزینه",
  },
  counts: {
    title: "راهنمای شمارش فیزیکی",
    purpose: "مقدار واقعی را ثبت کنید؛ ثبت نهایی شمارش، مقدار و ارزش موجودی را جایگزین می‌کند.",
    steps: [
      "فقط کالاهایی را انتخاب کنید که واقعاً شمرده‌اید. کالایی که موجودی آغازین ندارد، ابتدا باید در «اقلام موجودی» مقداردهی شود.",
      "مقدار مشاهده‌شده و ارزش کل همان موجودی را وارد کنید. اعداد اولیه، موجودی ثبت‌شده‌اند؛ آن‌ها را با شمارش واقعی بررسی کنید.",
      "پیش‌نویس بسازید و اختلاف را بررسی کنید. پیش از ثبت نهایی، فقط سفارش‌های در انتظار کسر را انتخاب کنید که مصرفشان در شمارش لحاظ شده است.",
    ], next: "history", action: "بررسی سفارش‌های در انتظار کسر",
  },
  history: {
    title: "راهنمای پیگیری تغییر موجودی",
    purpose: "منشأ تغییر مقدار و ارزش هر کالا را در سابقه‌ی گردش پیدا کنید.",
    steps: [
      "جست‌وجو را بر اساس نام کالا، شماره‌ی سفارش یا نوع تغییر انتخاب کنید و فیلترها را اعمال کنید.",
      "مقدار و تغییر ارزش را کنار نوع تغییر بخوانید. عدد منفی یعنی کاهش موجودی؛ پیش‌نویس خرید یا شمارش، گردش ایجاد نمی‌کند.",
      "سفارش‌های در انتظار کسر، پایین همین صفحه‌اند. هزینه‌ی ناقص را در دستور تهیه و کسری مواد را در خریدها بررسی کنید.",
    ], next: "recipes", action: "بررسی دستور تهیه و هزینه",
  },
};

export function InventoryOnboarding({ view, onNavigate }: { view: InventoryManagementView; onNavigate: (view: InventoryManagementView) => void }) {
  const guide = guides[view];
  return <details className="inventory-onboarding">
    <summary><InventoryIcon /><span><strong>{guide.title}</strong><span>{guide.purpose}</span></span></summary>
    <div className="inventory-onboarding-body">
      <ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <button type="button" className="secondary-button" onClick={() => onNavigate(guide.next)}>{guide.action}</button>
    </div>
  </details>;
}

export function InventoryEmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="inventory-onboarding-empty">
    <InventoryIcon />
    <div><strong>{title}</strong><p>{detail}</p>{action && onAction && <button type="button" className="secondary-button" onClick={onAction}>{action}</button>}</div>
  </div>;
}
