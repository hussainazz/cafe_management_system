"use client";

import {
  KeyboardSensor,
  PointerSensor,
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  archiveCategory,
  archiveProduct,
  archiveProductImage,
  reorderCategories,
  reorderProducts,
  saveCategory,
  savePromotionalCategoryProducts,
  saveOption,
  saveOptionGroup,
  saveProduct,
  saveProductSaleDiscount,
  uploadProductImage,
  type ManagerCatalog,
} from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";
import { roundDiscountedAmount } from "@cafe/contracts";
import { catalogProductImageUrl } from "../lib/catalog-image";
import { EditIcon, TrashIcon, CloseIcon, OrdersIcon, SettingsIcon } from "./icons";

type Confirm = { title: string; detail: string; run: () => Promise<void> };
type Props = {
  catalog: ManagerCatalog;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
};
const value = (data: FormData, name: string) => String(data.get(name) ?? "").trim();
const numeric = (data: FormData, name: string) => Number(data.get(name) ?? 0);
type CatalogOptionGroup = ManagerCatalog["optionGroups"][number];
type ConfiguredProductOptionGroup = ManagerCatalog["products"][number]["optionGroups"][number];
type PendingOptionCreation = {
  groupId: string;
  optionId: string | null;
  groupName: string;
  optionName: string;
  priceAmount: number;
};

function ProductOptionGroupFields({
  group,
  configured,
  error,
  basePriceErrors,
}: {
  group: CatalogOptionGroup;
  configured: ConfiguredProductOptionGroup | undefined;
  error: string | undefined;
  basePriceErrors: Record<string, string>;
}) {
  const [enabled, setEnabled] = useState(Boolean(configured));
  const [selectedOptionIds, setSelectedOptionIds] = useState(
    () => new Set(configured?.options.map((option) => option.optionId) ?? []),
  );
  const [overrideValues, setOverrideValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      group.options.map((option) => {
        const override = configured?.options.find((entry) => entry.optionId === option.id)?.priceAmountOverride;
        return [option.id, override == null ? "" : String(override)];
      }),
    ),
  );

  return (
    <details className="product-editor__option-group" open={Boolean(configured)}>
      <summary>
        <input
          name="optionGroupIds"
          type="checkbox"
          value={group.id}
          defaultChecked={enabled}
          aria-label={`افزودن گروه ${group.name} به این محصول`}
          onChange={(event) => setEnabled(event.currentTarget.checked)}
        />{" "}
        {group.name}
      </summary>
      <div className="catalog-option-group-fields">
        <p className="catalog-option-price-help">
          اگر مبلغی وارد نکنید، قیمت پایه‌ی گزینه اعمال می‌شود. برای این محصول قیمت دیگری وارد کنید.
        </p>
        <label>
          حداقل انتخاب{" "}
          <input
            name={`min-${group.id}`}
            type="number"
            min="0"
            step="1"
            required
            disabled={!enabled}
            defaultValue={configured?.minSelections ?? 1}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `option-group-error-${group.id}` : undefined}
          />
        </label>
        <label>
          حداکثر انتخاب{" "}
          <input
            name={`max-${group.id}`}
            type="number"
            min="1"
            step="1"
            required
            disabled={!enabled}
            defaultValue={configured?.maxSelections ?? 1}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `option-group-error-${group.id}` : undefined}
          />
        </label>
        {error && (
          <p id={`option-group-error-${group.id}`} className="catalog-option-group-error" role="alert">
            {error}
          </p>
        )}
        {group.options.map((option) => {
          const selected = selectedOptionIds.has(option.id);
          return (
            <div className="catalog-option-item" key={option.id}>
              <label className="catalog-option-item__select">
                <input
                  name={`optionIds-${group.id}`}
                  type="checkbox"
                  value={option.id}
                  defaultChecked={selected}
                  disabled={!enabled}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelectedOptionIds((current) => {
                      const next = new Set(current);
                      if (checked) next.add(option.id);
                      else next.delete(option.id);
                      return next;
                    });
                  }}
                /> {option.name}
              </label>
              <label>
                قیمت پایه (تومان)
                <input
                  name={`base-${group.id}-${option.id}`}
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  required
                  defaultValue={option.priceAmount}
                  aria-label={`قیمت پایه ${option.name} به تومان`}
                  aria-invalid={Boolean(basePriceErrors[`${group.id}-${option.id}`])}
                  aria-describedby={basePriceErrors[`${group.id}-${option.id}`] ? `base-price-error-${group.id}-${option.id}` : undefined}
                />
                {basePriceErrors[`${group.id}-${option.id}`] && (
                  <small id={`base-price-error-${group.id}-${option.id}`} className="catalog-option-group-error" role="alert">
                    {basePriceErrors[`${group.id}-${option.id}`]}
                  </small>
                )}
              </label>
              <div className="catalog-option-override">
                <label>
                  قیمت این محصول
                  <input
                    name={`override-${group.id}-${option.id}`}
                    type="number"
                    min="0"
                    max="2147483647"
                    step="1"
                    disabled={!enabled || !selected}
                    value={overrideValues[option.id] ?? ""}
                    placeholder="خالی = قیمت پایه"
                    aria-label={`قیمت ${option.name} برای این محصول به تومان`}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      setOverrideValues((current) => ({ ...current, [option.id]: nextValue }));
                    }}
                  />
                </label>
                {overrideValues[option.id] !== "" && (
                  <button
                    type="button"
                    className="catalog-option-use-base"
                    disabled={!enabled || !selected}
                    onClick={() => setOverrideValues((current) => ({ ...current, [option.id]: "" }))}
                    aria-label={`استفاده از قیمت پایه برای ${option.name}`}
                  >
                    استفاده از قیمت پایه
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function optionGroupLimitErrors(
  data: FormData,
  groups: CatalogOptionGroup[],
): Record<string, string> {
  const selectedGroupIds = new Set(data.getAll("optionGroupIds").map(String));
  const errors: Record<string, string> = {};

  for (const group of groups) {
    if (!selectedGroupIds.has(group.id)) continue;
    const minValue = data.get(`min-${group.id}`);
    const maxValue = data.get(`max-${group.id}`);
    const min = Number(minValue);
    const max = Number(maxValue);

    if (minValue === null || !Number.isInteger(min) || min < 0) {
      errors[group.id] = "حداقل انتخاب باید عددی صحیح و برابر با صفر یا بیشتر باشد.";
    } else if (maxValue === null || !Number.isInteger(max) || max < 1) {
      errors[group.id] = "حداکثر انتخاب باید عددی صحیح و برابر با 1 یا بیشتر باشد.";
    } else if (min > max) {
      errors[group.id] = "حداقل انتخاب نمی‌تواند از حداکثر انتخاب بیشتر باشد.";
    } else if (min > data.getAll(`optionIds-${group.id}`).length) {
      errors[group.id] = "حداقل انتخاب نمی‌تواند از تعداد گزینه‌های این گروه بیشتر باشد.";
    }
  }

  return errors;
}

function DragHandle({ attributes, listeners }: any) {
  return (
    <button
      type="button"
      className="catalog-drag-handle"
      aria-label="جابجایی با کشیدن"
      {...attributes}
      {...listeners}
    >
      ⠿
    </button>
  );
}

function SortableCategory({ row, selected, onSelect, mutate, reload, requestConfirm }: any) {
  const sortable = useSortable({ id: row.id });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(row.name);
  useEffect(() => { setName(row.name); }, [row.name]);
  useEffect(() => {
    if (!selected) {
      setRenaming(false);
      setName(row.name);
    }
  }, [selected, row.name]);
  const saveName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await mutate(() => saveCategory(row.id, { name: name.trim() }), reload);
    setRenaming(false);
  };
  return (
    <>
      <li
        ref={sortable.setNodeRef}
        style={{
          transform: CSS.Transform.toString(sortable.transform),
          transition: sortable.transition,
        }}
        className={`catalog-category-row ${selected ? "is-selected" : ""} ${sortable.isDragging ? "is-dragging" : ""}`}
      >
        {selected && renaming ? <form className="catalog-category-select catalog-category-rename" onSubmit={saveName} onClick={(event) => event.stopPropagation()}>
            <input aria-label="نام دسته" value={name} onChange={(event) => setName(event.target.value)} required autoFocus />
            <button type="submit">ذخیره</button>
            <button type="button" onClick={() => { setName(row.name); setRenaming(false); }}>لغو</button>
          </form> : <button type="button" className="catalog-category-select" onClick={onSelect}>
          <strong>{row.name}</strong>
        </button>}
        {selected && !renaming && <span className="catalog-category-actions">
          <button type="button" aria-label="تغییر نام دسته" title="تغییر نام دسته" onClick={() => setRenaming(true)}><EditIcon /></button>
          <button type="button" className="catalog-category-delete" aria-label="حذف دسته" onClick={() => requestConfirm({
            title: "حذف دسته",
            detail: `دسته‌ی «${row.name}» از فهرست فعال خارج می‌شود؛ سابقه‌ی آن حفظ خواهد شد.`,
            run: () => mutate(() => archiveCategory(row.id), reload),
          })} title="حذف دسته"><TrashIcon /></button>
        </span>}
        <DragHandle attributes={sortable.attributes} listeners={sortable.listeners} />
      </li>
    </>
  );
}

function SortableProduct({ row, categoryName, index, onEdit, disabled }: any) {
  const sortable = useSortable({ id: row.id, disabled: Boolean(disabled) });
  const saleDiscountAmount = row.saleDiscountKind === "PERCENTAGE"
    ? Math.floor(row.priceAmount * row.saleDiscountValue / 100)
    : row.saleDiscountKind === "FIXED" ? row.saleDiscountValue : 0;
  const salePrice = Math.max(0, row.priceAmount - saleDiscountAmount);
  const hasSaleDiscount = saleDiscountAmount > 0;
  const isUnavailable = !row.isAvailable || !row.isActive;
  return (
    <article
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`catalog-product-card ${sortable.isDragging ? "is-dragging" : ""} ${hasSaleDiscount ? "has-sale-discount" : ""} ${isUnavailable ? "is-unavailable" : ""}`}
    >
      <div className="catalog-product-card__top">
        <span className="catalog-order">#{index + 1}</span>
        <DragHandle attributes={sortable.attributes} listeners={sortable.listeners} />
      </div>
      <button type="button" className="catalog-product-card__open" onClick={onEdit}>
        {catalogProductImageUrl(row, categoryName) ? (
          <img
            src={catalogProductImageUrl(row, categoryName)!}
            alt={row.image?.altText ?? row.name}
          />
        ) : (
          <span className="catalog-product-card__placeholder" aria-hidden="true">
            ☕
          </span>
        )}
        <strong>{row.name}</strong>
        {hasSaleDiscount ? (
          <span className="catalog-product-card__pricing">
            <b>{formatToman(salePrice)}</b>
            <del>{formatToman(row.priceAmount)}</del>
            <strong className="catalog-product-card__discount">٪{Math.round(saleDiscountAmount * 100 / row.priceAmount)} تخفیف</strong>
          </span>
        ) : <b>{formatToman(row.priceAmount)}</b>}
        {!isUnavailable && (
          <small className="catalog-product-card__meta">
            <span className="catalog-product-card__availability">✓ موجود · فعال</span>
          </small>
        )}
        {isUnavailable && <strong className="catalog-product-card__unavailable">{row.isAvailable ? "⏸ غیرفعال" : "⊘ ناموجود"}</strong>}
      </button>
    </article>
  );
}

