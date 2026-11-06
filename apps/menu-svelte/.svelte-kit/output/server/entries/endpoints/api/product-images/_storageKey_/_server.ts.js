import { n as MENU_UPSTREAM, t as API_BASE_URL } from "../../../../../chunks/private.js";
// src/routes/api/product-images/[storageKey]/+server.ts
var GET = async ({ params, fetch }) => {
	const match = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(jpg|png|webp)$/i.exec(params.storageKey);
	if (!match || !API_BASE_URL) return new Response(null, { status: 404 });
	try {
		const url = new URL(`${MENU_UPSTREAM === "web-proxy" ? "/api/product-images" : "/api/v1/product-images"}/${encodeURIComponent(params.storageKey)}`, API_BASE_URL);
		if (!["http:", "https:"].includes(url.protocol)) return new Response(null, { status: 404 });
		const response = await fetch(url, { signal: AbortSignal.timeout(8e3) });
		if (!response.ok || !response.body) return new Response(null, { status: response.status === 404 ? 404 : 502 });
		const expected = match[1].toLowerCase() === "jpg" ? "image/jpeg" : `image/${match[1].toLowerCase()}`;
		if (response.headers.get("content-type")?.split(";")[0] !== expected) return new Response(null, { status: 502 });
		return new Response(response.body, { headers: {
			"content-type": expected,
			"cache-control": "public, max-age=31536000, immutable",
			"x-content-type-options": "nosniff"
		} });
	} catch {
		return new Response(null, { status: 503 });
	}
};
export { GET };

//# sourceMappingURL=_server.ts.js.map