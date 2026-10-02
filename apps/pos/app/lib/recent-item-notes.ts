const prefix = "cafe.pos.item-notes.v1:";
export function readRecentItemNotes(productId: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(prefix + productId) ?? "[]");
    return Array.isArray(value) ? [...new Set(value.filter((note): note is string => typeof note === "string").map((note) => note.trim()).filter(Boolean))].slice(0, 20) : [];
  } catch { return []; }
}
export function rememberItemNotes(items: Array<{ productId: string; note: string | null }>): void {
  for (const item of items) {
    const note = item.note?.trim();
    if (!note) continue;
    try { localStorage.setItem(prefix + item.productId, JSON.stringify([note, ...readRecentItemNotes(item.productId).filter((previous) => previous !== note)].slice(0, 20))); }
    catch { /* Optional suggestions must never interrupt a successful order save. */ }
  }
}
