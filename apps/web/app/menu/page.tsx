import { headers } from "next/headers";
import { MenuExperience } from "../../components/menu-experience";
import { getPublicMenu } from "../../lib/public-menu-api";
import { getPublicTableContext } from "../../lib/public-table-context";

export const dynamic = "force-dynamic";

export default async function MenuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const [initialResult, initialTableContext] = await Promise.all([
    getPublicMenu(),
    getPublicTableContext(requestHeaders.get("cookie")),
  ]);
  const query = await searchParams;

  return (
    <MenuExperience
      initialMenu={initialResult.ok ? initialResult.menu : null}
      initialRequestFailed={!initialResult.ok}
      invalidTableContext={query["table-context"] === "invalid"}
      initialTableContext={initialTableContext}
    />
  );
}
