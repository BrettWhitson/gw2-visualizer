import js from "@eslint/js";
import globals from "globals";
import svelte from "eslint-plugin-svelte";

export default [
  {
    ignores: ["web/static/**", "web/data/**", "node_modules/**", "_site/**"],
  },
  js.configs.recommended,
  // Svelte's rules for components and rune modules only (applied everywhere, they trip over the service worker).
  ...svelte.configs.recommended.map((config) => ({
    ...config,
    files: config.files ?? ["**/*.svelte", "**/*.svelte.js"],
  })),
  {
    files: ["web/src/**/*.js", "web/src/**/*.svelte"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    files: ["web/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: [
      "tests/**/*.js",
      "tools/**/*.mjs",
      "eslint.config.js",
      "vite.config.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-implicit-globals": "error",
      "no-alert": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='outerHTML']",
          message: "Use escapeHtml + innerHTML or DOM APIs.",
        },
      ],
    },
  },
  // A service worker's top level is its own isolated global scope.
  { files: ["web/sw.js"], rules: { "no-implicit-globals": "off" } },
  // Command-line tools report to the console.
  { files: ["tools/**/*.mjs"], rules: { "no-console": "off" } },
  {
    files: ["**/*.svelte", "**/*.svelte.js"],
    rules: {
      // `let { … } = $props()` is the idiom; the Svelte-aware version knows props are reassigned from outside.
      "prefer-const": "off",
      "svelte/prefer-const": ["error", { destructuring: "all" }],
    },
  },
];
