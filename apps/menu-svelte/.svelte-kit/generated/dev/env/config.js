import { variables } from "../../../../src/env.ts";
import { validate, handle_issues } from '@sveltejs/kit/internal/env';

const issues = {};

export { variables }

export const dynamic_private_env = {};

export const explicit_public_env = {};

export const rendered_env = {};

handle_issues(issues);

export function set_env(env) {
	const issues = {};
	const API_BASE_URL = validate(variables, env.API_BASE_URL, "API_BASE_URL", issues);
	dynamic_private_env.API_BASE_URL = API_BASE_URL;
	handle_issues(issues);
}

set_env({API_BASE_URL:"http://127.0.0.1:3001"});