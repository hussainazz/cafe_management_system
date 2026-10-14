import type { ApiFailure } from "./api-client";

const messages: Record<string, string> = {
  "An active stock item with this name already exists.": "کالای فعالی با این نام وجود دارد. نام دیگری وارد کنید.",
  "Conversion labels must be unique for a stock item.": "نام بسته‌بندی‌های یک کالا نباید تکراری باشد.",
  "An archived stock item cannot be edited.": "این کالا بایگانی شده و قابل ویرایش نیست.",
  "A stock item's base unit cannot change after it has conversions or is referenced by costing or inventory history.": "برای این کالا بسته‌بندی یا سابقه ثبت شده است؛ واحد مبنا قابل تغییر نیست.",
  "A conversion does not belong to this stock item.": "این بسته‌بندی مربوط به کالای انتخاب‌شده نیست.",
  "Every purchase line must reference an active stock item.": "برای هر ردیف خرید، یک کالای فعال انتخاب کنید.",
  "Every count line must reference a distinct active stock item.": "در شمارش، هر کالای فعال را فقط یک بار وارد کنید.",
  "A base-unit purchase must use the stock item's base-unit label.": "واحد خرید باید با واحد مبنای کالا مطابقت داشته باشد.",
  "The purchase unit label must match the selected conversion.": "واحد خرید با بسته‌بندی انتخاب‌شده مطابقت ندارد.",
  "The purchase conversion is unavailable for this stock item.": "این بسته‌بندی برای کالا فعال نیست. واحد دیگری انتخاب کنید.",
  "Only draft purchases can be edited.": "فقط پیش‌نویس خرید قابل ویرایش است.",
  "Only draft counts can be edited.": "فقط پیش‌نویس شمارش قابل ویرایش است.",
  "Only a posted purchase can be returned.": "مرجوعی فقط برای رسید ثبت‌شده امکان‌پذیر است.",
  "The purchase is already posted.": "این رسید قبلاً ثبت شده است.",
  "The inventory count is already posted.": "این شمارش قبلاً ثبت شده است.",
  "The stock item is already archived.": "این کالا قبلاً بایگانی شده است.",
  "The purchase line does not belong to this purchase.": "این ردیف مربوط به رسید انتخاب‌شده نیست.",
  "Returned quantity cannot exceed the originally received quantity.": "مقدار مرجوعی نمی‌تواند از مقدار خرید بیشتر باشد.",
  "The stock balance cannot cover this return.": "موجودی کالا برای این مرجوعی کافی نیست.",
  "An opening count must be posted before received purchases can update tracked inventory.": "ابتدا موجودی آغازین این کالا را ثبت کنید، سپس رسید خرید را ثبت کنید.",
  "An opening count has already started inventory tracking.": "موجودی آغازین قبلاً ثبت شده است. از شمارش انبار استفاده کنید.",
  "An opening count has already been posted.": "موجودی آغازین قبلاً ثبت شده است.",
  "An opening count cannot reset an already tracked item.": "موجودی این کالا قبلاً آغاز شده است. از شمارش انبار استفاده کنید.",
  "An opening count cannot reconcile previously recognized orders.": "موجودی آغازین نمی‌تواند سفارش‌های قبلی را پوشش دهد.",
  "A physical count can include only items whose opening count has been posted.": "ابتدا موجودی آغازین کالاهای انتخاب‌شده را ثبت کنید.",
  "A physical count cannot adjust an item before its opening count is posted.": "ابتدا موجودی آغازین این کالا را ثبت کنید.",
  "Every reconciled order must be an eligible pending consumption.": "یکی از سفارش‌های انتخاب‌شده دیگر در انتظار کسر موجودی نیست. فهرست را به‌روز کنید.",
  "The count must include every stock item for a pending order selected as already absorbed.": "تمام کالاهای مصرفی سفارش‌های انتخاب‌شده باید در شمارش باشند.",
  "The reconciled count does not contain a carrying value for restored stock.": "ارزش کالا در شمارش مربوط به این سفارش ثبت نشده است.",
  "Recipe references cannot contain a cycle.": "دستور تهیه نباید مستقیم یا از طریق دستور دیگری به خودش ارجاع دهد.",
  "Recipe component keys must be unique.": "اجزای دستور تهیه نباید شناسه تکراری داشته باشند.",
  "A recipe references an unavailable stock item.": "یکی از کالاهای دستور تهیه فعال نیست.",
  "A recipe references an unavailable nested recipe.": "یکی از دستورهای تهیه وابسته فعال نیست.",
  "An active recipe is required.": "یک دستور تهیه فعال انتخاب کنید.",
  "An active extras recipe is required.": "یک دستور تهیه فعال برای مواد افزوده انتخاب کنید.",
  "An active purchased stock item is required.": "یک کالای خریداری‌شده فعال انتخاب کنید.",
  "Weighted products require a recipe measured in grams.": "برای محصول وزنی، واحد دستور تهیه باید گرم باشد.",
  "Weighted products require purchased stock measured in grams.": "برای محصول وزنی، واحد مبنای کالا باید گرم باشد.",
  "Every costing option must belong to this product.": "گزینه‌های هزینه باید مربوط به همین محصول باشند.",
  "Every selected option must be active and available for this product.": "گزینه‌های انتخاب‌شده باید برای این محصول فعال و در دسترس باشند.",
  "Selected options do not satisfy the product option groups.": "تعداد گزینه‌های انتخاب‌شده با تنظیمات محصول مطابقت ندارد.",
  "Selected option IDs must be unique.": "یک گزینه را بیش از یک بار انتخاب نکنید.",
  "Combination option IDs must be unique.": "گزینه‌های یک ترکیب نباید تکراری باشند.",
  "Costing combination names must be unique.": "نام ترکیب‌های هزینه نباید تکراری باشد.",
  "Each option can have only one costing-rule group.": "برای هر گزینه فقط یک گروه قانون هزینه ثبت کنید.",
  "An option cannot define multiple rules for the same component.": "یک گزینه نمی‌تواند برای یک جزء چند قانون داشته باشد.",
  "A costing combination cannot define multiple rules for the same component.": "یک ترکیب نمی‌تواند برای یک جزء چند قانون داشته باشد.",
  "Only one costing override can use a particular option combination.": "برای این ترکیب گزینه‌ها قبلاً قانون هزینه ثبت شده است.",
  "More than one costing combination matches the selected options.": "برای گزینه‌های انتخاب‌شده چند ترکیب هزینه مطابقت دارد. قوانین را بررسی کنید.",
  "Selected options have conflicting rules for the same component.": "گزینه‌های انتخاب‌شده برای یک جزء قوانین متناقض دارند.",
  "A costing combination has conflicting rules.": "قوانین این ترکیب هزینه با هم سازگار نیستند.",
  "A costing rule references an unavailable recipe.": "دستور تهیه انتخاب‌شده در قانون هزینه فعال نیست.",
  "A costing rule references an unavailable stock item.": "کالای انتخاب‌شده در قانون هزینه فعال نیست.",
  "A costing rule references an unknown base recipe component.": "جزء انتخاب‌شده در دستور تهیه مبنا وجود ندارد.",
  "A costing rule references an unknown recipe component.": "جزء انتخاب‌شده در دستور تهیه وجود ندارد.",
  "An added component conflicts with an existing component key.": "شناسه جزء افزوده‌شده با یکی از اجزای موجود تکراری است.",
  "The product already has a costing configuration; update it with a version check.": "تنظیم هزینه این محصول قبلاً ثبت شده است. اطلاعات را به‌روز کنید.",
  "The report end date cannot be in the future.": "تاریخ پایان گزارش نباید بعد از امروز باشد.",
  "The cursor is invalid.": "فهرست را دوباره بارگذاری کنید.",
  "The converted purchase quantity must fit the supported range and be exact to six decimal places.": "مقدار خرید پس از تبدیل بسته‌بندی باید در محدوده مجاز و دقیق تا شش رقم اعشار باشد.",
  "This receipt would exceed the supported inventory quantity or value.": "ثبت این رسید، مقدار یا ارزش موجودی را از محدوده مجاز خارج می‌کند.",
  "A quantity or amount exceeds the supported range.": "یکی از مقدارها یا مبلغ‌ها از محدوده مجاز بیشتر است.",
  "The inventory service needs a database update. Contact the system administrator.": "سرویس موجودی به به‌روزرسانی نیاز دارد. با مسئول سیستم تماس بگیرید.",
};

