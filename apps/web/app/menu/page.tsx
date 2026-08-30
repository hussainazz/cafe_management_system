import { MenuExperience } from "../../components/menu-experience";
import { getPublicMenu } from "../../lib/public-menu-api";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const initialResult = await getPublicMenu();

  return (
    <MenuExperience
      initialMenu={initialResult.ok ? initialResult.menu : null}
      initialRequestFailed={!initialResult.ok}
    />
  );
}
