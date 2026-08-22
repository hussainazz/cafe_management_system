import { getPublicMenu } from "../../../lib/public-menu-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getPublicMenu();

  if (!result.ok) {
    return Response.json(
      { error: { code: "MENU_UNAVAILABLE", message: "Public menu is temporarily unavailable." } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  return Response.json(
    { data: result.menu, meta: { requestId: result.requestId } },
    { headers: { "cache-control": "no-store" } },
  );
}
