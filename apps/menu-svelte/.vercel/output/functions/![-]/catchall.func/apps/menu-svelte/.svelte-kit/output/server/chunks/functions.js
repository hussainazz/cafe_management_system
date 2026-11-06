import { W as server_api_unavailable } from "./server-errors.js";
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/utils/functions.js
function noop() {}
/**
* @template T
* @param {() => T} fn
*/
function once(fn) {
	let done = false;
	/** @type T */
	let result;
	return () => {
		if (done) return result;
		done = true;
		return result = fn();
	};
}
/**
* @param {string} name
* @param {string} [parens]
*/
function disallow_on_server(name, parens = "(...)") {
	return () => {
		server_api_unavailable({ name: `${name}${parens}` });
	};
}
export { noop as n, once as r, disallow_on_server as t };

//# sourceMappingURL=functions.js.map