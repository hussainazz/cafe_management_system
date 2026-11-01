import adapterNode from "@sveltejs/adapter-node";
import adapterVercel from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import { defineConfig } from "vite";

const selectedAdapter = process.env.SVELTEKIT_ADAPTER ?? "vercel";

if (selectedAdapter !== "vercel" && selectedAdapter !== "node") {
  throw new Error('SVELTEKIT_ADAPTER must be either "vercel" or "node".');
}

const adapter =
  selectedAdapter === "node" ? adapterNode() : adapterVercel({ runtime: "nodejs24.x" });

export default defineConfig({
  plugins: [sveltekit({ adapter })],
  server: { port: 3003 },
  preview: { port: 3003 },
});
