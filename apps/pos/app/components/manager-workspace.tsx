"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
} from "../lib/api-client";
import { formatToman } from "../lib/pos-utils";

type Panel = "catalog" | "staff" | "finance" | "settings";
type Confirm = {
  title: string;
  detail: string;
  reasonLabel?: string;
  run: (reason?: string) => Promise<void>;
} | null;
const number = (value: FormDataEntryValue | null) => Number(value ?? 0);
const text = (value: FormDataEntryValue | null) => String(value ?? "").trim();

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
            ["catalog", "کاتالوگ و میزها"],
            ["staff", "پرسنل"],
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
      {!loading && panel === "staff" && staff && (
        <StaffPanel
          staff={staff}
          mutate={mutate}
          reload={reloadStaff}
          requestConfirm={setConfirm}
        />
      )}
      {!loading && panel === "finance" && (
        <FinancePanel mutate={mutate} requestConfirm={setConfirm} />
      )}
      {!loading && panel === "settings" && settings && (
        <SettingsPanel settings={settings} mutate={mutate} reload={reloadSettings} />
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
                    {row.seatingLimitMinutes} دقیقه · {row.isActive ? "فعال" : "غیرفعال"}
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
  const [auditFilters, setAuditFilters] = useState({
    operation: "",
    entityType: "",
    actorId: "",
    entityId: "",
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
  return (
    <div className="manager-grid">
      <ManagerCard
        title="پرداخت‌ها و برگشت تسویه"
        hint="فقط تسویه‌های ثبت‌شده و نگهداری‌شده نمایش داده می‌شوند."
      >
        {message && <p className="form-error">{message}</p>}
        <ul className="manager-list">
          {payments.map((item) => (
            <li key={item.id}>
              <strong>{item.orderNumber}</strong>
              <small>
                {formatToman(item.totalAmount)} · {item.reversedAt ? "برگشت خورده" : "ثبت شده"}
              </small>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  window.open(
                    `/print/${item.orderId}/settlements/${item.id}/receipt`,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
              >
                رسید تسویه
              </button>
              {!item.reversedAt && (
                <button
                  className="danger-button"
                  type="button"
                  onClick={() =>
                    requestConfirm({
                      title: "برگشت تسویه",
                      detail: `برگشت تسویه سفارش ${item.orderNumber}، پرداخت ثبت‌شده را حذف نمی‌کند؛ آن را با دلیل شما برگشت‌خورده ثبت می‌کند و وضعیت سفارش را دوباره محاسبه می‌کند.`,
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
            </li>
          ))}
        </ul>
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
        <ul className="manager-list">
          {audit?.data.entries.map((entry: any) => (
            <li key={entry.id}>
              <strong>{entry.operation}</strong>
              <small>
                {entry.actor?.username ?? "سامانه"} · {entry.entityType} ·{" "}
                {new Date(entry.occurredAt).toLocaleString("fa-IR")}
              </small>
              {entry.reason && <span>{entry.reason}</span>}
            </li>
          ))}
        </ul>
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
  mutate,
  reload,
}: {
  settings: ManagerSettings;
  mutate: (action: () => Promise<any>, reload: () => Promise<any>) => Promise<void>;
  reload: () => Promise<any>;
}) {
  return (
    <ManagerCard title="تنظیمات کافه" hint="تنها تنظیم فعال v1، زمان پیش‌فرض نشستن میز است.">
      <EntityForm
        submit={(data) =>
          mutate(
            () => saveSettings({ defaultTableSeatingLimitMinutes: number(data.get("minutes")) }),
            reload,
          )
        }
        fields={[
          [
            "minutes",
            "زمان پیش‌فرض میز (دقیقه)",
            "number",
            settings.defaultTableSeatingLimitMinutes,
          ],
        ]}
        action="ذخیره تنظیمات"
      />
    </ManagerCard>
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
          optionGroupIds: data.getAll("optionGroupIds"),
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
        {catalog.optionGroups.map((item) => (
          <label key={item.id}>
            <input
              name="optionGroupIds"
              type="checkbox"
              value={item.id}
              defaultChecked={initial?.optionGroupIds?.includes(item.id)}
            />{" "}
            {item.name}
          </label>
        ))}
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
          seatingLimitMinutes: number(data.get("seatingLimitMinutes")),
          displayOrder: number(data.get("displayOrder")),
          isActive: data.get("isActive") === "on",
          waiterCallEnabled: data.get("waiterCallEnabled") === "on",
        })
      }
      fields={[
        ["name", "نام میز", "text", initial?.name],
        ["seatingLimitMinutes", "زمان نشستن (دقیقه)", "number", initial?.seatingLimitMinutes ?? 45],
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
