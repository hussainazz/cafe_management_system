import { NextRequest, NextResponse } from "next/server";
import { printFromApi, type ServerPrintKind } from "../../lib/server-printing";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { kind?: string; orderId?: string; settlementId?: string } | null;
  if (!body?.orderId || !["receipt", "bar-ticket", "settlement"].includes(body.kind ?? "")) return NextResponse.json({ error: { code: "INVALID_PRINT_REQUEST", message: "درخواست چاپ معتبر نیست." } }, { status: 400 });
  try {
    await printFromApi({ kind: body.kind as ServerPrintKind, orderId: body.orderId, cookie: request.headers.get("cookie") ?? "", ...(body.settlementId ? { settlementId: body.settlementId } : {}) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = error as { code?: string; message?: string };
    console.error("POS print failed", { printType: body.kind, orderId: body.orderId, printer: process.env.POS_PRINTER_NAME ?? null, error: failure.message });
    const status = failure.code === "PRINTER_NOT_CONFIGURED" ? 503 : failure.code === "PRINT_DATA_UNAVAILABLE" || failure.code === "PRINT_API_UNAVAILABLE" ? 502 : 500;
    const message = failure.code === "PRINT_DATA_UNAVAILABLE" ? "اطلاعات سفارش برای چاپ در دسترس نیست." : failure.code === "PRINT_API_UNAVAILABLE" ? "سرویس سفارش‌ها در دسترس نیست." : "چاپ انجام نشد. اتصال چاپگر را بررسی کنید.";
    return NextResponse.json({ error: { code: failure.code ?? "PRINT_FAILED", message } }, { status });
  }
}
