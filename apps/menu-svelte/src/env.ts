import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  API_BASE_URL: {
    schema: (value) => value?.trim() || undefined,
    static: false,
    description: "Server-side base URL for the existing Fastify API.",
  },
});
