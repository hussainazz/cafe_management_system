"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuCategory, MenuProduct, PublicMenu } from "../lib/menu-types";
import {
  categoryTone,
  filterMenu,
  formatToman,
  localizedName,
  menuProductCount,
  productImageUrl,
  secondaryName,
  type Language,
} from "../lib/menu-utils";
import {
  CakeIcon,
  ChevronIcon,
  ClockIcon,
  CloseIcon,
  CoffeeIcon,
  DishIcon,
  DrinkIcon,
  LeafIcon,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
  TeaIcon,
} from "./icons";

type MenuExperienceProps = {
  initialMenu: PublicMenu | null;
  initialRequestFailed: boolean;
};

const copy = {
  fa: {
    menu: "منو",
    welcome: "به کافه ران خوش آمدید",
    heroTitle: "آرام، گرم، بی‌عجله.",
    heroBody: "قهوه تخصصی، خوراک تازه و چند ساعت خوب برای گفت‌وگو.",
    open: "هر روز، همیشه باز",
    fresh: "آماده‌سازی تازه",
    items: "آیتم در منو",
    search: "دنبال چی می‌گردی؟",
    searchHint: "مثلاً لاته، برگر یا براونی",
    all: "همه",
    onlyAvailable: "فقط موجودها",
    categories: "دسته‌بندی‌ها",
    results: "نتیجه",
    toman: "تومان",
    minutes: "دقیقه",
    prep: "زمان آماده‌سازی",
    unavailable: "فعلاً ناموجود",
    discount: "تخفیف",
    options: "انتخاب‌های این آیتم",
    from: "از",
    noResultsTitle: "چیزی پیدا نکردیم",
    noResultsBody: "عبارت دیگری را امتحان کن یا فیلترها را پاک کن.",
    clearFilters: "پاک کردن فیلترها",
    errorTitle: "منو فعلاً در دسترس نیست",
    errorBody: "ارتباط با منو برقرار نشد. چند لحظه دیگر دوباره امتحان کن.",
    retry: "تلاش دوباره",
    close: "بستن",
    browseOnly: "این منو برای مشاهده است؛ سفارش شما با همراهی باریستا ثبت می‌شود.",
    footer: "قهوه خوب، نور گرم، گفت‌وگوی طولانی.",
  },
  en: {
    menu: "Menu",
    welcome: "Welcome to Run Café",
    heroTitle: "Warm. Intimate. Unhurried.",
    heroBody: "Specialty coffee, freshly made food, and room for a good conversation.",
    open: "Open every day",
    fresh: "Made to order",
    items: "items on the menu",
    search: "What are you in the mood for?",
    searchHint: "Try latte, burger or brownie",
    all: "All",
    onlyAvailable: "Available only",
    categories: "Categories",
    results: "results",
    toman: "Toman",
    minutes: "min",
    prep: "Preparation time",
    unavailable: "Unavailable for now",
    discount: "off",
    options: "Available choices",
    from: "from",
    noResultsTitle: "Nothing matched",
    noResultsBody: "Try another phrase or clear the filters.",
    clearFilters: "Clear filters",
    errorTitle: "The menu is taking a break",
    errorBody: "We could not reach the menu. Please try again in a moment.",
    retry: "Try again",
    close: "Close",
    browseOnly: "This menu is for browsing; your barista will take care of the order.",
    footer: "Good coffee, warm light, long conversations.",
  },
} as const;

function CategoryMark({
  category,
  className = "",
}: {
  category: MenuCategory;
  className?: string;
}) {
  const tone = categoryTone(category);
  const icon: Record<ReturnType<typeof categoryTone>, ReactNode> = {
    coffee: <CoffeeIcon />,
    tea: <TeaIcon />,
    cold: <DrinkIcon />,
    sweet: <CakeIcon />,
    food: <DishIcon />,
  };

  return <span className={`category-mark category-mark--${tone} ${className}`}>{icon[tone]}</span>;
}

