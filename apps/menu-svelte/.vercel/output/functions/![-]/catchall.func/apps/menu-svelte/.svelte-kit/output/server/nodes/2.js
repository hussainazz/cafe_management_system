

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.DGcduO42.js","_app/immutable/chunks/DklAu3X3.js","_app/immutable/entry/payload.DSmR2FwN.js","_app/immutable/chunks/D2rC4-Ub.js"];
export const stylesheets = ["_app/immutable/assets/2.UnxeGlPH.css"];
export const fonts = [];
