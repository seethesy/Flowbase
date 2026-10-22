import { test, expect } from "@playwright/test";

test("the sample document prints on US Letter with the header on every page", async ({
  page,
  isMobile,
}, testInfo) => {
  // Chromium's PDF output is the same for both projects; one run is enough.
  test.skip(isMobile, "PDF output is checked on desktop Chromium only.");
  await page.goto("/#/print/sample");
  await expect(
    page.getByRole("heading", { name: "Sample recipe book" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("button", { name: "Print or save as PDF" }),
  ).toBeHidden();
  const layout = await page.evaluate(() => {
    const header = document.querySelector(".print-page > thead");
    return {
      // A table header group is repeated at the top of every printed page.
      headerDisplay: header ? getComputedStyle(header).display : "",
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
  expect(layout).toEqual({ headerDisplay: "table-header-group", overflow: false });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  await testInfo.attach("sample-document.pdf", {
    body: pdf,
    contentType: "application/pdf",
  });
  const text = pdf.toString("latin1");
  const pages = text.match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pages.length).toBeGreaterThan(1);
  // US Letter is 612 × 792 points.
  expect(text).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+612(\.0+)?\s+792(\.0+)?\s*\]/);
});
