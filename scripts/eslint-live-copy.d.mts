import type { Rule } from "eslint";

// Types for the local ESLint plugin (FLOW-244), so tests can import it.
declare const plugin: { rules: { "no-literal-text": Rule.RuleModule } };
export default plugin;
