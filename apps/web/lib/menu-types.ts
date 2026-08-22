export type SaleDiscount = {
  kind: "FIXED" | "PERCENTAGE";
  value: number;
  amount: number;
};

export type MenuOption = {
  id: string;
  name: string;
  priceAmount: number;
};

export type MenuOptionGroup = {
  id: string;
  name: string;
  options: MenuOption[];
};

export type MenuProduct = {
  id: string;
  name: string;
  nameEn: string | null;
  basePriceAmount: number;
  finalPriceAmount: number;
  saleDiscount: SaleDiscount | null;
  preparationDeadlineMinutes: number;
  isAvailable: boolean;
  image: { storageKey: string; altText: string } | null;
  optionGroups: MenuOptionGroup[];
};

export type MenuCategory = {
  id: string;
  name: string;
  nameEn: string | null;
  products: MenuProduct[];
};

export type PublicMenu = { categories: MenuCategory[] };