const codes: Record<string, string> = {
  VALIDATION_ERROR: "اطلاعات واردشده را بررسی کنید.", BAD_REQUEST: "درخواست معتبر نیست. اطلاعات را بررسی کنید.",
  STALE_VERSION: "این اطلاعات تغییر کرده است. آن را به‌روز کنید و دوباره بررسی کنید.",
  CONFLICT: "درخواست با اطلاعات فعلی تداخل دارد. اطلاعات را به‌روز کنید و بررسی کنید.",
  INVALID_STATE: "این کار در وضعیت فعلی امکان‌پذیر نیست. اطلاعات را به‌روز کنید.",
  NOT_FOUND: "مورد انتخاب‌شده پیدا نشد. فهرست را به‌روز کنید.",
  BUSINESS_RULE_VIOLATION: "این عملیات با اطلاعات فعلی موجودی امکان‌پذیر نیست. مقدارها و موارد انتخاب‌شده را بررسی کنید.",
  IDEMPOTENCY_CONFLICT: "این درخواست قبلاً با اطلاعات دیگری ارسال شده است. وضعیت ثبت را بررسی کنید.",
  IDEMPOTENCY_IN_PROGRESS: "این درخواست هنوز در حال پردازش است. وضعیت ثبت را بررسی کنید.",
  FORBIDDEN: "برای این کار دسترسی مدیر لازم است.", AUTHENTICATION_REQUIRED: "دوباره وارد حساب شوید.", SESSION_EXPIRED: "نشست شما پایان یافته است. دوباره وارد شوید.",
  RATE_LIMITED: "تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.",
  INTERNAL_ERROR: "انجام عملیات با خطا روبه‌رو شد. پیش از ارسال دوباره، وضعیت ثبت را بررسی کنید.",
  SERVICE_UNAVAILABLE: "سرویس موجودی در دسترس نیست. پیش از ارسال دوباره، وضعیت ثبت را بررسی کنید.",
};
const fields: Record<string, string> = {
  name: "نام", category: "دسته‌بندی", baseUnit: "واحد مبنا", label: "نام بسته‌بندی", baseQuantityPerPack: "مقدار هر بسته",
  purchaseQuantity: "مقدار خرید", directCostAmount: "هزینه مستقیم", stockItemId: "کالا", conversionId: "بسته‌بندی", purchaseUnitLabel: "واحد خرید",
  receivedAt: "زمان دریافت", supplier: "تأمین‌کننده", baseQuantity: "مقدار مرجوعی", reason: "دلیل", observedQuantity: "مقدار شمارش", observedValueAmount: "ارزش شمارش",
  quantity: "مقدار", yieldQuantity: "مقدار خروجی", expectedVersion: "نسخه اطلاعات", recipeId: "دستور تهیه", purchasedQuantity: "مقدار کالای خریداری‌شده",
  componentKey: "جزء دستور تهیه", ingredientName: "شناسه‌ی ماده", fromDate: "تاریخ شروع", toDate: "تاریخ پایان", lines: "ردیف‌ها", components: "اجزای دستور تهیه",
};

