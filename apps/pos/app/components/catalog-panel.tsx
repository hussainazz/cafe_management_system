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
    <details>
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
          قیمت خالی از قیمت اصلی گزینه استفاده می‌کند؛ برای قیمت متفاوت در این محصول، مبلغ را وارد کنید.
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
      errors[group.id] = "حداقل انتخاب باید عدد صحیح صفر یا بیشتر باشد.";
    } else if (maxValue === null || !Number.isInteger(max) || max < 1) {
      errors[group.id] = "حداکثر انتخاب باید عدد صحیح ۱ یا بیشتر باشد.";
    } else if (min > max) {
      errors[group.id] = "حداقل انتخاب نمی‌تواند بیشتر از حداکثر انتخاب باشد.";
    } else if (min > data.getAll(`optionIds-${group.id}`).length) {
      errors[group.id] = "حداقل انتخاب نمی‌تواند از تعداد گزینه‌های مجاز بیشتر باشد.";
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

function SortableCategory({ row, index, selected, onSelect, mutate, reload, requestConfirm }: any) {
  const sortable = useSortable({ id: row.id });
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
        <DragHandle attributes={sortable.attributes} listeners={sortable.listeners} />
        <button type="button" className="catalog-category-select" onClick={onSelect}>
          <strong>{row.name}</strong>
          <small>{row.kind === "PROMOTIONAL" ? "تبلیغاتی" : "اصلی"} · {row.isActive ? "فعال" : "غیرفعال"}</small>
        </button>
        <span className="catalog-order">#{index + 1}</span>
      </li>
      {selected && (
        <li className="catalog-category-editor-item">
          <CategoryEditor row={row} mutate={mutate} reload={reload} requestConfirm={requestConfirm} />
        </li>
      )}
    </>
  );
}

function SortableProduct({ row, categoryName, index, onEdit, disabled }: any) {
  const sortable = useSortable({ id: row.id, disabled: Boolean(disabled) });
  return (
    <article
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={`catalog-product-card ${sortable.isDragging ? "is-dragging" : ""}`}
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
        <b>{formatToman(row.priceAmount)}</b>
        <small>
          {row.pricingMode === "WEIGHTED_PER_KG" ? "قیمت هر کیلو" : "قیمت هر واحد"} ·{" "}
          {row.isAvailable ? "موجود" : "ناموجود"} · {row.isActive ? "فعال" : "غیرفعال"}
        </small>
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
          <p>دسته را انتخاب یا با دستگیره مرتب کنید.</p>
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
                    index={index}
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
          <div className="catalog-empty">هنوز دسته‌ای ساخته نشده است.</div>
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
              <option value="PROMOTIONAL">دسته تبلیغاتی</option>
            </select>
            <small>دستهٔ اصلی مالک محصول است؛ دستهٔ تبلیغاتی همان محصول را بدون تغییر مبدأ نمایش می‌دهد.</small>
          </label>
          <button type="submit">ایجاد دسته</button>
        </form>
      </aside>
      <main className="catalog-products">
        <header className="catalog-products__header">
          <div>
            <h2>محصولات</h2>
            <p>محصولات دسته انتخاب‌شده را مدیریت و مرتب کنید.</p>
          </div>
          {selected && <span className="catalog-selected-category">دسته: {selected.name}</span>}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجوی محصول…"
            aria-label="جستجوی محصول"
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
                  هیچ محصولی در این دسته وجود ندارد.
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

function CategoryEditor({ row, mutate, reload, requestConfirm }: any) {
  return (
    <form
      className="catalog-category-editor"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void mutate(
          () =>
            saveCategory(row.id, {
              name: value(data, "name"),
              isActive: data.get("isActive") === "on",
              isPosVisible: data.get("isPosVisible") === "on",
            }),
          reload,
        );
      }}
    >
      <strong>ویرایش دسته انتخاب‌شده</strong>
      <span>{row.kind === "PROMOTIONAL" ? "دسته تبلیغاتی؛ محصولات از دسته‌های اصلی نمایش داده می‌شوند." : "دسته اصلی؛ محصولات به این دسته تعلق دارند."}</span>
      <input name="name" defaultValue={row.name} aria-label="نام دسته انتخاب‌شده" required />
      <label>
        <input name="isActive" type="checkbox" defaultChecked={row.isActive} /> نمایش در منوی عمومی
      </label>
      {row.kind === "SOURCE" && <label>
        <input name="isPosVisible" type="checkbox" defaultChecked={row.isPosVisible} /> نمایش در
        سفارش‌گیری POS
      </label>}
      <button>ذخیره تغییرات</button>
      {row.kind === "SOURCE" && (
        <button
          type="button"
          className="catalog-archive"
          onClick={() =>
            requestConfirm({
              title: "بایگانی دسته",
              detail: `«${row.name}» از فروش فعال خارج می‌شود و سابقه آن حفظ خواهد شد.`,
              run: () => mutate(() => archiveCategory(row.id), reload),
            })
          }
        >
          بایگانی دسته
        </button>
      )}
    </form>
  );
}


