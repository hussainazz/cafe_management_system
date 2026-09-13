"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  archiveCategory,
  archiveOption,
  archiveProduct,
  archiveProductImage,
  archiveTable,
  deactivateStaff,
  readAuditLog,
  readDailyReport,
  readManagerCatalog,
  readManagerSettings,
  readManagerStaff,
  readOrder,
  readPaymentHistory,
  reactivateStaff,
  reverseSettlement,
  saveCategory,
  saveOption,
  saveOptionGroup,
  saveProduct,
  saveSettings,
  saveStaff,
  saveTable,
  uploadProductImage,
  type ApiFailure,
  type ManagerCatalog,
  type ManagerSettings,
  type ManagerStaff,
  type PaymentHistory,
  type PosOrderDetail,
} from "../lib/api-client";
import { formatOrderNumber, formatToman } from "../lib/pos-utils";
import { printRoute } from "../lib/print-routes";

type Panel = "catalog" | "tables" | "finance" | "settings";
type Confirm = {
  title: string;
  detail: string;
  reasonLabel?: string;
  run: (reason?: string) => Promise<void>;
} | null;
type PaymentSortKey = "order" | "recordedAt" | "context" | "amount" | "method" | "recordedBy" | "status";
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

export function ManagerWorkspace({
  onOpenMenu,
  menuOpen,
}: {
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const [panel, setPanel] = useState<Panel>("catalog");
  const [catalog, setCatalog] = useState<ManagerCatalog | null>(null);
  const [staff, setStaff] = useState<ManagerStaff | null>(null);
  const [settings, setSettings] = useState<ManagerSettings | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const reloadCatalog = useCallback(async () => {
    const result = await readManagerCatalog();
    if (result.ok) setCatalog(result.data);
    return result;
  }, []);
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
    const results = await Promise.all([reloadCatalog(), reloadStaff(), reloadSettings()]);
    const failed = results.find((result) => !result.ok);
    setFailure(failed && !failed.ok ? failed.error : null);
    setLoading(false);
  }, [reloadCatalog, reloadSettings, reloadStaff]);
  useEffect(() => {
    void reloadAll();
  }, [reloadAll]);
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
    const error = result.error ?? { kind: "response" as const, message: "عملیات انجام نشد." };
    setFailure(error);
    throw new Error(error.message);
  };

  return (
    <section className="pos-workspace manager-workspace" aria-busy={loading}>
      <header className="workspace-header">
        <button
          className="menu-button"
          type="button"
          aria-label={menuOpen ? "بستن منو" : "باز کردن منو"}
          aria-expanded={menuOpen}
          onClick={onOpenMenu}
        >
          ☰
        </button>
        <div className="workspace-title">
          <p className="kicker">مدیریت</p>
          <h1>کنترل کافه</h1>
          <p>تغییرها مستقیماً با قوانین سرور ثبت می‌شوند.</p>
        </div>
        <button className="text-button" type="button" onClick={() => void reloadAll()}>
          نوسازی
        </button>
      </header>
      <nav className="manager-tabs" aria-label="بخش‌های مدیریت">
        {(
          [
            ["catalog", "کاتالوگ"],
            ["tables", "میزها"],
            ["finance", "حسابداری"],
            ["settings", "تنظیمات"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={panel === id ? "is-active" : ""}
            onClick={() => setPanel(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {failure && (
        <div className="manager-notice" role="status">
          <strong>داده زنده ناقص است.</strong>
          <span>{failure.message}</span>
          <button type="button" onClick={() => void reloadAll()}>
            تلاش دوباره
          </button>
        </div>
      )}
      {loading && <div className="manager-empty">در حال دریافت داده‌های مدیریت…</div>}
      {!loading && panel === "catalog" && catalog && (
        <CatalogPanel
          catalog={catalog}
          mutate={mutate}
          reload={reloadCatalog}
          requestConfirm={setConfirm}
        />
      )}
      {!loading && panel === "tables" && catalog && <TablesPanel catalog={catalog} mutate={mutate} reload={reloadCatalog} requestConfirm={setConfirm} />}
      {!loading && panel === "finance" && (
        <FinancePanel mutate={mutate} requestConfirm={setConfirm} />
      )}
      {!loading && panel === "settings" && settings && (
        <SettingsPanel settings={settings} staff={staff} mutate={mutate} reload={reloadSettings} reloadStaff={reloadStaff} requestConfirm={setConfirm} />
      )}
      {confirm && <ConfirmDialog confirm={confirm} close={() => setConfirm(null)} />}
    </section>
  );
}

function CatalogPanel({
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
            ["displayOrder", "ترتیب", "number"],
          ]}
          action="افزودن دسته"
        />
        <ul className="manager-list">
          {catalog.categories.map((row) => (
            <li key={row.id}>
              <EditableRow
                label={row.name}
                meta={`ترتیب ${row.displayOrder} · ${row.isActive ? "فعال" : "غیرفعال"}`}
                onSave={(data) =>
                  mutate(
                    () =>
                      saveCategory(row.id, {
                        name: text(data.get("name")),
                        displayOrder: number(data.get("displayOrder")),
                        isActive: data.get("isActive") === "on",
                      }),
                    reload,
                  )
                }
                fields={[
                  ["name", "نام", "text", row.name],
                  ["displayOrder", "ترتیب", "number", row.displayOrder],
                  ["isActive", "فعال", "checkbox", row.isActive],
                ]}
              />
              <DangerButton
                label="بایگانی دسته"
                onClick={() =>
                  requestConfirm({
                    title: "بایگانی دسته",
                    detail: `«${row.name}» از فروش فعال خارج می‌شود و سابقه آن حفظ خواهد شد.`,
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
      <ManagerCard title="محصولات" hint="قیمت تومان، زمان آماده‌سازی، گزینه‌ها و تصویر">
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
                  initialAlt={row.image?.altText ?? ""}
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
                      detail: `«${row.name}» از فروش فعال خارج می‌شود و عکس و سابقه سفارش‌ها حفظ می‌گردد.`,
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
      <ManagerCard title="گروه و گزینه محصول" hint="گزینه‌ها برای چند محصول قابل استفاده‌اند.">
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
                          detail: `گزینه «${item.name}» از انتخاب جدید خارج می‌شود؛ سابقه سفارش‌ها باقی می‌ماند.`,
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
      <ManagerCard title="میزهای فیزیکی" hint="ظرفیت زمانی، ترتیب نمایش و مجوز فراخوان گارسون">
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
                      detail: `میز «${row.name}» از سالن فعال خارج می‌شود؛ تاریخچه سفارش‌ها حذف نمی‌شود.`,
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
    <ManagerCard title="حساب‌های پرسنل" hint="مدیران در این فهرست قابل ویرایش نیستند.">
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
          ["password", "رمز عبور (حداقل ۱۲ کاراکتر)", "password"],
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
                      detail: `حساب «${row.username}» غیرفعال می‌شود و تمام نشست‌های فعال او لغو خواهد شد.`,
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
  mutate,
  requestConfirm,
}: {
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  requestConfirm: (confirm: Confirm) => void;
}) {
  const [payments, setPayments] = useState<PaymentHistory>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [report, setReport] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<PosOrderDetail | null>(null);
  const [paymentSort, setPaymentSort] = useState<{ key: PaymentSortKey; direction: "asc" | "desc" }>({
    key: "recordedAt",
    direction: "desc",
  });
  const [auditFilters, setAuditFilters] = useState({
    operation: "",
    entityType: "",
    actorId: "",
    entityId: "",
    sortBy: "occurredAt",
    sortDirection: "desc",
  });
  const auditFiltersRef = useRef(auditFilters);
  useEffect(() => {
    auditFiltersRef.current = auditFilters;
  }, [auditFilters]);
  const loadPayments = useCallback(async (next?: string, append = false) => {
    const result = await readPaymentHistory(next);
    if (result.ok) {
      setPayments((current) =>
        append ? [...current, ...result.data.payments] : result.data.payments,
      );
      setCursor(result.data.page.nextCursor);
    } else setMessage(result.error.message);
  }, []);
  const loadReport = useCallback(async (period: "today" | "yesterday") => {
    const result = await readDailyReport(period);
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
    void Promise.all([loadPayments(), loadReport("today"), loadAudit()]);
  }, [loadAudit, loadPayments, loadReport]);
  const sortedPayments = useMemo(() => {
    const valueFor = (item: PaymentHistory[number]) => {
      switch (paymentSort.key) {
        case "order": return item.dailyOrderNumber;
        case "recordedAt": return new Date(item.recordedAt).getTime();
        case "context": return paymentContext(item);
        case "amount": return item.totalAmount;
        case "method": return paymentMethods(item);
        case "recordedBy": return item.recordedBy.username;
        case "status": return item.reversedAt ? "برگشت خورده" : "ثبت شده";
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
    <div className="manager-grid">
      <ManagerCard
        title="پرداخت‌ها و برگشت تسویه"
        hint="فقط تسویه‌های ثبت‌شده و نگهداری‌شده نمایش داده می‌شوند."
      >
        {message && <p className="form-error">{message}</p>}
        <div className="manager-payment-table-wrap">
          <table className="manager-payment-table" aria-label="تاریخچه پرداخت‌ها">
            <thead>
              <tr>
                {([
                  ["order", "سفارش"], ["recordedAt", "زمان ثبت"], ["context", "موقعیت"],
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
                  <td>{new Date(item.recordedAt).toLocaleString("fa-IR")}</td>
                  <td>{paymentContext(item)}</td>
                  <td>{formatToman(item.totalAmount)}</td>
                  <td>{paymentMethods(item)}</td>
                  <td>{item.recordedBy.username}</td>
                  <td>{item.reversedAt ? "برگشت خورده" : "ثبت شده"}</td>
                  <td className="manager-payment-table__actions">
                    <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  window.open(
                    printRoute(item.orderId, "settlement", item.id),
                    "_blank",
                    "noopener,noreferrer",
                  )
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
              {!item.reversedAt && (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() =>
                    requestConfirm({
                      title: "برگشت تسویه",
                      detail: `برگشت تسویه سفارش ${formatOrderNumber(item.dailyOrderNumber)}، پرداخت ثبت‌شده را حذف نمی‌کند؛ آن را با دلیل شما برگشت‌خورده ثبت می‌کند و وضعیت سفارش را دوباره محاسبه می‌کند.`,
                      reasonLabel: "دلیل برگشت تسویه",
                      run: async (reason) => {
                        const order = await readOrder(item.orderId);
                        if (!order.ok) {
                          setMessage(order.error.message);
                          throw new Error(order.error.message);
                        }
                        await mutate(
                          () =>
                            reverseSettlement(item.id, {
                              expectedVersion: order.data.version,
                              reason: reason ?? "",
                            }),
                          async () => {
                            await Promise.all([loadPayments(), loadReport("today")]);
                          },
                        );
                      },
                    })
                  }
                >
                  برگشت تسویه
                </button>
              )}
                  </td>
                </tr>
              ))}
              {sortedPayments.length === 0 && (
                <tr><td className="manager-payment-table__empty" colSpan={8}>تسویه‌ای برای نمایش وجود ندارد.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadPayments(cursor, true)}
          >
            بارگذاری بیشتر
          </button>
        )}
      </ManagerCard>
      {selectedOrder && (
        <div className="manager-dialog-backdrop" role="presentation" onClick={() => setSelectedOrder(null)}>
          <section className="manager-dialog" role="dialog" aria-modal="true" aria-labelledby="historical-order-title" onClick={(event) => event.stopPropagation()}>
            <header className="manager-dialog__header">
              <div>
                <p className="kicker">سفارش ذخیره‌شده</p>
                <h2 id="historical-order-title">{formatOrderNumber(selectedOrder.dailyOrderNumber)}</h2>
              </div>
              <button className="text-button" type="button" onClick={() => setSelectedOrder(null)}>بستن</button>
            </header>
            <p>{selectedOrder.channel === "TABLE" ? `میز: ${selectedOrder.tableName ?? "-"}` : "نوع سفارش: بیرون‌بر"}</p>
            <p>زمان ثبت: {new Date(selectedOrder.createdAt).toLocaleString("fa-IR")}</p>
            <ul className="manager-list">
              {selectedOrder.items.map((orderItem) => (
                <li key={orderItem.id}>
                  <strong>{orderItem.productNameSnapshot} × {orderItem.quantity}</strong>
                  <small>{orderItem.options.length ? orderItem.options.map((option) => `${option.optionNameSnapshot} × ${option.quantity}`).join("، ") : "بدون گزینه"}</small>
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
      <ManagerCard title="گزارش روزانه" hint="تنها امروز و دیروز در تقویم تهران قابل مشاهده‌اند.">
        <div className="manager-actions">
          <button type="button" onClick={() => void loadReport("today")}>
            امروز
          </button>
          <button type="button" onClick={() => void loadReport("yesterday")}>
            دیروز
          </button>
        </div>
        {report && (
          <dl className="report-grid">
            <dt>بازه</dt>
            <dd>
              {new Date(report.meta.range.from).toLocaleString("fa-IR")} تا{" "}
              {new Date(report.meta.range.to).toLocaleString("fa-IR")}
            </dd>
            <dt>فروش</dt>
            <dd>{formatToman(report.data.salesAmount)}</dd>
            <dt>دریافتی</dt>
            <dd>{formatToman(report.data.paidAmount)}</dd>
            <dt>تعداد سفارش</dt>
            <dd>{report.data.orderCount}</dd>
            <dt>تخفیف</dt>
            <dd>{formatToman(report.data.discounts.totalAmount)}</dd>
            <dt>برگشت‌ها</dt>
            <dd>
              {report.data.reversals.count} مورد · {formatToman(report.data.reversals.amount)}
            </dd>
          </dl>
        )}
      </ManagerCard>
      <ManagerCard title="تاریخچه حسابرسی" hint="فقط داده‌های امن عملیات نشان داده می‌شوند.">
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
                ["actorId", "شناسه اجراکننده"],
                ["entityId", "شناسه رکورد"],
              ] as const
            ).map(([name, label]) => (
              <label key={name}>
                <span>{label}</span>
                <input
                  value={auditFilters[name]}
                  onChange={(event) =>
                    setAuditFilters((current) => ({ ...current, [name]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <button type="submit">اعمال فیلتر</button>
        </form>
        <div className="manager-audit-table-wrap">
          <table className="manager-audit-table">
            <thead><tr>
              {([ ["occurredAt", "زمان"], ["operation", "عملیات"], ["entityType", "نوع رکورد"], ["actor", "اجراکننده"] ] as const).map(([sortBy, label]) => (
                <th key={sortBy}><button type="button" onClick={() => {
                  const sortDirection = auditFilters.sortBy === sortBy && auditFilters.sortDirection === "desc" ? "asc" : "desc";
                  const next = { ...auditFilters, sortBy, sortDirection };
                  setAuditFilters(next);
                  void loadAudit(undefined, false, next);
                }}>{label}{auditFilters.sortBy === sortBy ? (auditFilters.sortDirection === "desc" ? " ↓" : " ↑") : ""}</button></th>
              ))}
              <th>شناسه رکورد</th><th>دلیل</th>
            </tr></thead>
            <tbody>{audit?.data.entries.map((entry: any) => (
              <tr key={entry.id}><td>{new Date(entry.occurredAt).toLocaleString("fa-IR")}</td><td>{entry.operation}</td><td>{entry.entityType}</td><td>{entry.actor?.username ?? "سامانه"}</td><td dir="ltr">{entry.entityId}</td><td>{entry.reason ?? "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
        {audit?.meta.page.nextCursor && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void loadAudit(audit.meta.page.nextCursor, true)}
          >
            بارگذاری بیشتر
          </button>
        )}
      </ManagerCard>
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
  return (
    <div className="manager-grid">
    <ManagerCard title="تنظیمات کافه" hint="نمایش زمان نشستن میز اختیاری است و فقط با فعال‌سازی مدیر استفاده می‌شود.">
      <form
        className="manager-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void mutate(
            () => saveSettings({
              tableSeatingLimitMinutes: seatingLimitEnabled ? number(data.get("minutes")) : null,
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
            نمایش زمان نشستن میز
          </label>
          <label>
            <span>زمان نشستن میز (دقیقه)</span>
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
    {staff ? <StaffPanel staff={staff} mutate={mutate} reload={reloadStaff} requestConfirm={requestConfirm} /> : (
      <ManagerCard title="پرسنل" hint="فهرست پرسنل اکنون در دسترس نیست.">
        <button className="secondary-button" type="button" onClick={() => void reloadStaff()}>تلاش دوباره</button>
      </ManagerCard>
    )}
    </div>
  );
}
function ManagerCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="manager-card">
      <header>
        <h2>{title}</h2>
        <p>{hint}</p>
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
              return <label key={option.id}><input name={`optionIds-${item.id}`} type="checkbox" value={option.id} defaultChecked={Boolean(selected)} /> {option.name} <input name={`override-${item.id}-${option.id}`} type="number" min="0" placeholder={`پیش‌فرض ${option.priceAmount}`} defaultValue={selected?.priceAmountOverride ?? ""} /></label>;
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
        ["displayOrder", "ترتیب", "number", initial?.displayOrder ?? 0],
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
        ["displayOrder", "ترتیب", "number", initial?.displayOrder ?? 0],
        ["isActive", "فعال", "checkbox", initial?.isActive ?? true],
        ["waiterCallEnabled", "فراخوان گارسون", "checkbox", initial?.waiterCallEnabled ?? false],
      ]}
    />
  );
}
function ImageForm({
  productId,
  initialAlt,
  hasImage,
  mutate,
  reload,
  requestConfirm,
}: {
  productId: string;
  initialAlt: string;
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
        const data = new FormData(event.currentTarget);
        const image = (event.currentTarget.elements.namedItem("image") as HTMLInputElement | null)?.files?.[0];
        if (!image?.size) return;
        setBusy(true);
        setProgress(0);
        void mutate(
          () => uploadProductImage(productId, image, text(data.get("altText")), setProgress),
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
        <label>
          <span>متن جایگزین</span>
          <input name="altText" required defaultValue={initialAlt} disabled={busy} />
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
              detail: "تصویر فعلی از نمایش محصول حذف می‌شود؛ محصول و سابقه سفارش‌ها باقی می‌مانند.",
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
    if (confirm.reasonLabel && !trimmedReason) {
      setError("ثبت دلیل برای این عملیات الزامی است.");
      reasonRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    void confirm
      .run(trimmedReason || undefined)
      .then(close)
      .catch(() => setError("عملیات انجام نشد. دوباره تلاش کنید."))
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
              required
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