export function CatalogPanel({ catalog, mutate, reload, requestConfirm }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(catalog.categories[0]?.id ?? null);
  const [categoryOrder, setCategoryOrder] = useState(() => catalog.categories.map((row) => row.id));
  const [productOrder, setProductOrder] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<any | "new" | null>(null);
  const [promoPickerOpen, setPromoPickerOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  useEffect(() => {
    setCategoryOrder(catalog.categories.map((row) => row.id));
    setProductOrder(
      Object.fromEntries(
        catalog.categories.map((category) => [
          category.id,
          category.kind === "PROMOTIONAL"
            ? category.productIds.filter((id) => catalog.products.some((product) => product.id === id))
            : catalog.products.filter((product) => product.categoryId === category.id).map((product) => product.id),
        ]),
      ),
    );
    if (!catalog.categories.some((row) => row.id === selectedId))
      setSelectedId(catalog.categories[0]?.id ?? null);
  }, [catalog]);
  const categories = useMemo(
    () =>
      [...catalog.categories].sort(
        (a, b) => categoryOrder.indexOf(a.id) - categoryOrder.indexOf(b.id),
      ),
    [catalog.categories, categoryOrder],
  );
  const selected = catalog.categories.find((row) => row.id === selectedId) ?? null;
  const products = useMemo(
    () =>
      [
        ...catalog.products.filter(
          (row) => (row.categoryId === selectedId || selected?.kind === "PROMOTIONAL" && selected.productIds.includes(row.id)) && row.name.includes(query.trim()),
        ),
      ].sort(
        (a, b) =>
          (productOrder[selectedId ?? ""]?.indexOf(a.id) ?? 0) -
          (productOrder[selectedId ?? ""]?.indexOf(b.id) ?? 0),
      ),
    [catalog.products, productOrder, query, selectedId],
  );
  const categoryDrop = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    const ordered = arrayMove(
      categoryOrder,
      categoryOrder.indexOf(String(event.active.id)),
      categoryOrder.indexOf(String(event.over.id)),
    );
    setCategoryOrder(ordered);
    void mutate(() => reorderCategories(ordered), reload);
  };
  const productDrop = (event: DragEndEvent) => {
    if (!selected || selected.kind === "PROMOTIONAL" || !event.over || event.active.id === event.over.id) return;
    const ids = productOrder[selected.id] ?? [];
    const ordered = arrayMove(
      ids,
      ids.indexOf(String(event.active.id)),
      ids.indexOf(String(event.over.id)),
    );
    setProductOrder((current) => ({ ...current, [selected.id]: ordered }));
    void mutate(() => reorderProducts(selected.id, ordered), reload);
  };
  return (
    <section className="catalog-workspace">
      <aside className="catalog-sidebar">
        <header>
          <h2>دسته‌ها</h2>
          <p>یک دسته را انتخاب کنید یا با دستگیره، ترتیب دسته‌ها را تغییر دهید.</p>
        </header>
        {categories.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={categoryDrop}>
            <SortableContext
              items={categories.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="catalog-category-list">
                {categories.map((row, index) => (
                  <SortableCategory
                    key={row.id}
                    row={row}
                    selected={selectedId === row.id}
                    onSelect={() => setSelectedId(row.id)}
                    mutate={mutate}
                    reload={reload}
                    requestConfirm={requestConfirm}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="catalog-empty">هنوز دسته‌ای ایجاد نشده است.</div>
        )}
        <form
          className="catalog-create"
          aria-labelledby="catalog-create-title"
          onSubmit={async (event) => {
            event.preventDefault();
            const formElement = event.currentTarget;
            const form = new FormData(formElement);
            let createdCategoryId: string | null = null;
            try {
              await mutate(
                async () => {
                  const result = await saveCategory(null, {
                    name: value(form, "name"),
                    kind: value(form, "kind"),
                    isActive: true,
                  });
                  if (result.ok) createdCategoryId = result.data.data.id;
                  return result;
                },
                reload,
              );
              formElement.reset();
              if (createdCategoryId) setSelectedId(createdCategoryId);
            } catch {
              // The Manager workspace displays the API failure in its status notice.
            }
          }}
        >
          <h3 id="catalog-create-title" className="catalog-create__title">ایجاد دسته</h3>
          <input name="name" required placeholder="نام دسته" aria-label="نام دسته" />
          <label className="catalog-create__kind">
            نوع دسته
            <select name="kind" aria-label="نوع دسته" defaultValue="SOURCE">
              <option value="SOURCE">دسته اصلی</option>
              <option value="PROMOTIONAL">دسته‌ی ویژه</option>
            </select>
            <small>محصول در دسته‌ی اصلی نگهداری می‌شود؛ دسته‌ی ویژه همان محصول را در این بخش هم نمایش می‌دهد.</small>
          </label>
          <button type="submit">ایجاد دسته</button>
        </form>
      </aside>
      <main className="catalog-products">
        <header className="catalog-products__header">
          <div>
            <h2>محصولات</h2>
            <p>محصولات این دسته را مدیریت و مرتب کنید.</p>
          </div>
          {selected && <span className="catalog-selected-category">دسته: {selected.name}</span>}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="نام محصول را جستجو کنید…"
            aria-label="جستجوی نام محصول"
            disabled={!selected}
          />
          {selected?.kind === "PROMOTIONAL" && <button type="button" className="catalog-promo-action" onClick={() => setPromoPickerOpen(true)}>افزودن محصول از دسته‌ها</button>}
          {selected?.kind === "SOURCE" && (
            <button className="catalog-add-product" onClick={() => setEditor("new")}>
              + افزودن محصول
            </button>
          )}
        </header>
        {!selected ? (
          <div className="catalog-empty">برای شروع، یک دسته ایجاد کنید.</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={productDrop}>
            <SortableContext items={products.map((row) => row.id)} strategy={rectSortingStrategy}>
              {products.length ? (
                <div className="catalog-product-grid">
                  {products.map((row) => (
                    <SortableProduct
                      key={row.id}
                      row={row}
                      categoryName={selected.name}
                      disabled={selected.kind === "PROMOTIONAL"}
                      index={Math.max(0, (productOrder[selected.id] ?? []).indexOf(row.id))}
                      onEdit={() => setEditor(row)}
                    />
                  ))}
                </div>
              ) : (
                <div className="catalog-empty">
                  محصولی در این دسته نیست.
                  {selected.kind === "PROMOTIONAL" ? <button onClick={() => setPromoPickerOpen(true)}>افزودن محصول از دسته‌ها</button> : <button onClick={() => setEditor("new")}>+ افزودن محصول</button>}
                </div>
              )}
            </SortableContext>
          </DndContext>
        )}
      </main>
      {promoPickerOpen && selected?.kind === "PROMOTIONAL" && <PromotionalProductPicker category={selected} catalog={catalog} close={() => setPromoPickerOpen(false)} mutate={mutate} reload={reload} />}
      {editor && selected && (
        <ProductDrawer
          initial={editor === "new" ? undefined : editor}
          categoryId={selected.id}
          catalog={catalog}
          close={() => setEditor(null)}
          mutate={mutate}
          reload={reload}
          requestConfirm={requestConfirm}
        />
      )}
    </section>
  );
}

function PromotionalProductPicker({ category, catalog, close, mutate, reload }: any) {
  const [selectedIds, setSelectedIds] = useState<string[]>(category.productIds);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const changed = selectedIds.length !== category.productIds.length ||
    selectedIds.some((id, index) => id !== category.productIds[index]);
  const search = query.trim().toLocaleLowerCase();
  const eligibleProducts = catalog.products.filter(
    (product: any) => product.isPublic && product.systemKey !== "PACKING",
  );
  const eligibleProductIds = new Set(eligibleProducts.map((product: any) => product.id));
  const excludedSelections = catalog.products.filter(
    (product: any) => category.productIds.includes(product.id) && !eligibleProductIds.has(product.id),
  );
  const toggle = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const sources = catalog.categories.filter((row: any) => row.kind === "SOURCE");
  const closeSafely = () => {
    if (saving) return;
    if (changed && !window.confirm("تغییرات ذخیره‌نشده حذف شوند؟")) return;
    close();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSafely();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const focusable = Array.from(
      panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    searchInput.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      opener.current?.focus();
    };
  }, []);

  const save = async () => {
    if (saving || !changed) return;
    setSaving(true);
    try {
      await mutate(() => savePromotionalCategoryProducts(category.id, selectedIds), reload);
      close();
    } catch {
      // The Manager workspace reports the save failure in its status notice.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="catalog-promo-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSafely();
      }}
    >
      <section
        ref={panel}
        className="catalog-promo-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-promo-title"
        aria-describedby="catalog-promo-guidance"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <header>
          <div>
            <h2 id="catalog-promo-title">افزودن محصول به «{category.name}»</h2>
            <p id="catalog-promo-guidance">
              محصول‌ها در دسته‌ی اصلی خود باقی می‌مانند و هم‌زمان در این دسته هم نمایش داده می‌شوند.
            </p>
          </div>
          <button type="button" onClick={closeSafely} disabled={saving}>بستن</button>
        </header>
        <div className="catalog-promo-controls">
          <label className="catalog-promo-search">
            <span className="catalog-promo-visually-hidden">جستجوی محصول یا دسته</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="نام محصول یا دسته را وارد کنید"
            />
          </label>
          <label className="catalog-promo-filter">
            <span className="catalog-promo-visually-hidden">فیلتر دسته‌ها</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8Z" /></svg>
            <select value={sourceFilter} onChange={(event) => setSourceFilter(event.currentTarget.value)}>
              <option value="">همه دسته‌ها</option>
              {sources.map((source: any) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
        </div>
        <div className="catalog-promo-sources">
          {sources.map((source: any) => {
            if (sourceFilter && sourceFilter !== source.id) return null;
            const sourceProducts = eligibleProducts.filter((product: any) => product.categoryId === source.id);
            const visibleProducts = sourceProducts.filter((product: any) =>
              !search || source.name.toLocaleLowerCase().includes(search) || product.name.toLocaleLowerCase().includes(search),
            );
            if (search && visibleProducts.length === 0) return null;
            return (
              <details className="catalog-promo-source" key={source.id} open={Boolean(search)}>
                <summary>
                  <input
                    type="checkbox"
                    aria-label={`انتخاب همه محصولات ${source.name}`}
                    checked={sourceProducts.length > 0 && sourceProducts.every((product: any) => selectedIds.includes(product.id))}
                    disabled={!sourceProducts.length}
                    ref={(input) => { if (input) input.indeterminate = sourceProducts.some((product: any) => selectedIds.includes(product.id)) && !sourceProducts.every((product: any) => selectedIds.includes(product.id)); }}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const ids = sourceProducts.map((product: any) => product.id);
                      setSelectedIds((current) => event.target.checked
                        ? Array.from(new Set([...current, ...ids]))
                        : current.filter((id) => !ids.includes(id)));
                    }}
                  />
                  <span className="catalog-promo-source-title">
                    <span>{source.name}</span>
                    <small>{sourceProducts.length} محصول</small>
                  </span>
                  <span className="catalog-promo-chevron" aria-hidden="true">‹</span>
                </summary>
                <fieldset>
                  <legend>محصول‌های قابل انتخاب</legend>
                  {visibleProducts.length ? visibleProducts.map((product: any) => (
                    <label key={product.id}>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(product.id)}
                        onChange={() => toggle(product.id)}
                      />
                      <span>{product.name}</span>
                    </label>
                  )) : <p className="catalog-promo-empty">محصول فعالی برای افزودن وجود ندارد.</p>}
                </fieldset>
              </details>
            );
          })}
          {search && !sources.some((source: any) =>
            eligibleProducts.some((product: any) => product.categoryId === source.id &&
              (source.name.toLocaleLowerCase().includes(search) || product.name.toLocaleLowerCase().includes(search))),
          ) && <p className="catalog-promo-empty">محصول یا دسته‌ای با این نام پیدا نشد.</p>}
          {excludedSelections.length > 0 && (
            <section className="catalog-promo-excluded" aria-label="محصولات فعلی که دیگر قابل انتخاب نیستند">
              <h3>محصولات این فهرست که دیگر قابل انتخاب نیستند</h3>
              <p>این محصول‌ها دیگر در منوی عمومی نمایش داده نمی‌شوند یا در دسته‌ی «بسته‌بندی» هستند. برای حذفشان از این دسته، تیک را بردارید. پس از حذف، دوباره نمی‌توانید آن‌ها را اضافه کنید.</p>
              {excludedSelections.map((product: any) => (
                <label key={product.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(product.id)}
                    onChange={() => toggle(product.id)}
                  />
                  <span>{product.name} · غیرقابل افزودن</span>
                </label>
              ))}
            </section>
          )}
        </div>
        <footer>
          <span>{selectedIds.length} محصول انتخاب شده</span>
          <div>
            <button type="button" className="catalog-promo-cancel" onClick={closeSafely} disabled={saving}>انصراف</button>
            <button type="button" onClick={() => void save()} disabled={!changed || saving}>
              {saving ? "در حال ذخیره…" : "ذخیره"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function ProductEditorIcon({ kind }: { kind: string }) {
  if (kind === "details") return <OrdersIcon />;
  if (kind === "options") return <SettingsIcon />;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "image" ? <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></> : <><path d="m3 3 10 0 8 8-10 10-8-8Z" /><circle cx="8" cy="8" r="1.5" /></>}</svg>;
}

function ProductDrawer({
  initial,
  categoryId,
  catalog,
  close,
  mutate,
  reload,
  requestConfirm,
}: any) {
  const [activeTab, setActiveTab] = useState("details");
  const [summaryImageFailed, setSummaryImageFailed] = useState(false);
  const [productName, setProductName] = useState(initial?.name ?? "");
  const [selectedCategory, setSelectedCategory] = useState(initial?.categoryId ?? categoryId);
  const tabs = [{ id: "details", label: "مشخصات" }, { id: "options", label: "گزینه‌ها" }, { id: "discount", label: "تخفیف" }, { id: "image", label: "تصویر" }];
  const [busy, setBusy] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [basePriceErrors, setBasePriceErrors] = useState<Record<string, string>>({});
  const [pendingOptionCreation, setPendingOptionCreation] = useState<PendingOptionCreation | null>(null);
  const [optionGroupErrors, setOptionGroupErrors] = useState<Record<string, string>>({});
  const [pricingMode, setPricingMode] = useState(initial?.pricingMode ?? "FIXED");
  const [priceAmount, setPriceAmount] = useState(initial?.priceAmount ?? 0);
  const [menuNote, setMenuNote] = useState(initial?.menuNote ?? "");
  const [saleDiscountMode, setSaleDiscountMode] = useState<"PRICE" | "PERCENTAGE">(
    initial?.saleDiscountKind === "PERCENTAGE" ? "PERCENTAGE" : "PRICE",
  );
  const [saleDiscountValue, setSaleDiscountValue] = useState(
    initial?.saleDiscountValue == null
      ? ""
      : String(initial.saleDiscountKind === "PERCENTAGE"
        ? initial.saleDiscountValue
        : Math.max(0, initial.priceAmount - initial.saleDiscountValue)),
  );
  const [saleDiscountBusy, setSaleDiscountBusy] = useState(false);
  const [saleDiscountMessage, setSaleDiscountMessage] = useState("");
  const [saleDiscountError, setSaleDiscountError] = useState("");
  const titleId = "catalog-product-drawer-title";
  const nameInput = useRef<HTMLInputElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    nameInput.current?.focus();
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      opener.current?.focus();
    };
  }, []);

  const closeSafely = () => {
    if (busy || imageBusy || saleDiscountBusy) return;
    if (pendingOptionCreation && !window.confirm(
      "گروه گزینه ساخته شده، اما هنوز به محصول وصل نشده است. اگر پنجره را ببندید، ذخیره‌ی این تغییر ناتمام می‌ماند. می‌خواهید ببندید؟",
    )) return;
    if (!pendingOptionCreation && dirty && !window.confirm("تغییرات ذخیره‌نشده حذف شوند؟")) return;
    close();
  };

  const discountValueNumber = Number(saleDiscountValue);
  const saleDiscountAmount = saleDiscountValue
    ? saleDiscountMode === "PERCENTAGE"
      ? Math.floor((priceAmount * discountValueNumber) / 100)
      : Math.max(0, priceAmount - discountValueNumber)
    : 0;
  const resultingSalePrice = saleDiscountAmount > 0
    ? Math.min(priceAmount, roundDiscountedAmount(Math.max(0, priceAmount - saleDiscountAmount)))
    : priceAmount;
  const calculatedDiscountPercentage = saleDiscountMode === "PERCENTAGE"
    ? Number.isInteger(discountValueNumber) ? discountValueNumber : 0
    : priceAmount > 0
      ? Math.min(100, Math.round((saleDiscountAmount * 100) / priceAmount))
      : 0;

  const saveSaleDiscount = async (remove = false) => {
    if (!initial?.id || saleDiscountBusy) return;
    if (!remove && (!Number.isInteger(discountValueNumber) || discountValueNumber < 0 ||
      (saleDiscountMode === "PERCENTAGE" && (discountValueNumber < 1 || discountValueNumber > 100)) ||
      (saleDiscountMode === "PRICE" && discountValueNumber > priceAmount))) {
      setSaleDiscountError(saleDiscountMode === "PERCENTAGE"
        ? "درصد تخفیف باید بین 1 تا 100 باشد."
        : "قیمت نهایی باید صفر یا بیشتر باشد و از قیمت پایه بیشتر نباشد.");
      setSaleDiscountMessage("");
      return;
    }
    if (!remove && priceAmount !== initial.priceAmount) {
      setSaleDiscountError("ابتدا قیمت پایه را ذخیره کنید؛ سپس تخفیف را ثبت کنید.");
      setSaleDiscountMessage("");
      return;
    }
    setSaleDiscountBusy(true);
    setSaleDiscountError("");
    setSaleDiscountMessage("");
    try {
      await mutate(async () => {
        const result = await saveProductSaleDiscount(
          initial.id,
          remove || saleDiscountAmount === 0
            ? null
            : saleDiscountMode === "PERCENTAGE"
              ? { kind: "PERCENTAGE", value: discountValueNumber }
              : { kind: "FIXED", value: saleDiscountAmount },
        );
        if (!result.ok) throw new Error(result.error.message);
        return result;
      }, reload);
      if (remove) setSaleDiscountValue("");
      setSaleDiscountMessage(remove ? "تخفیف محصول حذف شد." : "تخفیف محصول ذخیره شد.");
    } catch (error) {
      setSaleDiscountError(error instanceof Error ? error.message : "تخفیف ذخیره نشد.");
    } finally {
      setSaleDiscountBusy(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSafely();
      return;
    }
    if (event.key !== "Tab" || !drawer.current) return;
    const focusable = Array.from(
      drawer.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || imageBusy) return;
    const data = new FormData(event.currentTarget);
    const groupErrors = optionGroupLimitErrors(data, catalog.optionGroups);
    setOptionGroupErrors(groupErrors);
    const firstInvalidGroup = Object.keys(groupErrors)[0];
    if (firstInvalidGroup) {
      setActiveTab("options");
      event.currentTarget
        .querySelector<HTMLInputElement>(`[name="min-${firstInvalidGroup}"]`)
        ?.focus();
      return;
    }
    const changedBasePrices: Array<{ groupId: string; optionId: string; priceAmount: number }> = [];
    for (const group of catalog.optionGroups) {
      for (const option of group.options) {
        const rawPrice = value(data, `base-${group.id}-${option.id}`);
        const nextPrice = Number(rawPrice);
        if (!/^\d+$/.test(rawPrice) || !Number.isInteger(nextPrice) || nextPrice > 2_147_483_647) {
          setActiveTab("options");
          const errorKey = `${group.id}-${option.id}`;
          setBasePriceErrors((current) => ({
            ...current,
            [errorKey]: "قیمت باید عدد صحیحی بین صفر و 2٬147٬483٬647 تومان باشد.",
          }));
          event.currentTarget
            .querySelector<HTMLInputElement>(`[name="base-${group.id}-${option.id}"]`)
            ?.focus();
          return;
        }
        if (nextPrice !== option.priceAmount) {
          changedBasePrices.push({ groupId: group.id, optionId: option.id, priceAmount: nextPrice });
        }
      }
    }
    setBasePriceErrors({});
    setBusy(true);
    const optionGroups = catalog.optionGroups
      .filter((group: any) => data.getAll("optionGroupIds").includes(group.id))
      .map((group: any, displayOrder: number) => ({
        optionGroupId: group.id,
        displayOrder,
        minSelections: numeric(data, `min-${group.id}`),
        maxSelections: numeric(data, `max-${group.id}`),
        options: group.options
          .filter((option: any) => data.getAll(`optionIds-${group.id}`).includes(option.id))
          .map((option: any, optionOrder: number) => ({
            optionId: option.id,
            displayOrder: optionOrder,
            priceAmountOverride: value(data, `override-${group.id}-${option.id}`) || null,
          })),
      }));
    const newGroupName = value(data, "newOptionGroupName");
    const newOptionName = value(data, "newOptionName");
    const newOptionPrice = value(data, "newOptionPrice");
    if (newGroupName || newOptionName || newOptionPrice) {
      const min = Number(data.get("newOptionMin"));
      const max = Number(data.get("newOptionMax"));
      const parsedPrice = Number(newOptionPrice);
      if (!newGroupName || !newOptionName || newOptionPrice === "" || !/^\d+$/.test(newOptionPrice) || !Number.isInteger(parsedPrice) || parsedPrice > 2_147_483_647) {
        setSaveError("نام گروه، نام گزینه و قیمت صحیح را برای گروه تازه وارد کنید.");
        setBusy(false);
        return;
      }
      if (newGroupName.length > 120 || newOptionName.length > 120) {
        setSaveError("نام گروه و نام گزینه حداکثر می‌تواند 120 نویسه باشد.");
        setBusy(false);
        return;
      }
      if (!Number.isInteger(min) || min < 0 || max !== 1 || min > max) {
        setSaveError("حداقل و حداکثر انتخاب را به‌درستی وارد کنید. گروه تازه فقط یک گزینه دارد.");
        setBusy(false);
        return;
      }
      if (pendingOptionCreation && (
        pendingOptionCreation.groupName !== newGroupName ||
        pendingOptionCreation.optionName !== newOptionName ||
        pendingOptionCreation.priceAmount !== parsedPrice
      )) {
        setSaveError("ساخت این گروه شروع شده است. نام‌ها و قیمت را به مقدار قبلی برگردانید و دوباره ذخیره کنید.");
        setBusy(false);
        return;
      }
    } else if (pendingOptionCreation) {
      setSaveError("ساخت گزینه کامل نشده است. اطلاعات گروه و گزینه را کامل کنید و دوباره ذخیره کنید.");
      setBusy(false);
      return;
    }
    setSaveError("");
    setSaveMessage("");
    void mutate(
      async () => {
        for (const change of changedBasePrices) {
          const result = await saveOption(change.groupId, change.optionId, { priceAmount: change.priceAmount });
          if (!result.ok) return result;
        }
        if (newGroupName && newOptionName && newOptionPrice !== "") {
          let pending = pendingOptionCreation;
          if (!pending) {
            const groupResult = await saveOptionGroup(null, { name: newGroupName, isActive: true });
            if (!groupResult.ok) return groupResult;
            pending = {
              groupId: groupResult.data.data.id,
              optionId: null,
              groupName: newGroupName,
              optionName: newOptionName,
              priceAmount: Number(newOptionPrice),
            };
            setPendingOptionCreation(pending);
          }
          if (!pending.optionId) {
            const optionResult = await saveOption(pending.groupId, null, {
              name: newOptionName,
              priceAmount: Number(newOptionPrice),
              displayOrder: 0,
              isActive: true,
            });
            if (!optionResult.ok) return optionResult;
            pending = { ...pending, optionId: optionResult.data.data.id };
            setPendingOptionCreation(pending);
          }
          optionGroups.push({
            optionGroupId: pending.groupId,
            displayOrder: optionGroups.length,
            minSelections: numeric(data, "newOptionMin"),
            maxSelections: numeric(data, "newOptionMax"),
            options: [{ optionId: pending.optionId!, displayOrder: 0, priceAmountOverride: null }],
          });
        }
        return saveProduct(initial?.id ?? null, {
          categoryId: value(data, "categoryId"),
          name: value(data, "name"),
          priceAmount: numeric(data, "priceAmount"),
          pricingMode: value(data, "pricingMode"),
          preparationDeadlineMinutes: numeric(data, "preparationDeadlineMinutes"),
          menuNote: value(data, "menuNote") || null,
          isPublic: data.get("isPublic") === "on",
          isActive: data.get("isActive") === "on",
          isAvailable: data.get("isAvailable") === "on",
          optionGroups,
        });
      },
      reload,
    )
      .then(() => {
        setPendingOptionCreation(null);
        setDirty(false);
        setSaveMessage("تغییرات محصول ذخیره شد.");
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : "محصول ذخیره نشد. دوباره تلاش کنید.");
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="catalog-drawer-backdrop" role="presentation">
      <section
        ref={drawer}
        className="catalog-product-drawer product-editor"
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header>
          <div><h2 id={titleId}>{initial ? "ویرایش محصول" : "افزودن محصول"}</h2><p>مشخصات، گزینه‌ها، تخفیف و تصویر محصول را ویرایش کنید.</p></div>
          <button type="button" onClick={closeSafely} disabled={busy || imageBusy} aria-label="بستن و بازگشت">
            بستن <CloseIcon />
          </button>
        </header>
        <div className="catalog-product-drawer__content">
        <div className="product-editor__summary">
          <div className="product-editor__identity">
            {initial?.image && !summaryImageFailed ? <img onError={() => setSummaryImageFailed(true)} src={`/pos/api/v1/product-images/${encodeURIComponent(initial.image.storageKey)}`} alt="" /> : <span className="product-editor__placeholder"><OrdersIcon /></span>}
            <div><strong>{productName || "محصول جدید"}</strong><small>{catalog.categories.find((item: any) => item.id === selectedCategory)?.name}</small></div>
          </div>
          <div><small>قیمت پایه</small><strong>{formatToman(priceAmount)} <span>تومان</span></strong></div>
          <div><small>دسته</small><strong>{catalog.categories.find((item: any) => item.id === selectedCategory)?.name}</strong></div>
        </div>
        <div className="product-editor__tabs" role="tablist" aria-label="بخش‌های ویرایش محصول">
          {tabs.map((tab, index) => <button type="button" role="tab" id={`product-tab-${tab.id}`} aria-controls={`product-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} key={tab.id} onClick={() => setActiveTab(tab.id)} onKeyDown={(event) => {
            const next = event.key === "ArrowLeft" ? (index + 1) % tabs.length : event.key === "ArrowRight" ? (index + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); setActiveTab(tabs[next]!.id); document.getElementById(`product-tab-${tabs[next]!.id}`)?.focus();
          }}><ProductEditorIcon kind={tab.id} />{tab.label}</button>)}
        </div>
        <form id="catalog-product-form" className="manager-form" onSubmit={submit} onInvalidCapture={(event) => {
          const target = event.target as HTMLElement;
          setActiveTab(target.closest("[data-editor-panel]")?.getAttribute("data-editor-panel") ?? "details");
          requestAnimationFrame(() => target.focus());
        }} onChange={(event) => {
          setDirty(true);
          setSaveMessage("");
          setSaveError("");
          const fieldName = event.target instanceof HTMLInputElement ? event.target.name : "";
          if (/^(optionGroupIds|min-|max-|optionIds-)/.test(fieldName)) setOptionGroupErrors({});
          if (fieldName.startsWith("base-")) setBasePriceErrors({});
        }}>
          <fieldset className="catalog-edit-fields" disabled={busy || imageBusy}>
          <section data-editor-panel="details" id="product-panel-details" role="tabpanel" aria-labelledby="product-tab-details" hidden={activeTab !== "details"} className="product-editor__panel">
          <h3>اطلاعات اصلی</h3><p className="product-editor__guidance">اطلاعات پایه و وضعیت نمایش محصول را تنظیم کنید.</p>
          <div className="manager-fields">
            <label>
              <span>نام</span>
                <input ref={nameInput} name="name" required value={productName} onChange={(event) => setProductName(event.currentTarget.value)} />
            </label>
            <label>
              <span>دسته</span>
              <select name="categoryId" value={selectedCategory} onChange={(event) => setSelectedCategory(event.currentTarget.value)}>
                {catalog.categories.filter((item: any) => item.kind === "SOURCE").map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>روش قیمت‌گذاری</span>
              <select name="pricingMode" value={pricingMode} onChange={(event) => { setPricingMode(event.target.value); setDirty(true); setSaveMessage(""); }}>
                <option value="FIXED">قیمت هر واحد</option>
                <option value="WEIGHTED_PER_KG">قیمت بر اساس وزن (هر کیلو)</option>
              </select>
            </label>
            <label>
              <span>{pricingMode === "WEIGHTED_PER_KG" ? "قیمت هر کیلو (تومان)" : "قیمت هر واحد (تومان)"}</span>
              <input
                name="priceAmount"
                type="number"
                min="0"
                required
                value={priceAmount}
                onChange={(event) => { setPriceAmount(Number(event.target.value)); setDirty(true); setSaveMessage(""); }}
              />
              <small className="catalog-price-summary">قیمت ثبت‌شده: {formatToman(priceAmount)} تومان{pricingMode === "WEIGHTED_PER_KG" ? " به‌ازای هر کیلو" : " برای هر واحد"}</small>
            </label>
            <label>
              <span>آماده‌سازی (دقیقه)</span>
              <input
                name="preparationDeadlineMinutes"
                type="number"
                min="1"
                required
                defaultValue={initial?.preparationDeadlineMinutes ?? 1}
              />
            </label>
            <div className="product-editor__states">
            <label className="catalog-product-state">
              <input
                name="isPublic"
                type="checkbox"
                defaultChecked={initial?.isPublic ?? true}
              />
              <span><strong>نمایش در منوی عمومی</strong><small>اگر خاموش باشد، مشتریان آن را در منو نمی‌بینند؛ محصول در صندوق برای سفارش‌گیری باقی می‌ماند.</small></span>
            </label>
            <label className="catalog-product-state">
              <input name="isActive" type="checkbox" defaultChecked={initial?.isActive ?? true} />
              <span><strong>فعال در سفارش‌گیری</strong><small>اگر خاموش باشد، محصول در صندوق سفارش‌پذیر نیست و در منوی عمومی هم نمایش داده نمی‌شود.</small></span>
            </label>
            <label className="catalog-product-state">
              <input
                name="isAvailable"
                type="checkbox"
                defaultChecked={initial?.isAvailable ?? true}
              />
              <span><strong>موجود برای سفارش در منوی عمومی</strong><small>اگر خاموش باشد، محصول در منو با وضعیت ناموجود نمایش داده می‌شود؛ ثبت آن در صندوق همچنان ممکن است.</small></span>
            </label>
            </div>
            <label className="catalog-menu-note">
              <span>توضیحات محصول در منو</span>
              <textarea
                name="menuNote"
                rows={4}
                maxLength={1000}
                value={menuNote}
                onChange={(event) => { setMenuNote(event.currentTarget.value); setDirty(true); setSaveMessage(""); setSaveError(""); }}
                placeholder="توضیحی که مشتری در جزئیات محصول می‌بیند"
                aria-describedby="catalog-menu-note-help"
              />
              <small id="catalog-menu-note-help">این توضیح در پنجره‌ی جزئیات محصول، زیر گزینه‌ها نمایش داده می‌شود. حداکثر 1000 نویسه.</small>
              {menuNote && <button type="button" className="secondary-button" onClick={() => { setMenuNote(""); setDirty(true); setSaveMessage(""); setSaveError(""); }}>حذف توضیحات منو</button>}
            </label>
          </div>
          </section>
          <section data-editor-panel="options" id="product-panel-options" role="tabpanel" aria-labelledby="product-tab-options" hidden={activeTab !== "options"} className="product-editor__panel product-editor__options">
          <fieldset aria-describedby="catalog-option-groups-help">
            <legend>گزینه‌های محصول</legend>
            <p id="catalog-option-groups-help" className="catalog-option-groups-help">
              برای افزودن یک گروه به محصول، کادر کنار نام گروه را انتخاب کنید. «قیمت پایه» در همه محصولاتی که از گزینه استفاده می‌کنند به کار می‌رود؛ «قیمت این محصول» اختیاری است و فقط برای همین محصول جایگزین آن می‌شود.
            </p>
            {catalog.optionGroups.map((group: any) => {
              const configured = initial?.optionGroups?.find(
                (item: any) => item.optionGroupId === group.id,
              );
              return (
                <ProductOptionGroupFields
                  key={group.id}
                  group={group}
                  configured={configured}
                  error={optionGroupErrors[group.id]}
                  basePriceErrors={basePriceErrors}
                />
              );
            })}
            <details className="catalog-new-option-group">
              <summary>ساخت گروه گزینه برای همین محصول</summary>
              <p>گروه و گزینهٔ نخست هم‌زمان ساخته و به این محصول متصل می‌شوند.</p>
              <label>نام گروه <input name="newOptionGroupName" maxLength={120} readOnly={Boolean(pendingOptionCreation)} /></label>
              <label>نام گزینه <input name="newOptionName" maxLength={120} readOnly={Boolean(pendingOptionCreation)} /></label>
              <label>قیمت گزینه (تومان) <input name="newOptionPrice" type="number" min="0" max="2147483647" step="1" readOnly={Boolean(pendingOptionCreation)} /></label>
              <label>حداقل انتخاب <input name="newOptionMin" type="number" min="0" step="1" defaultValue="1" /></label>
              <label>حداکثر انتخاب <input name="newOptionMax" type="number" min="1" max="1" step="1" defaultValue="1" /></label>
            </details>
          </fieldset>
          </section>
          </fieldset>
          {saveError && <p className="catalog-product-message catalog-product-message--error" role="alert">{saveError}</p>}
          {saveMessage && <p className="catalog-product-message" role="status" aria-live="polite">{saveMessage}</p>}
        </form>
        {initial && (
          <section className="catalog-product-secondary" aria-label="اقدامات جانبی محصول">
          <section id="product-panel-discount" role="tabpanel" aria-labelledby="product-tab-discount" hidden={activeTab !== "discount"} className="catalog-sale-discount product-editor__panel">
            <h3 id="catalog-sale-discount-title">تخفیف منوی عمومی</h3>
            <p>قیمت پایه‌ی محصول تغییر نمی‌کند. تخفیف برای سفارش‌های تازه اعمال می‌شود.</p>
            <div className="manager-fields">
              <label>
                <span>نوع تخفیف</span>
                <select value={saleDiscountMode} onChange={(event) => {
                  const nextMode = event.currentTarget.value as "PRICE" | "PERCENTAGE";
                  const nextValue = saleDiscountMode === "PRICE"
                    ? String(calculatedDiscountPercentage)
                    : String(resultingSalePrice);
                  setSaleDiscountMode(nextMode);
                  setSaleDiscountValue(nextValue);
                  setSaleDiscountError("");
                }} disabled={saleDiscountBusy}>
                  <option value="PRICE">واردکردن قیمت نهایی</option>
                  <option value="PERCENTAGE">درصد</option>
                </select>
              </label>
              <label>
                <span>{saleDiscountMode === "PERCENTAGE" ? "درصد تخفیف" : "قیمت نهایی پس از تخفیف (تومان)"}</span>
                <input type="number" min={saleDiscountMode === "PERCENTAGE" ? "1" : "0"} max={saleDiscountMode === "PERCENTAGE" ? "100" : priceAmount} step="1" value={saleDiscountValue} onChange={(event) => setSaleDiscountValue(event.currentTarget.value)} disabled={saleDiscountBusy} />
              </label>
            </div>
            <p className="catalog-price-summary">قیمت پایه: {formatToman(priceAmount)} تومان · قیمت نهایی: {formatToman(resultingSalePrice)} تومان · تخفیف منو: {formatToman(calculatedDiscountPercentage)}٪</p>
            {saleDiscountError && <p className="catalog-product-message catalog-product-message--error" role="alert">{saleDiscountError}</p>}
            {saleDiscountMessage && <p className="catalog-product-message" role="status">{saleDiscountMessage}</p>}
            <div className="catalog-sale-discount__actions">
              <button type="button" disabled={saleDiscountBusy || !saleDiscountValue} onClick={() => void saveSaleDiscount(false)}>{saleDiscountBusy ? "در حال ذخیره…" : "ذخیره تخفیف"}</button>
              <button type="button" className="secondary-button" disabled={saleDiscountBusy || initial.saleDiscountValue == null} onClick={() => void saveSaleDiscount(true)}>حذف تخفیف</button>
            </div>
          </section>
          <section id="product-panel-image" role="tabpanel" aria-labelledby="product-tab-image" hidden={activeTab !== "image"} className="product-editor__panel">
          <ImageEditor
            product={initial}
            productBusy={busy}
            onBusyChange={setImageBusy}
            mutate={mutate}
            reload={reload}
            requestConfirm={requestConfirm}
          />
          </section>
          </section>
        )}
        {!initial && (activeTab === "image" || activeTab === "discount") && <section id={`product-panel-${activeTab}`} role="tabpanel" aria-labelledby={`product-tab-${activeTab}`} className="product-editor__panel"><h3>{activeTab === "image" ? "تصویر محصول" : "تخفیف منوی عمومی"}</h3><p>ابتدا مشخصات محصول را ذخیره کنید؛ سپس می‌توانید {activeTab === "image" ? "تصویر را بارگذاری" : "تخفیف را تنظیم"} کنید.</p></section>}
        </div>
        <footer className="catalog-product-drawer__footer">
          <button type="submit" form="catalog-product-form" disabled={busy || imageBusy}>{busy ? "در حال ذخیره مشخصات…" : imageBusy ? "در حال بارگذاری تصویر…" : "ذخیره مشخصات محصول"}</button>
          <button type="button" className="secondary-button" onClick={closeSafely} disabled={busy || imageBusy}>انصراف</button>
        </footer>
      </section>
    </div>
  );
}

function ImageEditor({ product, productBusy, onBusyChange, mutate, reload, requestConfirm }: any) {
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const [imageLoadFailed, setImageLoadFailed] = useState(false);
  const [hasImage, setHasImage] = useState(Boolean(product.image));
  const visibleImage =
    uploadedPreview ??
    (product.image
      ? `/pos/api/v1/product-images/${encodeURIComponent(product.image.storageKey)}`
      : null);
  return (
    <form
      className="manager-form catalog-image-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const file =
          selectedFile ??
          (event.currentTarget.elements.namedItem("image") as HTMLInputElement).files?.[0];
        if (!file || busy) return;
        setBusy(true);
        onBusyChange(true);
        setUploadError("");
        setUploadMessage("");
        setProgress(0);
        void uploadProductImage(product.id, file, setProgress)
          .then(async (result) => {
            await mutate(() => Promise.resolve(result), reload);
            if (!result.ok) return;

            setHasImage(true);
            setImageLoadFailed(false);
            setUploadedPreview(
              typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null,
            );
            setSelectedFile(null);
            let menuImageResponse: Response;
            let menuImage: Blob;
            try {
              menuImageResponse = await fetch(
                `/pos/api/v1/product-images/${encodeURIComponent(result.data.data.storageKey)}`,
                { cache: "no-store" },
              );
              menuImage = await menuImageResponse.blob();
            } catch {
              throw new Error("تصویر در صندوق بارگذاری شد، اما دریافت آن از منوی عمومی ممکن نشد.");
            }
            if (!menuImageResponse.ok || !menuImage.size || !menuImage.type.startsWith("image/")) {
              throw new Error("تصویر در صندوق بارگذاری شد، اما دریافت آن از منوی عمومی تأیید نشد.");
            }
            setUploadMessage("تصویر بارگذاری شد و نمایش آن در منوی عمومی تأیید شد.");
          })
          .catch((error: unknown) => {
            setUploadError(error instanceof Error ? error.message : "تصویر بارگذاری نشد. دوباره تلاش کنید.");
          })
          .finally(() => {
            setBusy(false);
            onBusyChange(false);
            setProgress(null);
          });
      }}
    >
      <div className="product-editor__image-heading"><h3><ProductEditorIcon kind="image" /> مدیریت تصویر محصول</h3><p>تصویر محصول را انتخاب و بارگذاری کنید.</p><small>فرمت‌های مجاز: JPG، PNG و WebP · حداکثر حجم: ۵ مگابایت</small></div>
      <div className="product-editor__image-layout">
      <div className="product-editor__upload-controls">
      <label className="product-editor__upload">
        <ProductEditorIcon kind="image" /><strong>انتخاب تصویر جدید</strong><span>برای انتخاب فایل کلیک کنید</span>
        تصویر JPEG/PNG/WebP{" "}
        <input
          name="image"
          aria-label="تصویر JPEG/PNG/WebP"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required={!hasImage}
          disabled={busy || productBusy}
          onChange={(event) => setSelectedFile(event.currentTarget.files?.[0] ?? null)}
        />
      </label>
      {selectedFile && (
        <small className="catalog-image-editor__selection">
          آماده برای بارگذاری: {selectedFile.name}
        </small>
      )}
      <button disabled={busy || productBusy}>
        {busy ? "در حال بارگذاری تصویر…" : hasImage ? "جایگزینی تصویر" : "بارگذاری تصویر"}
      </button>
      {busy && (
        <div
          className="image-upload-progress catalog-image-editor__progress"
          role="status"
          aria-live="polite"
        >
          <div className="image-upload-progress__label">
            <span>در حال ارسال تصویر؛ لطفاً این پنجره را نبندید.</span>
            <span>{progress === null ? "در حال آماده‌سازی…" : `${progress}٪`}</span>
          </div>
          <progress aria-label="پیشرفت بارگذاری تصویر" max={100} value={progress ?? undefined}>
            {progress ?? 0}%
          </progress>
        </div>
      )}
      {uploadError && <p className="catalog-product-message catalog-product-message--error" role="alert">{uploadError}</p>}
      {uploadMessage && <p className="catalog-product-message" role="status" aria-live="polite">{uploadMessage}</p>}
      </div>
      <div className="product-editor__image-preview">
      {visibleImage && !imageLoadFailed && (
        <img onError={() => setImageLoadFailed(true)} className="catalog-image-editor__preview" src={visibleImage} alt={product.name} />
      )}
      {(!visibleImage || imageLoadFailed) && <div className="product-editor__no-image"><ProductEditorIcon kind="image" /><span>{imageLoadFailed ? "دریافت تصویر ممکن نشد." : "هنوز تصویری بارگذاری نشده است."}</span></div>}
      <small>تصویر فعلی محصول</small>
      <div className="product-editor__image-actions">
      {hasImage && (
        <button
          type="button"
          className="catalog-archive"
          disabled={busy || productBusy}
          onClick={() =>
            requestConfirm({
              title: "حذف تصویر",
              detail: "تصویر فعلی حذف می‌شود؛ پس از آن می‌توانید تصویر دیگری بارگذاری کنید.",
              run: async () => {
                await mutate(() => archiveProductImage(product.id), reload);
                setHasImage(false);
                setUploadedPreview(null);
              },
            })
          }
        >
          حذف تصویر فعلی
        </button>
      )}
      </div>
      </div>
      </div>
      <div className="product-editor__archive-action">
      <button
        type="button"
        className="catalog-archive"
        disabled={busy || productBusy}
        onClick={() =>
          requestConfirm({
            title: "بایگانی محصول",
            detail: `محصول «${product.name}» از فهرست فعال خارج می‌شود؛ سابقه‌ی سفارش‌ها حفظ خواهد شد.`,
            run: () => mutate(() => archiveProduct(product.id), reload),
          })
        }
      >
        بایگانی محصول
      </button>
      </div>
    </form>
  );
}
