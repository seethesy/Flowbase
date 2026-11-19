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
  // Live text editing (FLOW-244): screen wording goes through <T> / useCopy.
  // Print documents, the sign-in screen and the editing UI itself are exempt.
  {
    files: ["src/features/**/*.tsx", "src/components/**/*.tsx", "src/app/**/*.tsx"],
    ignores: [
      "src/components/print/**",
      "src/features/print-sample.tsx",
      "src/features/beo-print.tsx",
      "src/app/auth.tsx",
      "src/app/live-copy.tsx",
    ],
    plugins: { "live-copy": liveCopy },
    rules: { "live-copy/wrap-text": "error" },
  },
);
