import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { richTextExtensions, type RichTextDoc } from "../src/components/rich-text/extensions";
import {
  normalizePastedHtml,
  renderRichText,
  sanitizeRichTextHtml,
} from "../src/components/rich-text/render";
import { RichTextEditor } from "../src/components/rich-text/RichTextEditor";
import { RichTextView } from "../src/components/rich-text/RichTextView";

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({ type: "text", text: value, marks });
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: "paragraph", content });
const task = (checked: boolean, label: string, children?: JSONContent): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(text(label)), ...(children ? [children] : [])],
});

// The BEO's cleanup/breakdown checklist, two levels deep.
const beoChecklist: RichTextDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Cleanup / breakdown")] },
    {
      type: "taskList",
      content: [
        task(
          true,
          "Kitchen",
          { type: "taskList", content: [task(true, "Wipe down prep tables"), task(false, "Bag trash")] },
        ),
        task(false, "Load truck"),
      ],
    },
  ],
};

const fragment = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
};

describe("rendering stored JSON (FLOW-50)", () => {
  it("renders headings, marks, nested lists and links", () => {
    const html = renderRichText({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Setup notes")] },
        paragraph(text("Bold", [{ type: "bold" }]), text(" and "), text("italic", [{ type: "italic" }])),
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                paragraph(text("Linens")),
                { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Ivory"))] }] },
              ],
            },
          ],
        },
        { type: "orderedList", content: [{ type: "listItem", content: [paragraph(text("Arrive"))] }] },
        paragraph(text("Venue", [{ type: "link", attrs: { href: "https://example.com/venue" } }])),
      ],
    });
    const dom = fragment(html);
    expect(dom.querySelector("h1")?.textContent).toBe("Setup notes");
    expect(dom.querySelector("strong")?.textContent).toBe("Bold");
    expect(dom.querySelector("em")?.textContent).toBe("italic");
    expect(dom.querySelector("ul > li > ul > li")?.textContent).toBe("Ivory");
    expect(dom.querySelector("ol > li")?.textContent).toBe("Arrive");
    const link = dom.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/venue");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it("renders nested checklists as read-only checkboxes (AC1)", () => {
    const dom = fragment(renderRichText(beoChecklist));
    const outer = dom.querySelectorAll(':scope > ul[data-type="taskList"] > li[data-type="taskItem"]');
    expect(outer).toHaveLength(2);
    const nested = outer[0].querySelectorAll('ul[data-type="taskList"] > li[data-type="taskItem"]');
    expect([...nested].map((item) => item.textContent)).toEqual(["Wipe down prep tables", "Bag trash"]);
    const boxes = [...dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false, false]);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(nested[1].getAttribute("data-checked")).toBe("false");
  });

  it("returns an empty string for missing or invalid documents", () => {
    expect(renderRichText(null)).toBe("");
    expect(renderRichText(undefined)).toBe("");
    expect(renderRichText({ type: "doc", content: [{ type: "table" }] })).toBe("");
    expect(renderRichText({ type: "paragraph" } as RichTextDoc)).toBe("");
  });
});

describe("sanitizing rendered HTML (FLOW-50)", () => {
  it("removes scripts, event handlers, styles and unsafe links", () => {
    const html = sanitizeRichTextHtml(
      '<p style="color:red" onclick="alert(1)">Hi<script>alert(1)</script><img src=x onerror="alert(1)"></p>' +
        '<a href="javascript:alert(1)">bad</a><a href="mailto:chef@example.com">mail</a>' +
        '<iframe src="https://example.com"></iframe><input type="text" value="x"><div data-foo="1">x</div>',
    );
    const dom = fragment(html);
    expect(html).not.toMatch(/script|onclick|onerror|style=|iframe|<img|data-foo|javascript:/i);
    expect(dom.querySelectorAll("input")).toHaveLength(0);
    expect(dom.querySelectorAll("a")[0].hasAttribute("href")).toBe(false);
    expect(dom.querySelectorAll("a")[1].getAttribute("href")).toBe("mailto:chef@example.com");
  });

  it("keeps checklist markup", () => {
    const html = sanitizeRichTextHtml(
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>',
    );
    const box = fragment(html).querySelector<HTMLInputElement>("input")!;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(html).toContain('data-type="taskItem"');
  });
});

