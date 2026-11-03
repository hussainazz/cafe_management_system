import { ft as resolve } from "../../../chunks/internal.js";
import { n as ensure_array_like, o as attr, r as head, s as escape_html } from "../../../chunks/server2.js";
import "../../../chunks/paths.js";
// src/routes/menu/+page.svelte
function _page($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { data } = $$props;
		const errorMessage = {
			not_configured: "The menu API address is not configured for this deployment.",
			timeout: "The menu service took too long to respond. Please try again later.",
			unavailable: "The menu service is temporarily unavailable. Please try again later.",
			invalid_response: "The menu service returned data this application could not read."
		};
		head("1uas024", $$renderer, ($$renderer) => {
			$$renderer.title(($$renderer) => {
				$$renderer.push(`<title>Menu data check — Run Cafe</title>`);
			});
			$$renderer.push(`<meta name="description" content="Minimal verification view for the SvelteKit public-menu API connection."/>`);
		});
		$$renderer.push(`<main class="svelte-1uas024"><a class="back-link svelte-1uas024"${attr("href", resolve("/"))}>← Application home</a> <h1 class="svelte-1uas024">Menu data check</h1> `);
		if (data.result.ok) {
			$$renderer.push(`<!--[0--><p class="status svelte-1uas024" role="status">Loaded ${escape_html(data.result.categories.length)}
      ${escape_html(data.result.categories.length === 1 ? "category" : "categories")}.</p> `);
			if (data.result.categories.length === 0) $$renderer.push(`<!--[0--><p>The API returned no public categories.</p>`);
			else {
				$$renderer.push(`<!--[-1--><ul class="categories svelte-1uas024"><!--[-->`);
				const each_array = ensure_array_like(data.result.categories);
				for (let $$index_1 = 0, $$length = each_array.length; $$index_1 < $$length; $$index_1++) {
					let category = each_array[$$index_1];
					$$renderer.push(`<li class="svelte-1uas024"><h2 class="svelte-1uas024">${escape_html(category.name)}</h2> `);
					if (category.products.length === 0) $$renderer.push(`<!--[0--><p>No public products in this category.</p>`);
					else {
						$$renderer.push(`<!--[-1--><ul class="products svelte-1uas024"><!--[-->`);
						const each_array_1 = ensure_array_like(category.products);
						for (let $$index = 0, $$length = each_array_1.length; $$index < $$length; $$index++) {
							let product = each_array_1[$$index];
							$$renderer.push(`<li class="svelte-1uas024"><strong>${escape_html(product.name)}</strong> <span>${escape_html(new Intl.NumberFormat("fa-IR").format(product.priceAmount))} تومان</span> `);
							if (!product.isAvailable) $$renderer.push(`<!--[0--><span class="availability svelte-1uas024">Currently unavailable</span>`);
							else $$renderer.push("<!--[-1-->");
							$$renderer.push(`<!--]--></li>`);
						}
						$$renderer.push(`<!--]--></ul>`);
					}
					$$renderer.push(`<!--]--></li>`);
				}
				$$renderer.push(`<!--]--></ul>`);
			}
			$$renderer.push(`<!--]-->`);
		} else $$renderer.push(`<!--[-1--><p class="error svelte-1uas024" role="alert">${escape_html(errorMessage[data.result.reason])}</p>`);
		$$renderer.push(`<!--]--></main>`);
	});
}
export { _page as default };

//# sourceMappingURL=_page.svelte.js.map