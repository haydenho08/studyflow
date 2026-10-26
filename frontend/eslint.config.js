// ESLint flat config. `npm run lint` runs it; CI fails on any error.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/api/schema.ts"] }, // build output and generated code
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // The two rules that catch real hook bugs: hooks called conditionally, and effects
      // that read values they don't list as dependencies (stale closures).
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Node scripts (screenshots). Callbacks passed to Playwright run in the page, hence browser too.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
