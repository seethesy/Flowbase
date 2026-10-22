import { getHTMLFromFragment, getSchema } from "@tiptap/core";
import { Node } from "@tiptap/pm/model";
import DOMPurify from "dompurify";
import { isAllowedLink, richTextExtensions, type RichTextDoc } from "./extensions";

const schema = getSchema(richTextExtensions);

// A private DOMPurify instance so these hooks never affect other callers.
const purifier = DOMPurify(window);
purifier.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!isAllowedLink(href)) node.removeAttribute("href");
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer nofollow");
  }
  // Rendered checklists are read-only; ticking happens in the editor.
  if (node.tagName === "INPUT") node.setAttribute("disabled", "");
});
const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: ["p", "br", "h1", "h2", "h3", "strong", "em", "ul", "ol", "li", "a", "label", "input", "span", "div"],
  ALLOWED_ATTR: ["href", "target", "rel", "start", "type", "checked", "disabled", "data-type", "data-checked"],
  ALLOW_DATA_ATTR: false,
};

export function sanitizeRichTextHtml(html: string): string {
  const fragment = purifier.sanitize(html, { ...SANITIZE_OPTIONS, RETURN_DOM_FRAGMENT: true });
  // Checklist boxes are the only inputs allowed.
  for (const input of fragment.querySelectorAll('input:not([type="checkbox"])')) input.remove();
  const container = document.createElement("div");
  container.append(fragment);
  return container.innerHTML;
}

// Stored JSON → sanitized HTML for screen and print. Invalid or missing
// documents render as an empty string instead of throwing.
export function renderRichText(doc: RichTextDoc | null | undefined): string {
  if (!doc) return "";
  try {
    const node = Node.fromJSON(schema, doc);
    node.check();
    return sanitizeRichTextHtml(getHTMLFromFragment(node.content, schema));
  } catch {
    return "";
  }
}

const LIST = new Set(["UL", "OL"]);

// Google Docs clipboard HTML → markup the editor schema understands. Styles the
// schema doesn't support are dropped by the editor itself; this only fixes
// structure that would otherwise be lost (nesting, checklists, the bold wrapper).
export function normalizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;

  // Docs wraps the whole selection in <b style="font-weight:normal" id="docs-internal-guid-…">.
  for (const wrapper of body.querySelectorAll('b[id^="docs-internal-guid"]')) {
    wrapper.replaceWith(...wrapper.childNodes);
  }

  // Docs nests lists as <ul><li/><ul>…</ul></ul>; move each nested list into the
  // preceding item so the nesting survives.
  for (const list of [...body.querySelectorAll("ul, ol")].reverse()) {
    const parent = list.parentElement;
    const previous = list.previousElementSibling;
    if (parent && LIST.has(parent.tagName) && previous?.tagName === "LI") {
      previous.append(list);
    }
  }

  // Docs checklists: <li role="checkbox" aria-checked="true|false">.
  for (const list of body.querySelectorAll("ul, ol")) {
    const items = [...list.children].filter((child) => child.tagName === "LI");
    if (!items.length || !items.every((item) => item.getAttribute("role") === "checkbox")) continue;
    const taskList = doc.createElement("ul");
    taskList.setAttribute("data-type", "taskList");
    for (const item of items) {
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", item.getAttribute("aria-checked") === "true" ? "true" : "false");
      item.removeAttribute("role");
      item.removeAttribute("aria-checked");
      taskList.append(item);
    }
    list.replaceWith(taskList);
  }

  return body.innerHTML;
}
