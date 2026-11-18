"use client";

import type { PosCatalogProduct } from "@cafe/contracts";
import { BagIcon, CloseIcon } from "./icons";

export type PackagingCatalogProduct = PosCatalogProduct & { categoryName: string };

export type PackagingItemReference =
  | { kind: "EXISTING"; orderItemId: string }
  | { kind: "REQUEST"; clientRef: string };

export type PackagingAssignmentDraft = {
  packagingItem: PackagingItemReference;
  productItem: PackagingItemReference;
  quantity: number;
};

export type PackagingWorkspaceLine = {
  key: string;
  reference: PackagingItemReference;
  productName: string;
  optionsLabel: string;
  quantity: number;
  locked: boolean;
  existingAssignments: Array<{ packagingName: string; quantity: number }>;
};

export type PackagingWorkspaceSession = {
  product: PackagingCatalogProduct;
  options: PosCatalogProduct["optionGroups"][number]["options"];
  weightGrams: number | null;
  packagingItem: PackagingItemReference;
  quantity: number;
  editingExisting: boolean;
  packagingLocked: boolean;
};

export function packagingReferenceKey(reference: PackagingItemReference): string {
  return reference.kind === "EXISTING" ? `existing:${reference.orderItemId}` : `request:${reference.clientRef}`;
}

export function PackagingWorkspace({
  session,
  lines,
  selectedQuantities,
  onAssignmentQuantityChange,
  onCancel,
  onConfirm,
}: {
  session: PackagingWorkspaceSession;
  lines: PackagingWorkspaceLine[];
  selectedQuantities: Record<string, number>;
  onAssignmentQuantityChange: (referenceKey: string, quantity: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const canConfirm = !session.packagingLocked;

  return (
    <section className="packaging-workspace" aria-labelledby="packaging-workspace-title">
      <header className="packaging-workspace__header">
        <div className="packaging-workspace__heading">
          <span className="packaging-workspace__icon" aria-hidden="true"><BagIcon /></span>
          <div>
            <h2 id="packaging-workspace-title">اختصاص بسته‌بندی</h2>
            <p>تعیین کنید این بسته‌بندی برای کدام کالاهای سفارش استفاده می‌شود.</p>
          </div>
        </div>
        <button type="button" className="button button--quiet packaging-workspace__back" onClick={onCancel}>
          <CloseIcon />
          بازگشت
        </button>
      </header>

      <div className="packaging-workspace__list-heading">
        <div><h3>کالاهای سفارش</h3><p>تعداد هر کالا را برای این نوع بسته‌بندی مشخص کنید.</p></div>
        <span>{lines.length} کالا</span>
      </div>

      <div className="packaging-workspace__items" role="group" aria-label="انتخاب کالاهای بسته‌بندی">
        {lines.map((line) => {
          const quantity = selectedQuantities[line.key] ?? 0;
          const selected = quantity > 0;
          const disabled = session.packagingLocked || line.locked;
          return (
            <article className={`packaging-item${selected ? " is-selected" : ""}${disabled ? " is-locked" : ""}`} key={line.key}>
              <label className="packaging-item__select">
                <input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onAssignmentQuantityChange(line.key, event.currentTarget.checked ? line.quantity : 0)} />
                <span className="packaging-item__text">
                  <strong>{line.productName}</strong>
                  {line.optionsLabel && <small>{line.optionsLabel}</small>}
                  {line.existingAssignments.length > 0 && <span className="packaging-item__existing">بسته‌بندی ثبت‌شده: {line.existingAssignments.map((assignment) => `${assignment.packagingName} × ${assignment.quantity}`).join("، ")}</span>}
                </span>
              </label>
              <div className="packaging-item__quantity">
                <span>تعداد این بسته</span>
                <div className="quantity" dir="ltr">
                  <button type="button" aria-label={`کم کردن تعداد ${line.productName} در بسته‌بندی`} disabled={disabled || quantity <= 0} onClick={() => onAssignmentQuantityChange(line.key, Math.max(0, quantity - 1))}>−</button>
                  <input aria-label={`تعداد ${line.productName} در این بسته‌بندی`} type="number" min={0} max={line.quantity} value={quantity} disabled={disabled} onChange={(event) => onAssignmentQuantityChange(line.key, Math.max(0, Math.min(line.quantity, Number(event.currentTarget.value) || 0)))} />
                  <button type="button" aria-label={`زیاد کردن تعداد ${line.productName} در بسته‌بندی`} disabled={disabled || quantity >= line.quantity} onClick={() => onAssignmentQuantityChange(line.key, Math.min(line.quantity, quantity + 1))}>+</button>
                </div>
              </div>
            </article>
          );
        })}
        {lines.length === 0 && <div className="packaging-workspace__empty">ابتدا کالاهای سفارش را از شبکه‌ی محصولات اضافه کنید.</div>}
      </div>

      <footer className="packaging-workspace__footer">
        <div>
          <button type="button" className="button button--quiet" onClick={onCancel}>انصراف</button>
          <button type="button" className="button button--primary" disabled={!canConfirm} onClick={onConfirm}>ثبت بسته‌بندی</button>
        </div>
      </footer>
    </section>
  );
}