describe("pasting from Google Docs (AC2)", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  const paste = (html: string) => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: richTextExtensions,
      editorProps: { transformPastedHTML: normalizePastedHtml },
    });
    editor.view.pasteHTML(html);
    return editor.getJSON();
  };
  const marksIn = (node: JSONContent): string[] => [
    ...(node.marks ?? []).map((mark) => mark.type),
    ...(node.content ?? []).flatMap(marksIn),
  ];
  const typesIn = (node: JSONContent): string[] => [node.type ?? "", ...(node.content ?? []).flatMap(typesIn)];

  // Trimmed from real Google Docs clipboard HTML.
  const docsHtml =
    '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234">' +
    '<h2 dir="ltr" style="line-height:1.38;margin-top:18pt"><span style="font-size:16pt;font-family:Arial;color:#000000;font-weight:400">Setup</span></h2>' +
    '<p dir="ltr"><span style="font-family:Arial;color:#ff0000;font-weight:700">Bold red</span><span style="font-family:Arial"> plain </span>' +
    '<span style="font-style:italic">italic</span> <span style="text-decoration:underline">underlined</span> ' +
    '<span style="background-color:#ffff00">highlight</span> <a href="https://example.com/sop"><span style="color:#1155cc">SOP</span></a></p>' +
    '<ul style="margin-top:0"><li dir="ltr" aria-level="1" style="list-style-type:disc"><p dir="ltr" role="presentation"><span>Linens</span></p></li>' +
    '<ul><li dir="ltr" aria-level="2" style="list-style-type:circle"><p dir="ltr" role="presentation"><span>Ivory</span></p></li></ul></ul>' +
    '<ul><li role="checkbox" aria-checked="true" aria-level="1"><p role="presentation"><span>Wipe tables</span></p></li>' +
    '<li role="checkbox" aria-checked="false" aria-level="1"><p role="presentation"><span>Bag trash</span></p></li></ul>' +
    '<table><tr><td><span style="font-family:Courier">Cell</span></td></tr></table>' +
    "</b>";

  it("keeps headings, bold, italic, links and nested lists", () => {
    const json = paste(docsHtml);
    const content = json.content ?? [];
    expect(content[0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(content[0].content?.[0].marks).toBeUndefined();
    const paragraphText = content[1].content ?? [];
    expect(paragraphText.find((node) => node.text === "Bold red")?.marks).toEqual([{ type: "bold" }]);
    expect(paragraphText.find((node) => node.text === " plain ")?.marks).toBeUndefined();
    expect(paragraphText.find((node) => node.text === "italic")?.marks).toEqual([{ type: "italic" }]);
    expect(paragraphText.find((node) => node.text === "SOP")?.marks?.[0]).toMatchObject({
      type: "link",
      attrs: { href: "https://example.com/sop" },
    });
    const list = content.find((node) => node.type === "bulletList");
    const linens = list?.content?.[0];
    expect(linens?.content?.[1]).toMatchObject({
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ text: "Ivory" }] }] }],
    });
  });

  it("turns Docs checklists into checklists", () => {
    const list = paste(docsHtml).content?.find((node) => node.type === "taskList");
    expect(list?.content?.map((item) => [item.attrs?.checked, item.content?.[0].content?.[0].text])).toEqual([
      [true, "Wipe tables"],
      [false, "Bag trash"],
    ]);
  });

  it("strips unsupported styles and elements", () => {
    const json = paste(docsHtml);
    expect(new Set(marksIn(json))).toEqual(new Set(["bold", "italic", "link"]));
    expect(typesIn(json)).not.toContain("table");
    expect(JSON.stringify(json)).not.toMatch(/color|font-family|underline|style/i);
    expect(JSON.stringify(json)).toContain("Cell");
  });

  it("does not bold everything inside the Docs wrapper", () => {
    const html = normalizePastedHtml('<b style="font-weight:normal" id="docs-internal-guid-x"><p>Plain</p></b>');
    expect(html).toBe("<p>Plain</p>");
  });
});

describe("components (FLOW-50)", () => {
  it("renders the editor with an accessible toolbar and emits JSON", () => {
    const onChange = vi.fn();
    render(<RichTextEditor label="Setup notes" value={beoChecklist} onChange={onChange} />);
    expect(screen.getByRole("toolbar", { name: "Setup notes formatting" })).toBeInTheDocument();
    for (const name of ["Heading 1", "Bold", "Italic", "Bulleted list", "Numbered list", "Checklist", "Indent", "Outdent", "Link"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("textbox", { name: "Setup notes" })).toHaveTextContent("Wipe down prep tables");
  });

  it("renders stored JSON read-only", () => {
    const { container } = render(<RichTextView doc={beoChecklist} />);
    expect(screen.getByRole("heading", { level: 2, name: "Cleanup / breakdown" })).toBeInTheDocument();
    expect(container.querySelectorAll("input[type=checkbox]:disabled")).toHaveLength(4);
  });
});
