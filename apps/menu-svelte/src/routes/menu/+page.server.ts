import { API_BASE_URL } from "$app/env/private";
import type { PageServerLoad } from "./$types";
import { getPublicMenu } from "#lib/server/public-menu.js";

export const load: PageServerLoad = async () => ({
  result: await getPublicMenu(API_BASE_URL),
});
