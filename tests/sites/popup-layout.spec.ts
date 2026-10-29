import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Page, Worker } from "@playwright/test";

let context: BrowserContext;
let worker: Worker;
let profileDirectory: string;

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-popup-layout-"));
  const extensionDirectory = resolve("dist");
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
    headless: process.env.CJ_TEST_HEADLESS !== "0",
    args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`]
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});

test.afterAll(async () => {
  await context?.close();
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
});

async function openPopupFor(site: Page): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  // Exercise the popup entry against the intended active tab. This tab-based
  // harness does not test the browser's native toolbar-popup window.
  await site.bringToFront();
  await popup.reload();
  return popup;
}

test("shows the complete extension name on one line beside its logo", async () => {
  const site = await context.newPage();
  let popup: Page | undefined;
  try {
    await site.route("https://popup.fixture.test/", (route) => route.fulfill({
      contentType: "text/html", body: "<!doctype html><html lang=en><body>Popup layout fixture</body></html>"
    }));
    await site.goto("https://popup.fixture.test/");
    popup = await openPopupFor(site);
    await expect(popup.locator("#site")).toHaveText("popup.fixture.test");
    await expect(popup.locator("#statusGrid")).toBeVisible();
    await expect(popup.locator("#unavailableState")).toBeHidden();
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    await expect(popup.locator("#version")).toHaveText(version);

    const name = popup.locator(".popup-header .eyebrow");
    await expect(name).toHaveText("CJ Font Fallback Fix");
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
  } finally {
    await popup?.close();
    await site.close();
  }
});

test("explains an unavailable page without repeating the header status", async () => {
  const site = await context.newPage();
  let popup: Page | undefined;
  try {
    await site.goto("chrome://version/");
    popup = await openPopupFor(site);
    await expect(popup.locator("#site")).toHaveText("Not enabled on this page");
    await expect(popup.locator("#unavailableState")).toBeVisible();
    await expect(popup.locator("#statusGrid")).toBeHidden();
    await expect(popup.locator("#siteControls")).toBeHidden();
    await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-inactive-128\.png$/);
    await expect(popup.locator("#unavailableState")).toContainText("Browser-protected and unsupported pages");
    await expect(popup.locator("#unavailableState")).not.toContainText("not enabled on this page");
  } finally {
    await popup?.close();
    await site.close();
  }
});
