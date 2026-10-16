"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { roundDiscountedAmount, type PosCatalogProduct } from "@cafe/contracts";
import { formatToman, positiveIntegerAmount, sumAmounts, weightedPricePreview } from "../lib/pos-utils";

type Option = PosCatalogProduct["optionGroups"][number]["options"][number];
type Group = PosCatalogProduct["optionGroups"][number];
type Card = { key: string; name: string; products: PosCatalogProduct[] };
type Configuration = { picked: Record<string, string[]>; weight: string };
const shotName = /^(.*)\s(سینگل|دبل)$/;

function availableGroups(product: PosCatalogProduct): Group[] {
  return product.optionGroups.map((group) => ({ ...group, options: group.options.filter((option) => option.isAvailable) }));
}

function defaultConfiguration(product: PosCatalogProduct): Configuration {
  const normalize = (value: string) => value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/ي/g, "ی").replace(/ك/g, "ک");
  return {
    picked: Object.fromEntries(availableGroups(product).flatMap((group) => {
      if (!normalize(group.name).includes("لاین قهوه")) return [];
      const option = group.options.find((item) => /^50\s*[/／]\s*50(?:\s|$)/.test(normalize(item.name).trim()));
      return option ? [[group.id, [option.id]]] : [];
    })),
    weight: "",
  };
}

// Keep at most two short choice rows on a card. Longer or multiple-choice
// groups stay in the popover, independently of the product's name.
function inlineGroupIds(product: PosCatalogProduct): Set<string> {
  return new Set(availableGroups(product)
    .filter((group) => group.maxSelections === 1 && group.options.length > 0 && group.options.length <= 3)
    .slice(0, 2)
    .map((group) => group.id));
}

