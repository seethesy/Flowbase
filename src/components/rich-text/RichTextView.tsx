import { useMemo } from "react";
import { clsx } from "clsx";
import type { RichTextDoc } from "./extensions";
import { renderRichText } from "./render";

// Read-only rendering of stored rich text for screen and print.
export function RichTextView({ doc, className }: { doc: RichTextDoc | null | undefined; className?: string }) {
  const html = useMemo(() => renderRichText(doc), [doc]);
  // html is produced by renderRichText, which sanitizes it.
  return <div className={clsx("rich-text", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