function ProductVisual({ product, category }: { product: MenuProduct; category: MenuCategory }) {
  const [imageFailed, setImageFailed] = useState(false);

  if (product.image && !imageFailed) {
    return (
      <span className="product-visual product-visual--image">
        {/* Product files are self-hosted; dimensions and lazy decoding keep the grid stable. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={productImageUrl(product.image.storageKey)}
          alt={product.image.altText}
          loading="lazy"
          decoding="async"
          width="480"
          height="360"
          onError={() => setImageFailed(true)}
        />
        <span className="image-shade" />
      </span>
    );
  }

  return (
    <span className={`product-visual product-visual--${categoryTone(category)}`} aria-hidden="true">
      <span className="visual-ring visual-ring--outer" />
      <span className="visual-ring visual-ring--inner" />
      <CategoryMark category={category} className="product-visual-mark" />
      <span className="visual-grain" />
    </span>
  );
}

function Price({ product, language }: { product: MenuProduct; language: Language }) {
  const text = copy[language];
  return (
    <span className="price-block">
      {product.saleDiscount ? (
        <span className="old-price">{formatToman(product.basePriceAmount, language)}</span>
      ) : null}
      <span className="price-line">
        <strong>{formatToman(product.finalPriceAmount, language)}</strong>
        <small>{text.toman}</small>
      </span>
    </span>
  );
}

function ProductCard({
  product,
  category,
  language,
  onSelect,
}: {
  product: MenuProduct;
  category: MenuCategory;
  language: Language;
  onSelect: () => void;
}) {
  const text = copy[language];
  const detail = secondaryName(product, language);

  return (
    <button
      className={`product-card${product.isAvailable ? "" : " is-unavailable"}`}
      type="button"
      onClick={onSelect}
      aria-label={`${localizedName(product, language)}، ${formatToman(product.finalPriceAmount, language)} ${text.toman}`}
    >
      <ProductVisual product={product} category={category} />
      <span className="product-card-body">
        <span className="product-card-topline">
          <span className="product-name-wrap">
            <strong className="product-name">{localizedName(product, language)}</strong>
            {detail ? <span className="product-secondary">{detail}</span> : null}
          </span>
          <ChevronIcon className="card-chevron" />
        </span>

        <span className="product-meta-row">
          <span className="prep-time">
            <ClockIcon />
            {formatToman(product.preparationDeadlineMinutes, language)} {text.minutes}
          </span>
          {product.optionGroups.length > 0 ? (
            <span className="option-dot" title={text.options}>
              +
            </span>
          ) : null}
        </span>

        <span className="product-card-bottom">
          <Price product={product} language={language} />
          {product.saleDiscount ? (
            <span className="discount-badge">
              {product.saleDiscount.kind === "PERCENTAGE"
                ? `${formatToman(product.saleDiscount.value, language)}٪`
                : formatToman(product.saleDiscount.amount, language)}{" "}
              {text.discount}
            </span>
          ) : null}
          {!product.isAvailable ? (
            <span className="unavailable-badge">{text.unavailable}</span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ProductDialog({
  product,
  category,
  language,
  onClose,
}: {
  product: MenuProduct;
  category: MenuCategory;
  language: Language;
  onClose: () => void;
}) {
  const text = copy[language];
  const closeRef = useRef<HTMLButtonElement>(null);
  const detail = secondaryName(product, language);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="product-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-dialog-title"
        dir={language === "fa" ? "rtl" : "ltr"}
      >
        <div className="dialog-visual-wrap">
          <ProductVisual product={product} category={category} />
          <button ref={closeRef} className="dialog-close" type="button" onClick={onClose}>
            <CloseIcon />
            <span className="sr-only">{text.close}</span>
          </button>
          {!product.isAvailable ? (
            <span className="dialog-unavailable">{text.unavailable}</span>
          ) : null}
        </div>

        <div className="dialog-body">
          <span className="dialog-category">
            <CategoryMark category={category} />
            {localizedName(category, language)}
          </span>
          <div className="dialog-heading-row">
            <div>
              <h2 id="product-dialog-title">{localizedName(product, language)}</h2>
              {detail ? <p className="dialog-secondary">{detail}</p> : null}
            </div>
            <Price product={product} language={language} />
          </div>

          <div className="dialog-prep">
            <ClockIcon />
            <span>{text.prep}</span>
            <strong>
              {formatToman(product.preparationDeadlineMinutes, language)} {text.minutes}
            </strong>
          </div>

          {product.optionGroups.length > 0 ? (
            <div className="option-groups">
              <h3>{text.options}</h3>
              {product.optionGroups.map((group) => (
                <div className="option-group" key={group.id}>
                  <p>{group.name}</p>
                  <ul>
                    {group.options.map((option) => (
                      <li key={option.id}>
                        <span>{option.name}</span>
                        <span className="option-price">
                          + {formatToman(option.priceAmount, language)} {text.toman}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : null}

          <p className="browse-note">
            <LeafIcon />
            {text.browseOnly}
          </p>
        </div>
      </section>
    </div>
  );
}

function LoadingMenu() {
  return (
    <main className="loading-shell" aria-label="Loading menu" aria-busy="true">
      <div className="skeleton skeleton--hero" />
      <div className="skeleton skeleton--search" />
      <div className="skeleton-chips">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="skeleton skeleton--chip" key={index} />
        ))}
      </div>
      <div className="skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton skeleton--card" key={index} />
        ))}
      </div>
    </main>
  );
}

export function MenuExperience({ initialMenu, initialRequestFailed }: MenuExperienceProps) {
  const [menu, setMenu] = useState(initialMenu);
  const [requestFailed, setRequestFailed] = useState(initialRequestFailed);
  const [retrying, setRetrying] = useState(false);
  const [language, setLanguage] = useState<Language>("fa");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{
    product: MenuProduct;
    category: MenuCategory;
  } | null>(null);
  const text = copy[language];
  const direction = language === "fa" ? "rtl" : "ltr";

  const filteredCategories = useMemo(
    () => (menu ? filterMenu(menu, deferredQuery, selectedCategory, availableOnly) : []),
    [availableOnly, deferredQuery, menu, selectedCategory],
  );
  const resultCount = filteredCategories.reduce(
    (count, category) => count + category.products.length,
    0,
  );
  const hasFilters = Boolean(query || selectedCategory || availableOnly);

  async function retryMenu() {
    setRetrying(true);
    try {
      const response = await fetch("/api/public-menu", { cache: "no-store" });
      if (!response.ok) throw new Error("Menu request failed");
      const body = (await response.json()) as { data: PublicMenu };
      setMenu(body.data);
      setRequestFailed(false);
    } catch {
      setRequestFailed(true);
    } finally {
      setRetrying(false);
    }
  }

  function clearFilters() {
    setQuery("");
    setSelectedCategory(null);
    setAvailableOnly(false);
  }

  if (!menu && !requestFailed) return <LoadingMenu />;

  if (!menu) {
    return (
      <main className="error-page" dir={direction}>
        <div className="error-orbit">
          <CoffeeIcon />
        </div>
        <p className="eyebrow">RUN CAFÉ · {text.menu}</p>
        <h1>{text.errorTitle}</h1>
        <p>{text.errorBody}</p>
        <button type="button" onClick={() => void retryMenu()} disabled={retrying}>
          <RefreshIcon className={retrying ? "is-spinning" : ""} />
          {text.retry}
        </button>
      </main>
    );
  }

  return (
    <div className="site-shell" dir={direction} lang={language}>
      <a className="skip-link" href="#menu-content">
        {text.menu}
      </a>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Run Café">
          <span className="brand-mark">R</span>
          <span>
            <strong>RUN CAFÉ</strong>
            <small>{text.menu}</small>
          </span>
        </a>
        <div className="topbar-actions">
          <span className="open-status">
            <i />
            {text.open}
          </span>
          <button
            className="language-toggle"
            type="button"
            onClick={() => setLanguage(language === "fa" ? "en" : "fa")}
            aria-label={language === "fa" ? "View menu in English" : "نمایش منو به فارسی"}
          >
            <span className={language === "fa" ? "is-active" : ""}>فا</span>
            <span className={language === "en" ? "is-active" : ""}>EN</span>
          </button>
        </div>
      </header>

      <main id="menu-content">
        <section className="hero" id="top">
          <div className="hero-copy">
            <p className="eyebrow">
              <SparkIcon />
              {text.welcome}
            </p>
            <h1>{text.heroTitle}</h1>
            <p className="hero-body">{text.heroBody}</p>
            <div className="hero-stats">
              <span>
                <strong>{formatToman(menu.categories.length, language)}</strong>
                {text.categories}
              </span>
              <span>
                <strong>{formatToman(menuProductCount(menu), language)}</strong>
                {text.items}
              </span>
              <span>
                <LeafIcon />
                {text.fresh}
              </span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <span className="hero-glow" />
            <span className="hero-plate hero-plate--outer" />
            <span className="hero-plate hero-plate--inner" />
            <CoffeeIcon className="hero-cup" />
            <span className="steam steam--one" />
            <span className="steam steam--two" />
            <span className="hero-leaf">
              <LeafIcon />
            </span>
          </div>
        </section>

        <section className="menu-toolbar" aria-label={text.categories}>
          <label className="search-box">
            <SearchIcon />
            <span className="sr-only">{text.search}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.searchHint}
              autoComplete="off"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} aria-label={text.clearFilters}>
                <CloseIcon />
              </button>
            ) : null}
          </label>

          <div className="filter-row">
            <div className="category-scroller" role="list" aria-label={text.categories}>
              <button
                type="button"
                className={`category-chip${selectedCategory === null ? " is-active" : ""}`}
                onClick={() => setSelectedCategory(null)}
              >
                <span className="category-chip-all">
                  <SparkIcon />
                </span>
                {text.all}
              </button>
              {menu.categories.map((category) => (
                <button
                  type="button"
                  className={`category-chip${selectedCategory === category.id ? " is-active" : ""}`}
                  onClick={() => setSelectedCategory(category.id)}
                  key={category.id}
                >
                  <CategoryMark category={category} />
                  {localizedName(category, language)}
                </button>
              ))}
            </div>
            <button
              className={`availability-toggle${availableOnly ? " is-active" : ""}`}
              type="button"
              onClick={() => setAvailableOnly((current) => !current)}
              aria-pressed={availableOnly}
            >
              <span className="toggle-track">
                <i />
              </span>
              {text.onlyAvailable}
            </button>
          </div>
        </section>

        <div className="menu-results-header">
          <p>
            <strong>{formatToman(resultCount, language)}</strong> {text.results}
          </p>
          {hasFilters ? (
            <button type="button" onClick={clearFilters}>
              {text.clearFilters}
              <CloseIcon />
            </button>
          ) : null}
        </div>

        {filteredCategories.length > 0 ? (
          <div className="category-sections">
            {filteredCategories.map((category, categoryIndex) => (
              <section className="category-section" key={category.id}>
                <div className="section-heading">
                  <CategoryMark category={category} />
                  <div>
                    <span className="section-number">
                      {String(categoryIndex + 1).padStart(2, "0")}
                    </span>
                    <h2>{localizedName(category, language)}</h2>
                    {secondaryName(category, language) ? (
                      <p>{secondaryName(category, language)}</p>
                    ) : null}
                  </div>
                  <span className="section-line" />
                  <span className="section-count">
                    {formatToman(category.products.length, language)}
                  </span>
                </div>
                <div className="product-grid">
                  {category.products.map((product) => (
                    <ProductCard
                      product={product}
                      category={category}
                      language={language}
                      onSelect={() => setSelectedProduct({ product, category })}
                      key={product.id}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <section className="empty-state">
            <span>
              <SearchIcon />
            </span>
            <h2>{text.noResultsTitle}</h2>
            <p>{text.noResultsBody}</p>
            <button type="button" onClick={clearFilters}>
              {text.clearFilters}
            </button>
          </section>
        )}
      </main>

      <footer>
        <div className="footer-mark">R</div>
        <p>{text.footer}</p>
        <span>RUN CAFÉ · EST. 2026</span>
      </footer>

      {selectedProduct ? (
        <ProductDialog
          product={selectedProduct.product}
          category={selectedProduct.category}
          language={language}
          onClose={() => setSelectedProduct(null)}
        />
      ) : null}
    </div>
  );
}
