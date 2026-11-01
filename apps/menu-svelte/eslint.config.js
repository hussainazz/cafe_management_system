import eslint from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import svelte from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";

export default [
  { ignores: [".svelte-kit/**", ".vercel/**", "build/**", "coverage/**", "node_modules/**"] },
  eslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: { "@typescript-eslint/consistent-type-imports": "error" },
  },
  ...svelte.configs["flat/recommended"],
  {
    files: ["**/*.svelte"],
    languageOptions: { parser: svelteParser, parserOptions: { parser: tsParser } },
  },
];
