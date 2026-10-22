"use client";
import { useRecoveryState, requestAutomaticRecovery, recoveryNoticeEvent, finishRecoveryEpisode } from "../lib/automatic-recovery";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  archiveCategory,
  archiveOption,
  archiveProduct,
  archiveProductImage,
  archiveTable,
  deactivateStaff,
  deleteOpenOrder,
  readAuditLog,
  readDailyReport,
  readManagerCatalog,
  readStaffCatalog,
  readManagerSettings,
  readManagerStaff,
  readOrderList,
  readOrder,
  readPaymentHistory,
  readPosTables,
  reactivateStaff,
  reverseSettlement,
  saveCategory,
  saveOption,
  saveOptionGroup,
  saveProduct,
  saveSettings,
  activateInventory,
  saveStaff,
  saveTable,
  uploadProductImage,
  type ApiFailure,
  type ManagerCatalog,
  type ManagerSettings,
  type ManagerStaff,
  type PaymentHistory,
  type PaymentHistoryFilters,
  type PaymentHistoryOrderFilter,
  type OrderSummary,
  type PosOrderDetail,
} from "../lib/api-client";
import { formatOrderNumber, formatToman } from "../lib/pos-utils";
import { printDocument, printRoute } from "../lib/print-routes";
import { AlertIcon, MenuIcon, RefreshIcon, WifiIcon } from "./icons";
import { CatalogPanel } from "./catalog-panel";
import { SettlementSheet } from "./orders-workspace";
import { persianDateToGregorianDate, tehranPersianDateParts } from "../lib/tehran-date";
import { InventoryWorkspace } from "./inventory-workspace";

type Panel = "catalog" | "tables" | "finance" | "payments" | "audit" | "settings" | "inventory";
type SettingsPanel = "settings" | "tables" | "audit";
export type ManagerSection = "settings" | "finance" | "payments" | "catalog" | "inventory";
type Confirm = {
  title: string;
  detail: string;
  reasonLabel?: string;
  reasonOptional?: boolean;
  run: (reason?: string) => Promise<void>;
} | null;
type PaymentSortKey = "order" | "recordedAt" | "context" | "amount" | "method" | "recordedBy" | "status";
type PaymentListFilter = PaymentHistoryOrderFilter | "PREVIOUS_UNPAID" | null;
const number = (value: FormDataEntryValue | null) => Number(value ?? 0);
const text = (value: FormDataEntryValue | null) => String(value ?? "").trim();

const paymentMethodLabel = {
  CASH: "نقدی",
  CARD_TERMINAL: "کارت‌خوان",
  CARD_TRANSFER: "کارت‌به‌کارت",
} as const;

function paymentContext(item: PaymentHistory[number]) {
  return item.channel === "TABLE" ? `میز ${item.table?.name ?? "—"}` : "بیرون‌بر";
}

function paymentMethods(item: PaymentHistory[number]) {
  return item.payments.map((payment) => paymentMethodLabel[payment.method]).join("، ") || "—";
}

type PaymentFilterDraft = {
  currentDay: boolean;
  fromDate: string;
  toDate: string;
  fromTime: string;
  toTime: string;
};

function initialPaymentFilterDraft(): PaymentFilterDraft {
  const { month, day } = tehranPersianDateParts();
  return { currentDay: true, fromDate: `${month}/${day}`, toDate: `${month}/${day}`, fromTime: "", toTime: "" };
}

function paymentFiltersFromDraft(draft: PaymentFilterDraft): PaymentHistoryFilters | null {
  const { year, month, day } = tehranPersianDateParts();
  const fromDate = draft.currentDay ? persianDateToGregorianDate(year, `${month}/${day}`) : persianDateToGregorianDate(year, draft.fromDate);
  const toDate = draft.currentDay ? persianDateToGregorianDate(year, `${month}/${day}`) : persianDateToGregorianDate(year, draft.toDate);
  if (!fromDate || !toDate || fromDate > toDate) return null;
  if ((draft.fromTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.fromTime)) || (draft.toTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.toTime))) return null;
  return {
    fromDate,
    toDate,
    ...(draft.fromTime ? { fromTime: draft.fromTime } : {}),
    ...(draft.toTime ? { toTime: draft.toTime } : {}),
  };
}

