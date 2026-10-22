import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import type { Extensions, JSONContent } from "@tiptap/core";

// Rich text for SOPs, setup notes and BEO notes (FLOW-50, ADR-25): TipTap free
// core only. Documents are stored as TipTap JSON (RichTextDoc) and rendered to
// sanitized HTML for screen and print (render.ts).
export type RichTextDoc = JSONContent;

export const LINK_PROTOCOLS = ["http", "https", "mailto", "tel"];

export function isAllowedLink(url: string) {
  return /^(https?:|mailto:|tel:)/i.test(url.trim());
}

// Shared by the editor and the renderer so both accept exactly the same
// content. Anything outside this schema (underline, colours, fonts, tables,
// code) is dropped when pasted.
export const richTextExtensions: Extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    underline: false,
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: "https",
      protocols: LINK_PROTOCOLS,
      isAllowedUri: (url) => isAllowedLink(url),
    },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
];

export const emptyRichText: RichTextDoc = { type: "doc", content: [{ type: "paragraph" }] };
