import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["public/lib/**", "public/data/**", "node_modules/**", "_site/**"],
  },
  js.configs.recommended,
  {
    files: ["public/src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        cytoscape: "readonly",
        cytoscapeDagre: "readonly",
      },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ["tests/**/*.js", "tools/**/*.mjs", "eslint.config.js"],
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
  { files: ["public/sw.js"], rules: { "no-implicit-globals": "off" } },
  // Command-line tools report to the console.
  { files: ["tools/**/*.mjs"], rules: { "no-console": "off" } },
];
