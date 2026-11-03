import { r as head } from "../../chunks/server2.js";
import { t as navigating } from "../../chunks/state.js";
// src/routes/+layout.svelte
function _layout($$renderer, $$props) {
	$$renderer.component(($$renderer) => {
		let { children } = $$props;
		head("12qhfyh", $$renderer, ($$renderer) => {
			$$renderer.push(`<meta name="theme-color" content="#f5f2eb"/>`);
		});
		if (navigating.to) $$renderer.push(`<!--[0--><p class="loading svelte-12qhfyh" role="status" aria-live="polite">Loading page…</p>`);
		else $$renderer.push("<!--[-1-->");
		$$renderer.push(`<!--]--> `);
		children($$renderer);
		$$renderer.push(`<!---->`);
	});
}
export { _layout as default };

//# sourceMappingURL=_layout.svelte.js.map