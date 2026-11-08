import { unzipSync, strFromU8 } from "fflate";

export type ProposalBlock = {
  id: string;
  kind: "heading" | "paragraph" | "table";
  text: string;
  rows?: string[][];
};

const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const children = (node: Element, name: string) =>
  Array.from(node.children).filter((child) => child.localName === name && child.namespaceURI === WORD);
const descendants = (node: Element, name: string) =>
  Array.from(node.getElementsByTagNameNS(WORD, name));
const paragraphText = (node: Element) =>
  descendants(node, "t").map((part) => part.textContent ?? "").join("").trim();

// Parse the Word document in the browser. The original order and stable block
// indexes let the review screen point each entry back to the source text.
export async function parseProposalDocx(file: Blob): Promise<ProposalBlock[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = unzipSync(bytes);
  const documentXml = entries["word/document.xml"];
  if (!documentXml) throw new Error("This Word file has no document body.");
  const xml = new DOMParser().parseFromString(strFromU8(documentXml), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error("The Word document could not be read.");
  const body = xml.getElementsByTagNameNS(WORD, "body")[0];
  if (!body) throw new Error("This Word file has no document body.");
  const blocks: ProposalBlock[] = [];
  for (const node of Array.from(body.children)) {
    if (node.localName === "p") {
      const text = paragraphText(node);
      if (!text) continue;
      const style = descendants(node, "pStyle")[0]?.getAttributeNS(WORD, "val") ?? "";
      blocks.push({ id: `block-${blocks.length}`, kind: /^heading|^title/i.test(style) ? "heading" : "paragraph", text });
    } else if (node.localName === "tbl") {
      const rows = children(node, "tr").map((row) =>
        children(row, "tc").map((cell) => children(cell, "p").map(paragraphText).filter(Boolean).join("\n")),
      );
      blocks.push({ id: `block-${blocks.length}`, kind: "table", rows, text: rows.map((row) => row.join(" | ")).join("\n") });
    }
  }
  return blocks;
}
