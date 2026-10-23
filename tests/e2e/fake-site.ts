import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { SiteModule } from "../../collector/src/types.ts";

// A fake lead site for the collector framework tests (FLOW-102): a module that reads
// the saved pages in collector/fixtures/fake, and a server that serves them.
export function fakeSiteModule(baseUrl: string): SiteModule {
  return {
    site: "fake",
    source: "Fake site",
    checkLogin: async ({ page, visit }) => {
      await visit(`${baseUrl}/account.html`);
      return (await page.locator("[data-signed-in]").count()) > 0;
    },
    listLeads: async ({ page, visit }) => {
      await visit(`${baseUrl}/leads.html`);
      return page
        .locator("[data-lead-id]")
        .evaluateAll((items) =>
          items.map((item) => ({
            id: (item as HTMLElement).dataset.leadId ?? "",
            updatedAt: (item as HTMLElement).dataset.updated,
          })),
        );
    },
    readLead: async ({ page, visit }, id) => {
      await visit(`${baseUrl}/lead-${id.replace("fake-", "")}.html`);
      const field = async (name: string) =>
        (await page.locator(`[data-field="${name}"]`).innerText()).trim();
      const guests = await field("guestCount");
      const budget = (await field("budget")).replace(/[^\d]/g, "");
      return {
        sourceLeadUrl: `${baseUrl}/lead-${id.replace("fake-", "")}.html`,
        name: await field("name"),
        email: await field("email"),
        phone: await field("phone"),
        eventDate: (await field("eventDate")) || null,
        guestCount: guests ? Number(guests) : null,
        location: await field("location"),
        eventType: await field("eventType"),
        budgetCents: budget ? Number(budget) * 100 : null,
        message: await field("message"),
        raw: { page: id },
      };
    },
  };
}

// Serves collector/fixtures/fake. `replace` swaps a page for another (e.g. the lead
// list for the CAPTCHA page); every page requested is recorded (not the favicon).
export async function serveFakeSite(replace: Record<string, string> = {}) {
  const requested: string[] = [];
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path.endsWith(".html")) requested.push(path);
    const file = replace[path] ?? path;
    try {
      const html = await readFile(join("collector/fixtures/fake", file.replace(/^\//, "")));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requested,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// A stand-in for the Worker's ingestion endpoints: checks the bearer token like the
// real route and records what the collector posted.
export async function serveIngest(token: string) {
  const posts: { path: string; body: unknown }[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      if (request.headers.authorization !== `Bearer ${token}`)
        return void response.writeHead(401).end();
      posts.push({ path: request.url ?? "", body: JSON.parse(body) });
      response.writeHead(202, { "Content-Type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    posts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
