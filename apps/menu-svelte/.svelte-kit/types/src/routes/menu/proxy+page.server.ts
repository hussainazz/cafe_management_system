// @ts-nocheck
import { API_BASE_URL } from "$app/env/private";
import type { PageServerLoad } from "./$types";
import { getPublicMenu } from "#lib/server/public-menu.js";

export const load = async () => ({
  result: await getPublicMenu(API_BASE_URL),
});
;null as any as PageServerLoad;