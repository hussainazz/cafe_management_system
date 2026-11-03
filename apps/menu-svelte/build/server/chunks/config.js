import { m as env_invalid } from "./server-errors.js";
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/exports/env/index.js
/** @import { StandardSchemaV1 } from '@standard-schema/spec' */
/** @import { DefinedEnvVars, EnvVarConfig } from '@sveltejs/kit/env' */
/**
* Utility for defining [environment variables](https://svelte.dev/docs/kit/environment-variables),
* which are made available via `$app/env/public` and `$app/env/private`.
*
* @example
* ```js
* import { defineEnvVars } from '@sveltejs/kit/env';
* import * as v from 'valibot';
*
* export const variables = defineEnvVars({
* 	API_URL: {
* 		schema: v.pipe(v.string(), v.url())
* 	},
* 	PORT: {
* 		schema: (value) => {
* 			if (value === undefined) return 3000;
* 			const port = Number(value);
* 			if (!Number.isInteger(port)) throw new Error('PORT must be an integer');
* 			return port;
* 		}
* 	}
* });
* ```
*
* @template {Record<string, EnvVarConfig<any>>} T
* @param {T} variables
* @returns {DefinedEnvVars<T>}
*/
function defineEnvVars(variables) {
	/** @type {Record<string, EnvVarConfig<any>>} */
	const normalized = {};
	for (const [name, config] of Object.entries(variables)) normalized[name] = typeof config.schema === "function" && !("~standard" in config.schema) ? {
		...config,
		schema: normalize_env_schema(config.schema)
	} : config;
	return normalized;
}
/**
* @param {(value: string | undefined) => any} fn
* @returns {StandardSchemaV1<string | undefined, any>}
*/
function normalize_env_schema(fn) {
	return { "~standard": { validate(value) {
		let result;
		try {
			result = fn(value);
		} catch (error) {
			return { issues: [{ message: error instanceof Error ? error.message || "Invalid value" : String(error) }] };
		}
		if (result instanceof Promise) return result;
		return { value: result };
	} } };
}
// src/env.ts
var variables = defineEnvVars({ API_BASE_URL: {
	schema: (value) => value?.trim() || void 0,
	static: false,
	description: "Server-side base URL for the existing Fastify API."
} });
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/utils/format.js
/**
* Joins a list as `a`, `a or b` or `a, b or c`, for use in diagnostics
* @param {string[]} items
*/
function join_or(items) {
	return items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items[0];
}
/**
* Formats a list with one indented `- item` per line, for use in diagnostics
* @param {string[]} items
*/
function bullet_list(items) {
	return items.map((item) => `  - ${item}`).join("\n");
}
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/exports/internal/env.js
/** @import { StandardSchemaV1 } from '@standard-schema/spec' */
/** @import { EnvVarConfig } from '@sveltejs/kit/env' */
var MISSING = { message: `Value is missing. If it is optional, add a validator declaring it as such.` };
var BAD_VALIDATOR = { message: "Variable was configured with a validator that does not implement Standard Schema" };
var ASYNC_VALIDATOR = { message: "Variable uses an async validator, which is not supported" };
/**
* @param {Record<string, EnvVarConfig<any> | undefined>} variables
* @param {string | undefined} value
* @param {string} name
* @param {Record<string, StandardSchemaV1.Issue[]>} issues
* @returns
*/
function validate(variables, value, name, issues) {
	const validator = (variables[name] ?? {}).schema;
	if (!validator) {
		if (value === void 0) issues[name] = [MISSING];
		return value;
	}
	if (!validator["~standard"]) {
		issues[name] = [BAD_VALIDATOR];
		return;
	}
	const result = validator["~standard"].validate(value);
	if (result instanceof Promise) {
		issues[name] = [ASYNC_VALIDATOR];
		return;
	}
	if (result.issues) {
		issues[name] = [...result.issues];
		return;
	}
	return result.value;
}
/**
* @param {Record<string, StandardSchemaV1.Issue[]>} issues
*/
function handle_issues(issues) {
	const entries = Object.entries(issues);
	if (entries.length === 0) return;
	const list = entries.map(([name, issues]) => `${name}\n${bullet_list(issues.map((issue) => issue.message))}`).join("\n\n");
	env_invalid({ issues: `\n${list}\n` }, { stackless: true });
}
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
export { join_or as a, set_env as i, explicit_public_env as n, variables as o, rendered_env as r, dynamic_private_env as t };

//# sourceMappingURL=config.js.map