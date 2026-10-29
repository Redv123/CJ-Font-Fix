import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

let context: BrowserContext;
let profileDirectory: string;
const savedFonts = {
  fontSC: "Saved SC", fontTC: "Saved TC", fontJP: "Saved JP",
  fontSCSerif: "Saved SC Serif", fontTCSerif: "Saved TC Serif", fontJPSerif: "Saved JP Serif"
};

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-options-loading-"));
  const directory = resolve("dist");
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium", executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
    headless: process.env.CJ_TEST_HEADLESS !== "0",
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  // onInstalled repairs all six choices asynchronously. Let that finish before
  // tests replace them with intentionally unavailable saved names.
  await expect.poll(() => worker.evaluate(async (keys) => {
    const stored = await chrome.storage.sync.get(keys);
    return keys.every((key) => typeof stored[key] === "string");
  }, Object.keys(savedFonts))).toBe(true);
});
test.afterAll(async () => {
  await context?.close();
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
});

for (const failure of ["error", "empty"] as const) {
  test(`keeps independent settings and site actions usable when the font list is ${failure}`, async () => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate((fonts) => chrome.storage.sync.set({
      ...fonts, defaultChinese: "tc", trustCjkLang: false, dynamicDetection: false, simpleMode: false,
      siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {}
    }), savedFonts);
    const page = await context.newPage();
    try {
      await page.addInitScript((kind) => {
        Object.defineProperty(chrome.fontSettings, "getFontList", { value: async () => {
          if (kind === "error") throw new Error("Simulated font lookup failure");
          return [];
        } });
      }, failure);
      await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
      await expect(page.locator("#status")).toContainText("Could not load installed fonts");
      await expect(page.locator("#defaultChinese")).toHaveValue("tc", { timeout: 2000 });
      await expect(page.locator("#trustCjkLang")).not.toBeChecked();
      await expect(page.locator("#dynamicDetection")).not.toBeChecked();
      for (const key of Object.keys(savedFonts)) await expect(page.locator(`#${key}`)).toBeDisabled();
      await expect(page.locator("#resetSettings")).toBeDisabled();
      await expect(page.locator("#toggleSiteOverrides")).toHaveCSS("pointer-events", "auto");
      await expect(page.locator("#toggleSiteOverrides")).toHaveCSS("opacity", "1");
      await page.locator("#defaultChinese").selectOption("sc");
      await page.locator("#dynamicDetection").check();
      await page.locator("#simpleMode").check();
      await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get(["defaultChinese", "dynamicDetection", "simpleMode"])))
        .toEqual({ defaultChinese: "sc", dynamicDetection: true, simpleMode: true });
      expect(await worker.evaluate((keys) => chrome.storage.sync.get(keys), Object.keys(savedFonts))).toEqual(savedFonts);
      await expect(page.locator("#status")).toContainText("Could not load installed fonts");
      await page.locator("#toggleSiteOverrides").click();
      await page.locator("#toggleSiteOverrides").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#toggleSiteOverrides")).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Enter");
      await expect(page.locator("#toggleSiteOverrides")).toHaveAttribute("aria-expanded", "true");
      await page.locator("#openAddSite").click();
      await page.locator("#newSiteHostname").fill("added.example.net");
      await page.locator("#newSiteVariant").selectOption("tc");
      await page.locator("#saveSiteRule").click();
      await expect(page.locator("#addSiteOverride")).toBeHidden();
      await page.getByRole("button", { name: "Edit website: added.example.net", exact: true }).click();
      await page.locator(".site-inline-editor").getByRole("combobox", { name: "Language", exact: true }).selectOption("off");
      await page.locator(".site-inline-editor").getByRole("button", { name: "Save changes", exact: true }).click();
      await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("siteOverrides")))
        .toEqual({ siteOverrides: { "example.com": "jp", "added.example.net": "off" } });
      await page.locator("#clearSiteOverrides").click();
      await expect(page.locator("#undoSiteOverrides")).toBeEnabled();
      await page.locator("#undoSiteOverrides").click();
      await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("siteOverrides")))
        .toEqual({ siteOverrides: { "example.com": "jp", "added.example.net": "off" } });
      expect(await worker.evaluate((keys) => chrome.storage.sync.get(keys), Object.keys(savedFonts))).toEqual(savedFonts);
    } finally { await page.close(); }
  });
}