function PromotionalProductPicker({ category, catalog, close, mutate, reload }: any) {
  const [selectedIds, setSelectedIds] = useState<string[]>(category.productIds);
  const [query, setQuery] = useState("");
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
    if (changed && !window.confirm("تغییرات ذخیره‌نشده دور ریخته شوند؟")) return;
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
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
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
              محصولات انتخاب‌شده با دستهٔ اصلی خود باقی می‌مانند و در این دسته نیز نمایش داده می‌شوند.
            </p>
          </div>
          <button type="button" onClick={closeSafely} disabled={saving}>بستن</button>
        </header>
        <div className="catalog-promo-controls">
          <label>
            جستجوی محصول یا دسته
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="نام محصول یا دسته را بنویسید"
            />
          </label>
          <p>
            فقط محصولات فعال و عمومیِ دسته‌های اصلی، به‌جز بسته‌بندی، قابل انتخاب‌اند.
            محصولات غیرعمومی و بسته‌بندی در این فهرست نمی‌آیند.
          </p>
        </div>
        <div className="catalog-promo-sources">
          {sources.map((source: any) => {
            const sourceProducts = eligibleProducts.filter((product: any) => product.categoryId === source.id);
            const visibleProducts = sourceProducts.filter((product: any) =>
              !search || source.name.toLocaleLowerCase().includes(search) || product.name.toLocaleLowerCase().includes(search),
            );
            if (search && visibleProducts.length === 0) return null;
            return (
              <details className="catalog-promo-source" key={source.id} open={Boolean(search)}>
                <summary>
                  <span>{source.name}</span>
                  <small>{sourceProducts.length} محصول</small>
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
                  )) : <p className="catalog-promo-empty">محصول فعالی برای پیشنهاد وجود ندارد.</p>}
                </fieldset>
              </details>
            );
          })}
          {search && !sources.some((source: any) =>
            eligibleProducts.some((product: any) => product.categoryId === source.id &&
              (source.name.toLocaleLowerCase().includes(search) || product.name.toLocaleLowerCase().includes(search))),
          ) && <p className="catalog-promo-empty">محصول یا دسته‌ای با این نام پیدا نشد.</p>}
          {excludedSelections.length > 0 && (
            <section className="catalog-promo-excluded" aria-label="محصولات فعلی غیرقابل پیشنهاد">
              <h3>محصولات متصلِ غیرقابل پیشنهاد</h3>
              <p>این محصولات دیگر عمومی نیستند یا بسته‌بندی‌اند. برای نگه‌داشتن آن‌ها در فهرست تیک را بردارید؛ امکان افزودن دوباره وجود ندارد.</p>
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

function ProductDrawer({
  initial,
  categoryId,
  catalog,
  close,
  mutate,
  reload,
  requestConfirm,
}: any) {
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
    if (busy || imageBusy) return;
    if (pendingOptionCreation && !window.confirm(
      "گروه گزینه ساخته شده اما هنوز به محصول متصل نشده است. با بستن این پنجره امکان ادامهٔ ذخیره از دست می‌رود. می‌بندید؟",
    )) return;
    if (!pendingOptionCreation && dirty && !window.confirm("تغییرات ذخیره‌نشده دور ریخته شوند؟")) return;
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
        ? "درصد تخفیف باید عددی بین ۱ تا ۱۰۰ باشد."
        : "قیمت پس از تخفیف باید بین صفر و قیمت پایه باشد.");
      setSaleDiscountMessage("");
      return;
    }
    if (!remove && priceAmount !== initial.priceAmount) {
      setSaleDiscountError("ابتدا قیمت پایه را ذخیره کنید، سپس تخفیف را ثبت کنید.");
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
      setSaleDiscountError(error instanceof Error ? error.message : "ذخیره تخفیف انجام نشد.");
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
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
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
          const errorKey = `${group.id}-${option.id}`;
          setBasePriceErrors((current) => ({
            ...current,
            [errorKey]: "قیمت باید عدد صحیحی بین صفر و ۲٬۱۴۷٬۴۸۳٬۶۴۷ تومان باشد.",
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
        setSaveError("برای گروه جدید، نام گروه، نام گزینه و قیمت صحیح را کامل کنید.");
        setBusy(false);
        return;
      }
      if (newGroupName.length > 120 || newOptionName.length > 120) {
        setSaveError("نام گروه و گزینه حداکثر ۱۲۰ نویسه است.");
        setBusy(false);
        return;
      }
      if (!Number.isInteger(min) || min < 0 || max !== 1 || min > max) {
        setSaveError("حداقل و حداکثر انتخاب گروه جدید را به‌درستی وارد کنید؛ فقط یک گزینه در گروه تازه وجود دارد.");
        setBusy(false);
        return;
      }
      if (pendingOptionCreation && (
        pendingOptionCreation.groupName !== newGroupName ||
        pendingOptionCreation.optionName !== newOptionName ||
        pendingOptionCreation.priceAmount !== parsedPrice
      )) {
        setSaveError("ساخت این گروه شروع شده است؛ نام‌ها و قیمت را به مقدار قبلی برگردانید و دوباره ذخیره کنید.");
        setBusy(false);
        return;
      }
    } else if (pendingOptionCreation) {
      setSaveError("ساخت گزینه نیمه‌تمام است؛ اطلاعات گروه و گزینه را کامل کنید و دوباره ذخیره کنید.");
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
        setSaveError(error instanceof Error ? error.message : "ذخیره محصول انجام نشد. دوباره تلاش کنید.");
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="catalog-drawer-backdrop" role="presentation">
      <section
        ref={drawer}
        className="catalog-product-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header>
          <h2 id={titleId}>{initial ? "ویرایش محصول" : "افزودن محصول"}</h2>
          <button type="button" onClick={closeSafely} disabled={busy || imageBusy} aria-label="بستن و بازگشت">
            بستن
          </button>
        </header>
        <div className="catalog-product-drawer__content">
        <form id="catalog-product-form" className="manager-form" onSubmit={submit} onChange={(event) => {
          setDirty(true);
          setSaveMessage("");
          setSaveError("");
          const fieldName = event.target instanceof HTMLInputElement ? event.target.name : "";
          if (/^(optionGroupIds|min-|max-|optionIds-)/.test(fieldName)) setOptionGroupErrors({});
          if (fieldName.startsWith("base-")) setBasePriceErrors({});
        }}>
          <strong>مشخصات و فروش</strong>
          <fieldset className="catalog-edit-fields" disabled={busy || imageBusy}>
          <div className="manager-fields">
            <label>
              <span>دسته</span>
              <select name="categoryId" defaultValue={initial?.categoryId ?? categoryId}>
                {catalog.categories.filter((item: any) => item.kind === "SOURCE").map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>نام</span>
                <input ref={nameInput} name="name" required defaultValue={initial?.name ?? ""} />
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
            <label className="catalog-product-state">
              <input name="isActive" type="checkbox" defaultChecked={initial?.isActive ?? true} />
              <span><strong>فعال در سفارش‌گیری</strong><small>در POS و منوی عمومی نمایش داده شود.</small></span>
            </label>
            <label className="catalog-product-state">
              <input
                name="isAvailable"
                type="checkbox"
                defaultChecked={initial?.isAvailable ?? true}
              />
              <span><strong>موجود برای سفارش در منوی عمومی</strong><small>اگر خاموش باشد، محصول در منو با وضعیت ناموجود نمایش داده می‌شود؛ ثبت آن در POS همچنان ممکن است.</small></span>
            </label>
          </div>
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
          </fieldset>
          {saveError && <p className="catalog-product-message catalog-product-message--error" role="alert">{saveError}</p>}
          {saveMessage && <p className="catalog-product-message" role="status" aria-live="polite">{saveMessage}</p>}
        </form>
        {initial && (
          <section className="catalog-product-secondary" aria-label="اقدامات جانبی محصول">
          <section className="catalog-sale-discount" aria-labelledby="catalog-sale-discount-title">
            <h3 id="catalog-sale-discount-title">تخفیف منوی عمومی</h3>
            <p>قیمت پایهٔ محصول حفظ می‌شود و تخفیف روی سفارش‌های جدید اعمال خواهد شد.</p>
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
                <span>{saleDiscountMode === "PERCENTAGE" ? "درصد تخفیف" : "قیمت پس از تخفیف (تومان)"}</span>
                <input type="number" min={saleDiscountMode === "PERCENTAGE" ? "1" : "0"} max={saleDiscountMode === "PERCENTAGE" ? "100" : priceAmount} step="1" value={saleDiscountValue} onChange={(event) => setSaleDiscountValue(event.currentTarget.value)} disabled={saleDiscountBusy} />
              </label>
            </div>
            <p className="catalog-price-summary">قیمت پایه: {formatToman(priceAmount)} تومان · قیمت پس از تخفیف: {formatToman(resultingSalePrice)} تومان · درصد قابل نمایش در منو: {formatToman(calculatedDiscountPercentage)}٪</p>
            {saleDiscountError && <p className="catalog-product-message catalog-product-message--error" role="alert">{saleDiscountError}</p>}
            {saleDiscountMessage && <p className="catalog-product-message" role="status">{saleDiscountMessage}</p>}
            <div className="catalog-sale-discount__actions">
              <button type="button" disabled={saleDiscountBusy || !saleDiscountValue} onClick={() => void saveSaleDiscount(false)}>{saleDiscountBusy ? "در حال ذخیره…" : "ذخیره تخفیف"}</button>
              <button type="button" className="secondary-button" disabled={saleDiscountBusy || initial.saleDiscountValue == null} onClick={() => void saveSaleDiscount(true)}>حذف تخفیف</button>
            </div>
          </section>
          <p>تصویر و بایگانی مستقل از ذخیره مشخصات محصول انجام می‌شوند.</p>
          <ImageEditor
            product={initial}
            productBusy={busy}
            onBusyChange={setImageBusy}
            mutate={mutate}
            reload={reload}
            requestConfirm={requestConfirm}
          />
          </section>
        )}
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
              throw new Error("تصویر در POS بارگذاری شد، اما دریافت آن از سرویس تصاویر منو ممکن نشد.");
            }
            if (!menuImageResponse.ok || !menuImage.size || !menuImage.type.startsWith("image/")) {
              throw new Error("تصویر در POS بارگذاری شد، اما دریافت آن از سرویس تصاویر تأیید نشد.");
            }
            setUploadMessage("تصویر بارگذاری شد و دریافت آن از سرویس تصاویر تأیید شد.");
          })
          .catch((error: unknown) => {
            setUploadError(error instanceof Error ? error.message : "بارگذاری تصویر انجام نشد. دوباره تلاش کنید.");
          })
          .finally(() => {
            setBusy(false);
            onBusyChange(false);
            setProgress(null);
          });
      }}
    >
      <strong>تصویر محصول</strong>
      {visibleImage && (
        <img className="catalog-image-editor__preview" src={visibleImage} alt={product.name} />
      )}
      <label>
        تصویر JPEG/PNG/WebP{" "}
        <input
          name="image"
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
      {hasImage && (
        <button
          type="button"
          className="catalog-archive"
          disabled={busy || productBusy}
          onClick={() =>
            requestConfirm({
              title: "حذف تصویر",
              detail: "تصویر فعلی حذف می‌شود و می‌توانید تصویر تازه‌ای بارگذاری کنید.",
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
      <button
        type="button"
        className="catalog-archive"
        disabled={busy || productBusy}
        onClick={() =>
          requestConfirm({
            title: "بایگانی محصول",
            detail: `«${product.name}» از فروش فعال خارج می‌شود و سابقه سفارش‌ها حفظ می‌گردد.`,
            run: () => mutate(() => archiveProduct(product.id), reload),
          })
        }
      >
        بایگانی محصول
      </button>
    </form>
  );
}
