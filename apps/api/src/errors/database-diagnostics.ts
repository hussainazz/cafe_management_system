export type DatabaseDiagnostic = {
  kind?: string | undefined;
  sqlState?: string | undefined;
  constraint?: string | undefined;
  table?: string | undefined;
  column?: string | undefined;
};

export function databaseDiagnostic(error: unknown): DatabaseDiagnostic | undefined {
  if (!error || typeof error !== "object") return undefined;
  const source = error as Record<string, unknown>;
  const meta = source.meta && typeof source.meta === "object" ? source.meta as Record<string, unknown> : undefined;
  const adapter = meta?.driverAdapterError && typeof meta.driverAdapterError === "object" ? meta.driverAdapterError as Record<string, unknown> : undefined;
  let cause = source.cause && typeof source.cause === "object"
    ? source.cause as Record<string, unknown> : adapter?.cause && typeof adapter.cause === "object"
      ? adapter.cause as Record<string, unknown> : meta ?? source;
  // The native engine sometimes serializes PostgreSQL errors into an unknown
  // request error. Extract only the SQLSTATE and diagnostic message section;
  // never log the invocation, query, arguments, or failing-row detail.
  if (source.name === "PrismaClientUnknownRequestError" && typeof source.message === "string") {
    const postgres = source.message.match(/QueryError\(PostgresError \{ code: "([0-9A-Z]{5})", message: "(.*?)", severity:/s);
    if (postgres) cause = { originalCode: postgres[1], originalMessage: postgres[2]!.replace(/\\"/g, '"'), kind: "postgres" };
  }
  const sqlState = typeof cause.originalCode === "string" && /^[0-9A-Z]{5}$/.test(cause.originalCode)
    ? cause.originalCode : typeof cause.code === "string" && /^[0-9A-Z]{5}$/.test(cause.code) ? cause.code : undefined;
  const kind = typeof cause.kind === "string" && /^[A-Za-z]{1,80}$/.test(cause.kind) ? cause.kind : undefined;
  if (!sqlState && !kind && !(meta && /^P\d{4}$/.test(String(source.code)))) return undefined;
  const message = typeof cause.originalMessage === "string" ? cause.originalMessage : typeof cause.message === "string" ? cause.message : "";
  const identifier = (label: string) => message.match(new RegExp(`${label} "([A-Za-z_][A-Za-z0-9_]{0,127})"`))?.[1];
  const safeIdentifier = (value: unknown) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/.test(value) ? value : undefined;
  return { sqlState, kind: kind ?? "prisma", constraint: identifier("constraint") ?? safeIdentifier(meta?.field_name),
    table: identifier("relation") ?? safeIdentifier(meta?.table), column: identifier("column") ?? safeIdentifier(meta?.column) };
}

export function safeErrorDiagnostics(error: unknown) {
  const source = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = source.code ?? source.errorCode;
  const prismaCode = typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
  // Extract source locations only. Prisma messages can embed request values.
  const frames = error instanceof Error ? error.stack?.split("\n").filter((line) => /^\s+at /.test(line))
    .map((line) => line.match(/(?:file:\/\/)?([^\s()]+\.[cm]?[jt]s:\d+:\d+)/)?.[1]).filter(Boolean).slice(0, 8) : undefined;
  return { errName: error instanceof Error ? error.name : "UnknownError", prismaCode,
    database: databaseDiagnostic(error), frames };
}