export function ProductPicker({ card, expanded, onOpen, onClose, onSelectOptions, getQuantity, onDecrease }: {
  card: Card;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
  getQuantity?: (product: PosCatalogProduct, options: Option[], weightGrams?: number) => number;
  onDecrease?: (product: PosCatalogProduct, options: Option[], weightGrams?: number) => void;
  onSelectOptions: (product: PosCatalogProduct, options: Option[], weightGrams?: number) => void;
}) {
  // Cashier defaults requested for coffee: double shot and an available 50/50 line.
  const [productId, setProductId] = useState(() => (card.products.find((product) => product.name.match(shotName)?.[2] === "دبل") ?? card.products[0]!).id);
  const product = card.products.find((item) => item.id === productId) ?? card.products[0]!;
  const [configurations, setConfigurations] = useState<Record<string, Configuration>>({});
  const configuration = configurations[product.id] ?? defaultConfiguration(product);
  const groups = availableGroups(product);
  const inlineIds = inlineGroupIds(product);
  const inlineGroups = groups.filter((group) => inlineIds.has(group.id));
  const complexGroups = groups.filter((group) => !inlineIds.has(group.id));
  const needsPopover = complexGroups.length > 0 || product.pricingMode === "WEIGHTED_PER_KG" || card.products.length > 3;
  const hasInlineVariants = card.products.length > 1 && card.products.length <= 3;
  const hasChoices = hasInlineVariants || groups.length > 0;
  const [search, setSearch] = useState("");
  const cardRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const instanceId = useId();
  const dialogId = `${instanceId}-options`;

  const selected = (group: Group) => group.options.filter((option) => configuration.picked[group.id]?.includes(option.id));
  const options = groups.flatMap(selected);
  const grams = positiveIntegerAmount(configuration.weight);
  const validChoices = groups.every((group) => selected(group).length >= group.minSelections && selected(group).length <= group.maxSelections);
  const canAdd = validChoices && (product.pricingMode !== "WEIGHTED_PER_KG" || grams > 0);
  const complexValid = complexGroups.every((group) => selected(group).length >= group.minSelections);
  const grossPrice = product.pricingMode === "WEIGHTED_PER_KG"
    ? weightedPricePreview(product.priceAmount, sumAmounts(options.map((option) => option.priceAmount)), grams)
    : sumAmounts([product.priceAmount, ...options.map((option) => option.priceAmount)]);

  const basePrice = product.pricingMode === "WEIGHTED_PER_KG" ? weightedPricePreview(product.priceAmount, 0, grams) : product.priceAmount;
  const discount = !product.saleDiscountValue ? 0 : product.saleDiscountKind === "PERCENTAGE"
    ? Math.floor(basePrice * product.saleDiscountValue / 100)
    : product.pricingMode === "WEIGHTED_PER_KG" ? Math.floor(product.saleDiscountValue * grams / 1000) : product.saleDiscountValue;
  const price = discount > 0 ? Math.min(grossPrice, roundDiscountedAmount(Math.max(0, grossPrice - discount))) : grossPrice;

  const updateConfiguration = (change: Partial<Configuration>) => setConfigurations((current) => ({
    ...current, [product.id]: { ...(current[product.id] ?? defaultConfiguration(product)), ...change },
  }));
  const choose = (group: Group, optionId: string) => {
    const current = configuration.picked[group.id] ?? [];
    const next = group.maxSelections === 1 ? [optionId]
      : current.includes(optionId) ? current.filter((id) => id !== optionId)
      : current.length < group.maxSelections ? [...current, optionId] : current;
    updateConfiguration({ picked: { ...configuration.picked, [group.id]: next } });
  };
  const close = () => { onClose(); triggerRef.current?.focus({ preventScroll: true }); };
  const add = () => {
    if (!canAdd) return;
    onSelectOptions(product, options, product.pricingMode === "WEIGHTED_PER_KG" ? grams : undefined);
    if (expanded) triggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node) && !popoverRef.current?.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); triggerRef.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    popoverRef.current?.querySelector<HTMLElement>('input[type="search"], input, button')?.focus({ preventScroll: true });
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [expanded, onClose]);

  useLayoutEffect(() => {
    if (!expanded) return;
    const reposition = () => {
      if (!cardRef.current || !popoverRef.current) return;
      const rect = cardRef.current.getBoundingClientRect();
      const margin = 12;
      const gap = 8;
      const width = Math.min(304, window.innerWidth - margin * 2);
      const height = Math.min(popoverRef.current.offsetHeight, window.innerHeight - margin * 2);
      const fitsLeft = rect.left >= width + gap + margin;
      const fitsRight = window.innerWidth - rect.right >= width + gap + margin;
      const left = fitsLeft ? rect.left - width - gap : fitsRight ? rect.right + gap
        : Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
      const preferredTop = fitsLeft || fitsRight ? rect.top
        : rect.bottom + gap + height <= window.innerHeight - margin ? rect.bottom + gap : rect.top - height - gap;
      setPosition({ left, top: Math.max(margin, Math.min(preferredTop, window.innerHeight - height - margin)), width, visibility: "visible" });
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    if (popoverRef.current) observer.observe(popoverRef.current);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); };
  }, [expanded]);

  const variants = () => <fieldset className="pos-product__segments"><legend className="sr-only">اندازه {card.name}</legend>
    {card.products.map((variant) => <label key={variant.id}><input type="radio" name={`${instanceId}-variant`} checked={product.id === variant.id} onChange={() => { setProductId(variant.id); setSearch(""); }} /><span>{variant.name.match(shotName)?.[2] ?? variant.name}</span></label>)}
  </fieldset>;
  const renderGroup = (group: Group, inline: boolean) => {
    const count = selected(group).length;
    const query = search.trim().replace(/ي/g, "ی").replace(/ك/g, "ک");
    const visibleOptions = group.options.filter((option) => !query || `${group.name} ${option.name}`.replace(/ي/g, "ی").replace(/ك/g, "ک").includes(query));
    const multi = group.maxSelections > 1;
    return <fieldset key={group.id} className={inline ? "pos-product__segments" : "pos-product__option-group"}>
      <legend className={inline ? "sr-only" : undefined}>{group.name}{!inline && <small>{group.minSelections > 0 ? "الزامی" : "اختیاری"}{multi ? ` · حداکثر ${group.maxSelections.toLocaleString("fa-IR")}` : ""}</small>}</legend>
      {!multi && group.minSelections === 0 && <label><input type="radio" name={`${instanceId}-${group.id}`} checked={count === 0} onChange={() => updateConfiguration({ picked: { ...configuration.picked, [group.id]: [] } })} /><span>بدون افزودنی</span></label>}
      {visibleOptions.map((option) => {
        const checked = selected(group).some((item) => item.id === option.id);
        return <label key={option.id}><input type={multi ? "checkbox" : "radio"} name={`${instanceId}-${group.id}`} checked={checked} disabled={multi && !checked && count >= group.maxSelections} onChange={() => choose(group, option.id)} /><span title={option.name} data-numeric={inline && /^[۰-۹0-9٪%/\s]+$/.test(option.name.replace(/\s*(روبوستا|عربیکا)/g, "")) || undefined}>{inline ? option.name.replace(/\s*(روبوستا|عربیکا)/g, "") : option.name}</span></label>;
      })}
      {!inline && visibleOptions.length === 0 && <p className="pos-product__empty">{group.options.length ? "گزینه‌ای پیدا نشد" : "گزینه‌ای در دسترس نیست"}</p>}
    </fieldset>;
  };
  const selectedWeight = product.pricingMode === "WEIGHTED_PER_KG" ? grams : undefined;
  const quantity = getQuantity?.(product, options, selectedWeight) ?? 0;
  const addButton = () => quantity > 0 ? <div className="pos-product__quantity" role="group" aria-label={`تعداد ${card.name} در کارت محصول`}>
    <button type="button" aria-label={`کم کردن ${card.name} در کارت محصول`} onClick={() => onDecrease?.(product, options, selectedWeight)}>−</button>
    <output aria-live="polite" aria-label={`تعداد انتخاب‌شده ${card.name}`}>{quantity.toLocaleString("fa-IR")}</output>
    <button type="button" aria-label={`افزودن ${card.name} به سفارش`} title={`افزودن ${card.name} به سفارش`} disabled={!canAdd} onClick={add}>+</button>
  </div> : <button className="pos-product__add" type="button"
    aria-label={`افزودن ${card.name} به سفارش`} title={`افزودن ${card.name} به سفارش`}
    disabled={!canAdd} onClick={add}><span aria-hidden="true">+</span></button>;


  return <article ref={cardRef} className={`pos-product${hasChoices ? " pos-product--choices" : ""}${expanded ? " is-active" : ""}`} aria-label={card.name}>
    <h3 className="pos-product__name">{card.name}</h3>
    <div className="pos-product__inline">
      {hasInlineVariants && variants()}
      {inlineGroups.map((group) => renderGroup(group, true))}
    </div>
    <div className="pos-product__actions">
      {needsPopover && <button ref={triggerRef} className="pos-product__configure" type="button" aria-label={`انتخاب گزینه‌های ${card.name}`} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={expanded ? dialogId : undefined} onClick={() => expanded ? close() : onOpen()}><span>{complexGroups.length === 1 ? complexGroups[0]!.name : "گزینه‌ها"}</span><span aria-hidden="true">⋯</span>{!complexValid && <span className="sr-only">انتخاب الزامی</span>}</button>}
      {addButton()}
    </div>
    {expanded && needsPopover && createPortal(<section id={dialogId} ref={popoverRef} dir="rtl" className="pos-product-popover" role="dialog" aria-label={`انتخاب گزینه برای ${card.name}`} style={position}>
      <header className="pos-product-popover__header"><div><strong>{card.name}</strong><small>انتخاب گزینه‌ها</small></div><button type="button" aria-label="بستن گزینه‌ها" onClick={close}>×</button></header>
      {complexGroups.some((group) => group.options.length > 5) && <div className="pos-product-popover__search"><input type="search" aria-label="جست‌وجوی گزینه‌ها" placeholder="جست‌وجوی گزینه‌ها" value={search} onChange={(event) => setSearch(event.target.value)} /></div>}
      <div className="pos-product-popover__body">
        {card.products.length > 3 && variants()}
        {complexGroups.map((group) => renderGroup(group, false))}
        {product.pricingMode === "WEIGHTED_PER_KG" && <label className="pos-product__weight">وزن (گرم)<input aria-label="وزن" inputMode="numeric" value={configuration.weight} onChange={(event) => updateConfiguration({ weight: event.target.value.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[^0-9]/g, "") })} placeholder="گرم" /><small>قیمت هر کیلو: {formatToman(product.priceAmount)}</small></label>}
      </div>
      <footer className="pos-product-popover__footer"><div><small>{canAdd ? "مبلغ" : "انتخاب‌های الزامی را کامل کنید"}</small>{canAdd && <strong>{formatToman(price)} <small>تومان</small></strong>}</div>{addButton()}</footer>
    </section>, document.body)}
  </article>;
}
