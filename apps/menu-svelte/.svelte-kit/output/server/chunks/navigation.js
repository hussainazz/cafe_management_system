import { n as noop, t as disallow_on_server } from "./functions.js";
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/runtime/app/navigation/server.js
var afterNavigate = noop;
disallow_on_server("disableScrollHandling", "()");
disallow_on_server("goto");
disallow_on_server("invalidate");
disallow_on_server("invalidateAll", "()");
disallow_on_server("refreshAll", "()");
disallow_on_server("preloadCode");
disallow_on_server("preloadData");
var pushState = disallow_on_server("pushState");
disallow_on_server("replaceState");
export { pushState as n, afterNavigate as t };

//# sourceMappingURL=navigation.js.map