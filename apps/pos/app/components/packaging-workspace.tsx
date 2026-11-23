"use client";

import type { PosCatalogProduct } from "@cafe/contracts";
import { BagIcon, CloseIcon } from "./icons";

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
  remainingQuantity: number;
  existingAssignments: Array<{ packagingName: string; quantity: number }>;
};

export type PackagingWorkspaceSession = {
  product: PosCatalogProduct | null;
  options: PosCatalogProduct["optionGroups"][number]["options"];
  weightGrams: number | null;
  packagingItem: PackagingItemReference;
  editingExisting: boolean;
  minimumQuantity: number;
};

export function packagingReferenceKey(reference: PackagingItemReference): string {
  return reference.kind === "EXISTING" ? `existing:${reference.orderItemId}` : `request:${reference.clientRef}`;
}

export function PackagingWorkspace({
  session,
  lines,
  selectedQuantities,
  editablePackages,
  onEditPackage,
  onAssignmentQuantityChange,
  onCancel,
  onRemove,
  onConfirm,
}: {
  session: PackagingWorkspaceSession;
  lines: PackagingWorkspaceLine[];
  selectedQuantities: Record<string, number>;
  editablePackages: Array<{ reference: PackagingItemReference; name: string }>;
  onEditPackage: (reference: PackagingItemReference) => void;
  onAssignmentQuantityChange: (referenceKey: string, quantity: number) => void;
  onCancel: () => void;
  onRemove: () => void;
  onConfirm: () => void;
}) {
  const selectedTotal = lines.reduce((total, line) => total + Math.min(line.remainingQuantity, selectedQuantities[line.key] ?? 0), 0);
  const canConfirm = selectedTotal >= Math.max(session.minimumQuantity, session.editingExisting ? 0 : 1);

  return (
    <section className="packaging-workspace" aria-labelledby="packaging-workspace-title">
      <header className="packaging-workspace__header">
        <div className="packaging-workspace__heading">
          <span className="packaging-workspace__icon" aria-hidden="true"><BagIcon /></span>
          <div>
            <h2 id="packaging-workspace-title">{session.editingExisting ? "ویرایش بسته‌بندی" : "اختصاص بسته‌بندی"}</h2>
            <p>برای هر واحد از کالای انتخاب‌شده، یک بسته‌بندی ثبت می‌شود.</p>
          </div>
        </div>
        <button type="button" className="button button--quiet packaging-workspace__back" onClick={onCancel}>
          <CloseIcon />
          بازگشت
        </button>
      </header>

      {editablePackages.length > 1 ? (
        <label className="field">
          <span>بسته‌بندی برای ویرایش</span>
          <select value={packagingReferenceKey(session.packagingItem)} onChange={(event) => {
            const selected = editablePackages.find(({ reference }) => packagingReferenceKey(reference) === event.currentTarget.value);
            if (selected) onEditPackage(selected.reference);
          }}>
            {editablePackages.map(({ reference, name }, index) => (
              <option key={packagingReferenceKey(reference)} value={packagingReferenceKey(reference)}>
                {name} ({(index + 1).toLocaleString("fa-IR")})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="packaging-workspace__list-heading">
        <div><h3>کالاهای سفارش</h3><p>تعداد واحدهایی را که با این نوع بسته‌بندی ثبت می‌شوند انتخاب کنید.</p></div>
        <span>{lines.length} کالا</span>
      </div>

      <div className="packaging-workspace__items" role="group" aria-label="انتخاب کالاهای بسته‌بندی">
        {lines.map((line) => {
          const quantity = selectedQuantities[line.key] ?? 0;
          const selected = quantity > 0;
          const disabled = line.remainingQuantity <= 0;
          return (
            <article className={`packaging-item${selected ? " is-selected" : ""}${disabled ? " is-locked" : ""}`} key={line.key}>
              <label className="packaging-item__select">
                <input type="checkbox" checked={selected} disabled={disabled} onChange={(event) => onAssignmentQuantityChange(line.key, event.currentTarget.checked ? line.remainingQuantity : 0)} />
                <span className="packaging-item__text">
                  <strong>{line.productName}</strong>
                  {line.optionsLabel && <small>{line.optionsLabel}</small>}
                  {line.existingAssignments.length > 0 && <span className="packaging-item__existing">بسته‌بندی ثبت‌شده: {line.existingAssignments.map((assignment) => `${assignment.packagingName} × ${assignment.quantity}`).join("، ")}</span>}
                </span>
              </label>
              <div className="packaging-item__quantity">
                <span>تعداد انتخاب‌شده</span>
                <div className="quantity" dir="ltr">
                  <button type="button" aria-label={`کم کردن تعداد ${line.productName} در بسته‌بندی`} disabled={disabled || quantity <= 0} onClick={() => onAssignmentQuantityChange(line.key, Math.max(0, quantity - 1))}>−</button>
                  <input aria-label={`تعداد ${line.productName} برای بسته‌بندی`} type="number" min={0} max={line.remainingQuantity} value={quantity} disabled={disabled} onChange={(event) => onAssignmentQuantityChange(line.key, Math.max(0, Math.min(line.remainingQuantity, Math.trunc(event.currentTarget.valueAsNumber) || 0)))} />
                  <button type="button" aria-label={`زیاد کردن تعداد ${line.productName} در بسته‌بندی`} disabled={disabled || quantity >= line.remainingQuantity} onClick={() => onAssignmentQuantityChange(line.key, Math.min(line.remainingQuantity, quantity + 1))}>+</button>
                </div>
              </div>
            </article>
          );
        })}
        {lines.length === 0 && <div className="packaging-workspace__empty">ابتدا کالاهای سفارش را از شبکه‌ی محصولات اضافه کنید.</div>}
      </div>

      <footer className="packaging-workspace__footer">
        <div>
          {session.editingExisting && session.minimumQuantity === 0 ? (
            <button type="button" className="button button--quiet" onClick={onRemove}>حذف بسته‌بندی</button>
          ) : null}
          <button type="button" className="button button--quiet" onClick={onCancel}>انصراف</button>
          <button type="button" className="button button--primary" disabled={!canConfirm} onClick={onConfirm}>ثبت بسته‌بندی</button>
        </div>
      </footer>
    </section>
  );
}
