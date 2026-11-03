import { ft as resolve } from "../../chunks/internal.js";
import { o as attr, r as head } from "../../chunks/server2.js";
import "../../chunks/paths.js";
// src/routes/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		head("1uha8ag", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Run Cafe Menu — SvelteKit staging</title>`);
			});
			$$renderer.push(`<meta name="description" content="Parallel SvelteKit menu application development entry point."/>`);
		});
		$$renderer.push(`<main class="svelte-1uha8ag"><p class="eyebrow svelte-1uha8ag">Parallel application</p> <h1>SvelteKit menu foundation</h1> <p>This development entry page confirms the new application is running independently.</p> <a${attr("href", resolve("/menu"))}>Open the API-backed menu data check</a></main>`);
	});
}
export { _page as default };

//# sourceMappingURL=_page.svelte.js.map