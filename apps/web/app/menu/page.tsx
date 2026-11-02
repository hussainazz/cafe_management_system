import { headers } from "next/headers";
import { MenuExperience } from "../../components/menu-experience";
import { getPublicMenu } from "../../lib/public-menu-api";
import { getPublicTableContext } from "../../lib/public-table-context";

export const dynamic = "force-dynamic";

export default async function MenuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const requestHeaders = await headers();
  const initialTableContext = await getPublicTableContext(requestHeaders.get("cookie"));
  // The phone form does not wait for catalog data or product images.
  const initialResult = initialTableContext?.authenticationRequired
    ? null : await getPublicMenu();
  const query = await searchParams;

  return (
    <MenuExperience
      initialMenu={initialResult?.ok ? initialResult.menu : null}
      initialRequestFailed={initialResult !== null && !initialResult.ok}
      invalidTableContext={query["table-context"] === "invalid"}
      initialTableContext={initialTableContext}
    />
  );
}
