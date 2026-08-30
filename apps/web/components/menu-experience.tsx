"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MenuCategory, MenuProduct, PublicMenu } from "../lib/menu-types";
import {
  categoryTone,
  filterMenu,
  formatToman,
  localProductPictureUrl,
  localizedName,
  productImageUrl,
  secondaryName,
  type Language,
} from "../lib/menu-utils";
import {
  CakeIcon,
  ChevronIcon,
  CloseIcon,
  CoffeeIcon,
  DishIcon,
  DrinkIcon,
  LeafIcon,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
} from "./icons";

type MenuExperienceProps = {
  initialMenu: PublicMenu | null;
  initialRequestFailed: boolean;
};

const copy = {
  fa: {
    menu: "منو",
    heroTitle: "Run Cafe",
    search: "دنبال چی می‌گردی؟",
    searchHint: "مثلاً لاته، برگر یا براونی",
    categories: "دسته‌بندی‌ها",
    results: "نتیجه",
    toman: "تومان",
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
    footer: "قهوه خوب، نور گرم، گفت‌وگوی طولانی.",
  },
  en: {
    menu: "Menu",
    heroTitle: "Run Cafe",
    search: "What are you in the mood for?",
    searchHint: "Try latte, burger or brownie",
    categories: "Categories",
    results: "results",
    toman: "Toman",
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
    special: <SparkIcon />,
    drink: <DrinkIcon />,
    dessert: <CakeIcon />,
    food: <DishIcon />,
  };

  return <span className={`category-mark category-mark--${tone} ${className}`}>{icon[tone]}</span>;
}

