export function tehranPersianDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    calendar: "persian",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function persianDateToGregorianDate(year: string, value: string): string | null {
  const normalizedYear = normalizeDigits(year);
  const normalizedValue = normalizeDigits(value).replace(/[\u066c,]/g, "");
  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(normalizedValue);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran",
    calendar: "persian",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (!/^\d{4}$/.test(normalizedYear)) return null;
  const first = Date.UTC(Number(normalizedYear) + 620, 0, 1, 12);
  const last = Date.UTC(Number(normalizedYear) + 622, 4, 1, 12);
  for (let timestamp = first; timestamp < last; timestamp += 24 * 60 * 60 * 1_000) {
    const parts = formatter.formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    if (part("year") === normalizedYear && Number(part("month")) === month && Number(part("day")) === day) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }
  return null;
}

export function normalizeDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩".indexOf(digit) % 10));
}

export function currentPersianDateInput(now = new Date()) {
  const { year, month, day } = tehranPersianDateParts(now);
  return { year, value: `${month}/${day}` };
}
