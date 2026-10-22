import { useState, type FormEvent, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import {
  Bold,
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
} from "lucide-react";
import { Button } from "../ui/button";
import { emptyRichText, isAllowedLink, richTextExtensions, type RichTextDoc } from "./extensions";
import { normalizePastedHtml } from "./render";

type Props = {
  label: string;
  value: RichTextDoc | null | undefined;
  onChange: (value: RichTextDoc) => void;
};

function activeListItem(editor: Editor) {
  return editor.isActive("taskItem") ? "taskItem" : "listItem";
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "outline" : "ghost"}
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

// Rich text editor (FLOW-50). Emits TipTap JSON; render it with RichTextView.
export function RichTextEditor({ label, value, onChange }: Props) {
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const editor = useEditor({
    extensions: richTextExtensions,
    content: value ?? emptyRichText,
    immediatelyRender: true,
    editorProps: {
      transformPastedHTML: normalizePastedHtml,
      attributes: {
        class: "rich-text rich-text-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
  });
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const item = activeListItem(editor);
      return {
        h1: editor.isActive("heading", { level: 1 }),
        h2: editor.isActive("heading", { level: 2 }),
        h3: editor.isActive("heading", { level: 3 }),
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        bulletList: editor.isActive("bulletList"),
        orderedList: editor.isActive("orderedList"),
        taskList: editor.isActive("taskList"),
        link: editor.isActive("link"),
        canIndent: editor.can().sinkListItem(item),
        canOutdent: editor.can().liftListItem(item),
      };
    },
  });

  const chain = () => editor.chain().focus();
  const applyLink = (event: FormEvent) => {
    event.preventDefault();
    const href = (linkDraft ?? "").trim();
    if (!href) chain().extendMarkRange("link").unsetLink().run();
    else if (isAllowedLink(href)) chain().extendMarkRange("link").setLink({ href }).run();
    else return;
    setLinkDraft(null);
  };
  const linkInvalid = linkDraft !== null && linkDraft.trim() !== "" && !isAllowedLink(linkDraft);

  return (
    <div className="rich-text-field">
      <div className="rich-text-toolbar" role="toolbar" aria-label={`${label} formatting`}>
        <ToolbarButton label="Heading 1" active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
          <Heading1 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Heading 2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Heading 3" active={state.h3} onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          <Heading3 size={16} />
        </ToolbarButton>
        <ToolbarButton label="Bold" active={state.bold} onClick={() => chain().toggleBold().run()}>
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton label="Italic" active={state.italic} onClick={() => chain().toggleItalic().run()}>
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton label="Bulleted list" active={state.bulletList} onClick={() => chain().toggleBulletList().run()}>
          <List size={16} />
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={state.orderedList} onClick={() => chain().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolbarButton>
        <ToolbarButton label="Checklist" active={state.taskList} onClick={() => chain().toggleTaskList().run()}>
          <ListChecks size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Indent"
          disabled={!state.canIndent}
          onClick={() => chain().sinkListItem(activeListItem(editor)).run()}
        >
          <IndentIncrease size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Outdent"
          disabled={!state.canOutdent}
          onClick={() => chain().liftListItem(activeListItem(editor)).run()}
        >
          <IndentDecrease size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="Link"
          active={state.link}
          onClick={() => setLinkDraft(editor.getAttributes("link").href ?? "")}
        >
          <LinkIcon size={16} />
        </ToolbarButton>
      </div>
      {linkDraft !== null && (
        <form className="rich-text-link" onSubmit={applyLink}>
          <label>
            <span>Link URL</span>
            <input
              autoFocus
              type="url"
              value={linkDraft}
              placeholder="https://"
              aria-invalid={linkInvalid}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setLinkDraft(null);
              }}
            />
          </label>
          {linkInvalid && <small role="alert">Use an http, https, mailto or tel link.</small>}
          <Button type="submit" variant="outline">
            {linkDraft.trim() ? "Apply link" : "Remove link"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setLinkDraft(null)}>
            Cancel
          </Button>
        </form>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