function ProductVisual({ product, category }: { product: MenuProduct; category: MenuCategory }) {
  const [imageIndex, setImageIndex] = useState(0);
  const localPictureUrl = localProductPictureUrl(product);
  const imageSources = [
    product.image ? productImageUrl(product.image.storageKey) : null,
    localPictureUrl,
  ].filter((source, index, sources): source is string => Boolean(source) && sources.indexOf(source) === index);
  const imageSource = imageSources[imageIndex];

  if (imageSource) {
    return (
      <span className="product-visual product-visual--image">
        {/* Product files are self-hosted; dimensions and lazy decoding keep the grid stable. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageSource}
          alt={product.image?.altText ?? product.name}
          loading="lazy"
          decoding="async"
          width="480"
          height="360"
          onError={() => setImageIndex((currentIndex) => currentIndex + 1)}
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

        {product.optionGroups.length > 0 ? (
          <span className="product-meta-row">
            <span className="option-dot" title={text.options}>
              +
            </span>
          </span>
        ) : null}

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
        <button ref={closeRef} className="dialog-close" type="button" onClick={onClose}>
          <CloseIcon />
          <span className="sr-only">{text.close}</span>
        </button>

        <div className="dialog-scroll-content">
          <div className="dialog-visual-wrap">
            <ProductVisual product={product} category={category} />
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
                            {formatToman(product.finalPriceAmount + option.priceAmount, language)}{
                              " "
                            }
                            {text.toman}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}

          </div>
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
  const language: Language = "fa";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showCategoryScrollCue, setShowCategoryScrollCue] = useState(true);
  const categoryScrollerRef = useRef<HTMLDivElement>(null);
  const categoryNavigationTargetRef = useRef<string | null>(null);
  const categoryNavigationTimerRef = useRef<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{
    product: MenuProduct;
    category: MenuCategory;
  } | null>(null);
  const text = copy[language];
  const direction = language === "fa" ? "rtl" : "ltr";

  const filteredCategories = useMemo(
    () => (menu ? filterMenu(menu, deferredQuery, null) : []),
    [deferredQuery, menu],
  );
  const resultCount = filteredCategories.reduce(
    (count, category) => count + category.products.length,
    0,
  );
  const hasFilters = Boolean(query);

  useEffect(() => {
    if (!menu) return;

    let animationFrame = 0;
    const updateSelectedCategory = () => {
      animationFrame = 0;
      if (categoryNavigationTargetRef.current) return;

      const toolbarBottom =
        document.querySelector<HTMLElement>(".menu-toolbar")?.getBoundingClientRect().bottom ?? 0;
      const marker = toolbarBottom + 64;
      let activeCategory: string | null = null;

      for (const category of filteredCategories) {
        const section = document.getElementById(`category-${category.id}`);
        if (section && section.getBoundingClientRect().top <= marker) {
          activeCategory = category.id;
        } else {
          break;
        }
      }

      if (
        filteredCategories.length > 0 &&
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      ) {
        activeCategory = filteredCategories.at(-1)?.id ?? null;
      }

      setSelectedCategory((current) =>
        current === activeCategory ? current : activeCategory,
      );
    };
    const scheduleUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateSelectedCategory);
    };

    updateSelectedCategory();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [filteredCategories, menu]);

  useEffect(
    () => () => {
      if (categoryNavigationTimerRef.current !== null) {
        window.clearTimeout(categoryNavigationTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedCategory) return;
    const scroller = categoryScrollerRef.current;
    const activeChip = document.querySelector<HTMLElement>(
      `[data-category-chip="${selectedCategory}"]`,
    );
    if (!scroller || !activeChip) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const chipRect = activeChip.getBoundingClientRect();
    const chipIsOutsideView =
      chipRect.left < scrollerRect.left + 8 || chipRect.right > scrollerRect.right - 8;

    if (chipIsOutsideView) {
      const horizontalOffset =
        chipRect.left + chipRect.width / 2 - (scrollerRect.left + scrollerRect.width / 2);
      scroller.scrollBy({ left: horizontalOffset, behavior: "smooth" });
    }
  }, [selectedCategory]);

  useEffect(() => {
    const scroller = categoryScrollerRef.current;
    if (!scroller) return;

    let animationFrame = 0;
    const updateScrollCue = () => {
      animationFrame = 0;
      const lastChip = scroller.lastElementChild as HTMLElement | null;
      if (!lastChip) {
        setShowCategoryScrollCue(false);
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const lastChipRect = lastChip.getBoundingClientRect();
      const hasMoreCategories =
        direction === "rtl"
          ? lastChipRect.left < scrollerRect.left + 4
          : lastChipRect.right > scrollerRect.right - 4;
      setShowCategoryScrollCue(hasMoreCategories);
    };
    const scheduleUpdate = () => {
      if (!animationFrame) animationFrame = window.requestAnimationFrame(updateScrollCue);
    };

    updateScrollCue();
    scroller.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      scroller.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [direction, menu?.categories.length]);

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
  }

  function scrollToCategory(categoryId: string) {
    if (categoryNavigationTimerRef.current !== null) {
      window.clearTimeout(categoryNavigationTimerRef.current);
    }
    categoryNavigationTargetRef.current = categoryId;
    setQuery("");
    setSelectedCategory(categoryId);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`category-${categoryId}`);
      if (!target) {
        categoryNavigationTargetRef.current = null;
        return;
      }

      const finishNavigation = () => {
        if (categoryNavigationTargetRef.current !== categoryId) return;
        categoryNavigationTargetRef.current = null;
        if (categoryNavigationTimerRef.current !== null) {
          window.clearTimeout(categoryNavigationTimerRef.current);
          categoryNavigationTimerRef.current = null;
        }
      };

      window.addEventListener("scrollend", finishNavigation, { once: true });
      categoryNavigationTimerRef.current = window.setTimeout(finishNavigation, 1_500);
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
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
      <main id="menu-content">
        <section className="hero" id="top">
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
          <div className="hero-copy">
            <h1>{text.heroTitle}</h1>
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

          <div className="category-navigation">
            <div
              ref={categoryScrollerRef}
              className="category-scroller"
              role="list"
              aria-label={text.categories}
            >
              {menu.categories.map((category) => (
                <button
                  type="button"
                  className={`category-chip${selectedCategory === category.id ? " is-active" : ""}`}
                  aria-pressed={selectedCategory === category.id}
                  data-category-chip={category.id}
                  onClick={() => scrollToCategory(category.id)}
                  key={category.id}
                >
                  <CategoryMark category={category} />
                  {localizedName(category, language)}
                </button>
              ))}
            </div>
            <span
              className={`category-scroll-cue${showCategoryScrollCue ? "" : " is-hidden"}`}
              aria-hidden="true"
            >
              {language === "fa" ? "‹" : "›"}
            </span>
          </div>
        </section>

        <div className="menu-results-header" id="menu-results">
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
              <section
                className="category-section"
                id={`category-${category.id}`}
                key={category.id}
              >
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
        <div className="footer-mark" aria-hidden="true">
          <img src="/run-cafe-logo.webp" alt="" width="30" height="56" />
        </div>
        <p>{text.footer}</p>
        <span>RUN CAFÉ · EST. 2017</span>
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
