// Live text editing guard (FLOW-244): screen wording must go through <T> or
// useCopy (FLOW-240) so the admin can edit it. Reports, in JSX:
//   - text with letters, e.g. <h2>New heading</h2>;
//   - string literals rendered as children, including the branches of ?:, &&,
//     || and ??, e.g. {saving ? "Saving…" : "Save"};
//   - literal placeholders, e.g. placeholder="Search".
// Punctuation- and symbol-only text (·, —, /, :, …, ×) passes. Text inside
// <option>, <textarea>, <title>, <code>, <pre>, <kbd> and SVG text is left alone,
// as is anything already inside <T> or <TPlural>. Other attributes (className,
// aria-*, title, href, type, …) are not checked. For a genuine exception, add
// `// eslint-disable-next-line live-copy/wrap-text -- <reason>`.
// docs/live-text-editing.md explains the keys.

const LETTERS = /\p{L}/u;
const ALLOWED_PARENTS = new Set([
  "option",
  "textarea",
  "title",
  "style",
  "script",
  "code",
  "pre",
  "kbd",
  "svg",
  "text",
  "tspan",
  "T",
  "TPlural",
]);

const nameOf = (element) => {
  const name = element?.openingElement?.name;
  if (!name) return null;
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return name.property.name;
  return null;
};
const hasLetters = (node) => {
  if (node.type === "Literal") return typeof node.value === "string" && LETTERS.test(node.value);
  if (node.type === "TemplateLiteral")
    return LETTERS.test(node.quasis.map((q) => q.value.cooked ?? q.value.raw).join(""));
  return false;
};
// The string literals an expression renders directly.
function renderedStrings(node) {
  if (!node) return [];
  switch (node.type) {
    case "Literal":
    case "TemplateLiteral":
      return hasLetters(node) ? [node] : [];
    case "ConditionalExpression":
      return [...renderedStrings(node.consequent), ...renderedStrings(node.alternate)];
    case "LogicalExpression":
      return node.operator === "&&"
        ? renderedStrings(node.right)
        : [...renderedStrings(node.left), ...renderedStrings(node.right)];
    case "TSAsExpression":
    case "TSNonNullExpression":
      return renderedStrings(node.expression);
    default:
      return [];
  }
}

const wrapText = {
  meta: {
    type: "problem",
    docs: {
      description: "Screen wording goes through <T> or useCopy so the admin can edit it (FLOW-240).",
    },
    messages: {
      text: 'Wrap screen text in <T id="area.screen.element">…</T> so the admin can edit it (docs/live-text-editing.md).',
      placeholder:
        'Use useCopy("area.screen.element", "…") for placeholder text so the admin can edit it (docs/live-text-editing.md).',
    },
    schema: [],
  },
  create(context) {
    const allowed = (parent) =>
      (parent?.type === "JSXElement" && ALLOWED_PARENTS.has(nameOf(parent)));
    return {
      JSXText(node) {
        if (!LETTERS.test(node.value) || allowed(node.parent)) return;
        // Point at the text itself, not the whitespace before it, so a
        // disable-next-line comment above the text applies.
        const start = node.range[0] + /^\s*/.exec(node.value)[0].length;
        context.report({
          node,
          loc: context.sourceCode.getLocFromIndex(start),
          messageId: "text",
        });
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (parent?.type === "JSXAttribute") {
          if (parent.name?.name === "placeholder")
            for (const literal of renderedStrings(node.expression))
              context.report({ node: literal, messageId: "placeholder" });
          return;
        }
        if (parent?.type !== "JSXElement" && parent?.type !== "JSXFragment") return;
        if (allowed(parent)) return;
        for (const literal of renderedStrings(node.expression))
          context.report({ node: literal, messageId: "text" });
      },
      JSXAttribute(node) {
        if (node.name?.name === "placeholder" && node.value?.type === "Literal" && hasLetters(node.value))
          context.report({ node: node.value, messageId: "placeholder" });
      },
    };
  },
};

export default { rules: { "wrap-text": wrapText } };
