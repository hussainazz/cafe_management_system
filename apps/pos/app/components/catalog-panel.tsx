"use client";

import { KeyboardSensor, PointerSensor, DndContext, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { archiveCategory, archiveProduct, archiveProductImage, reorderCategories, reorderProducts, saveCategory, saveProduct, uploadProductImage, type ManagerCatalog } from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";
import { catalogProductImageUrl } from "../lib/catalog-image";

type Confirm = { title: string; detail: string; run: () => Promise<void> };
type Props = { catalog: ManagerCatalog; mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>; reload: () => Promise<any>; requestConfirm: (confirm: Confirm) => void };
const value = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const numeric = (data: FormData, name: string) => Number(data.get(name) ?? 0);

function DragHandle({ attributes, listeners }: any) { return <button type="button" className="catalog-drag-handle" aria-label="جابجایی با کشیدن" {...attributes} {...listeners}>⠿</button>; }

function SortableCategory({ row, index, selected, onSelect }: any) {
  const sortable = useSortable({ id: row.id });
  return <li ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={`catalog-category-row ${selected ? "is-selected" : ""} ${sortable.isDragging ? "is-dragging" : ""}`}>
    <DragHandle attributes={sortable.attributes} listeners={sortable.listeners} />
    <button type="button" className="catalog-category-select" onClick={onSelect}><strong>{row.name}</strong><small>{row.isActive ? "فعال" : "غیرفعال"}</small></button>
    <span className="catalog-order">#{index + 1}</span>
  </li>;
}

function SortableProduct({ row, categoryName, index, onEdit }: any) {
  const sortable = useSortable({ id: row.id });
  return <article ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className={`catalog-product-card ${sortable.isDragging ? "is-dragging" : ""}`}>
    <div className="catalog-product-card__top"><span className="catalog-order">#{index + 1}</span><DragHandle attributes={sortable.attributes} listeners={sortable.listeners} /></div>
    <button type="button" className="catalog-product-card__open" onClick={onEdit}>
      {catalogProductImageUrl(row, categoryName) ? <img src={catalogProductImageUrl(row, categoryName)!} alt={row.image?.altText ?? row.name} /> : <span className="catalog-product-card__placeholder" aria-hidden="true">☕</span>}
      <strong>{row.name}</strong><b>{formatToman(row.priceAmount)}</b><small>{row.pricingMode === "WEIGHTED_PER_KG" ? "قیمت هر کیلو" : "قیمت هر واحد"} · {row.isAvailable ? "موجود" : "ناموجود"} · {row.isActive ? "فعال" : "غیرفعال"}</small>
    </button>
  </article>;
}

export function CatalogPanel({ catalog, mutate, reload, requestConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(catalog.categories[0]?.id ?? null);
  const [categoryOrder, setCategoryOrder] = useState(() => catalog.categories.map((row) => row.id));
  const [productOrder, setProductOrder] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<any | "new" | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  useEffect(() => { setCategoryOrder(catalog.categories.map((row) => row.id)); setProductOrder(Object.fromEntries(catalog.categories.map((category) => [category.id, catalog.products.filter((product) => product.categoryId === category.id).map((product) => product.id)]))); if (!catalog.categories.some((row) => row.id === selectedId)) setSelectedId(catalog.categories[0]?.id ?? null); }, [catalog]);
  const categories = useMemo(() => [...catalog.categories].sort((a, b) => categoryOrder.indexOf(a.id) - categoryOrder.indexOf(b.id)), [catalog.categories, categoryOrder]);
  const selected = catalog.categories.find((row) => row.id === selectedId) ?? null;
  const products = useMemo(() => [...catalog.products.filter((row) => row.categoryId === selectedId && row.name.includes(query.trim()))].sort((a, b) => (productOrder[selectedId ?? ""]?.indexOf(a.id) ?? 0) - (productOrder[selectedId ?? ""]?.indexOf(b.id) ?? 0)), [catalog.products, productOrder, query, selectedId]);
  const categoryDrop = (event: DragEndEvent) => { if (!event.over || event.active.id === event.over.id) return; const ordered = arrayMove(categoryOrder, categoryOrder.indexOf(String(event.active.id)), categoryOrder.indexOf(String(event.over.id))); setCategoryOrder(ordered); void mutate(() => reorderCategories(ordered), reload); };
  const productDrop = (event: DragEndEvent) => { if (!selected || !event.over || event.active.id === event.over.id) return; const ids = productOrder[selected.id] ?? []; const ordered = arrayMove(ids, ids.indexOf(String(event.active.id)), ids.indexOf(String(event.over.id))); setProductOrder((current) => ({ ...current, [selected.id]: ordered })); void mutate(() => reorderProducts(selected.id, ordered), reload); };
  return <section className="catalog-workspace">
    <aside className="catalog-sidebar"><header><h2>دسته‌ها</h2><p>دسته را انتخاب یا با دستگیره مرتب کنید.</p></header>
      <form className="catalog-create" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void mutate(() => saveCategory(null, { name: value(form, "name"), isActive: true }), reload).then(() => event.currentTarget.reset()); }}><input name="name" required placeholder="نام دسته" aria-label="نام دسته"/><button>افزودن</button></form>
      {categories.length ? <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={categoryDrop}><SortableContext items={categories.map((row) => row.id)} strategy={verticalListSortingStrategy}><ul className="catalog-category-list">{categories.map((row, index) => <SortableCategory key={row.id} row={row} index={index} selected={selectedId === row.id} onSelect={() => setSelectedId(row.id)} />)}</ul></SortableContext></DndContext> : <div className="catalog-empty">هنوز دسته‌ای ساخته نشده است.</div>}
      {selected && <CategoryEditor key={selected.id} row={selected} mutate={mutate} reload={reload} requestConfirm={requestConfirm} />}
    </aside>
    <main className="catalog-products"><header className="catalog-products__header"><div><h2>محصولات</h2><p>محصولات دسته انتخاب‌شده را مدیریت و مرتب کنید.</p></div>{selected && <span className="catalog-selected-category">دسته: {selected.name}</span>}<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجوی محصول…" aria-label="جستجوی محصول" disabled={!selected}/><button className="catalog-add-product" disabled={!selected} onClick={() => setEditor("new")}>+ افزودن محصول</button></header>
      {!selected ? <div className="catalog-empty">برای شروع، یک دسته ایجاد کنید.</div> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={productDrop}><SortableContext items={products.map((row) => row.id)} strategy={rectSortingStrategy}>{products.length ? <div className="catalog-product-grid">{products.map((row) => <SortableProduct key={row.id} row={row} categoryName={selected.name} index={Math.max(0, (productOrder[selected.id] ?? []).indexOf(row.id))} onEdit={() => setEditor(row)} />)}</div> : <div className="catalog-empty">هیچ محصولی در این دسته وجود ندارد.<button onClick={() => setEditor("new")}>+ افزودن محصول</button></div>}</SortableContext></DndContext>}
    </main>
    {editor && selected && <ProductDrawer initial={editor === "new" ? undefined : editor} categoryId={selected.id} catalog={catalog} close={() => setEditor(null)} mutate={mutate} reload={reload} requestConfirm={requestConfirm} />}
  </section>;
}