test("allows manual font selection when no recommended default is installed", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate((fonts) => chrome.storage.sync.set({
    ...Object.fromEntries(Object.keys(fonts).map((key) => [key, ""])), simpleMode: false
  }), savedFonts);
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(chrome.fontSettings, "getFontList", {
        value: async () => [{ fontId: "Manual font", displayName: "Manual font" }]
      });
    });
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await expect(page.locator("#fontSC")).toBeEnabled();
    await expect(page.locator("#fontSC")).toHaveValue("");
    await expect(page.locator("#resetSettings")).toBeEnabled();
    await page.locator("#fontSC").selectOption("Manual font");
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("fontSC")))
      .toEqual({ fontSC: "Manual font" });
    await page.locator("#resetSettings").click();
    await expect(page.locator("#fontSC")).toHaveValue("");
    await expect(page.locator("#fontSC")).toBeEnabled();
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("fontSC"))).toEqual({ fontSC: "" });
  } finally { await page.close(); }
});

test("reports saved-settings failures separately and keeps the site manager independent", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate((fonts) => chrome.storage.sync.set({
    ...fonts, siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {}
  }), savedFonts);
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      const get = chrome.storage.sync.get.bind(chrome.storage.sync);
      Object.defineProperty(chrome.storage.sync, "get", { value: async (keys: string[]) => {
        if (keys.includes("fontSC")) throw new Error("Simulated settings read failure");
        return get(keys);
      } });
    });
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await expect(page.locator("#status")).toContainText("Could not load settings: Simulated settings read failure");
    await expect(page.locator("#defaultChinese")).toBeDisabled();
    await expect(page.locator("#simpleMode")).toBeDisabled();
    await expect(page.locator("#resetSettings")).toBeDisabled();
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: example.com", exact: true }).click();
    await page.locator(".site-inline-editor").getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
    await page.locator(".site-inline-editor").getByRole("button", { name: "Save changes", exact: true }).click();
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("siteOverrides")))
      .toEqual({ siteOverrides: { "example.com": "tc" } });
    expect(await worker.evaluate((keys) => chrome.storage.sync.get(keys), Object.keys(savedFonts))).toEqual(savedFonts);
  } finally { await page.close(); }
});

test("keeps font controls usable when saving repaired choices fails", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate((fonts) => chrome.storage.sync.set({ ...fonts, simpleMode: false }), savedFonts);
  const page = await context.newPage();
  try {
    await page.addInitScript(() => {
      Object.defineProperty(chrome.fontSettings, "getFontList", {
        value: async () => [{ fontId: "Manual font", displayName: "Manual font" }]
      });
      const set = chrome.storage.sync.set.bind(chrome.storage.sync);
      let fail = true;
      Object.defineProperty(chrome.storage.sync, "set", { value: async (values: Record<string, unknown>) => {
        if (fail && Object.hasOwn(values, "fontSC")) {
          fail = false;
          throw new Error("Simulated settings write failure");
        }
        return set(values);
      } });
    });
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await expect(page.locator("#status")).toContainText("Could not save: Simulated settings write failure");
    await expect(page.locator("#fontSC")).toBeEnabled();
    await expect(page.locator("#resetSettings")).toBeEnabled();
    await expect(page.locator("#toggleSiteOverrides")).toHaveCSS("pointer-events", "auto");
    await page.locator("#fontSC").selectOption("Manual font");
    await expect.poll(() => worker.evaluate(() => chrome.storage.sync.get("fontSC")))
      .toEqual({ fontSC: "Manual font" });
    await expect(page.locator("#status")).toBeEmpty();
  } finally { await page.close(); }
});
