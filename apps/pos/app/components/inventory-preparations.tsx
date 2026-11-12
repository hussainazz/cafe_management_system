"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { saveInventoryRecipe, type ApiResult, type InventoryRecipe, type InventoryStockItem } from "../lib/api-client";

type Unit = "PIECE" | "GRAM" | "MILLILITER";
const units: Record<Unit, string> = { PIECE: "عدد", GRAM: "گرم", MILLILITER: "میلی‌لیتر" };
type Component = { key: string; kind: "STOCK_ITEM" | "RECIPE"; id: string; quantity: string };
const emptyComponent = (): Component => ({ key: crypto.randomUUID(), kind: "STOCK_ITEM", id: "", quantity: "1" });

export function InventoryPreparations({ items, recipes, mutate, onDirtyChange }: {
  items: InventoryStockItem[]; recipes: InventoryRecipe[];
  mutate: (action: () => Promise<ApiResult<unknown>>) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [editing, setEditing] = useState<InventoryRecipe | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState<Unit>("PIECE");
  const [yieldQuantity, setYieldQuantity] = useState("1");
  const [components, setComponents] = useState<Component[]>(() => [emptyComponent()]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const load = (recipe: InventoryRecipe | null) => {
    if (dirty && !window.confirm("تغییرات دستور مشترک ذخیره نشده است. بدون ذخیره ادامه می‌دهید؟")) return;
    setEditing(recipe); setName(recipe?.name ?? ""); setUnit((recipe?.outputUnit as Unit | undefined) ?? "PIECE"); setYieldQuantity(recipe?.yieldQuantity ?? "1");
    setComponents(recipe?.components.map((row) => ({ key: row.componentKey, kind: row.sourceKind, id: row.sourceKind === "STOCK_ITEM" ? row.stockItemId : row.nestedRecipeId, quantity: row.quantity })) ?? [emptyComponent()]);
    setDirty(false); setError(null);
  };
  const change = (index: number, patch: Partial<Component>) => { setDirty(true); setComponents((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row)); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      const ok = await mutate(async () => {
        const result = await saveInventoryRecipe(editing?.id ?? null, {
          name, ingredientName: name, outputUnit: unit, yieldQuantity,
          components: components.map((row, displayOrder) => ({ componentKey: row.key, sourceKind: row.kind, ...(row.kind === "STOCK_ITEM" ? { stockItemId: row.id } : { nestedRecipeId: row.id }), quantity: row.quantity, displayOrder })),
          ...(editing ? { expectedVersion: editing.version } : {}),
        });
        if (result.ok) { setEditing(result.data.data); setDirty(false); }
        return result;
      });
      if (!ok) setError("دستور مشترک ذخیره نشد. اطلاعات و پیام خطا را بررسی کنید.");
    } catch { setError("دستور مشترک ذخیره نشد. اتصال را بررسی کنید."); }
    finally { setSaving(false); }
  };
  return <section className="manager-card">
    <header><h2>دستورهای مشترک</h2><p>مواد ترکیبی را یک بار تعریف کنید و در محصولات دیگر به کار ببرید. برای نمونه، «کوکی بیرون‌بر» شامل دستور «کوکی» و یک بسته‌بندی است.</p></header>
    <div className="inventory-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => load(null)}>دستور مشترک جدید</button>
      <label><span>ویرایش دستور مشترک</span><select value={editing?.id ?? ""} disabled={saving} onChange={(event) => load(recipes.find((recipe) => recipe.id === event.target.value) ?? null)}><option value="">دستور جدید</option>{recipes.filter((recipe) => recipe.isActive && !recipe.archivedAt).map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <form className="manager-form" onSubmit={(event) => void submit(event)} onChangeCapture={() => setDirty(true)}>
      <fieldset disabled={saving} className="inventory-option-recipe"><legend>اجزای دستور مشترک</legend>
        <label><span>نام دستور مشترک</span><input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="مثلاً کوکی بیرون‌بر" /></label>
        <label><span>واحد خروجی دستور</span><select value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>{Object.entries(units).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>مقدار خروجی دستور</span><input required inputMode="decimal" value={yieldQuantity} onChange={(event) => setYieldQuantity(event.target.value)} /></label>
        {components.map((row, index) => {
          const options = row.kind === "STOCK_ITEM" ? items : recipes.filter((recipe) => recipe.id !== editing?.id);
          const source = options.find((option) => option.id === row.id);
          const sourceUnit = row.kind === "STOCK_ITEM" ? (source as InventoryStockItem | undefined)?.baseUnit : (source as InventoryRecipe | undefined)?.outputUnit;
          return <div className="inventory-entry-row" key={row.key}>
            <label><span>نوع جزء {index + 1}</span><select value={row.kind} onChange={(event) => change(index, { kind: event.target.value as Component["kind"], id: "" })}><option value="STOCK_ITEM">قلم موجودی</option><option value="RECIPE">دستور مشترک</option></select></label>
            <label><span>جزء {index + 1}</span><select required value={row.id} onChange={(event) => change(index, { id: event.target.value })}><option value="">انتخاب ماده</option>{options.filter((option) => (option.isActive && !option.archivedAt) || option.id === row.id).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
            <label><span>مقدار جزء {index + 1}{sourceUnit ? ` (${units[sourceUnit as Unit]})` : ""}</span><input required inputMode="decimal" value={row.quantity} onChange={(event) => change(index, { quantity: event.target.value })} /></label>
            {components.length > 1 && <button type="button" className="text-button" onClick={() => { setDirty(true); setComponents(components.filter((_, i) => i !== index)); }}>حذف جزء {index + 1}</button>}
          </div>;
        })}
        <button type="button" className="secondary-button" onClick={() => { setDirty(true); setComponents([...components, emptyComponent()]); }}>افزودن جزء به دستور مشترک</button>
        <button type="submit">ذخیره‌ی دستور مشترک</button>
      </fieldset>
    </form>
  </section>;
}
