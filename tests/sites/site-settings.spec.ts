import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

let context: BrowserContext;
let profileDirectory: string;

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-site-settings-"));
  const extensionDirectory = resolve("dist");
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
    headless: process.env.CJ_TEST_HEADLESS !== "0",
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`
    ]
  });
});

test.afterAll(async () => {
  await context?.close();
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
});

test("applies domain choices, exact exceptions, and automatic detection through the popup", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  console.log(await worker.evaluate(() => navigator.userAgent));
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {}, trustCjkLang: true }));
  const site = await context.newPage();
  await site.route("https://m.example.co.uk/**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><body><p>这是中文内容。</p></body></html>' }));
  await site.goto("https://m.example.co.uk/");
  const popup = await context.newPage();
  // Keep the fixture active: the popup addresses the active tab.
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#site")).toHaveText("m.example.co.uk");
  await popup.locator("#siteScope").selectOption("domain");
  await popup.locator("#override").selectOption("jp");
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await popup.locator("#siteScope").selectOption("hostname");
  await popup.locator("#override").selectOption("tc");
  await expect(popup.locator("#detected")).toHaveText("Traditional Chinese");
  await popup.locator("#override").selectOption("auto");
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
  await popup.locator("#override").selectOption("inherit");
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await popup.locator("#siteScope").selectOption("domain");
  await popup.locator("#override").selectOption("auto");
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
  await popup.locator("#override").selectOption("jp");
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await options.locator("#toggleSiteOverrides").click();
  await expect(options.locator(".site-override-row")).toHaveCount(1);
  await expect(options.locator(".site-rule-scope")).toHaveText("Whole domain");
  await options.locator(".site-override-row button").click();
  await expect(options.locator(".site-override-row")).toHaveCount(0);
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
});


test("keeps legacy choices and separates hosted domains in the Settings editor", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "legacy.example.com": "tc" }, siteDomainOverrides: {} }));
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await options.locator("#toggleSiteOverrides").click();
  await expect(options.locator(".site-override-row input")).toHaveValue("legacy.example.com");
  await expect(options.locator(".site-rule-scope")).toHaveText("This hostname");
  await options.locator("#newSiteHostname").fill("https://www.alice.github.io/path");
  await options.locator("#newSiteScope").selectOption("domain");
  await options.locator("#newSiteVariant").selectOption("jp");
  await options.locator("#addSiteOverride button").click();
  await expect(options.locator(".site-override-row")).toHaveCount(2);
  const domainRow = options.locator(".site-override-row").filter({ hasText: "Whole domain" });
  await expect(domainRow.locator("input")).toHaveValue("alice.github.io");
  await options.locator("#newSiteHostname").fill("localhost");
  await options.locator("#addSiteOverride button").click();
  await expect(options.locator("#siteOverrideStatus")).toContainText("no registrable domain");
  await expect(options.locator(".site-override-row")).toHaveCount(2);
  await options.locator("#resetSettings").click();
  await expect(options.locator(".site-override-row")).toHaveCount(2);
  await options.setViewportSize({ width: 400, height: 800 });
  expect(await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  options.once("dialog", (dialog) => dialog.accept());
  await options.locator("#clearSiteOverrides").click();
  await expect(options.locator(".site-override-row")).toHaveCount(0);
});


test("preserves unrelated edits from two Settings pages and rejects rename collisions", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} }));
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const [i, page] of pages.entries()) {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.locator("#newSiteHostname").fill(i === 0 ? "first.example.com" : "second.example.com");
    await page.locator("#newSiteVariant").selectOption(i === 0 ? "sc" : "jp");
  }
  await Promise.all(pages.map((page) => page.locator("#addSiteOverride button").click()));
  const first = pages[0]!;
  await expect(first.locator(".site-override-row")).toHaveCount(2);
  const rows = first.locator(".site-override-row");
  await rows.first().locator("input").fill("second.example.com");
  await rows.first().locator("input").press("Tab");
  await expect(first.locator("#siteOverrideStatus")).toContainText("already exists");
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator("input")).toHaveValue("first.example.com");
});
