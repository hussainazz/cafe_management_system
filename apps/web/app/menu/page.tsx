import { MenuExperience } from "../../components/menu-experience";
import { getPublicMenu } from "../../lib/public-menu-api";

export const dynamic = "force-dynamic";

export default async function MenuPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const initialResult = await getPublicMenu();
  const query = await searchParams;

  return (
    <MenuExperience
      initialMenu={initialResult.ok ? initialResult.menu : null}
      initialRequestFailed={!initialResult.ok}
      invalidTableContext={query["table-context"] === "invalid"}
    />
  );
}
