import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { queryClient } from "../src/app/queryClient";
import {
  CopyProvider,
  LiveEditControls,
  T,
  TPlural,
  useCopy,
} from "../src/app/live-copy";
import type { CopyOverrides } from "../shared/copy";
import { TestAuth } from "./auth-provider";

// Live text editing (FLOW-240) in the browser: rendering overrides and values,
// and the edit mode's save, cancel, reset and placeholder rules.

type Call = { method: string; path: string; body: unknown };
function mockCopyApi(initial: CopyOverrides = {}) {
  let overrides = { ...initial };
  const calls: Call[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    if (path === "/api/copy" && method === "GET") return Response.json(overrides);
    if (path === "/api/copy" && method === "PUT") {
      for (const edit of body as { key: string; text: string }[])
        overrides = { ...overrides, [edit.key]: edit.text };
      return Response.json(overrides);
    }
    if (path.startsWith("/api/copy/") && method === "DELETE") {
      const key = decodeURIComponent(path.slice("/api/copy/".length));
      const { [key]: _removed, ...rest } = overrides;
      void _removed;
      overrides = rest;
      return Response.json(overrides);
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  });
  return calls;
}
function mount(node: ReactNode) {
  return render(
    <QueryClientProvider client={queryClient}>
      <TestAuth>
        <CopyProvider>
          <LiveEditControls allowed />
          {node}
        </CopyProvider>
      </TestAuth>
    </QueryClientProvider>,
  );
}
function Search() {
  const placeholder = useCopy("test.search.placeholder", "Search {thing}…", { thing: "leads" });
  return <input aria-label="Search" placeholder={placeholder} />;
}

describe("<T>", () => {
  it("shows the default, or the saved override, with values filled in", async () => {
    mockCopyApi({ "test.list.empty": "Nothing for {name} yet" });
    mount(
      <>
        <p data-testid="heading">
          <T id="test.list.heading">Leads</T>
        </p>
        <p data-testid="empty">
          <T id="test.list.empty" values={{ name: <strong>Juniper</strong> }}>
            {"No leads for {name}"}
          </T>
        </p>
        <p data-testid="count">
          <TPlural id="test.list.count" count={1} one="{count} lead" other="{count} leads" />
          {" / "}
          <TPlural id="test.list.count" count={3} one="{count} lead" other="{count} leads" />
        </p>
      </>,
    );
    expect(screen.getByTestId("heading")).toHaveTextContent("Leads");
    await waitFor(() =>
      expect(screen.getByTestId("empty")).toHaveTextContent("Nothing for Juniper yet"),
    );
    expect(within(screen.getByTestId("empty")).getByText("Juniper").tagName).toBe("STRONG");
    expect(screen.getByTestId("count")).toHaveTextContent("1 lead / 3 leads");
  });

  it("renders without a provider, and outside edit mode adds no element (AC2)", () => {
    const { container } = render(
      <p>
        <T id="test.plain.text">Plain text</T>
      </p>,
    );
    expect(container.innerHTML).toBe("<p>Plain text</p>");
  });

  it("shows HTML typed into an override as literal text (AC7)", async () => {
    mockCopyApi({ "test.list.heading": "<img src=x onerror=alert(1)><b>Bold</b>" });
    const { container } = mount(
      <h1>
        <T id="test.list.heading">Leads</T>
      </h1>,
    );
    await waitFor(() =>
      expect(screen.getByRole("heading")).toHaveTextContent(
        "<img src=x onerror=alert(1)><b>Bold</b>",
      ),
    );
    expect(container.querySelector("img, b")).toBeNull();
  });
});

