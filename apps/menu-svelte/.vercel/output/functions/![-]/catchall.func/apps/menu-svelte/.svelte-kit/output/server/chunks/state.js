import { a as getContext } from "./server2.js";
import "./uneval.js";
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/runtime/app/state/server.js
function context() {
	return getContext("__request__");
}
var page = {
	get data() {
		return context().page.data;
	},
	get error() {
		return context().page.error;
	},
	get form() {
		return context().page.form;
	},
	get params() {
		return context().page.params;
	},
	get route() {
		return context().page.route;
	},
	get shallow() {
		return context().page.shallow;
	},
	get state() {
		return context().page.state;
	},
	get status() {
		return context().page.status;
	},
	get url() {
		return context().page.url;
	}
};
var navigating = {
	from: null,
	to: null,
	type: null,
	willUnload: null,
	delta: null,
	complete: null
};
export { page as n, navigating as t };

//# sourceMappingURL=state.js.map