export function inventoryErrorMessage(error: ApiFailure): string {
  let message = messages[error.message] ?? codes[error.code ?? ""] ?? error.message;
  if (error.kind === "network") message = "ارتباط با سرویس قطع شد. پیش از ارسال دوباره، وضعیت ثبت را بررسی کنید.";
  const details = error.details?.slice(0, 5).map((detail) => {
    const parts = detail.path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
    const label = fields[parts.at(-1) ?? ""] ?? "اطلاعات";
    const row = parts.findIndex((part) => part === "lines" || part === "components" || part === "conversions");
    const index = row >= 0 && /^\d+$/.test(parts[row + 1] ?? "") ? ` (ردیف ${(Number(parts[row + 1]) + 1).toLocaleString("fa-IR")})` : "";
    const reason = detail.code === "quantity_precision" ? "تبدیل مقدار باید دقیق تا شش رقم اعشار باشد." :
      detail.code === "too_big" || detail.code === "maximum" ? "بیشتر از حد مجاز است." :
      detail.code === "too_small" || detail.code === "minimum" ? "کمتر از حد مجاز است یا وارد نشده است." : "این مقدار را بررسی کنید.";
    return `${label}${index}: ${reason}`;
  });
  if (details?.length) message += ` ${[...new Set(details)].join(" ")}`;
  if (error.requestId) message += ` کد پیگیری: ${error.requestId}`;
  return message;
}
