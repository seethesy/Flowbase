// ESLint rule live-copy/no-literal-text (FLOW-244): screen wording must be
// wrapped in <T id="…"> (or useCopy for an input placeholder) so the admin can
// edit it live (FLOW-240). See docs/live-text-editing.md.
//
// Flags, outside <T> and <Plural>:
// - JSX text with a letter in it (punctuation and symbols such as · — / : … × are fine);
// - a string or template literal with a letter as a JSX child, including the
//   branches of a ?: or the right side of && / || / ??;
// - a string with a letter in a `placeholder` attribute.
// Other attributes (className, aria-*, title, href, type…) are not checked, nor is
// text inside a native <option>, <title>, <style> or <script>.

const MESSAGE =
  'Wrap screen text in <T id="area.screen.element">…</T> so the admin can edit it (docs/live-text-editing.md).';
const PLACEHOLDER_MESSAGE =
  'Use useCopy("area.screen.element", "…") for the placeholder and set data-copy-id on the input (docs/live-text-editing.md).';
const letters = /\p{L}/u;
const ALLOWED_PARENTS = new Set(["T", "Plural", "option", "title", "style", "script"]);

const elementName = (node) => {
  const name = node?.openingElement?.name;
  if (!name) return "";
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXMemberExpression") return `${name.object.name}.${name.property.name}`;
  return "";
};
function insideAllowed(node) {
  for (let current = node.parent; current; current = current.parent)
    if (current.type === "JSXElement" && ALLOWED_PARENTS.has(elementName(current))) return true;
  return false;
}
const textOf = (node) =>
  node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : node.type === "TemplateLiteral"
      ? node.quasis.map((quasi) => quasi.value.cooked ?? "").join("")
      : null;
// String leaves an expression can render: literals, templates, ?: branches, && || ?? sides.
function leaves(node) {
  if (!node) return [];
  if (node.type === "Literal" || node.type === "TemplateLiteral") return [node];
  if (node.type === "ConditionalExpression") return [...leaves(node.consequent), ...leaves(node.alternate)];
  if (node.type === "LogicalExpression")
    return [...(node.operator === "&&" ? [] : leaves(node.left)), ...leaves(node.right)];
  return [];
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Screen wording must be editable live (FLOW-240/244)." },
    schema: [],
    messages: { text: MESSAGE, placeholder: PLACEHOLDER_MESSAGE },
  },
  create(context) {
    const report = (node, messageId) => context.report({ node, messageId });
    return {
      JSXText(node) {
        if (letters.test(node.value) && !insideAllowed(node)) report(node, "text");
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === "JSXAttribute") {
          const name = node.parent.name.name;
          if (name !== "placeholder") return;
          for (const leaf of leaves(node.expression))
            if (letters.test(textOf(leaf) ?? "")) report(leaf, "placeholder");
          return;
        }
        if (insideAllowed(node)) return;
        for (const leaf of leaves(node.expression))
          if (letters.test(textOf(leaf) ?? "")) report(leaf, "text");
      },
      JSXAttribute(node) {
        if (node.name.name === "placeholder" && node.value?.type === "Literal" && letters.test(String(node.value.value)))
          report(node.value, "placeholder");
      },
    };
  },
};

export default { rules: { "no-literal-text": rule } };
