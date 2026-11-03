import { defineEnvVars } from "@sveltejs/kit/env";
import { handle_issues, validate } from "@sveltejs/kit/internal/env";
// src/env.ts
var variables = defineEnvVars({ API_BASE_URL: {
	schema: (value) => value?.trim() || void 0,
	static: false,
	description: "Server-side base URL for the existing Fastify API."
} });
// .svelte-kit/generated/build/env/config.js
var issues = {};
var dynamic_private_env = {};
var explicit_public_env = {};
var rendered_env = {};
handle_issues(issues);
function set_env(env) {
	const issues = {};
	dynamic_private_env.API_BASE_URL = validate(variables, env.API_BASE_URL, "API_BASE_URL", issues);
	handle_issues(issues);
}
export { variables as a, set_env as i, explicit_public_env as n, rendered_env as r, dynamic_private_env as t };

//# sourceMappingURL=config.js.map