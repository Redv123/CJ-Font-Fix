import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("shows the complete extension name on one line beside its logo", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("dist/popup.html")).href);
  await page.addStyleTag({ path: resolve("ui.css") });
  const manifest = JSON.parse(await readFile(resolve("dist/manifest.json"), "utf8")) as { version: string };
  await page.locator("#version").evaluate((element, version) => {
    element.textContent = version;
  }, manifest.version);

  const name = page.locator(".popup-header .eyebrow");
  await expect(name).toHaveText("CJ Font Fallback Fix");
  await name.evaluate((element) => {
    element.style.fontSize = "15px";
  });
  const metrics = await name.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return {
      availableWidth: element.getBoundingClientRect().width,
      textWidth: range.getBoundingClientRect().width,
      lineCount: range.getClientRects().length
    };
  });
  expect(metrics.lineCount).toBe(1);
  expect(metrics.textWidth).toBeLessThanOrEqual(metrics.availableWidth);
});

test("explains an unavailable page without repeating the header status", async ({ page }) => {
  await page.goto(pathToFileURL(resolve("dist/popup.html")).href);
  await page.locator("#site").evaluate((element) => {
    element.textContent = "Not enabled on this page";
  });
  await page.locator("#unavailableState").evaluate((element) => {
    (element as HTMLElement).hidden = false;
  });

  await expect(page.locator("#site")).toHaveText("Not enabled on this page");
  await expect(page.locator("#unavailableState")).toContainText("Browser-protected and unsupported pages");
  await expect(page.locator("#unavailableState")).not.toContainText("not enabled on this page");
});
