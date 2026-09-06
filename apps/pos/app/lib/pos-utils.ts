export const persianNumber = new Intl.NumberFormat("fa-IR", {
  maximumFractionDigits: 0,
});

export function formatToman(amount: number) {
  return `${persianNumber.format(amount)} تومان`;
}

export function elapsedLabel(startedAt: string | null, now = Date.now()) {
  if (!startedAt) return null;
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) return null;

  const totalMinutes = Math.max(0, Math.floor((now - started) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${persianNumber.format(minutes)} دقیقه`;
  if (minutes === 0) return `${persianNumber.format(hours)} ساعت`;
  return `${persianNumber.format(hours)} ساعت و ${persianNumber.format(minutes)} دقیقه`;
}

export function sumAmounts(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}
