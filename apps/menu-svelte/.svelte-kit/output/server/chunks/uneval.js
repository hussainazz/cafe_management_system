// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/messages/internal/server.js
/**
* @typedef {{ cause?: unknown; stackless?: boolean }} ServerThrowOptions
*/
/**
* Throws the full diagnostic. Unlike shared errors, server-only errors keep their full text in production
* @param {string} code
* @param {string} message
* @param {ServerThrowOptions | undefined} options
* @param {Function} caller The generated helper, which is omitted from the stack along with this function
* @returns {never}
*/
function throw_error(code, message, options, caller) {
	const error = new Error(`${code}\n${message}\nhttps://svelte.dev/e/kit/${code}`, options?.cause === void 0 ? void 0 : { cause: options.cause });
	error.name = "SvelteKit error";
	if (options?.stackless) error.stack = "";
	else Error.captureStackTrace?.(error, caller);
	throw error;
}
/**
* Returns the error thrown by `fn`, for the few places that pass an error on (for example to
* `handleError` or a later `console.error`) rather than throwing it. Its stack starts inside `fn`
* @param {() => never} fn A function that calls a generated `server-errors` helper
* @returns {Error}
*/
function capture_error(fn) {
	try {
		fn();
	} catch (error) {
		return error;
	}
}
// ../../node_modules/.pnpm/@sveltejs+kit@3.1.1_@sveltejs+vite-plugin-svelte@7.3.1_svelte@5.57.3_@typescript-eslint_ce7a38b4d0c9455b42587c3cd25e66bf/node_modules/@sveltejs/kit/src/messages/server-errors.js
/** @import { ServerThrowOptions } from './internal/server.js' */
/**
* Data returned from action inside `%id%` is not serializable: %message%
* @param {{ "id": string; "message": string; "path"?: string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_data_not_serializable(_values, options) {
	throw_error("action_data_not_serializable", _values?.path !== void 0 ? `Data returned from action inside \`${_values.id}\` is not serializable: ${_values.message} (\`${_values.path}\`)` : `Data returned from action inside \`${_values.id}\` is not serializable: ${_values.message}`, options, action_data_not_serializable);
}
/**
* When using named actions, the default action cannot be used. See the docs for more info: https://svelte.dev/docs/kit/form-actions#Named-actions
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_default_with_named(_values, options) {
	throw_error("action_default_with_named", `When using named actions, the default action cannot be used. See the docs for more info: https://svelte.dev/docs/kit/form-actions#Named-actions`, options, action_default_with_named);
}
/**
* Cannot use reserved action name `default`
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_name_reserved(_values, options) {
	throw_error("action_name_reserved", `Cannot use reserved action name \`default\``, options, action_name_reserved);
}
/**
* Data returned from action inside `%id%` is not serializable. Form actions need to return plain objects or `fail()`. E.g. `return { success: true }` or `return fail(400, { message: "invalid" });`
* @param {{ "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_response_not_serializable(_values, options) {
	throw_error("action_response_not_serializable", `Data returned from action inside \`${_values.id}\` is not serializable. Form actions need to return plain objects or \`fail()\`. E.g. \`return { success: true }\` or \`return fail(400, { message: "invalid" });\``, options, action_response_not_serializable);
}
/**
* Cannot `return error(...)` — use `error(...)` or `return fail(...)` instead
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_return_error(_values, options) {
	throw_error("action_return_error", `Cannot \`return error(...)\` — use \`error(...)\` or \`return fail(...)\` instead`, options, action_return_error);
}
/**
* Cannot `return redirect(...)` — use `redirect(...)` instead
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_return_redirect(_values, options) {
	throw_error("action_return_redirect", `Cannot \`return redirect(...)\` — use \`redirect(...)\` instead`, options, action_return_redirect);
}
/**
* Cannot `throw fail()`. Use `return fail()`
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function action_throw_fail(_values, options) {
	throw_error("action_throw_fail", `Cannot \`throw fail()\`. Use \`return fail()\``, options, action_throw_fail);
}
/**
* `%adapter%` does not specify `getClientAddress`. Please raise an issue
* @param {{ "adapter": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function client_address_unsupported(_values, options) {
	throw_error("client_address_unsupported", `\`${_values.adapter}\` does not specify \`getClientAddress\`. Please raise an issue`, options, client_address_unsupported);
}
/**
* Cookie `%name%` is too large, and will be discarded by the browser
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function cookie_too_large(_values, options) {
	throw_error("cookie_too_large", `Cookie \`${_values.name}\` is too large, and will be discarded by the browser`, options, cookie_too_large);
}
/**
* Cannot serialize cookies until after the route is determined
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function cookies_serialize_before_route(_values, options) {
	throw_error("cookies_serialize_before_route", `Cannot serialize cookies until after the route is determined`, options, cookies_serialize_before_route);
}
/**
* Cannot use `cookies.set(...)` after the response has been generated
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function cookies_set_after_response(_values, options) {
	throw_error("cookies_set_after_response", `Cannot use \`cookies.set(...)\` after the response has been generated`, options, cookies_set_after_response);
}
/**
* `content-security-policy-report-only` must be specified with either the `report-to` or `report-uri` directives, or both
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function csp_report_only_missing_report(_values, options) {
	throw_error("csp_report_only_missing_report", `\`content-security-policy-report-only\` must be specified with either the \`report-to\` or \`report-uri\` directives, or both`, options, csp_report_only_missing_report);
}
/**
* Invalid response from route `%path%`: handler should return a `Response` object
* @param {{ "path": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function endpoint_invalid_response(_values, options) {
	throw_error("endpoint_invalid_response", `Invalid response from route \`${_values.path}\`: handler should return a \`Response\` object`, options, endpoint_invalid_response);
}
/**
* Cannot return `fetch(...)` directly from a handler if the response has a `Content-Encoding: %encoding%` header. The body has already been decoded
* @param {{ "encoding": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function fetch_response_decoded(_values, options) {
	throw_error("fetch_response_decoded", `Cannot return \`fetch(...)\` directly from a handler if the response has a \`Content-Encoding: ${_values.encoding}\` header. The body has already been decoded`, options, fetch_response_decoded);
}
/**
* The `handleError` hook failed
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function handle_error_hook_failed(_values, options) {
	throw_error("handle_error_hook_failed", `The \`handleError\` hook failed`, options, handle_error_hook_failed);
}
/**
* `%name%` header is already set
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function header_already_set(_values, options) {
	throw_error("header_already_set", `\`${_values.name}\` header is already set`, options, header_already_set);
}
/**
* CORS error: %reason% `Access-Control-Allow-Origin` header is present on the requested resource
* @param {{ "reason": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function load_fetch_cors(_values, options) {
	throw_error("load_fetch_cors", `CORS error: ${_values.reason} \`Access-Control-Allow-Origin\` header is present on the requested resource`, options, load_fetch_cors);
}
/**
* Data returned from `load` while rendering `%id%` is not a plain object
* @param {{ "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function load_not_plain_object(_values, options) {
	throw_error("load_not_plain_object", `Data returned from \`load\` while rendering \`${_values.id}\` is not a plain object`, options, load_not_plain_object);
}
/**
* Data returned from `load` while rendering `%id%` is not serializable: %message% (`%path%`). If you need to serialize/deserialize custom types, use transport hooks: https://svelte.dev/docs/kit/hooks#transport.
* @param {{ "id": string; "message": string; "path": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function load_not_serializable(_values, options) {
	throw_error("load_not_serializable", `Data returned from \`load\` while rendering \`${_values.id}\` is not serializable: ${_values.message} (\`${_values.path}\`). If you need to serialize/deserialize custom types, use transport hooks: https://svelte.dev/docs/kit/hooks#transport.`, options, load_not_serializable);
}
/**
* Failed to serialize promise while rendering `%id%`
* @param {{ "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function load_promise_not_serializable(_values, options) {
	throw_error("load_promise_not_serializable", `Failed to serialize promise while rendering \`${_values.id}\``, options, load_promise_not_serializable);
}
/**
* Failed to get response header `%name%` — it must be included by the `filterSerializedResponseHeaders` option: https://svelte.dev/docs/kit/hooks#handle (at `%id%`)
* @param {{ "name": string; "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function load_response_header_not_serialized(_values, options) {
	throw_error("load_response_header_not_serialized", `Failed to get response header \`${_values.name}\` — it must be included by the \`filterSerializedResponseHeaders\` option: https://svelte.dev/docs/kit/hooks#handle (at \`${_values.id}\`)`, options, load_response_header_not_serialized);
}
/**
* Cannot prerender pages with actions
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function prerender_actions(_values, options) {
	throw_error("prerender_actions", `Cannot prerender pages with actions`, options, prerender_actions);
}
/**
* Cannot prerender a `+server` file with %methods% or fallback handlers (`%id%`)
* @param {{ "methods": string; "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function prerender_endpoint_methods(_values, options) {
	throw_error("prerender_endpoint_methods", `Cannot prerender a \`+server\` file with ${_values.methods} or fallback handlers (\`${_values.id}\`)`, options, prerender_endpoint_methods);
}
/**
* `%id%` is not prerenderable
* @param {{ "id": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function prerender_endpoint_not_prerenderable(_values, options) {
	throw_error("prerender_endpoint_not_prerenderable", `\`${_values.id}\` is not prerenderable`, options, prerender_endpoint_not_prerenderable);
}
/**
* Cannot use prerendering if `config.csp.mode === 'nonce'`
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function prerender_nonce(_values, options) {
	throw_error("prerender_nonce", `Cannot use prerendering if \`config.csp.mode === 'nonce'\``, options, prerender_nonce);
}
/**
* Cannot use prerendering if page template contains `%tag%`
* @param {{ "tag": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function prerender_template_nonce(_values, options) {
	throw_error("prerender_template_nonce", `Cannot use prerendering if page template contains \`${_values.tag}\``, options, prerender_template_nonce);
}
/**
* Cannot call a command (`%name%`) from a `%method%` handler
* @param {{ "name": string; "method": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_command_method(_values, options) {
	throw_error("remote_command_method", `Cannot call a command (\`${_values.name}\`) from a \`${_values.method}\` handler`, options, remote_command_method);
}
/**
* Cannot call a command (`%name%`) inside a query or prerender function
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_command_readonly(_values, options) {
	throw_error("remote_command_readonly", `Cannot call a command (\`${_values.name}\`) inside a query or prerender function`, options, remote_command_readonly);
}
/**
* Cannot call a command (`%name%`) during server-side rendering
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_command_render(_values, options) {
	throw_error("remote_command_render", `Cannot call a command (\`${_values.name}\`) during server-side rendering`, options, remote_command_render);
}
/**
* Cannot %operation% cookies in `query` or `prerender` functions
* @param {{ "operation": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_cookie_forbidden(_values, options) {
	throw_error("remote_cookie_forbidden", `Cannot ${_values.operation} cookies in \`query\` or \`prerender\` functions`, options, remote_cookie_forbidden);
}
/**
* Cookies %operation% in remote functions must have an absolute path
* @param {{ "operation": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_cookie_path_relative(_values, options) {
	throw_error("remote_cookie_path_relative", `Cookies ${_values.operation} in remote functions must have an absolute path`, options, remote_cookie_path_relative);
}
/**
* `fail(...)` is for form actions. A remote `form` handler should call `invalid(...)` instead. See https://svelte.dev/docs/kit/remote-functions#form-Programmatic-validation
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_form_fail(_values, options) {
	throw_error("remote_form_fail", `\`fail(...)\` is for form actions. A remote \`form\` handler should call \`invalid(...)\` instead. See https://svelte.dev/docs/kit/remote-functions#form-Programmatic-validation`, options, remote_form_fail);
}
/**
* `setHeaders` is not allowed in remote functions
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_headers_forbidden(_values, options) {
	throw_error("remote_headers_forbidden", `\`setHeaders\` is not allowed in remote functions`, options, remote_headers_forbidden);
}
/**
* Invalid validator passed to remote function. Expected `'unchecked'` or a Standard Schema (https://standardschema.dev)
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_invalid_validator(_values, options) {
	throw_error("remote_invalid_validator", `Invalid validator passed to remote function. Expected \`'unchecked'\` or a Standard Schema (https://standardschema.dev)`, options, remote_invalid_validator);
}
/**
* `query.live` `%name%` did not yield a value
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_query_live_no_value(_values, options) {
	throw_error("remote_query_live_no_value", `\`query.live\` \`${_values.name}\` did not yield a value`, options, remote_query_live_no_value);
}
/**
* `query.live` `%name%` must return an `Iterator`, `Iterable`, `AsyncIterator` or `AsyncIterable`
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_query_live_not_iterable(_values, options) {
	throw_error("remote_query_live_not_iterable", `\`query.live\` \`${_values.name}\` must return an \`Iterator\`, \`Iterable\`, \`AsyncIterator\` or \`AsyncIterable\``, options, remote_query_live_not_iterable);
}
/**
* Cannot call `%type%` `%name%` while prerendering, as prerendered pages need static data. Use `prerender` from `$app/server` instead
* @param {{ "type": string; "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_query_prerender(_values, options) {
	throw_error("remote_query_prerender", `Cannot call \`${_values.type}\` \`${_values.name}\` while prerendering, as prerendered pages need static data. Use \`prerender\` from \`$app/server\` instead`, options, remote_query_prerender);
}
/**
* Cannot access `event.%property%` in a query. Pass the value as an argument to the query instead
* @param {{ "property": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_request_property(_values, options) {
	throw_error("remote_request_property", `Cannot access \`event.${_values.property}\` in a query. Pass the value as an argument to the query instead`, options, remote_request_property);
}
/**
* `requested(%name%, %limit%)` cannot be used with synchronous iteration because the query validator is async. Use `for await ... of` instead
* @param {{ "name": string; "limit": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_requested_async_validator(_values, options) {
	throw_error("remote_requested_async_validator", `\`requested(${_values.name}, ${_values.limit})\` cannot be used with synchronous iteration because the query validator is async. Use \`for await ... of\` instead`, options, remote_requested_async_validator);
}
/**
* `requested(...)` can only be called in the context of a command/form remote function
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_requested_context(_values, options) {
	throw_error("remote_requested_context", `\`requested(...)\` can only be called in the context of a command/form remote function`, options, remote_requested_context);
}
/**
* Limit must be a non-negative integer or `Infinity`
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_requested_invalid_limit(_values, options) {
	throw_error("remote_requested_invalid_limit", `Limit must be a non-negative integer or \`Infinity\``, options, remote_requested_invalid_limit);
}
/**
* `requested(...)` expects a query function created with `query(...)`, `query.batch(...)`, or `query.live(...)`
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_requested_invalid_query(_values, options) {
	throw_error("remote_requested_invalid_query", `\`requested(...)\` expects a query function created with \`query(...)\`, \`query.batch(...)\`, or \`query.live(...)\``, options, remote_requested_invalid_query);
}
/**
* `%method%()` is invalid for %type% queries. Use `%replacement%()` instead.
* @param {{ "method": string; "type": string; "replacement": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function remote_requested_wrong_method(_values, options) {
	throw_error("remote_requested_wrong_method", `\`${_values.method}()\` is invalid for ${_values.type} queries. Use \`${_values.replacement}()\` instead.`, options, remote_requested_wrong_method);
}
/**
* Cannot call `%name%` on the server
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function server_api_unavailable(_values, options) {
	throw_error("server_api_unavailable", `Cannot call \`${_values.name}\` on the server`, options, server_api_unavailable);
}
/**
* Cannot use `setHeaders(...)` after the response has been generated
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function set_headers_after_response(_values, options) {
	throw_error("set_headers_after_response", `Cannot use \`setHeaders(...)\` after the response has been generated`, options, set_headers_after_response);
}
/**
* Use `event.cookies.set(name, value, options)` instead of `event.setHeaders` to set cookies
* @param {void} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function set_headers_cookie(_values, options) {
	throw_error("set_headers_cookie", `Use \`event.cookies.set(name, value, options)\` instead of \`event.setHeaders\` to set cookies`, options, set_headers_cookie);
}
/**
* Cannot call `fetch` eagerly during server-side rendering with relative URL (`%url%`) — put your `fetch` calls inside `onMount` or a `load` function instead
* @param {{ "url": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function ssr_fetch_relative_url(_values, options) {
	throw_error("ssr_fetch_relative_url", `Cannot call \`fetch\` eagerly during server-side rendering with relative URL (\`${_values.url}\`) — put your \`fetch\` calls inside \`onMount\` or a \`load\` function instead`, options, ssr_fetch_relative_url);
}
/**
* Can only read `%name%` on the server during rendering (not in e.g. `load` functions), as it is bound to the current request via component context. This prevents state from leaking between users.
* @param {{ "name": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function state_read_outside_render(_values, options) {
	throw_error("state_read_outside_render", `Can only read \`${_values.name}\` on the server during rendering (not in e.g. \`load\` functions), as it is bound to the current request via component context. This prevents state from leaking between users.`, options, state_read_outside_render);
}
/**
* Cannot access `url.%property%` on a page with prerendering enabled
* @param {{ "property": string }} _values
* @param {ServerThrowOptions} [options]
* @returns {never}
*/
function url_search_unavailable_prerender(_values, options) {
	throw_error("url_search_unavailable_prerender", `Cannot access \`url.${_values.property}\` on a page with prerendering enabled`, options, url_search_unavailable_prerender);
}
// ../../node_modules/.pnpm/devalue@5.9.4/node_modules/devalue/src/constants.js
var MAX_ARRAY_LEN = 2 ** 32 - 1;
var MAX_ARRAY_INDEX = MAX_ARRAY_LEN - 1;
// ../../node_modules/.pnpm/devalue@5.9.4/node_modules/devalue/src/utils.js
/** @type {Record<string, string>} */
var escaped = {
	"<": "\\u003C",
	"\\": "\\\\",
	"\b": "\\b",
	"\f": "\\f",
	"\n": "\\n",
	"\r": "\\r",
	"	": "\\t",
	"\u2028": "\\u2028",
	"\u2029": "\\u2029"
};
var DevalueError = class extends Error {
	/**
	* @param {string} message
	* @param {string[]} keys
	* @param {any} [value] - The value that failed to be serialized
	* @param {any} [root] - The root value being serialized
	*/
	constructor(message, keys, value, root) {
		super(message);
		this.name = "DevalueError";
		this.path = keys.join("");
		this.value = value;
		this.root = root;
	}
};
/** @param {any} thing */
function is_primitive(thing) {
	return thing === null || typeof thing !== "object" && typeof thing !== "function";
}
var object_proto_names = /* @__PURE__ */ Object.getOwnPropertyNames(Object.prototype).sort().join("\0");
/** @param {any} thing */
function is_plain_object(thing) {
	const proto = Object.getPrototypeOf(thing);
	return proto === Object.prototype || proto === null || Object.getPrototypeOf(proto) === null || Object.getOwnPropertyNames(proto).sort().join("\0") === object_proto_names;
}
/** @param {any} thing */
function get_type(thing) {
	return Object.prototype.toString.call(thing).slice(8, -1);
}
/** @param {any} thing */
function is_buffer(thing) {
	return typeof Buffer !== "undefined" && Buffer.isBuffer(thing);
}
/** @param {string} char */
function get_escaped_char(char) {
	switch (char) {
		case "\"": return "\\\"";
		case "<": return "\\u003C";
		case "\\": return "\\\\";
		case "\n": return "\\n";
		case "\r": return "\\r";
		case "	": return "\\t";
		case "\b": return "\\b";
		case "\f": return "\\f";
		case "\u2028": return "\\u2028";
		case "\u2029": return "\\u2029";
		default: return char < " " ? `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}` : "";
	}
}
/** @param {string} str */
function stringify_string(str) {
	let result = "";
	let last_pos = 0;
	const len = str.length;
	for (let i = 0; i < len; i += 1) {
		const char = str[i];
		const replacement = get_escaped_char(char);
		if (replacement) {
			result += str.slice(last_pos, i) + replacement;
			last_pos = i + 1;
		}
	}
	return `"${last_pos === 0 ? str : result + str.slice(last_pos)}"`;
}
/** @param {Record<string | symbol, any>} object */
function enumerable_symbols(object) {
	return Object.getOwnPropertySymbols(object).filter((symbol) => Object.getOwnPropertyDescriptor(object, symbol).enumerable);
}
var is_identifier = /^[a-zA-Z_$][a-zA-Z_$0-9]*$/;
/** @param {string} key */
function stringify_key(key) {
	return is_identifier.test(key) ? "." + key : "[" + JSON.stringify(key) + "]";
}
/** @param {number} n */
function is_valid_array_index(n) {
	if (!Number.isInteger(n)) return false;
	if (n < 0) return false;
	if (n > MAX_ARRAY_INDEX) return false;
	return true;
}
/** @param {number} n */
function is_valid_array_len(n) {
	if (!Number.isInteger(n)) return false;
	if (n < 0) return false;
	if (n > MAX_ARRAY_LEN) return false;
	return true;
}
/** @param {string} s */
function is_valid_array_index_string(s) {
	if (s.length === 0) return false;
	if (s.length > 1 && s.charCodeAt(0) === 48) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	return is_valid_array_index(+s);
}
/**
* Returns the length of the leading run of valid array indices in `keys`.
* @param {readonly string[]} keys
*/
function array_index_cut(keys) {
	for (var i = keys.length - 1; i >= 0; i--) if (is_valid_array_index_string(keys[i])) break;
	return i + 1;
}
/**
* Finds the populated indices of an array.
* @param {unknown[]} array
*/
function valid_array_indices(array) {
	const keys = Object.keys(array);
	keys.length = array_index_cut(keys);
	return keys;
}
// ../../node_modules/.pnpm/devalue@5.9.4/node_modules/devalue/src/uneval.js
var chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$";
var MIN_STRING_LENGTH = 128;
var unsafe_chars = /[<\b\f\n\r\t\0\u2028\u2029]/g;
var reserved = /^(?:do|if|in|for|int|let|new|try|var|byte|case|char|else|enum|goto|long|this|void|with|await|break|catch|class|const|final|float|short|super|throw|while|yield|delete|double|export|import|native|return|switch|throws|typeof|boolean|default|extends|finally|package|private|abstract|continue|debugger|function|volatile|interface|protected|transient|implements|instanceof|synchronized)$/;
/**
* Turn a value into the JavaScript that creates an equivalent value
* @param {any} value
* @param {(value: any, uneval: (value: any) => string) => string | void} [replacer]
*/
function uneval(value, replacer) {
	const counts = /* @__PURE__ */ new Map();
	/** @type {string[]} */
	const keys = [];
	const custom = /* @__PURE__ */ new Map();
	/** @type {Map<string | bigint, string> | undefined} */
	let primitives;
	/** @param {any} thing */
	function stringify_cached_primitive(thing) {
		if (typeof thing === "string" && thing.length >= MIN_STRING_LENGTH || typeof thing === "bigint") {
			primitives ??= /* @__PURE__ */ new Map();
			let literal = primitives.get(thing);
			if (literal === void 0) {
				literal = stringify_primitive(thing);
				primitives.set(thing, literal);
			}
			return literal;
		}
		return stringify_primitive(thing);
	}
	/** @param {any} thing */
	function walk(thing) {
		if (!is_primitive(thing)) {
			if (counts.has(thing)) {
				counts.set(thing, counts.get(thing) + 1);
				return;
			}
			counts.set(thing, 1);
			if (replacer) {
				const str = replacer(thing, (value) => uneval(value, replacer));
				if (typeof str === "string") {
					custom.set(thing, str);
					return;
				}
			}
			if (typeof thing === "function") throw new DevalueError(`Cannot stringify a function`, keys, thing, value);
			switch (get_type(thing)) {
				case "BigInt":
				case "String":
					walk(thing.valueOf());
					return;
				case "Number":
				case "Boolean":
				case "Date":
				case "RegExp":
				case "URL":
				case "URLSearchParams": return;
				case "Array":
					for (const i of valid_array_indices(thing)) {
						keys.push(`[${i}]`);
						walk(thing[i]);
						keys.pop();
					}
					break;
				case "Set":
					Array.from(thing).forEach(walk);
					break;
				case "Map":
					for (const [key, value] of thing) {
						keys.push(`.get(${is_primitive(key) ? stringify_cached_primitive(key) : "..."})`);
						walk(key);
						walk(value);
						keys.pop();
					}
					break;
				case "Int8Array":
				case "Uint8Array":
				case "Uint8ClampedArray":
				case "Int16Array":
				case "Uint16Array":
				case "Float16Array":
				case "Int32Array":
				case "Uint32Array":
				case "Float32Array":
				case "Float64Array":
				case "BigInt64Array":
				case "BigUint64Array":
				case "DataView":
					if (!is_buffer(thing)) walk(thing.buffer);
					return;
				case "ArrayBuffer": return;
				case "Temporal.Duration":
				case "Temporal.Instant":
				case "Temporal.PlainDate":
				case "Temporal.PlainTime":
				case "Temporal.PlainDateTime":
				case "Temporal.PlainMonthDay":
				case "Temporal.PlainYearMonth":
				case "Temporal.ZonedDateTime": return;
				default:
					if (!is_plain_object(thing)) throw new DevalueError(`Cannot stringify arbitrary non-POJOs`, keys, thing, value);
					if (enumerable_symbols(thing).length > 0) throw new DevalueError(`Cannot stringify POJOs with symbolic keys`, keys, thing, value);
					for (const key of Object.keys(thing)) {
						if (key === "__proto__") throw new DevalueError(`Cannot stringify objects with __proto__ keys`, keys, thing, value);
						keys.push(stringify_key(key));
						walk(thing[key]);
						keys.pop();
					}
			}
		} else if (typeof thing === "symbol") throw new DevalueError(`Cannot stringify a Symbol primitive`, keys, thing, value);
		else if (typeof thing === "string" && thing.length >= MIN_STRING_LENGTH || typeof thing === "bigint") counts.set(thing, (counts.get(thing) || 0) + 1);
	}
	walk(value);
	const names = /* @__PURE__ */ new Map();
	/** @type {Array<[any, number]>} */
	const repeated = [];
	counts.forEach((count, thing) => {
		if (count > 1) repeated.push([thing, count]);
	});
	repeated.sort((a, b) => b[1] - a[1]).forEach(([thing, count]) => {
		const name = get_name(names.size);
		if (is_primitive(thing)) {
			const length = stringify_cached_primitive(thing).length;
			if (length * count <= length + (count + 1) * name.length + 25) return;
		}
		names.set(thing, name);
	});
	/**
	* @param {any} thing
	* @returns {string}
	*/
	function stringify(thing) {
		if (names.has(thing)) return names.get(thing);
		if (is_primitive(thing)) return stringify_primitive(thing);
		if (custom.has(thing)) return custom.get(thing);
		const type = get_type(thing);
		switch (type) {
			case "Number":
			case "String":
			case "Boolean":
			case "BigInt": return `Object(${stringify(thing.valueOf())})`;
			case "RegExp":
				const { source, flags } = thing;
				return flags ? `new RegExp(${stringify_string(source)},"${flags}")` : `new RegExp(${stringify_string(source)})`;
			case "Date": return `new Date(${thing.getTime()})`;
			case "URL": return `new URL(${stringify_string(thing.toString())})`;
			case "URLSearchParams": return `new URLSearchParams(${stringify_string(thing.toString())})`;
			case "Array": {
				let has_holes = false;
				let result = "[";
				for (let i = 0; i < thing.length; i += 1) {
					if (i > 0) result += ",";
					if (Object.hasOwn(thing, i)) result += stringify(thing[i]);
					else if (!has_holes) {
						const populated_keys = valid_array_indices(thing);
						const population = populated_keys.length;
						const d = String(thing.length).length;
						const array = stringify_sparse_array(thing.length);
						if (thing.length + 2 > array.length + 18 + population * (d + 2)) return `Object.assign(${array},{${populated_keys.map((k) => `${k}:${stringify(thing[k])}`).join(",")}})`;
						has_holes = true;
					}
				}
				const tail = thing.length === 0 || Object.hasOwn(thing, thing.length - 1) ? "" : ",";
				return result + tail + "]";
			}
			case "Set":
			case "Map": return `new ${type}([${Array.from(thing).map(stringify).join(",")}])`;
			case "Int8Array":
			case "Uint8Array":
			case "Uint8ClampedArray":
			case "Int16Array":
			case "Uint16Array":
			case "Float16Array":
			case "Int32Array":
			case "Uint32Array":
			case "Float32Array":
			case "Float64Array":
			case "BigInt64Array":
			case "BigUint64Array": {
				if (is_buffer(thing)) thing = new Uint8Array(thing);
				let str = `new ${type}`;
				if (!names.has(thing.buffer)) str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
				else str += `(${stringify(thing.buffer)})`;
				if (thing.byteLength !== thing.buffer.byteLength) {
					const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
					const end = start + thing.length;
					str += `.subarray(${start},${end})`;
				}
				return str;
			}
			case "DataView": {
				let str = `new DataView`;
				if (!names.has(thing.buffer)) str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
				else str += `(${stringify(thing.buffer)}`;
				if (thing.byteLength !== thing.buffer.byteLength) str += `,${thing.byteOffset},${thing.byteLength}`;
				return str + ")";
			}
			case "ArrayBuffer": return `new Uint8Array([${new Uint8Array(thing).toString()}]).buffer`;
			case "Temporal.Duration":
			case "Temporal.Instant":
			case "Temporal.PlainDate":
			case "Temporal.PlainTime":
			case "Temporal.PlainDateTime":
			case "Temporal.PlainMonthDay":
			case "Temporal.PlainYearMonth":
			case "Temporal.ZonedDateTime": return `${type}.from(${stringify_string(thing.toString())})`;
			default:
				const keys = Object.keys(thing);
				const obj = keys.map((key) => `${safe_key(key)}:${stringify(thing[key])}`).join(",");
				if (Object.getPrototypeOf(thing) === null) return keys.length > 0 ? `{${obj},__proto__:null}` : `{__proto__:null}`;
				return `{${obj}}`;
		}
	}
	const str = stringify(value);
	if (names.size) {
		/** @type {string[]} */
		const params = [];
		/** @type {string[]} */
		const statements = [];
		/** @type {string[]} */
		const values = [];
		/** @type {string[]} */
		const reconstructions = [];
		names.forEach((name, thing) => {
			params.push(name);
			if (custom.has(thing)) {
				values.push(custom.get(thing));
				return;
			}
			if (is_primitive(thing)) {
				values.push(stringify_cached_primitive(thing));
				return;
			}
			const type = get_type(thing);
			switch (type) {
				case "Number":
				case "String":
				case "Boolean":
				case "BigInt": {
					const primitive = thing.valueOf();
					if (names.has(primitive)) {
						values.push("{}");
						reconstructions.push(`${name}=Object(${stringify(primitive)})`);
					} else values.push(`Object(${stringify(primitive)})`);
					break;
				}
				case "RegExp":
					const { source, flags } = thing;
					const regexp = flags ? `new RegExp(${stringify_string(source)},"${flags}")` : `new RegExp(${stringify_string(source)})`;
					values.push(regexp);
					break;
				case "Date":
					values.push(`new Date(${thing.getTime()})`);
					break;
				case "URL":
					values.push(`new URL(${stringify_string(thing.toString())})`);
					break;
				case "URLSearchParams":
					values.push(`new URLSearchParams(${stringify_string(thing.toString())})`);
					break;
				case "Array": {
					const populated_keys = valid_array_indices(thing);
					values.push(thing.length > 32 + 2 * populated_keys.length ? stringify_sparse_array(thing.length) : `Array(${thing.length})`);
					for (const i of populated_keys) statements.push(`${name}[${i}]=${stringify(thing[i])}`);
					break;
				}
				case "Set": {
					values.push(`new Set`);
					const adds = Array.from(thing).map((v) => `.add(${stringify(v)})`);
					if (adds.length > 0) statements.push(name + adds.join(""));
					break;
				}
				case "Map": {
					values.push(`new Map`);
					const sets = Array.from(thing).map(([k, v]) => `.set(${stringify(k)}, ${stringify(v)})`);
					if (sets.length > 0) statements.push(name + sets.join(""));
					break;
				}
				case "Int8Array":
				case "Uint8Array":
				case "Uint8ClampedArray":
				case "Int16Array":
				case "Uint16Array":
				case "Float16Array":
				case "Int32Array":
				case "Uint32Array":
				case "Float32Array":
				case "Float64Array":
				case "BigInt64Array":
				case "BigUint64Array": {
					if (is_buffer(thing)) thing = new Uint8Array(thing);
					let str = `new ${type}`;
					if (!names.has(thing.buffer)) str += `([${stringify_typed_array_elements(type, thing.buffer)}])`;
					else str += `(${stringify(thing.buffer)})`;
					if (thing.byteLength !== thing.buffer.byteLength) {
						const start = thing.byteOffset / thing.BYTES_PER_ELEMENT;
						const end = start + thing.length;
						str += `.subarray(${start},${end})`;
					}
					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}
				case "DataView": {
					let str = `new DataView`;
					if (!names.has(thing.buffer)) str += `(new Uint8Array([${new Uint8Array(thing.buffer)}]).buffer`;
					else str += `(${stringify(thing.buffer)}`;
					if (thing.byteLength !== thing.buffer.byteLength) str += `,${thing.byteOffset},${thing.byteLength}`;
					str += ")";
					values.push(`{}`);
					reconstructions.push(`${name}=${str}`);
					break;
				}
				case "ArrayBuffer":
					values.push(`new Uint8Array([${new Uint8Array(thing)}]).buffer`);
					break;
				case "Temporal.Duration":
				case "Temporal.Instant":
				case "Temporal.PlainDate":
				case "Temporal.PlainTime":
				case "Temporal.PlainDateTime":
				case "Temporal.PlainMonthDay":
				case "Temporal.PlainYearMonth":
				case "Temporal.ZonedDateTime":
					values.push(`${type}.from(${stringify_string(thing.toString())})`);
					break;
				default:
					values.push(Object.getPrototypeOf(thing) === null ? "Object.create(null)" : "{}");
					Object.keys(thing).forEach((key) => {
						statements.push(`${name}${safe_prop(key)}=${stringify(thing[key])}`);
					});
			}
		});
		statements.push(`return ${str}`);
		const body = [...reconstructions, ...statements].join(";");
		if (params.length > 65534) return `(function(){var[${params.join(",")}]=arguments[0];${body}}([${values.join(",")}]))`;
		return `(function(${params.join(",")}){${body}}(${values.join(",")}))`;
	} else return str;
}
/**
* Emit an array whose storage is not proportional to its declared length.
* As in the default parse operations, touching and deleting the largest valid
* index forces V8 into dictionary-elements mode before setting the length.
* Merely starting with [] and assigning .length still eagerly allocates.
* @param {number} length
*/
function stringify_sparse_array(length) {
	return `(function(a){a[${MAX_ARRAY_INDEX}]=0;delete a[${MAX_ARRAY_INDEX}];a.length=${length};return a}([]))`;
}
/**
* Serialize the elements of `buffer`, read as `type`, as a comma-separated list.
* The view is created from `type` rather than from the serialized value's own
* constructor, which may be a subclass like Node's `Buffer` whose `toString`
* decodes the bytes instead of listing them.
* `BigInt64Array`/`BigUint64Array` elements are bigints and must be written
* with an `n` suffix, otherwise the emitted `new BigInt64Array([...])` throws.
* @param {string} type
* @param {ArrayBufferLike} buffer
*/
function stringify_typed_array_elements(type, buffer) {
	const array = new globalThis[type](buffer);
	if (type === "BigInt64Array" || type === "BigUint64Array") return Array.from(array, (element) => `${element}n`).join(",");
	if (array instanceof Float32Array || array instanceof Float64Array || typeof Float16Array !== "undefined" && array instanceof Float16Array) return Array.from(array, (element) => Object.is(element, -0) ? "-0" : `${element}`).join(",");
	return array.toString();
}
/** @param {number} num */
function get_name(num) {
	let name = "";
	do {
		name = chars[num % 54] + name;
		num = ~~(num / 54) - 1;
	} while (num >= 0);
	return reserved.test(name) ? `${name}0` : name;
}
/** @param {string} c */
function escape_unsafe_char(c) {
	return escaped[c] || c;
}
/** @param {string} str */
function escape_unsafe_chars(str) {
	return str.replace(unsafe_chars, escape_unsafe_char);
}
/** @param {string} key */
function safe_key(key) {
	return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? key : escape_unsafe_chars(JSON.stringify(key));
}
/** @param {string} key */
function safe_prop(key) {
	return /^[_$a-zA-Z][_$a-zA-Z0-9]*$/.test(key) ? `.${key}` : `[${escape_unsafe_chars(JSON.stringify(key))}]`;
}
/** @param {any} thing */
function stringify_primitive(thing) {
	const type = typeof thing;
	if (type === "string") return stringify_string(thing);
	if (thing === void 0) return "void 0";
	if (thing === 0 && 1 / thing < 0) return "-0";
	const str = String(thing);
	if (type === "number") return str.replace(/^(-)?0\./, "$1.");
	if (type === "bigint") return thing + "n";
	return str;
}
export { remote_requested_invalid_limit as $, load_not_plain_object as A, remote_command_readonly as B, cookies_set_after_response as C, handle_error_hook_failed as D, fetch_response_decoded as E, prerender_endpoint_methods as F, remote_headers_forbidden as G, remote_cookie_forbidden as H, prerender_endpoint_not_prerenderable as I, remote_query_live_not_iterable as J, remote_invalid_validator as K, prerender_nonce as L, load_promise_not_serializable as M, load_response_header_not_serialized as N, header_already_set as O, prerender_actions as P, remote_requested_context as Q, prerender_template_nonce as R, cookies_serialize_before_route as S, endpoint_invalid_response as T, remote_cookie_path_relative as U, remote_command_render as V, remote_form_fail as W, remote_request_property as X, remote_query_prerender as Y, remote_requested_async_validator as Z, action_return_error as _, is_buffer as a, ssr_fetch_relative_url as at, client_address_unsupported as b, is_valid_array_len as c, capture_error as ct, valid_array_indices as d, remote_requested_invalid_query as et, MAX_ARRAY_INDEX as f, action_response_not_serializable as g, action_name_reserved as h, get_type as i, set_headers_cookie as it, load_not_serializable as j, load_fetch_cors as k, stringify_key as l, action_default_with_named as m, DevalueError as n, server_api_unavailable as nt, is_plain_object as o, state_read_outside_render as ot, action_data_not_serializable as p, remote_query_live_no_value as q, enumerable_symbols as r, set_headers_after_response as rt, is_valid_array_index as s, url_search_unavailable_prerender as st, uneval as t, remote_requested_wrong_method as tt, stringify_string as u, action_return_redirect as v, csp_report_only_missing_report as w, cookie_too_large as x, action_throw_fail as y, remote_command_method as z };

//# sourceMappingURL=uneval.js.map