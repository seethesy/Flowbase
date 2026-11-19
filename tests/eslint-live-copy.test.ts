// @vitest-environment node
import { RuleTester } from "eslint";
import tsEslint from "typescript-eslint";
import { describe, it } from "vitest";
import liveCopy from "../scripts/eslint-live-copy.mjs";

// The live text editing lint guard (FLOW-244): unwrapped screen wording fails.
RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({
  languageOptions: {
    parser: tsEslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run("live-copy/wrap-text", liveCopy.rules["wrap-text"], {
  valid: [
    'const a = <h2><T id="leads.inbox.title">New heading</T></h2>;',
    'const a = <T id="leads.inbox.count" values={{ count }}>{"{count} leads"}</T>;',
    'const a = <TPlural id="leads.inbox.count" count={n} one="{count} lead" other="{count} leads" />;',
    "const a = <input placeholder={useCopy(\"leads.inbox.search\", \"Search\")} />;",
    "const a = <input placeholder={placeholder} />;",
    // Punctuation and symbols only.
    "const a = <p>{a} · {b} — {c} / {d}: {e}… ×</p>;",
    // Other attributes are not wording to edit here.
    'const a = <button className="primary" aria-label="Close" title="Close" type="button" />;',
    // Native options, code and record data.
    "const a = <select><option value=\"\">All statuses</option></select>;",
    "const a = <pre>npm install</pre>;",
    "const a = <p>{client.name}</p>;",
    "const a = <p>{loading ? <Spinner /> : null}</p>;",
  ],
  invalid: [
    // AC2: an unwrapped heading or placeholder fails, pointing to <T> / useCopy.
    { code: "const a = <h2>New heading</h2>;", errors: [{ messageId: "text" }] },
    { code: 'const a = <input placeholder="Search" />;', errors: [{ messageId: "placeholder" }] },
    { code: 'const a = <input placeholder={"Search"} />;', errors: [{ messageId: "placeholder" }] },
    {
      code: 'const a = <input placeholder={all ? "Search all" : "Search mine"} />;',
      errors: [{ messageId: "placeholder" }, { messageId: "placeholder" }],
    },
    { code: 'const a = <p>{"Nothing here"}</p>;', errors: [{ messageId: "text" }] },
    {
      code: 'const a = <Button>{saving ? "Saving…" : "Save"}</Button>;',
      errors: [{ messageId: "text" }, { messageId: "text" }],
    },
    { code: 'const a = <p>{name || "Unnamed lead"}</p>;', errors: [{ messageId: "text" }] },
    { code: "const a = <p>{count} leads</p>;", errors: [{ messageId: "text" }] },
    { code: "const a = <p>{`${count} leads`}</p>;", errors: [{ messageId: "text" }] },
    { code: "const a = <>Ready</>;", errors: [{ messageId: "text" }] },
  ],
});
