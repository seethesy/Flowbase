// @vitest-environment node
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import liveCopy from "../../scripts/eslint-live-copy.mjs";

// The lint guard (FLOW-244): unwrapped screen text fails, wrapped text passes.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("live-copy/no-literal-text", liveCopy.rules["no-literal-text"], {
  valid: [
    '<h2><T id="leads.inbox.title">New heading</T></h2>',
    '<p><T id="leads.inbox.count" values={{ count }}>{"{count} leads"}</T></p>',
    '<Plural id="leads.inbox.rows" count={n} one="{count} row" other="{count} rows" />',
    "<span>·</span>",
    "<span> — / : … × </span>",
    "<td>{row.name}</td>",
    '<input placeholder={searchPlaceholder} data-copy-id="leads.inbox.search.placeholder" />',
    '<div className="panel" aria-label="Close" title="Close" />',
    '<select><option value="">All</option></select>',
    '<p>{error || "—"}</p>',
  ],
  invalid: [
    { code: "<h2>New heading</h2>", errors: [{ messageId: "text" }] },
    { code: '<input placeholder="Search" />', errors: [{ messageId: "placeholder" }] },
    { code: '<SearchInput placeholder={open ? "Search" : "Find"} />', errors: [{ messageId: "placeholder" }, { messageId: "placeholder" }] },
    { code: '<p>{"Saving…"}</p>', errors: [{ messageId: "text" }] },
    { code: "<p>{`Saved ${count} rows`}</p>", errors: [{ messageId: "text" }] },
    { code: '<p>{busy ? "Saving…" : <T id="a.b.save">Save</T>}</p>', errors: [{ messageId: "text" }] },
    { code: '<p>{ready && "Done"}</p>', errors: [{ messageId: "text" }] },
    { code: '<p>{name ?? "Unnamed"}</p>', errors: [{ messageId: "text" }] },
  ],
});
