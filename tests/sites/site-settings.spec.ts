import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

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

async function addRule(page: Page, hostname: string, scope: "hostname" | "domain", language: "sc" | "tc" | "jp" | "off"): Promise<void> {
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill(hostname);
  await dialog.getByRole("radio", { name: scope === "domain" ? "Include subdomains" : "Website only", exact: true }).check();
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption(language);
  await dialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function removeRule(page: Page, hostname: string): Promise<void> {
  await page.getByRole("button", { name: `Edit website: ${hostname}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit website", exact: true });
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("applies Settings domain choices and popup hostname exceptions", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {}, trustCjkLang: true }));
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await options.locator("#toggleSiteOverrides").click();
  await addRule(options, "example.co.uk", "domain", "jp");
  const site = await context.newPage();
  await site.route("https://m.example.co.uk/**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><body><p>这是中文内容。</p></body></html>' }));
  await site.goto("https://m.example.co.uk/");
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await popup.locator("#override").selectOption("tc");
  await expect(popup.locator("#detected")).toHaveText("Traditional Chinese");
  await popup.locator("#override").selectOption("auto");
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
  await removeRule(options, "m.example.co.uk");
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await removeRule(options, "example.co.uk");
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
});

test("keeps legacy choices and separates hosted domains in the Settings editor", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "legacy.example.com": "tc" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await expect(page.getByRole("button", { name: "Edit website: legacy.example.com", exact: true })).toBeVisible();
  await addRule(page, "https://www.alice.github.io/path", "domain", "jp");
  await expect(page.getByRole("button", { name: "Edit website: alice.github.io", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("localhost");
  await dialog.getByRole("radio", { name: "Include subdomains", exact: true }).check();
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
  await dialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("cannot include subdomains");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("#resetSettings").click();
  await expect(page.locator("#siteRuleCount")).toHaveText("2 rules");
  await page.setViewportSize({ width: 400, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  page.once("dialog", (prompt) => prompt.accept());
  await page.locator("#clearSiteOverrides").click();
  await expect(page.locator("#siteRuleCount")).toHaveText("0 rules");
});

test("preserves unrelated edits from two Settings pages and rejects rename collisions", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} }));
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
  }
  await Promise.all([addRule(pages[0]!, "first.example.com", "hostname", "sc"), addRule(pages[1]!, "second.example.com", "hostname", "jp")]);
  const page = pages[0]!;
  await expect(page.locator("#siteRuleCount")).toHaveText("2 rules");
  await page.getByRole("button", { name: "Edit website: first.example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit website", exact: true });
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("second.example.com");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: first.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: second.example.com", exact: true })).toBeVisible();
});

test("shows intervention details only while correction is active", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    simpleMode: false, dynamicDetection: true, trustCjkLang: false,
    fontSC: "CJ Test Sans", preserveWebsiteFonts: false,
    siteOverrides: { "example.net": "sc" }, siteDomainOverrides: {}
  }));
  const site = await context.newPage();
  await site.route("https://example.net/**", (route) => route.fulfill({
    contentType: "text/html", body: '<html lang="en"><body><p id="reading">English reading text.</p></body></html>'
  }));
  await site.goto("https://example.net/");
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#site")).toHaveText("example.net");
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeHidden();
  }
  await site.locator("#reading").evaluate((element) => { element.textContent = "这是用于验证字体修正的中文段落。"; });
  await expect.poll(() => site.locator("#reading").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("CJ Test Sans");
  await popup.reload();
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }
  await expect(popup.locator("#font")).toHaveText("CJ Test Sans");
  await expect(popup.locator("#changed")).toHaveText("1");
  await popup.locator("#override").selectOption("off");
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeHidden();
  }
  await worker.evaluate(() => chrome.storage.sync.set({ simpleMode: true }));
  await popup.locator("#override").selectOption("sc");
  await expect(popup.locator("#interventionRow")).toBeVisible();
  await expect(popup.locator("#interventionLabel")).toHaveText("Applied lang");
  await expect(popup.locator("#fontRow")).toBeHidden();
  await expect(popup.locator("#managedRow")).toBeHidden();
});

test("edits a saved hostname into a domain rule and preserves the Hide switch", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "www.example.co.uk": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit website", exact: true });
  await expect(dialog.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.example.co.uk");
  await dialog.getByRole("radio", { name: "Include subdomains", exact: true }).check();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide site language settings", exact: true }).click();
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit website: example.co.uk", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("www.example.co.uk");
  await dialog.getByRole("radio", { name: "Website only", exact: true }).check();
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toHaveCount(0);
});

test("searches all 100 rules and paginates within a language group", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    const rules: Record<string, string> = {};
    for (let n = 1; n <= 100; n++) {
      rules[`site${String(n).padStart(3, "0")}.example.com`] = n <= 42 ? "sc" : n <= 77 ? "jp" : n <= 95 ? "tc" : "off";
    }
    await chrome.storage.sync.set({ siteOverrides: rules, siteDomainOverrides: {} });
  });
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await expect(page.locator("#siteRuleCount")).toHaveText("100 rules");
  const japanese = page.getByRole("group", { name: "Japanese rules", exact: true });
  await japanese.locator("summary").click();
  await expect(japanese.getByRole("button", { name: /^Edit website:/ })).toHaveCount(10);
  await japanese.getByRole("button", { name: "Next", exact: true }).click();
  await expect(japanese.getByRole("button", { name: "Edit website: site053.example.com", exact: true })).toBeVisible();
  await expect(japanese.getByRole("button", { name: "Edit website: site043.example.com", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("site077");
  await expect(page.getByRole("button", { name: "Edit website: site077.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit website:/ })).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("missing.example");
  await expect(page.getByText("No matching websites.", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("");
  await expect(page.locator("#siteRuleCount")).toHaveText("100 rules");
  await expect(japanese.getByRole("button", { name: /^Edit website:/ })).toHaveCount(10);
});

test("cancels drafts, redirects duplicate additions, and protects scope-move conflicts", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "www.example.com": "jp" }, siteDomainOverrides: { "example.com": "sc" }
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await page.getByRole("button", { name: "Edit website: www.example.com", exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit website", exact: true });
  await editDialog.getByRole("textbox", { name: "Website", exact: true }).fill("draft.example.net");
  await page.keyboard.press("Escape");
  await expect(editDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: www.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: draft.example.net", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add website", exact: true });
  await addDialog.getByRole("textbox", { name: "Website", exact: true }).fill("www.example.com");
  await addDialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
  await addDialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("jp");
  await expect(editDialog.getByRole("alert")).toContainText("already has a rule");
  await editDialog.getByRole("radio", { name: "Include subdomains", exact: true }).check();
  await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editDialog.getByRole("alert")).toContainText("already exists");
  await editDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: www.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: example.com", exact: true })).toBeVisible();
  await expect(page.locator("#siteRuleCount")).toHaveText("2 rules");
});

test("animates Manage and Hide while respecting reduced motion", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  const button = page.locator("#toggleSiteOverrides");
  const hasAnimation = () => button.evaluate((element) => {
    (element as HTMLButtonElement).click();
    return document.getElementById("siteOverridesPanel")!.getAnimations().some((animation) =>
      Number(animation.effect?.getComputedTiming().duration) > 0
    );
  });
  expect(await hasAnimation()).toBe(true);
  await expect(page.locator("#siteOverridesPanel")).toBeVisible();
  await expect(button).toHaveText("Hide site language settings");
  expect(await hasAnimation()).toBe(true);
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await hasAnimation()).toBe(false);
  await expect(page.locator("#siteOverridesPanel")).toBeVisible();
  expect(await hasAnimation()).toBe(false);
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
});

test("returns focus to the opener when canceling after another rule was saved", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "a.example.com": "sc", "b.example.com": "sc" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await page.getByRole("button", { name: "Edit website: b.example.com", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Edit website", exact: true });
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  const opener = page.getByRole("button", { name: "Edit website: a.example.com", exact: true });
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  const add = page.getByRole("button", { name: "Add website", exact: true });
  await add.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add website", exact: true })).toBeHidden();
  await expect(add).toBeFocused();
});
