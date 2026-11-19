import type { Rule } from "eslint";

// Types for the local live text editing lint rule (FLOW-244).
declare const plugin: { rules: { "wrap-text": Rule.RuleModule } };
export default plugin;
