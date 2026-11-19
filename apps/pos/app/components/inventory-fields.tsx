"use client";

import { useId, useRef, useState } from "react";
import type { ChangeEvent, ComponentPropsWithoutRef, KeyboardEvent } from "react";
import { normalizeDigits } from "../lib/tehran-date";

function normalizeInventorySearch(value: string) {
  return normalizeDigits(value)
    .toLocaleLowerCase("fa")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064b-\u065f\u0670]/g, "")
    .replace(/[\s\u200c]+/g, " ")
    .trim();
}

export function inventorySearchMatches(name: string, query: string) {
  const normalizedName = normalizeInventorySearch(name);
  return normalizeInventorySearch(query)
    .split(" ")
    .every((word) => normalizedName.includes(word));
}

function groupInventoryNumber(value: string) {
  if (!/^\d+(?:\.\d*)?$/.test(value)) return value;
  const [whole, fraction] = value.split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

type InventoryNumberInputProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "inputMode" | "value" | "onChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  integer?: boolean;
};

export function InventoryNumberInput({
  value,
  onValueChange,
  integer = false,
  ...props
}: InventoryNumberInputProps) {
  const display = groupInventoryNumber(value);
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const raw = normalizeDigits(input.value).replace(/٬/g, ",").replace(/٫/g, ".");
    const { inputType, data } = event.nativeEvent as InputEvent;
    const typedDigitOrPoint =
      inputType === "insertText" && /^[\d.٫]$/.test(normalizeDigits(data ?? ""));
    // Editing a digit can shift separators that were already in the field.
    const editingGroupedValue =
      display !== value &&
      (inputType === "deleteContentForward" ||
        inputType === "deleteContentBackward" ||
        typedDigitOrPoint);
    const wellGrouped = /^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(raw);
    const ungroup = wellGrouped || editingGroupedValue;
    const next = (ungroup ? raw.replace(/,/g, "") : raw).trim().replace(/^\.(?=\d)/, "0.");
    const formatted = groupInventoryNumber(next);
    if (formatted !== input.value) {
      const prefix = raw.slice(0, input.selectionStart ?? raw.length);
      let remaining = (ungroup ? prefix.replace(/,/g, "") : prefix).trimStart().length;
      if (raw.trimStart().startsWith(".") && next.startsWith("0.") && remaining > 0) remaining += 1;
      let position = 0;
      while (remaining > 0 && position < formatted.length) {
        if (formatted === next || formatted[position] !== ",") remaining -= 1;
        position += 1;
      }
      if (inputType === "deleteContentForward" && formatted[position] === ",") position += 1;
      input.value = formatted;
      input.setSelectionRange(position, position);
    }
    onValueChange(next);
  };
  return (
    <input
      {...props}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      pattern={integer ? "(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)" : undefined}
      title={integer ? "مبلغ یا تعداد را به‌صورت عدد صحیح وارد کنید." : undefined}
      dir="ltr"
      data-inventory-number
      value={display}
      onChange={change}
    />
  );
}

type PickerOption = { id: string; name: string };

export function InventorySearchPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  required,
  disabled,
}: {
  label: string;
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selectedName = options.find((option) => option.id === value)?.name ?? "";
  const matches =
    query === null
      ? options
      : options.filter((option) => inventorySearchMatches(option.name, query));
  const close = () => {
    inputRef.current?.setCustomValidity("");
    setOpen(false);
    setQuery(null);
    setActiveIndex(-1);
  };
  const choose = (option: PickerOption) => {
    if (option.id !== value) onChange(option.id);
    close();
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        activeIndex === -1 && step === -1
          ? matches.length - 1
          : Math.min(Math.max(activeIndex + step, 0), matches.length - 1);
      setOpen(true);
      setActiveIndex(next);
      requestAnimationFrame(() =>
        listRef.current?.children[next]?.scrollIntoView?.({ block: "nearest" }),
      );
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const option = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
      if (option) choose(option);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };
  return (
    <div className="inventory-picker-field">
      <label htmlFor={`${listId}-input`}>{label}</label>
      <div className="inventory-search-picker">
        <input
          id={`${listId}-input`}
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={
            open && matches[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={query ?? selectedName}
          placeholder={placeholder}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => {
            if (!open) event.currentTarget.select();
            setOpen(true);
          }}
          onBlur={close}
          onChange={(event) => {
            event.stopPropagation();
            if (required && !selectedName)
              event.currentTarget.setCustomValidity("یک مورد از فهرست انتخاب کنید.");
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
        />
        {open && (
          <div className="inventory-search-picker__list">
            <div ref={listRef} id={listId} role="listbox">
              {matches.map((option, index) => (
                <button
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={option.id === value}
                  className={index === activeIndex ? "is-active" : ""}
                  key={option.id}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    inputRef.current?.focus();
                    choose(option);
                  }}
                >
                  {option.name}
                </button>
              ))}
            </div>
            {matches.length === 0 && <p role="status">موردی با این نام پیدا نشد.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