describe("edit mode", () => {
  it("edits text inside a button without firing it, and saves for everyone (AC2, AC8)", async () => {
    const user = userEvent.setup();
    const calls = mockCopyApi();
    const clicked = vi.fn();
    mount(
      <button type="button" onClick={clicked}>
        <T id="test.actions.new-lead">New lead</T>
      </button>,
    );
    await user.click(await screen.findByRole("button", { name: "Edit wording" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.click(screen.getByText("New lead"));
    expect(clicked).not.toHaveBeenCalled();
    const editor = screen.getByRole("dialog", { name: "Edit wording" });
    await user.clear(within(editor).getByRole("textbox"));
    await user.type(within(editor).getByRole("textbox"), "Add a lead");
    // The page shows the pending text, marked as changed.
    const edited = screen.getByText("Add a lead", { selector: ".live-copy" });
    expect(edited).toHaveClass("live-copy-changed");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: "/api/copy",
        body: [{ key: "test.actions.new-lead", text: "Add a lead", placeholders: [] }],
      }),
    );
    // Saved: edit mode is off and the button shows the new wording.
    expect(await screen.findByRole("button", { name: "Edit wording" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a lead" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a lead" }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it("cancel discards every pending edit and leaves edit mode (AC3)", async () => {
    const user = userEvent.setup();
    const calls = mockCopyApi();
    mount(
      <>
        <h1>
          <T id="test.page.title">Clients</T>
        </h1>
        <p>
          <T id="test.page.intro">Everyone you work with.</T>
        </p>
      </>,
    );
    await user.click(await screen.findByRole("button", { name: "Edit wording" }));
    for (const [text, typed] of [
      ["Clients", "Customers"],
      ["Everyone you work with.", "All of them."],
    ]) {
      await user.click(screen.getByText(text));
      const box = within(screen.getByRole("dialog", { name: "Edit wording" })).getByRole("textbox");
      await user.clear(box);
      await user.type(box, typed);
      await user.keyboard("{Escape}");
    }
    expect(screen.getByRole("heading")).toHaveTextContent("Customers");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("heading")).toHaveTextContent("Clients");
    expect(screen.getByText("Everyone you work with.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit wording" })).toBeInTheDocument();
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("blocks Save while a placeholder is missing or misspelled (AC5)", async () => {
    const user = userEvent.setup();
    mockCopyApi();
    mount(
      <p>
        <T id="test.list.count" values={{ count: 4 }}>
          {"{count} leads"}
        </T>
      </p>,
    );
    await user.click(await screen.findByRole("button", { name: "Edit wording" }));
    await user.click(screen.getByText("4 leads"));
    const editor = screen.getByRole("dialog", { name: "Edit wording" });
    const box = within(editor).getByRole("textbox");
    await user.clear(box);
    await user.type(box, "Some leads");
    expect(within(editor).getByRole("alert")).toHaveTextContent("Keep {count} in the text.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(box);
    // userEvent reads { as a key descriptor; {{ types one brace.
    await user.type(box, "Leads: {{cuont}");
    expect(within(editor).getByRole("alert")).toHaveTextContent("Keep {count} in the text.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.clear(box);
    await user.type(box, "Leads: {{count}");
    expect(within(editor).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("resets an override to the default (AC6)", async () => {
    const user = userEvent.setup();
    const calls = mockCopyApi({ "test.page.title": "Customers" });
    mount(
      <h1>
        <T id="test.page.title">Clients</T>
      </h1>,
    );
    await waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Customers"));
    await user.click(screen.getByRole("button", { name: "Edit wording" }));
    await user.click(screen.getByText("Customers"));
    await user.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(screen.getByRole("heading")).toHaveTextContent("Clients");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: "DELETE", path: "/api/copy/test.page.title", body: undefined }),
    );
    await waitFor(() => expect(screen.getByRole("heading")).toHaveTextContent("Clients"));
  });

  it("edits an input's placeholder by clicking the input", async () => {
    const user = userEvent.setup();
    const calls = mockCopyApi();
    mount(<Search />);
    const input = await screen.findByLabelText("Search");
    expect(input).toHaveAttribute("placeholder", "Search leads…");
    await user.click(screen.getByRole("button", { name: "Edit wording" }));
    await user.click(input);
    const box = within(screen.getByRole("dialog", { name: "Edit wording" })).getByRole("textbox");
    expect(box).toHaveValue("Search {thing}…");
    await user.clear(box);
    await user.type(box, "Find {{thing}");
    expect(input).toHaveAttribute("placeholder", "Find leads");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: "/api/copy",
        body: [{ key: "test.search.placeholder", text: "Find {thing}", placeholders: ["thing"] }],
      }),
    );
  });

  it("shows no pencil to someone who may not edit (AC1)", async () => {
    mockCopyApi();
    render(
      <QueryClientProvider client={queryClient}>
        <CopyProvider>
          <LiveEditControls allowed={false} />
        </CopyProvider>
      </QueryClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Edit wording" })).not.toBeInTheDocument();
  });
});

// Every literal key has one default (docs/live-text-editing.md): two places using
// the same key with different text would overwrite each other's wording.
describe("wording keys", () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return /\.tsx?$/.test(name) ? [full] : [];
    });
  const usages = () => {
    const found: { key: string; text: string; where: string }[] = [];
    for (const file of sources("src")) {
      const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const literal = (node: ts.Node | undefined): string | null => {
        if (!node) return null;
        if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
        if (ts.isJsxExpression(node)) return literal(node.expression);
        return null;
      };
      const where = (node: ts.Node) =>
        `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
      const attr = (opening: ts.JsxOpeningLikeElement, name: string) => {
        const found = opening.attributes.properties.find(
          (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === name,
        );
        return found ? literal(found.initializer) : null;
      };
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "T") {
          const key = attr(node.openingElement, "id");
          const children = node.children.filter((c) => !(ts.isJsxText(c) && !c.text.trim()));
          const text =
            children.length === 1
              ? ts.isJsxText(children[0])
                ? children[0].text.trim().replace(/\s+/g, " ")
                : literal(children[0])
              : null;
          if (key && text !== null) found.push({ key, text, where: where(node) });
        }
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(sf) === "TPlural") {
          const key = attr(node, "id");
          for (const form of ["one", "other"]) {
            const text = attr(node, form);
            if (key && text !== null) found.push({ key: `${key}.${form}`, text, where: where(node) });
          }
        }
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "useCopy"
        ) {
          const key = literal(node.arguments[0]);
          const text = literal(node.arguments[1]);
          if (key && text !== null) found.push({ key, text, where: where(node) });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    return found;
  };

  it("are well formed and each has one default", () => {
    const all = usages();
    expect(all.length).toBeGreaterThan(1000);
    const byKey = new Map<string, { text: string; where: string }>();
    const conflicts: string[] = [];
    const malformed: string[] = [];
    for (const usage of all) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/.test(usage.key))
        malformed.push(`${usage.key} (${usage.where})`);
      const seen = byKey.get(usage.key);
      if (seen && seen.text !== usage.text)
        conflicts.push(`${usage.key}: "${seen.text}" (${seen.where}) vs "${usage.text}" (${usage.where})`);
      if (!seen) byKey.set(usage.key, usage);
    }
    expect(malformed).toEqual([]);
    expect(conflicts).toEqual([]);
  });
});
