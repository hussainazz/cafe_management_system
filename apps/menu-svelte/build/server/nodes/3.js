import * as server from '../entries/pages/menu/_page.server.ts.js';

export const index = 3;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/menu/_page.svelte.js')).default;
export { server };
export const server_id = "src/routes/menu/+page.server.ts";
export const imports = ["_app/immutable/nodes/3.DYcsTe7v.js","_app/immutable/chunks/DklAu3X3.js","_app/immutable/entry/payload.DSmR2FwN.js","_app/immutable/chunks/D2rC4-Ub.js"];
export const stylesheets = ["_app/immutable/assets/3.CkB_L5TK.css"];
export const fonts = [];
