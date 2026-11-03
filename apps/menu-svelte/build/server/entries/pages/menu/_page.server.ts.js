import { t as dynamic_private_env } from "../../../chunks/config.js";
import { PublicMenuResponseSchema } from "@cafe/contracts";
// .svelte-kit/generated/build/env/private/server.js
var API_BASE_URL = dynamic_private_env.API_BASE_URL;
// src/lib/server/public-menu.ts
function isTimeout(error) {
	return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
async function getPublicMenu(apiBaseUrl, fetcher = globalThis.fetch) {
	if (!apiBaseUrl?.trim()) return {
		ok: false,
		reason: "not_configured"
	};
	let endpoint;
	try {
		endpoint = new URL("/api/v1/public/menu", apiBaseUrl);
		if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") return {
			ok: false,
			reason: "not_configured"
		};
	} catch {
		return {
			ok: false,
			reason: "not_configured"
		};
	}
	try {
		const response = await fetcher(endpoint, {
			cache: "no-store",
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(8e3)
		});
		if (!response.ok) return {
			ok: false,
			reason: "unavailable"
		};
		let body;
		try {
			body = await response.json();
		} catch (error) {
			return {
				ok: false,
				reason: isTimeout(error) ? "timeout" : "invalid_response"
			};
		}
		const parsed = PublicMenuResponseSchema.safeParse(body);
		if (!parsed.success) return {
			ok: false,
			reason: "invalid_response"
		};
		return {
			ok: true,
			categories: parsed.data.data.categories,
			requestId: parsed.data.meta.requestId
		};
	} catch (error) {
		if (isTimeout(error)) return {
			ok: false,
			reason: "timeout"
		};
		return {
			ok: false,
			reason: "unavailable"
		};
	}
}
// src/routes/menu/+page.server.ts
var load = async () => ({ result: await getPublicMenu(API_BASE_URL) });
export { load };

//# sourceMappingURL=_page.server.ts.js.map