function shiftPaymentDate(year: string, value: string, offset: -1 | 1): string | null {
  const gregorianDate = persianDateToGregorianDate(year, value);
  if (!gregorianDate) return null;
  const date = new Date(`${gregorianDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tehran", calendar: "persian", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  if (part("year") !== year) return null;
  return `${part("month")}/${part("day")}`;
}

type PaymentDatePreset = "today" | "yesterday" | "last7" | "custom";

function paymentDatePresetRange(preset: Exclude<PaymentDatePreset, "custom">): { draft: PaymentFilterDraft; filters: PaymentHistoryFilters } {
  const today = tehranPersianDateParts();
  const todayGregorian = persianDateToGregorianDate(today.year, `${today.month}/${today.day}`);
  if (!todayGregorian) {
    const draft = initialPaymentFilterDraft();
    return { draft, filters: { fromDate: new Date().toISOString().slice(0, 10), toDate: new Date().toISOString().slice(0, 10) } };
  }
  const gregorianDay = (offset: number) => {
    const date = new Date(`${todayGregorian}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const persianValue = (date: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Tehran", calendar: "persian", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(`${date}T12:00:00Z`));
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
    return { year: value("year"), value: `${value("month")}/${value("day")}` };
  };
  const to = persianValue(preset === "yesterday" ? gregorianDay(-1) : todayGregorian);
  const from = persianValue(preset === "last7" ? gregorianDay(-6) : preset === "yesterday" ? gregorianDay(-1) : todayGregorian);
  const draft = { currentDay: preset === "today", fromDate: from.value, toDate: to.value, fromTime: "", toTime: "" };
  return { draft, filters: { fromDate: preset === "last7" ? gregorianDay(-6) : preset === "yesterday" ? gregorianDay(-1) : todayGregorian, toDate: preset === "yesterday" ? gregorianDay(-1) : todayGregorian } };
}

export function ManagerWorkspace({
  section = "settings",
  role = "MANAGER",
  onOpenMenu,
  menuOpen,
}: {
  section?: ManagerSection;
  role?: "STAFF" | "MANAGER";
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const [settingsPanel, setSettingsPanel] = useRecoveryState<SettingsPanel>("manager-settings-panel", "settings");
  const panel: Panel = section === "settings" ? settingsPanel : section;
  const pageTitle = section === "settings" ? "تنظیمات" : section === "finance" ? "حسابداری" : section === "payments" ? "تاریخچه‌ی پرداخت" : section === "catalog" ? "منو و کالاها" : "انبار";
  const [catalog, setCatalog] = useState<ManagerCatalog | null>(null);
  const [staff, setStaff] = useState<ManagerStaff | null>(null);
  const [settings, setSettings] = useState<ManagerSettings | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [confirm, setConfirm] = useState<Confirm>(null);

  useEffect(() => {
    let cancelRecovery: (() => void) | undefined;
    const failed = (event: Event) => {
      const error = (event as CustomEvent<ApiFailure>).detail;
      cancelRecovery?.();
      cancelRecovery = undefined;
      if (error.kind === "network") {
        setFailure(error);
        cancelRecovery = requestAutomaticRecovery();
      }
    };
    const notified = (event: Event) => setFailure({ kind: "network", message: (event as CustomEvent<string>).detail });
    window.addEventListener("run-cafe:api-failure", failed);
    window.addEventListener(recoveryNoticeEvent, notified);
    return () => { cancelRecovery?.(); window.removeEventListener("run-cafe:api-failure", failed); window.removeEventListener(recoveryNoticeEvent, notified); };
  }, []);
  useEffect(() => {
    if (loading || failure || !catalog || (role === "MANAGER" && (!staff || !settings))) return;
    const healthy = window.setTimeout(finishRecoveryEpisode, 30_000);
    return () => window.clearTimeout(healthy);
  }, [loading, failure, catalog, staff, settings, role]);
  const reloadCatalog = useCallback(async () => {
    const result = role === "MANAGER" ? await readManagerCatalog() : await readStaffCatalog();
    if (result.ok) setCatalog(result.data);
    return result;
  }, [role]);
  const reloadStaff = useCallback(async () => {
    const result = await readManagerStaff();
    if (result.ok) setStaff(result.data);
    return result;
  }, []);
  const reloadSettings = useCallback(async () => {
    const result = await readManagerSettings();
    if (result.ok) setSettings(result.data);
    return result;
  }, []);
  const reloadAll = useCallback(async () => {
    setLoading(true);
    const results = role === "MANAGER"
      ? await Promise.all([reloadCatalog(), reloadStaff(), reloadSettings()])
      : [await reloadCatalog()];
    const failed = results.find((result) => !result.ok);
    setFailure(failed && !failed.ok ? failed.error : null);
    setLoading(false);
  }, [reloadCatalog, reloadSettings, reloadStaff, role]);
  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);
  useEffect(() => {
    setOnline(navigator.onLine);
    const handleOffline = () => setOnline(false);
    const handleOnline = () => setOnline(true);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);
  const mutate = async (
    action: () => Promise<{ ok: boolean; error?: ApiFailure }>,
    reload: () => Promise<unknown>,
  ) => {
    const result = await action();
    if (result.ok) {
      await reload();
      setFailure(null);
      return;
    }
    const error = result.error ?? { kind: "response" as const, message: "عملیات انجام نشد. دوباره تلاش کنید." };
    setFailure(error);
    throw new Error(error.message);
  };

  return (
    <section className="pos-workspace manager-workspace" aria-busy={loading}>
      <header className="workspace-header">
        <div className="header-actions">
          <span className={`connection ${!online ? "connection--offline" : loading || failure ? "connection--busy" : "connection--connected"}`} role="status" aria-label={!online ? "اتصال شبکه قطع است" : failure ? "بخشی از اطلاعات مدیریت به‌روز نیست" : loading ? "در حال دریافت اطلاعات تازه" : "اتصال برقرار است"}>
            <WifiIcon />
            <span>{!online ? "قطع ارتباط" : failure ? "اطلاعات ناقص" : loading ? "در حال به‌روزرسانی" : "متصل"}</span>
          </span>
          <button className={`icon-button refresh-button${loading ? " is-refreshing" : ""}`} type="button" disabled={loading} onClick={() => void reloadAll()} aria-label="دریافت اطلاعات تازه‌ی مدیریت" title="دریافت اطلاعات تازه‌ی مدیریت">
            <RefreshIcon />
          </button>
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? "بستن منو" : "باز کردن منو"}
            aria-expanded={menuOpen}
            onClick={onOpenMenu}
          >
            <MenuIcon />
          </button>
        </div>
        {failure && (
          <div className="workspace-header__notices">
            <div className="manager-notice" role="status">
              <strong>بخشی از اطلاعات مدیریت به‌روز نیست.</strong>
              <span>{failure.message}</span>
              <button type="button" onClick={() => void reloadAll()}>
                تلاش دوباره
              </button>
            </div>
          </div>
        )}
        <div className="workspace-title">
          <h1>{pageTitle}</h1>
        </div>
      </header>
      {section === "settings" && <nav className="manager-tabs" aria-label="بخش‌های تنظیمات">
        {([
          ["settings", "تنظیمات"],
          ["tables", "میزها"],
          ["audit", "حسابرسی"],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={settingsPanel === id ? "is-active" : ""}
            onClick={() => setSettingsPanel(id)}
          >
            {label}
          </button>
        ))}
      </nav>}
      {loading && <div className="manager-empty">در حال دریافت اطلاعات مدیریت…</div>}
      {!loading && panel === "catalog" && catalog && (
        <CatalogPanel
          catalog={catalog}
          mutate={mutate}
          reload={reloadCatalog}
          requestConfirm={setConfirm}
        />
      )}
      {!loading && panel === "tables" && catalog && <TablesPanel catalog={catalog} mutate={mutate} reload={reloadCatalog} requestConfirm={setConfirm} />}
      {!loading && panel === "inventory" && catalog && (settings?.inventoryActivatedAt
        ? <InventoryWorkspace catalog={catalog} />
        : <ManagerCard title="انبار غیرفعال است" hint="برای شروع، انبار را از تنظیمات کافه فعال کنید. تا آن زمان، هیچ سفارشی در انبار ثبت نمی‌شود.">
            <p>از منوی اصلی، تنظیمات را باز کنید.</p>
          </ManagerCard>)}
      {!loading && (panel === "finance" || panel === "payments" || panel === "audit") && (
        <FinancePanel panel={panel} role={role} tables={catalog?.tables ?? []} mutate={mutate} requestConfirm={setConfirm} />
      )}
      {!loading && panel === "settings" && settings && (
        <SettingsPanel settings={settings} staff={staff} mutate={mutate} reload={reloadSettings} reloadStaff={reloadStaff} requestConfirm={setConfirm} />
      )}
      {confirm && <ConfirmDialog confirm={confirm} close={() => setConfirm(null)} />}
    </section>
  );
}

function LegacyCatalogPanel({
  catalog,
  mutate,
  reload,
  requestConfirm,
}: {
  catalog: ManagerCatalog;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  return (
    <div className="manager-grid">
      <ManagerCard title="دسته‌ها" hint="نام، ترتیب نمایش و وضعیت فروش">
        <EntityForm
          submit={(data) =>
            mutate(
              () =>
                saveCategory(null, {
                  name: text(data.get("name")),
                  displayOrder: number(data.get("displayOrder")),
                  isActive: true,
                }),
              reload,
            )
          }
          fields={[
            ["name", "نام دسته", "text"],
            ["displayOrder", "ترتیب نمایش", "number"],
          ]}
          action="افزودن دسته"
        />
        <ul className="manager-list">
          {catalog.categories.map((row) => (
            <li key={row.id}>
              <EditableRow
                label={row.name}
                meta={`ترتیب ${row.displayOrder}`}
                onSave={(data) =>
                  mutate(
                    () =>
                      saveCategory(row.id, {
                        name: text(data.get("name")),
                        displayOrder: number(data.get("displayOrder")),
                      }),
                    reload,
                  )
                }
                fields={[
                  ["name", "نام", "text", row.name],
                  ["displayOrder", "ترتیب نمایش", "number", row.displayOrder],
                ]}
              />
              <DangerButton
                label="حذف دسته"
                onClick={() =>
                  requestConfirm({
                    title: "حذف دسته",
                    detail: `دسته‌ی «${row.name}» از فهرست فعال خارج می‌شود؛ سابقه‌ی آن حفظ خواهد شد.`,
                    run: async () => {
                      await mutate(() => archiveCategory(row.id), reload);
                    },
                  })
                }
              />
            </li>
          ))}
        </ul>
      </ManagerCard>
      <ManagerCard title="محصولات" hint="قیمت، زمان آماده‌سازی، گزینه‌ها و تصویر محصول">
        <ProductForm
          catalog={catalog}
          submit={(body) => mutate(() => saveProduct(null, body), reload)}
          action="افزودن محصول"
        />
        <ul className="manager-list">
          {catalog.products.map((row) => (
            <li key={row.id}>
              <details>
                <summary>
                  {row.name}{" "}
                  <small>
                    {formatToman(row.priceAmount)} · {row.isAvailable ? "موجود" : "ناموجود"}
                  </small>
                </summary>
                <ProductForm
                  catalog={catalog}
                  initial={row}
                  submit={(body) => mutate(() => saveProduct(row.id, body), reload)}
                  action="ذخیره محصول"
                />
                <ImageForm
                  productId={row.id}
                  hasImage={Boolean(row.image)}
                  mutate={mutate}
                  reload={reload}
                  requestConfirm={requestConfirm}
                />
                <DangerButton
                  label="بایگانی محصول"
                  onClick={() =>
                    requestConfirm({
                      title: "بایگانی محصول",
                      detail: `محصول «${row.name}» از فهرست فعال خارج می‌شود؛ تصویر و سابقه‌ی سفارش‌ها حفظ می‌شود.`,
                      run: async () => {
                        await mutate(() => archiveProduct(row.id), reload);
                      },
                    })
                  }
                />
              </details>
            </li>
          ))}
        </ul>
      </ManagerCard>
      <ManagerCard title="گروه‌های گزینه" hint="هر گروه گزینه می‌تواند برای چند محصول استفاده شود.">
        <EntityForm
          submit={(data) =>
            mutate(
              () => saveOptionGroup(null, { name: text(data.get("name")), isActive: true }),
              reload,
            )
          }
          fields={[["name", "نام گروه", "text"]]}
          action="افزودن گروه"
        />
        <ul className="manager-list">
          {catalog.optionGroups.map((group) => (
            <li key={group.id}>
              <details>
                <summary>
                  {group.name} <small>{group.isActive ? "فعال" : "غیرفعال"}</small>
                </summary>
                <EntityForm
                  submit={(data) =>
                    mutate(
                      () =>
                        saveOptionGroup(group.id, {
                          name: text(data.get("name")),
                          isActive: data.get("isActive") === "on",
                        }),
                      reload,
                    )
                  }
                  fields={[
                    ["name", "نام گروه", "text", group.name],
                    ["isActive", "فعال", "checkbox", group.isActive],
                  ]}
                  action="ذخیره گروه"
                />
                <OptionForm
                  groupId={group.id}
                  submit={(body) => mutate(() => saveOption(group.id, null, body), reload)}
                  action="افزودن گزینه"
                />
                {group.options.map((item) => (
                  <div className="manager-subrow" key={item.id}>
                    <OptionForm
                      groupId={group.id}
                      initial={item}
                      submit={(body) => mutate(() => saveOption(group.id, item.id, body), reload)}
                      action="ذخیره گزینه"
                    />
                    <DangerButton
                      label="بایگانی"
                      onClick={() =>
                        requestConfirm({
                          title: "بایگانی گزینه",
                          detail: `گزینه‌ی «${item.name}» دیگر برای سفارش‌های تازه قابل انتخاب نیست؛ سابقه‌ی سفارش‌ها حفظ می‌شود.`,
                          run: async () => {
                            await mutate(() => archiveOption(group.id, item.id), reload);
                          },
                        })
                      }
                    />
                  </div>
                ))}
              </details>
            </li>
          ))}
        </ul>
      </ManagerCard>
      </div>
  );
}

function TablesPanel({ catalog, mutate, reload, requestConfirm }: {
  catalog: ManagerCatalog;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  return (
    <div className="manager-grid">
      <ManagerCard title="میزهای فیزیکی" hint="ترتیب نمایش و فعال‌بودن درخواست میزبان">
        <TableForm
          submit={(body) => mutate(() => saveTable(null, body), reload)}
          action="افزودن میز"
        />
        <ul className="manager-list">
          {catalog.tables.map((row) => (
            <li key={row.id}>
              <details>
                <summary>
                  {row.name}{" "}
                  <small>
                    {row.isActive ? "فعال" : "غیرفعال"}
                  </small>
                </summary>
                <TableForm
                  initial={row}
                  submit={(body) => mutate(() => saveTable(row.id, body), reload)}
                  action="ذخیره میز"
                />
                <DangerButton
                  label="بایگانی میز"
                  onClick={() =>
                    requestConfirm({
                      title: "بایگانی میز",
                      detail: `میز «${row.name}» از سالن فعال خارج می‌شود؛ سابقه‌ی سفارش‌ها حفظ می‌شود.`,
                      run: async () => {
                        await mutate(() => archiveTable(row.id), reload);
                      },
                    })
                  }
                />
              </details>
            </li>
          ))}
        </ul>
      </ManagerCard>
    </div>
  );
}

function StaffPanel({
  staff,
  mutate,
  reload,
  requestConfirm,
}: {
  staff: ManagerStaff;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  return (
    <ManagerCard title="حساب‌های پرسنل" hint="حساب مدیر در این فهرست نمایش داده نمی‌شود.">
      <EntityForm
        submit={(data) =>
          mutate(
            () =>
              saveStaff(null, {
                username: text(data.get("username")),
                password: text(data.get("password")),
              }),
            reload,
          )
        }
        fields={[
          ["username", "نام کاربری", "text"],
          ["password", "رمز عبور (حداقل 12 کاراکتر)", "password"],
        ]}
        action="ساخت حساب پرسنل"
      />
      <ul className="manager-list">
        {staff.map((row) => (
          <li key={row.id}>
            <details>
              <summary>
                {row.username} <small>{row.isActive ? "فعال" : "غیرفعال"}</small>
              </summary>
              <EntityForm
                submit={(data) => {
                  const password = text(data.get("password"));
                  return mutate(
                    () =>
                      saveStaff(row.id, {
                        username: text(data.get("username")),
                        ...(password ? { password } : {}),
                      }),
                    reload,
                  );
                }}
                fields={[
                  ["username", "نام کاربری", "text", row.username],
                  ["password", "رمز جدید (اختیاری)", "password"],
                ]}
                action="ذخیره حساب"
              />
              {row.isActive ? (
                <DangerButton
                  label="غیرفعال‌سازی"
                  onClick={() =>
                    requestConfirm({
                      title: "غیرفعال‌سازی پرسنل",
                      detail: `حساب «${row.username}» غیرفعال می‌شود و همه‌ی نشست‌های فعال این حساب پایان می‌یابد.`,
                      run: async () => {
                        await mutate(() => deactivateStaff(row.id), reload);
                      },
                    })
                  }
                />
              ) : (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void mutate(() => reactivateStaff(row.id), reload)}
                >
                  فعال‌سازی دوباره
                </button>
              )}
            </details>
          </li>
        ))}
      </ul>
    </ManagerCard>
  );
}

function FinancePanel({
  panel,
  role,
  tables,
  mutate,
  requestConfirm,
}: {
  panel: "finance" | "payments" | "audit";
  role: "STAFF" | "MANAGER";
  tables: ManagerCatalog["tables"];
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  const [payments, setPayments] = useState<PaymentHistory>([]);
  const [paymentListFilter, setPaymentListFilter] = useState<PaymentListFilter>(null);
  const [unpaidOrders, setUnpaidOrders] = useState<OrderSummary[]>([]);
  const [staffTables, setStaffTables] = useState<Array<{ id: string; name: string }>>([]);
  const [unpaidOrdersCursor, setUnpaidOrdersCursor] = useState<string | null>(null);
  const [unpaidOrdersHasMore, setUnpaidOrdersHasMore] = useState(false);
  const [loadingUnpaidOrders, setLoadingUnpaidOrders] = useState(false);
  const [draftPaymentFilters, setDraftPaymentFilters] = useRecoveryState<PaymentFilterDraft>("payment-draft-filters", initialPaymentFilterDraft);
  const paymentYear = tehranPersianDateParts().year;
  const steppedPaymentDates = useMemo(() => ({
    fromNext: shiftPaymentDate(paymentYear, draftPaymentFilters.fromDate, 1),
    fromPrevious: shiftPaymentDate(paymentYear, draftPaymentFilters.fromDate, -1),
    toNext: shiftPaymentDate(paymentYear, draftPaymentFilters.toDate, 1),
    toPrevious: shiftPaymentDate(paymentYear, draftPaymentFilters.toDate, -1),
  }), [draftPaymentFilters.fromDate, draftPaymentFilters.toDate, paymentYear]);
  const [datePreset, setDatePreset] = useState<PaymentDatePreset>("today");
  const [appliedPaymentFilters, setAppliedPaymentFilters] = useRecoveryState<PaymentHistoryFilters>("payment-applied-filters", () => {
    const filters = paymentFiltersFromDraft(initialPaymentFilterDraft());
    if (!filters) throw new Error("Unable to resolve the current Tehran date.");
    return filters;
  });
  const [report, setReport] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PosOrderDetail | null>(null);
  const [editingSettlementId, setEditingSettlementId] = useState<string | null>(null);
  const [paymentSort, setPaymentSort] = useState<{ key: PaymentSortKey; direction: "asc" | "desc" }>({
    key: "recordedAt",
    direction: "desc",
  });
  const [auditFilters, setAuditFilters] = useRecoveryState("audit-filters", {
    operation: "",
    entityType: "",
    actorId: "",
    entityId: "",
    orderId: "",
    sortBy: "occurredAt",
    sortDirection: "desc",
  });
  const auditFiltersRef = useRef(auditFilters);
  useEffect(() => {
    auditFiltersRef.current = auditFilters;
  }, [auditFilters]);
  const loadPayments = useCallback(async (filters: PaymentHistoryFilters, orderFilter?: PaymentHistoryOrderFilter) => {
    const result = orderFilter ? await readPaymentHistory(filters, orderFilter) : await readPaymentHistory(filters);
    if (result.ok) {
      setPayments(result.data);
    } else setMessage(result.error.message);
  }, []);
  const refreshPayments = () => paymentListFilter && paymentListFilter !== "PREVIOUS_UNPAID"
    ? loadPayments(appliedPaymentFilters, paymentListFilter)
    : loadPayments(appliedPaymentFilters);
  const loadPreviousUnpaidOrders = useCallback(async (cursor?: string, append = false) => {
    const [year = 0, month = 1, day = 1] = appliedPaymentFilters.fromDate.split("-").map(Number);
    const rangeStart = Date.UTC(year, month - 1, day) - (3.5 * 60 * 60 * 1000);
    const result = await readOrderList({
      state: "OPEN",
      paymentStatus: "UNPAID",
      to: new Date(rangeStart - 1).toISOString(),
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (result.ok) {
      setUnpaidOrders((current) => append ? [...current, ...result.data.data.orders] : result.data.data.orders);
      setUnpaidOrdersCursor(result.data.meta.page.nextCursor);
      setUnpaidOrdersHasMore(result.data.meta.page.hasMore);
    } else setMessage(result.error.message);
    setLoadingUnpaidOrders(false);
  }, [appliedPaymentFilters.fromDate]);
  const loadReport = useCallback(async (filters: PaymentHistoryFilters) => {
    const result = await readDailyReport(filters);
    if (result.ok) setReport(result.data);
    else setMessage(result.error.message);
  }, []);
  const loadAudit = useCallback(
    async (next?: string, append = false, filters = auditFiltersRef.current) => {
      const activeFilters = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value),
      );
      const result = await readAuditLog(next, activeFilters);
      if (result.ok)
        setAudit((current: any) =>
          append && current
            ? {
                ...result.data,
                data: { entries: [...current.data.entries, ...result.data.data.entries] },
              }
            : result.data,
        );
      else setMessage(result.error.message);
    },
    [],
  );
  useEffect(() => {
    void Promise.all([
      loadPayments(appliedPaymentFilters, paymentListFilter === "PREVIOUS_UNPAID" ? undefined : paymentListFilter ?? undefined),
      ...(role === "MANAGER" ? [loadReport(appliedPaymentFilters), loadAudit()] : []),
    ]);
  }, [appliedPaymentFilters, loadAudit, loadPayments, loadReport, paymentListFilter, role]);
  useEffect(() => {
    if (paymentListFilter !== "PREVIOUS_UNPAID") return;
    setUnpaidOrders([]);
    setUnpaidOrdersCursor(null);
    setUnpaidOrdersHasMore(false);
    setLoadingUnpaidOrders(true);
    void loadPreviousUnpaidOrders();
  }, [paymentListFilter, loadPreviousUnpaidOrders]);
  useEffect(() => {
    if (role !== "STAFF" || paymentListFilter !== "PREVIOUS_UNPAID") return;
    let cancelled = false;
    void readPosTables().then((result) => {
      if (cancelled) return;
      if (result.ok) setStaffTables(result.data.tables);
      else setMessage(result.error.message);
    });
    return () => { cancelled = true; };
  }, [role, paymentListFilter]);
  const sortedPayments = useMemo(() => {
    const valueFor = (item: PaymentHistory[number]) => {
      switch (paymentSort.key) {
        case "order": return item.dailyOrderNumber;
        case "recordedAt": return new Date(item.recordedAt).getTime();
        case "context": return paymentContext(item);
        case "amount": return item.totalAmount;
        case "method": return paymentMethods(item);
        case "recordedBy": return item.recordedBy.username;
        case "status": return item.orderState === "DELETED" ? "حذف‌شده" : item.reversedAt ? "برگشت‌خورده" : "ثبت‌شده";
      }
    };
    return [...payments].sort((left, right) => {
      const leftValue = valueFor(left);
      const rightValue = valueFor(right);
      const compared = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "fa");
      return paymentSort.direction === "asc" ? compared : -compared;
    });
  }, [paymentSort, payments]);
  const changePaymentSort = (key: PaymentSortKey) => {
    setPaymentSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  return (
    <div className={`manager-grid${panel === "finance" || panel === "payments" ? " finance-dashboard-grid" : ""}`}>
      {(panel === "finance" || panel === "payments") && <div className="finance-dashboard">
      {panel === "finance" && role === "MANAGER" && <ManagerCard className="manager-card--accounting" title="نمای کلی مالی" hint="گزارش بر اساس بازه‌ی انتخاب‌شده برای پرداخت‌ها.">
        {report ? <>
          <div className="finance-metrics">
            <article className="finance-metric finance-metric--primary"><span>کل</span><strong>{formatToman(report.data.salesAmount)}</strong><small>تومان</small></article>
            <article className="finance-metric finance-metric--primary"><span>تسویه شده</span><strong>{formatToman(report.data.paidAmount)}</strong><small>تومان</small></article>
            <article className="finance-metric"><span>کارت‌به‌کارت</span><strong>{formatToman(report.data.paymentMethodTotals.cardTransferAmount)}</strong><small>تومان</small></article>
            <article className="finance-metric"><span>نقدی</span><strong>{formatToman(report.data.paymentMethodTotals.cashAmount)}</strong><small>تومان</small></article>
          </div>
          <details className="finance-breakdown">
            <summary>جزئیات گزارش و برگشت‌ها</summary>
            <dl className="report-grid">
              <dt>بازه</dt><dd>{new Date(report.meta.range.from).toLocaleString("fa-IR-u-nu-latn")} تا {new Date(report.meta.range.to).toLocaleString("fa-IR-u-nu-latn")}</dd>
              <dt>تعداد سفارش</dt><dd>{Number(report.data.orderCount).toLocaleString("fa-IR-u-nu-latn")} سفارش</dd>
              <dt>تخفیف</dt><dd>{formatToman(report.data.discounts.totalAmount)} تومان</dd>
              <dt>برگشت‌ها</dt><dd>{Number(report.data.reversals.count).toLocaleString("fa-IR-u-nu-latn")} مورد · {formatToman(report.data.reversals.amount)}</dd>
            </dl>
          </details>
        </> : <div className="finance-loading" role="status">در حال دریافت گزارش مالی…</div>}
      </ManagerCard>}
      <ManagerCard className="finance-filter-card" title="فیلتر پرداخت‌ها" hint="بازه‌ی زمانی و ساعت ثبت پرداخت را مشخص کنید.">
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="finance-filter-toolbar">
          <div className="finance-date-presets" role="group" aria-label="بازه‌ی تاریخ">
            {([["today", "امروز"], ["yesterday", "دیروز"], ["last7", "7 روز اخیر"], ["custom", "بازه دلخواه"]] as const).map(([preset, label]) => (
              <button key={preset} type="button" className={datePreset === preset ? "is-active" : ""} aria-pressed={datePreset === preset} onClick={() => {
                setDatePreset(preset);
                if (preset === "custom") { setDraftPaymentFilters((current) => ({ ...current, currentDay: false })); return; }
                const { draft, filters } = paymentDatePresetRange(preset);
                setDraftPaymentFilters(draft);
                setMessage(null); setAppliedPaymentFilters(filters);
              }}>{label}</button>
            ))}
          </div>
        </div>
        {datePreset !== "today" && <p className="finance-active-filter">بازه‌ی فعال: {datePreset === "yesterday" ? "دیروز" : datePreset === "last7" ? "7 روز اخیر" : `${draftPaymentFilters.fromDate} تا ${draftPaymentFilters.toDate}`}{draftPaymentFilters.fromTime || draftPaymentFilters.toTime ? ` · ${draftPaymentFilters.fromTime || "ابتدای روز"} تا ${draftPaymentFilters.toTime || "پایان روز"}` : " · تمام ساعت‌ها"}</p>}
        <form className="finance-advanced-filters" onSubmit={(event) => {
          event.preventDefault();
          const filters = paymentFiltersFromDraft(draftPaymentFilters);
          if (!filters) { setMessage("تاریخ را با قالب ماه/روز و ساعت را با قالب ساعت:دقیقه وارد کنید. تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد."); return; }
          setMessage(null); setDatePreset("custom"); setAppliedPaymentFilters(filters);
        }}>
          <div className="finance-advanced-fields">
            <div className="finance-date-fields">
              <label>
                <span>از تاریخ</span>
                <div className="finance-date-input">
                  <input aria-label="از تاریخ" value={draftPaymentFilters.fromDate} placeholder="MM/DD شمسی" inputMode="numeric" disabled={draftPaymentFilters.currentDay} onChange={(event) => { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, fromDate: event.target.value })); }} />
                  <span className="finance-date-stepper">
                    <button type="button" aria-label="روز بعد برای تاریخ شروع" title="روز بعد" disabled={draftPaymentFilters.currentDay || !steppedPaymentDates.fromNext} onClick={() => { const fromDate = steppedPaymentDates.fromNext; if (fromDate) { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, fromDate })); } }}>▲</button>
                    <button type="button" aria-label="روز قبل برای تاریخ شروع" title="روز قبل" disabled={draftPaymentFilters.currentDay || !steppedPaymentDates.fromPrevious} onClick={() => { const fromDate = steppedPaymentDates.fromPrevious; if (fromDate) { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, fromDate })); } }}>▼</button>
                  </span>
                </div>
              </label>
              <label>
                <span>تا تاریخ</span>
                <div className="finance-date-input">
                  <input aria-label="تا تاریخ" value={draftPaymentFilters.toDate} placeholder="MM/DD شمسی" inputMode="numeric" disabled={draftPaymentFilters.currentDay} onChange={(event) => { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, toDate: event.target.value })); }} />
                  <span className="finance-date-stepper">
                    <button type="button" aria-label="روز بعد برای تاریخ پایان" title="روز بعد" disabled={draftPaymentFilters.currentDay || !steppedPaymentDates.toNext} onClick={() => { const toDate = steppedPaymentDates.toNext; if (toDate) { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, toDate })); } }}>▲</button>
                    <button type="button" aria-label="روز قبل برای تاریخ پایان" title="روز قبل" disabled={draftPaymentFilters.currentDay || !steppedPaymentDates.toPrevious} onClick={() => { const toDate = steppedPaymentDates.toPrevious; if (toDate) { setDatePreset("custom"); setDraftPaymentFilters((current) => ({ ...current, currentDay: false, toDate })); } }}>▼</button>
                  </span>
                </div>
              </label>
            </div>
          <label>
            <span>بازه‌ی پرداخت</span>
            <select aria-label="بازه‌ی پرداخت" value={
              draftPaymentFilters.fromTime === "08:00" && draftPaymentFilters.toTime === "16:00" ? "morning"
                : draftPaymentFilters.fromTime === "16:00" && !draftPaymentFilters.toTime ? "evening"
                  : "all"
            } onChange={(event) => {
              const shift = event.target.value;
              // An omitted upper bound means the end of each selected local
              // date, including 23:59:59. Using 00:00 would create an overnight window.
              const draft = { ...draftPaymentFilters, fromTime: shift === "morning" ? "08:00" : shift === "evening" ? "16:00" : "", toTime: shift === "morning" ? "16:00" : "" };
              setDraftPaymentFilters(draft);
              setDatePreset("custom");
              const filters = paymentFiltersFromDraft(draft);
              if (filters) {
                setMessage(null);
                setAppliedPaymentFilters(filters);
              } else setMessage("تاریخ را با قالب ماه/روز وارد کنید. تاریخ شروع نمی‌تواند بعد از تاریخ پایان باشد.");
            }}>
              <option value="all">تمام ساعت‌ها</option>
              <option value="morning">شیفت اول (08:00 تا 16:00)</option>
              <option value="evening">شیفت دوم (از 16:00 تا پایان روز)</option>
            </select>
          </label>
          <div className="finance-time-fields">
            <label>
              <span>از ساعت</span>
              <input aria-label="از ساعت" value={draftPaymentFilters.fromTime} placeholder="HH:MM" inputMode="numeric" onChange={(event) => setDraftPaymentFilters((current) => ({ ...current, fromTime: event.target.value }))} />
            </label>
            <label>
              <span>تا ساعت</span>
              <input aria-label="تا ساعت" value={draftPaymentFilters.toTime} placeholder="HH:MM" inputMode="numeric" onChange={(event) => setDraftPaymentFilters((current) => ({ ...current, toTime: event.target.value }))} />
            </label>
          </div>
          </div>
          <div className="manager-actions finance-filter-actions">
            <button type="button" className="secondary-button" onClick={() => {
              const initial = initialPaymentFilterDraft();
              const filters = paymentFiltersFromDraft(initial);
              if (filters) {
                setDraftPaymentFilters(initial);
                setAppliedPaymentFilters(filters);
                setDatePreset("today");
                setMessage(null);
              }
            }}>بازنشانی فیلترها</button>
            <button type="submit">نمایش نتایج</button>
          </div>
        </form>
      </ManagerCard>
      <ManagerCard className="manager-card--payments" title="تاریخچه‌ی پرداخت و سفارش">
        <div className="finance-history-filters" role="group" aria-label="فیلتر سفارش‌ها">
          <button type="button" className={`secondary-button${paymentListFilter === null ? " is-active" : ""}`} aria-pressed={paymentListFilter === null} onClick={() => setPaymentListFilter(null)}>همه</button>
          <button type="button" className={`secondary-button${paymentListFilter === "MULTIPLE_SETTLEMENTS" ? " is-active" : ""}`} aria-pressed={paymentListFilter === "MULTIPLE_SETTLEMENTS"} onClick={() => setPaymentListFilter((current) => current === "MULTIPLE_SETTLEMENTS" ? null : "MULTIPLE_SETTLEMENTS")}>تسویه‌ی چندمرحله‌ای</button>
          <button type="button" className={`secondary-button${paymentListFilter === "PREVIOUS_UNPAID" ? " is-active" : ""}`} aria-pressed={paymentListFilter === "PREVIOUS_UNPAID"} onClick={() => setPaymentListFilter((current) => current === "PREVIOUS_UNPAID" ? null : "PREVIOUS_UNPAID")}>پرداخت‌نشده‌ی روزهای قبل</button>
          <button type="button" className={`secondary-button${paymentListFilter === "DISCOUNTED" ? " is-active" : ""}`} aria-pressed={paymentListFilter === "DISCOUNTED"} onClick={() => setPaymentListFilter((current) => current === "DISCOUNTED" ? null : "DISCOUNTED")}>سفارش‌های تخفیف‌دار</button>
        </div>
        {paymentListFilter === "PREVIOUS_UNPAID" ? (
          <>
            <p className="finance-history-list-title">سفارش‌های پرداخت‌نشده پیش از شروع این بازه</p>
            <div className="manager-payment-table-wrap">
              <table className="manager-payment-table finance-unpaid-orders" aria-label="سفارش‌های پرداخت‌نشده‌ی روزهای قبل">
                <thead><tr><th scope="col">سفارش</th><th scope="col">زمان ثبت</th><th scope="col">محل سفارش</th><th scope="col">وضعیت پرداخت</th><th scope="col">مبلغ کل</th><th scope="col">مانده</th></tr></thead>
                <tbody>
                  {unpaidOrders.map((order) => (
                    <tr key={order.id}>
                      <td><strong>{formatOrderNumber(order.dailyOrderNumber)}</strong></td>
                      <td>{new Date(order.createdAt).toLocaleString("fa-IR-u-nu-latn")}</td>
                      <td>{order.channel === "TABLE" ? `میز ${(role === "STAFF" ? staffTables : tables).find((table) => table.id === order.tableId)?.name ?? "—"}` : "بیرون‌بر"}</td>
                      <td><span className="payment-status is-warning">پرداخت‌نشده</span></td>
                      <td className="payment-amount">{formatToman(order.totalAmount)} <small>تومان</small></td>
                      <td className="payment-amount">{formatToman(order.balanceAmount)} <small>تومان</small></td>
                    </tr>
                  ))}
                  {!loadingUnpaidOrders && unpaidOrders.length === 0 && <tr><td className="manager-payment-table__empty" colSpan={6}>سفارش پرداخت‌نشده‌ای پیش از این بازه پیدا نشد.</td></tr>}
                  {loadingUnpaidOrders && unpaidOrders.length === 0 && <tr><td className="manager-payment-table__empty" colSpan={6}>در حال بارگذاری سفارش‌ها…</td></tr>}
                </tbody>
              </table>
            </div>
            {unpaidOrdersHasMore && unpaidOrdersCursor && <div className="manager-actions"><button type="button" className="secondary-button" disabled={loadingUnpaidOrders} onClick={() => { setLoadingUnpaidOrders(true); void loadPreviousUnpaidOrders(unpaidOrdersCursor, true); }}>نمایش سفارش‌های بیشتر</button></div>}
          </>
        ) : <div className="manager-payment-table-wrap">
          <table className="manager-payment-table" aria-label="تاریخچه پرداخت‌ها">
            <thead>
              <tr>
                {([
                  ["order", "سفارش"], ["recordedAt", "زمان پرداخت"], ["context", "محل سفارش"],
                  ["amount", "مبلغ"], ["method", "روش پرداخت"], ["recordedBy", "ثبت‌کننده"], ["status", "وضعیت"],
                ] as const).map(([key, label]) => {
                  const active = paymentSort.key === key;
                  return (
                    <th key={key} aria-sort={active ? (paymentSort.direction === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => changePaymentSort(key)}>
                        {label}{active ? (paymentSort.direction === "desc" ? " ↓" : " ↑") : ""}
                      </button>
                    </th>
                  );
                })}
                <th scope="col">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {sortedPayments.map((item) => (
                <tr key={item.id}>
                  <td><strong>{formatOrderNumber(item.dailyOrderNumber)}</strong></td>
                  <td>{new Date(item.recordedAt).toLocaleString("fa-IR-u-nu-latn")}</td>
                  <td>{paymentContext(item)}</td>
                  <td className="payment-amount">{formatToman(item.totalAmount)} <small>تومان</small></td>
                  <td>{paymentMethods(item)}</td>
                  <td>{item.recordedBy.username}</td>
                  <td><span className={`payment-status ${item.orderState === "DELETED" ? "is-neutral" : item.reversedAt ? "is-warning" : "is-success"}`}>{item.orderState === "DELETED" ? "حذف‌شده" : item.reversedAt ? "برگشت‌خورده" : "ثبت‌شده"}</span></td>
                  <td className="manager-payment-table__actions">
                    <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  void printDocument(printRoute(item.orderId, "settlement", item.id)).catch((error: unknown) => {
                    setMessage(error instanceof Error ? error.message : "سند چاپ آماده نشد.");
                  })
                }
              >
                رسید تسویه
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={async () => {
                  const result = await readOrder(item.orderId);
                  if (result.ok) setSelectedOrder(result.data);
                  else setMessage(result.error.message);
                }}
              >
                جزئیات سفارش
              </button>
              {item.orderState !== "DELETED" && !item.reversedAt && <button
                className="secondary-button"
                type="button"
                onClick={async () => {
                  const result = await readOrder(item.orderId);
                  if (!result.ok) {
                    setMessage(result.error.message);
                    return;
                  }
                  setSelectedOrder(result.data);
                  setEditingSettlementId(item.id);
                }}
              >
                ویرایش پرداخت
              </button>}
              {item.orderState !== "DELETED" && !item.reversedAt && <button
                className="danger-button"
                type="button"
                onClick={() => requestConfirm({
                  title: "برگشت تسویه",
                  detail: `تسویه‌ی سفارش ${formatOrderNumber(item.dailyOrderNumber)} برگشت می‌خورد و مانده‌ی سفارش دوباره محاسبه می‌شود. اگر تنظیم مدیر الزام کرده باشد، باید دلیل وارد شود.`,
                  reasonLabel: "دلیل برگشت (اختیاری)",
                  reasonOptional: true,
                  run: async (reason) => {
                    const order = await readOrder(item.orderId);
                    if (!order.ok) throw new Error(order.error.message);
                    await mutate(
                      () => reverseSettlement(item.id, { expectedVersion: order.data.version, ...(reason ? { reason } : {}) }),
                      async () => {
                        await refreshPayments();
                        if (role === "MANAGER") await loadReport(appliedPaymentFilters);
                      },
                    );
                  },
                })}
              >
                برگشت تسویه
              </button>}
              {item.orderState !== "DELETED" && !item.reversedAt && <button
                className="danger-button"
                type="button"
                onClick={() =>
                  requestConfirm({
                    title: "حذف سفارش",
                    detail: `سفارش ${formatOrderNumber(item.dailyOrderNumber)} به‌صورت منطقی حذف می‌شود؛ پرداخت‌های فعال سفارش از گزارش فروش خارج می‌شوند؛ جزئیات پرداخت و سابقه‌ی حسابرسی حفظ می‌شوند.`,
                    run: async () => {
                      const order = await readOrder(item.orderId);
                      if (!order.ok) {
                        setMessage(order.error.message);
                        throw new Error(order.error.message);
                      }
                      await mutate(
                        () => deleteOpenOrder(item.orderId, { expectedVersion: order.data.version }),
                        async () => {
                          await refreshPayments();
                          if (role === "MANAGER") await loadReport(appliedPaymentFilters);
                        },
                      );
                    },
                  })
                }
              >
                حذف سفارش
              </button>}
                  </td>
                </tr>
              ))}
              {sortedPayments.length === 0 && (
                <tr><td className="manager-payment-table__empty" colSpan={8}>{paymentListFilter === "MULTIPLE_SETTLEMENTS" ? "تسویه‌ی چندمرحله‌ای در این بازه پیدا نشد." : paymentListFilter === "DISCOUNTED" ? "سفارش تخفیف‌داری در این بازه پیدا نشد." : "پرداختی در این بازه ثبت نشده است."}</td></tr>
              )}
            </tbody>
          </table>
        </div>}
      </ManagerCard>
      {selectedOrder && !editingSettlementId && (
        <div className="manager-dialog-backdrop" role="presentation" onClick={() => setSelectedOrder(null)}>
          <section className="manager-dialog" role="dialog" aria-modal="true" aria-labelledby="historical-order-title" onClick={(event) => event.stopPropagation()}>
            <header className="manager-dialog__header">
              <div>
                <p className="kicker">جزئیات سفارش</p>
                <h2 id="historical-order-title">{formatOrderNumber(selectedOrder.dailyOrderNumber)}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setSelectedOrder(null)}>بستن</button>
            </header>
            <p>{selectedOrder.channel === "TABLE" ? `میز: ${selectedOrder.tableName ?? "-"}` : "نوع سفارش: بیرون‌بر"}</p>
            <p>زمان ثبت: {new Date(selectedOrder.createdAt).toLocaleString("fa-IR-u-nu-latn")}</p>
            <ul className="manager-list">
              {selectedOrder.items.map((orderItem) => (
                <li key={orderItem.id}>
                  <strong>{orderItem.productNameSnapshot} × {orderItem.quantity}</strong>
                  <small>{orderItem.options.length ? orderItem.options.map((option) => `${option.optionNameSnapshot} × ${option.quantity}`).join("، ") : "بدون گزینه‌ی انتخاب‌شده"}</small>
                  <span>{formatToman(orderItem.lineTotalAmount)}</span>
                </li>
              ))}
            </ul>
            <dl className="report-grid">
              <dt>مجموع سفارش</dt><dd>{formatToman(selectedOrder.totalAmount)}</dd>
              <dt>پرداخت‌شده</dt><dd>{formatToman(selectedOrder.paidAmount)}</dd>
              <dt>باقی‌مانده</dt><dd>{formatToman(selectedOrder.balanceAmount)}</dd>
            </dl>
          </section>
        </div>
      )}
      {selectedOrder && editingSettlementId && (() => {
        const settlement = selectedOrder.settlements.find((candidate) => candidate.id === editingSettlementId);
        return settlement ? (
          <SettlementSheet
            order={selectedOrder}
            historicalSettlement={settlement}
            onClose={() => {
              setEditingSettlementId(null);
              setSelectedOrder(null);
            }}
            onSuccess={async () => {
              setEditingSettlementId(null);
              setSelectedOrder(null);
              await refreshPayments();
              if (role === "MANAGER") await loadReport(appliedPaymentFilters);
            }}
          />
        ) : null;
      })()}
      </div>}
      {panel === "audit" && <ManagerCard title="گزارش رویدادها" hint="رویدادهای ثبت‌شده در سامانه را ببینید.">
        <form
          className="manager-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loadAudit(undefined, false);
          }}
        >
          <div className="manager-fields">
            {(
              [
                ["operation", "عملیات"],
                ["entityType", "نوع رکورد"],
                ["actorId", "شناسه‌ی کاربر"],
                ["entityId", "شناسه‌ی رکورد"],
                ["orderId", "شناسه سفارش"],
              ] as const
            ).map(([name, label]) => (
              <label key={name}>
                <span>{label}</span>
                <input
                  value={auditFilters[name] ?? ""}
                  onChange={(event) =>
                    setAuditFilters((current) => ({ ...current, [name]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <button type="submit">نمایش نتایج</button>
        </form>
        <div className="manager-audit-table-wrap">
          <table className="manager-audit-table">
            <thead><tr>
              {([ ["occurredAt", "زمان"], ["operation", "عملیات"], ["entityType", "نوع رکورد"], ["actor", "کاربر"] ] as const).map(([sortBy, label]) => (
                <th key={sortBy}><button type="button" onClick={() => {
                  const sortDirection = auditFilters.sortBy === sortBy && auditFilters.sortDirection === "desc" ? "asc" : "desc";
                  const next = { ...auditFilters, sortBy, sortDirection };
                  setAuditFilters(next);
                  void loadAudit(undefined, false, next);
                }}>{label}{auditFilters.sortBy === sortBy ? (auditFilters.sortDirection === "desc" ? " ↓" : " ↑") : ""}</button></th>
              ))}
              <th>شناسه رکورد</th><th>شناسه سفارش</th><th>شناسه تسویه‌های مرتبط</th><th>دلیل</th>
            </tr></thead>
            <tbody>{audit?.data.entries.map((entry: any) => (
              <tr key={entry.id}>
                <td>{new Date(entry.occurredAt).toLocaleString("fa-IR-u-nu-latn")}</td>
                <td>{entry.operation}</td>
                <td>{entry.entityType}</td>
                <td>{entry.actor?.username ?? "سامانه"}</td>
                <td dir="ltr">{entry.entityId}</td>
                <td>{entry.relatedOrder ? <code dir="ltr">{entry.relatedOrder.id}</code> : "—"}</td>
                <td>{entry.relatedSettlementIds.length ? <span className="manager-audit-reference-list">
                  {entry.relatedSettlementIds.map((settlementId: string) => <code dir="ltr" key={settlementId}>{settlementId}</code>)}
                </span> : "—"}</td>
                <td>{entry.reason ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {audit?.meta.page.nextCursor && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadAudit(audit.meta.page.nextCursor, true)}
          >
            نمایش رویدادهای بیشتر
          </button>
        )}
      </ManagerCard>
      }
    </div>
  );
}

function SettingsPanel({
  settings,
  staff,
  mutate,
  reload,
  reloadStaff,
  requestConfirm,
}: {
  settings: ManagerSettings;
  staff: ManagerStaff | null;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  reloadStaff: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  const [seatingLimitEnabled, setSeatingLimitEnabled] = useState(
    settings.tableSeatingLimitMinutes !== null,
  );
  const [settlementReversalReasonRequired, setSettlementReversalReasonRequired] = useState(settings.settlementReversalReasonRequired);
  useEffect(() => setSettlementReversalReasonRequired(settings.settlementReversalReasonRequired), [settings.settlementReversalReasonRequired]);
  return (
    <div className="manager-grid">
    <ManagerCard title="تنظیمات کافه" hint="ثبت مدت حضور مشتری روی میز اختیاری است و با فعال‌سازی این گزینه در سفارش‌ها نمایش داده می‌شود.">
      <form
        className="manager-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate(
            () => saveSettings({
              tableSeatingLimitMinutes: seatingLimitEnabled ? number(data.get("minutes")) : null,
              settlementReversalReasonRequired,
            }),
            reload,
          );
        }}
      >
        <div className="manager-fields">
          <label>
            <input
              name="seatingLimitEnabled"
              type="checkbox"
              checked={seatingLimitEnabled}
              onChange={(event) => setSeatingLimitEnabled(event.target.checked)}
            />{" "}
            نمایش مدت حضور مشتری روی میز
          </label>
          <label>
            <input
              name="settlementReversalReasonRequired"
              type="checkbox"
              checked={settlementReversalReasonRequired}
              onChange={(event) => setSettlementReversalReasonRequired(event.target.checked)}
            />{" "}
            الزام ثبت دلیل برای برگشت تسویه
          </label>
          <label>
            <span>مدت حضور مشتری روی میز (دقیقه)</span>
            <input
              name="minutes"
              type="number"
              min="1"
              required={seatingLimitEnabled}
              disabled={!seatingLimitEnabled}
              defaultValue={settings.tableSeatingLimitMinutes ?? ""}
            />
          </label>
        </div>
        <button type="submit">ذخیره تنظیمات</button>
      </form>
    </ManagerCard>
    <ManagerCard title="فعال‌سازی انبار" hint="پس از فعال‌سازی، فقط سفارش‌های جدید وارد محاسبات و گردش موجودی می‌شوند. سفارش‌های قبلی شامل نمی‌شوند. این تغییر دائمی است و امکان غیرفعال‌کردن انبار وجود ندارد.">
      <label>
        <input type="checkbox" checked={settings.inventoryActivatedAt !== null} disabled={settings.inventoryActivatedAt !== null}
          onChange={() => requestConfirm({
            title: "انبار فعال شود؟",
            detail: "از این لحظه، انبار برای سفارش‌های جدید فعال می‌شود. سفارش‌های قبلی وارد انبار نمی‌شوند. پس از تأیید، امکان غیرفعال‌کردن انبار وجود ندارد.",
            run: () => mutate(activateInventory, reload),
          })} /> فعال‌سازی انبار
      </label>
      {settings.inventoryActivatedAt && <p role="status">انبار فعال است و امکان غیرفعال‌کردن آن وجود ندارد.</p>}
    </ManagerCard>
    {staff ? <StaffPanel staff={staff} mutate={mutate} reload={reloadStaff} requestConfirm={requestConfirm} /> : (
      <ManagerCard title="پرسنل" hint="فهرست پرسنل بارگذاری نشد.">
        <button className="secondary-button" type="button" onClick={() => void reloadStaff()}>تلاش دوباره</button>
      </ManagerCard>
    )}
    </div>
  );
}
function ManagerCard({
  className,
  title,
  hint,
  children,
}: {
  className?: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className={["manager-card", className].filter(Boolean).join(" ")}>
      <header>
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </header>
      {children}
    </section>
  );
}
function EntityForm({
  fields,
  action,
  submit,
}: {
  fields: any[];
  action: string;
  submit: (data: FormData) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="manager-form"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void submit(new FormData(event.currentTarget))
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <div className="manager-fields">
        {fields.map(([name, label, type, value]) => (
          <label key={name}>
            {type === "checkbox" ? (
              <>
                <input name={name} type="checkbox" defaultChecked={Boolean(value)} /> {label}
              </>
            ) : (
              <>
                <span>{label}</span>
                <input
                  name={name}
                  type={type}
                  required={type !== "password" || action.includes("ساخت")}
                  defaultValue={value ?? ""}
                  min={type === "number" ? 0 : undefined}
                />
              </>
            )}
          </label>
        ))}
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "در حال ثبت…" : action}
      </button>
    </form>
  );
}
function ProductForm({
  catalog,
  initial,
  action,
  submit,
}: {
  catalog: ManagerCatalog;
  initial?: any;
  action: string;
  submit: (body: any) => Promise<any>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <form
      className="manager-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(event.currentTarget);
        setBusy(true);
        void submit({
          categoryId: text(data.get("categoryId")),
          name: text(data.get("name")),
          priceAmount: number(data.get("priceAmount")),
          preparationDeadlineMinutes: number(data.get("preparationDeadlineMinutes")),
          displayOrder: number(data.get("displayOrder")),
          isActive: data.get("isActive") === "on",
          isAvailable: data.get("isAvailable") === "on",
          optionGroups: catalog.optionGroups.filter((group) => data.getAll("optionGroupIds").includes(group.id)).map((group, displayOrder) => ({ optionGroupId: group.id, displayOrder, minSelections: number(data.get(`min-${group.id}`)), maxSelections: number(data.get(`max-${group.id}`)), options: group.options.filter((option) => data.getAll(`optionIds-${group.id}`).includes(option.id)).map((option, optionOrder) => { const raw = data.get(`override-${group.id}-${option.id}`); return { optionId: option.id, displayOrder: optionOrder, priceAmountOverride: raw === "" ? null : number(raw) }; }) })),
        })
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <div className="manager-fields">
        <label>
          <span>دسته</span>
          <select name="categoryId" defaultValue={initial?.categoryId}>
            {catalog.categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>نام</span>
          <input name="name" required defaultValue={initial?.name ?? ""} />
        </label>
        <label>
          <span>قیمت (تومان)</span>
          <input
            name="priceAmount"
            type="number"
            min="0"
            required
            defaultValue={initial?.priceAmount ?? 0}
          />
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
        <label>
          <span>ترتیب</span>
          <input
            name="displayOrder"
            type="number"
            min="0"
            required
            defaultValue={initial?.displayOrder ?? 0}
          />
        </label>
        <label>
          <input name="isActive" type="checkbox" defaultChecked={initial?.isActive ?? true} /> فعال
        </label>
        <label>
          <input name="isAvailable" type="checkbox" defaultChecked={initial?.isAvailable ?? true} />{" "}
          موجود
        </label>
      </div>
      <fieldset>
        <legend>گروه‌های گزینه</legend>
        {catalog.optionGroups.map((item) => {
          const configured = initial?.optionGroups?.find((group: any) => group.optionGroupId === item.id);
          return <details key={item.id}>
            <summary><input name="optionGroupIds" type="checkbox" value={item.id} defaultChecked={Boolean(configured)} /> {item.name}</summary>
            <label>حداقل <input name={`min-${item.id}`} type="number" min="0" defaultValue={configured?.minSelections ?? 1} /></label>
            <label>حداکثر <input name={`max-${item.id}`} type="number" min="1" defaultValue={configured?.maxSelections ?? 1} /></label>
            {item.options.map((option) => {
              const selected = configured?.options?.find((entry: any) => entry.optionId === option.id);
              return <label key={option.id}><input name={`optionIds-${item.id}`} type="checkbox" value={option.id} defaultChecked={Boolean(selected)} /> {option.name} <input name={`override-${item.id}-${option.id}`} type="number" min="0" placeholder={`پیش‌فرض ${formatToman(option.priceAmount)}`} defaultValue={selected?.priceAmountOverride ?? ""} /></label>;
            })}
          </details>;
        })}
      </fieldset>
      <button type="submit" disabled={busy}>
        {busy ? "در حال ثبت…" : action}
      </button>
    </form>
  );
}
function OptionForm({
  initial,
  action,
  submit,
}: {
  groupId: string;
  initial?: any;
  action: string;
  submit: (body: any) => Promise<any>;
}) {
  return (
    <EntityForm
      action={action}
      submit={(data) =>
        submit({
          name: text(data.get("name")),
          priceAmount: number(data.get("priceAmount")),
          displayOrder: number(data.get("displayOrder")),
          isActive: data.get("isActive") === "on",
          isAvailable: data.get("isAvailable") === "on",
        })
      }
      fields={[
        ["name", "نام", "text", initial?.name],
        ["priceAmount", "قیمت اضافه", "number", initial?.priceAmount ?? 0],
        ["displayOrder", "ترتیب نمایش", "number", initial?.displayOrder ?? 0],
        ["isActive", "فعال", "checkbox", initial?.isActive ?? true],
        ["isAvailable", "موجود", "checkbox", initial?.isAvailable ?? true],
      ]}
    />
  );
}
function TableForm({
  initial,
  action,
  submit,
}: {
  initial?: any;
  action: string;
  submit: (body: any) => Promise<any>;
}) {
  return (
    <EntityForm
      action={action}
      submit={(data) =>
        submit({
          name: text(data.get("name")),
          displayOrder: number(data.get("displayOrder")),
          isActive: data.get("isActive") === "on",
          waiterCallEnabled: data.get("waiterCallEnabled") === "on",
        })
      }
      fields={[
        ["name", "نام میز", "text", initial?.name],
        ["displayOrder", "ترتیب نمایش", "number", initial?.displayOrder ?? 0],
        ["isActive", "فعال", "checkbox", initial?.isActive ?? true],
        ["waiterCallEnabled", "درخواست میزبان", "checkbox", initial?.waiterCallEnabled ?? false],
      ]}
    />
  );
}
function ImageForm({
  productId,
  hasImage,
  mutate,
  reload,
  requestConfirm,
}: {
  productId: string;
  hasImage: boolean;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  return (
    <form
      className="manager-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const image = (event.currentTarget.elements.namedItem("image") as HTMLInputElement | null)?.files?.[0];
        if (!image?.size) return;
        setBusy(true);
        setProgress(0);
        void mutate(
          () => uploadProductImage(productId, image, setProgress),
          reload,
        )
          .catch(() => undefined)
          .finally(() => {
            setBusy(false);
            setProgress(null);
          });
      }}
    >
      <div className="manager-fields">
        <label>
          <span>تصویر JPEG/PNG/WebP</span>
          <input
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            required
            disabled={busy}
          />
        </label>
      </div>
      <button type="submit" disabled={busy}>
        {busy ? "در حال بارگذاری…" : "بارگذاری یا جایگزینی تصویر"}
      </button>
      {busy && (
        <div className="image-upload-progress" role="status">
          <div className="image-upload-progress__label">
            <span>در حال ارسال تصویر</span>
            <span>{progress === null ? "در حال آماده‌سازی…" : `${progress}٪`}</span>
          </div>
          <progress
            aria-label="پیشرفت بارگذاری تصویر"
            max={100}
            value={progress ?? undefined}
          >
            {progress ?? 0}%
          </progress>
        </div>
      )}
      {hasImage && (
        <DangerButton
          label="حذف تصویر فعلی"
          onClick={() =>
            requestConfirm({
              title: "حذف تصویر",
              detail: "تصویر فعلی از محصول حذف می‌شود؛ محصول و سابقه‌ی سفارش‌ها باقی می‌مانند.",
              run: async () => {
                await mutate(() => archiveProductImage(productId), reload);
              },
            })
          }
        />
      )}
    </form>
  );
}
function EditableRow({
  label,
  meta,
  fields,
  onSave,
}: {
  label: string;
  meta: string;
  fields: any[];
  onSave: (data: FormData) => Promise<any>;
}) {
  return (
    <details>
      <summary>
        {label} <small>{meta}</small>
      </summary>
      <EntityForm fields={fields} action="ذخیره" submit={onSave} />
    </details>
  );
}
function DangerButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="danger-button" type="button" onClick={onClick}>
      {label}
    </button>
  );
}
function ConfirmDialog({ confirm, close }: { confirm: Exclude<Confirm, null>; close: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reasonRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    reasonRef.current?.focus();
  }, []);
  const submit = () => {
    const trimmedReason = reason.trim();
    if (confirm.reasonLabel && !confirm.reasonOptional && !trimmedReason) {
      setError("برای ادامه، دلیل این عملیات را وارد کنید.");
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    void confirm
      .run(trimmedReason || undefined)
      .then(close)
      .catch((failure) => setError(failure instanceof Error ? failure.message : "عملیات انجام نشد. دوباره تلاش کنید."))
      .finally(() => setBusy(false));
  };
  return (
    <div
      className="manager-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manager-confirm-title"
      aria-describedby="manager-confirm-detail"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) close();
      }}
    >
      <div>
        <h2 id="manager-confirm-title">{confirm.title}</h2>
        <p id="manager-confirm-detail">{confirm.detail}</p>
        {confirm.reasonLabel && (
          <label className="manager-dialog__reason">
            <span>{confirm.reasonLabel}</span>
            <input
              ref={reasonRef}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              required={!confirm.reasonOptional}
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        <div className="manager-actions">
          <button type="button" onClick={close} disabled={busy}>
            انصراف
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={submit}
          >
            {busy ? "در حال ثبت…" : "تأیید"}
          </button>
        </div>
      </div>
    </div>
  );
}