function CategoryEditor({ row, mutate, reload, requestConfirm }: any) { return <form className="catalog-category-editor" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void mutate(() => saveCategory(row.id, { name: value(data, "name"), isActive: data.get("isActive") === "on", isPosVisible: data.get("isPosVisible") === "on" }), reload); }}><strong>ویرایش دسته انتخاب‌شده</strong><input name="name" defaultValue={row.name} aria-label="نام دسته انتخاب‌شده" required/><label><input name="isActive" type="checkbox" defaultChecked={row.isActive}/> نمایش در منوی عمومی</label><label><input name="isPosVisible" type="checkbox" defaultChecked={row.isPosVisible}/> نمایش در سفارش‌گیری POS</label><button>ذخیره تغییرات</button><button type="button" className="catalog-archive" onClick={() => requestConfirm({ title: "بایگانی دسته", detail: `«${row.name}» از فروش فعال خارج می‌شود و سابقه آن حفظ خواهد شد.`, run: () => mutate(() => archiveCategory(row.id), reload) })}>بایگانی دسته</button></form>; }

function ProductDrawer({ initial, categoryId, catalog, close, mutate, reload, requestConfirm }: any) { const [busy, setBusy] = useState(false); const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); const optionGroups = catalog.optionGroups.filter((group: any) => data.getAll("optionGroupIds").includes(group.id)).map((group: any, displayOrder: number) => ({ optionGroupId: group.id, displayOrder, minSelections: numeric(data, `min-${group.id}`), maxSelections: numeric(data, `max-${group.id}`), options: group.options.filter((option: any) => data.getAll(`optionIds-${group.id}`).includes(option.id)).map((option: any, optionOrder: number) => ({ optionId: option.id, displayOrder: optionOrder, priceAmountOverride: value(data, `override-${group.id}-${option.id}`) || null })) })); void mutate(() => saveProduct(initial?.id ?? null, { categoryId: value(data, "categoryId"), name: value(data, "name"), priceAmount: numeric(data, "priceAmount"), preparationDeadlineMinutes: numeric(data, "preparationDeadlineMinutes"), isActive: data.get("isActive") === "on", isAvailable: data.get("isAvailable") === "on", optionGroups }), reload).then(close).finally(() => setBusy(false)); };
  return <div className="catalog-drawer-backdrop" role="presentation"><section className="catalog-product-drawer" role="dialog" aria-modal="true" aria-label={initial ? "ویرایش محصول" : "افزودن محصول"}><header><h2>{initial ? "ویرایش محصول" : "افزودن محصول"}</h2><button onClick={close} aria-label="بستن">×</button></header><form className="manager-form" onSubmit={submit}><div className="manager-fields"><label><span>دسته</span><select name="categoryId" defaultValue={initial?.categoryId ?? categoryId}>{catalog.categories.map((item: any) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>نام</span><input name="name" required defaultValue={initial?.name ?? ""}/></label><label><span>قیمت (تومان)</span><input name="priceAmount" type="number" min="0" required defaultValue={initial?.priceAmount ?? 0}/></label><label><span>آماده‌سازی (دقیقه)</span><input name="preparationDeadlineMinutes" type="number" min="1" required defaultValue={initial?.preparationDeadlineMinutes ?? 1}/></label><label><input name="isActive" type="checkbox" defaultChecked={initial?.isActive ?? true}/> فعال</label><label><input name="isAvailable" type="checkbox" defaultChecked={initial?.isAvailable ?? true}/> موجود</label></div><fieldset><legend>گروه‌های گزینه</legend>{catalog.optionGroups.map((group: any) => { const configured = initial?.optionGroups?.find((item: any) => item.optionGroupId === group.id); return <details key={group.id}><summary><input name="optionGroupIds" type="checkbox" value={group.id} defaultChecked={Boolean(configured)}/> {group.name}</summary><label>حداقل <input name={`min-${group.id}`} type="number" min="0" defaultValue={configured?.minSelections ?? 1}/></label><label>حداکثر <input name={`max-${group.id}`} type="number" min="1" defaultValue={configured?.maxSelections ?? 1}/></label>{group.options.map((option: any) => { const selected = configured?.options?.find((entry: any) => entry.optionId === option.id); return <label key={option.id}><input name={`optionIds-${group.id}`} type="checkbox" value={option.id} defaultChecked={Boolean(selected)}/> {option.name}<input name={`override-${group.id}-${option.id}`} type="number" min="0" defaultValue={selected?.priceAmountOverride ?? ""}/></label>; })}</details>; })}</fieldset><button disabled={busy}>{busy ? "در حال ثبت…" : "ذخیره محصول"}</button></form>{initial && <ImageEditor product={initial} mutate={mutate} reload={reload} requestConfirm={requestConfirm}/>}</section></div>; }

function ImageEditor({ product, mutate, reload, requestConfirm }: any) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [hasImage, setHasImage] = useState(Boolean(product.image));
  const visibleImage = uploadedPreview ?? (product.image ? `/pos/api/v1/product-images/${encodeURIComponent(product.image.storageKey)}` : null);
  return <form className="manager-form catalog-image-editor" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = selectedFile ?? (event.currentTarget.elements.namedItem("image") as HTMLInputElement).files?.[0];
    if (!file || busy) return;
    setBusy(true); setProgress(0);
    void mutate(() => uploadProductImage(product.id, file, value(data, "altText"), setProgress), reload)
      .then(() => { setHasImage(true); setUploadedPreview(typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null); setSelectedFile(null); })
      .finally(() => { setBusy(false); setProgress(null); });
  }}>
    <strong>تصویر محصول</strong>
    {visibleImage && <img className="catalog-image-editor__preview" src={visibleImage} alt={product.image?.altText ?? "پیش‌نمایش تصویر محصول"} />}
    <label>تصویر JPEG/PNG/WebP <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required={!hasImage} disabled={busy} onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}/></label>
    {selectedFile && <small className="catalog-image-editor__selection">آماده برای بارگذاری: {selectedFile.name}</small>}
    <label>متن جایگزین <input name="altText" required defaultValue={product.image?.altText ?? ""} disabled={busy}/></label>
    <button disabled={busy}>{busy ? "در حال بارگذاری تصویر…" : hasImage ? "جایگزینی تصویر" : "بارگذاری تصویر"}</button>
    {busy && <div className="image-upload-progress catalog-image-editor__progress" role="status" aria-live="polite"><div className="image-upload-progress__label"><span>در حال ارسال تصویر؛ لطفاً این پنجره را نبندید.</span><span>{progress === null ? "در حال آماده‌سازی…" : `${progress}٪`}</span></div><progress aria-label="پیشرفت بارگذاری تصویر" max={100} value={progress ?? undefined}>{progress ?? 0}%</progress></div>}
    {hasImage && <button type="button" className="catalog-archive" onClick={() => requestConfirm({ title: "حذف تصویر", detail: "تصویر فعلی حذف می‌شود و می‌توانید تصویر تازه‌ای بارگذاری کنید.", run: async () => { await mutate(() => archiveProductImage(product.id), reload); setHasImage(false); setUploadedPreview(null); } })}>حذف تصویر فعلی</button>}
    <button type="button" className="catalog-archive" onClick={() => requestConfirm({ title: "بایگانی محصول", detail: `«${product.name}» از فروش فعال خارج می‌شود و سابقه سفارش‌ها حفظ می‌گردد.`, run: () => mutate(() => archiveProduct(product.id), reload) })}>بایگانی محصول</button>
  </form>;
}
