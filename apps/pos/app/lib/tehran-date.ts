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
  const match = /^(\d{2})\/(\d{2})$/.exec(value);
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
  const first = Date.UTC(Number(year) + 620, 0, 1, 12);
  const last = Date.UTC(Number(year) + 622, 4, 1, 12);
  for (let timestamp = first; timestamp < last; timestamp += 24 * 60 * 60 * 1_000) {
    const parts = formatter.formatToParts(new Date(timestamp));
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
    if (part("year") === year && Number(part("month")) === month && Number(part("day")) === day) {
      return new Date(timestamp).toISOString().slice(0, 10);
    }
  }
  return null;
}

export function currentPersianDateInput(now = new Date()) {
  const { year, month, day } = tehranPersianDateParts(now);
  return { year, value: `${month}/${day}` };
}
