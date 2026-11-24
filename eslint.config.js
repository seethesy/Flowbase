import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
import liveCopy from "./scripts/eslint-live-copy.mjs";
export default ts.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ["scripts/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": hooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
  {
    // Every checkbox is a RoundCheck (FLOW-245) and every dropdown a Dropdown (FLOW-259).
    files: ["src/**/*.tsx"],
    ignores: ["src/components/ui/round-check.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']",
          message: "Use RoundCheck from src/components/ui/round-check.tsx instead of a raw checkbox.",
        },
        {
          // Every dropdown is the shared Dropdown (FLOW-259).
          selector: "JSXOpeningElement[name.name='select']",
          message: "Use Dropdown from src/components/ui/Dropdown.tsx instead of a native select.",
        },
      ],
    },
  },
  {
    // Screen wording is editable live (FLOW-240): wrap it in <T>, or useCopy for a
    // placeholder (FLOW-244, docs/live-text-editing.md). Print documents are out
    // of scope.
    files: ["src/features/**/*.tsx", "src/components/**/*.tsx"],
    ignores: [
      "src/components/print/**",
      "src/features/beo/print-sample.tsx",
      "src/features/beo/beo-print.tsx",
      "src/features/beo/offline-beos.tsx",
    ],
    plugins: { "live-copy": liveCopy },
    rules: { "live-copy/no-literal-text": "error" },
  },
);
