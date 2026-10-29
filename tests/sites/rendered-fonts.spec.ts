import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, CDPSession, Worker } from "@playwright/test";
import type { Variant } from "../../src/shared/types";

// Opt-in: these checks require real installed fonts, unlike CSS-stack tests.
const cases = [
  { variant: "sc", family: "Noto Sans CJK SC", postScript: "NotoSansCJKsc-Regular", baseline: "JP", baselineVariant: "jp" },
  { variant: "tc", family: "Noto Sans CJK TC", postScript: "NotoSansCJKtc-Regular", baseline: "JP", baselineVariant: "jp" },
  { variant: "jp", family: "Noto Sans CJK JP", postScript: "NotoSansCJKjp-Regular", baseline: "SC", baselineVariant: "sc" }
] as const;
const missingFamily = "CJ Rendered Fonts Deliberately Missing";
const text = "骨直令漢字";
let context: BrowserContext;
let worker: Worker;
let profileDirectory: string;

async function renderedFonts(cdp: CDPSession, selector: string) {
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  expect(nodeId, `Missing original page element: ${selector}`).toBeGreaterThan(0);
  return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts;
}

async function chooseFont(variant: Variant, family: string): Promise<void> {
  await worker.evaluate(async ({ variant, family }) => {
    await chrome.storage.sync.set({
      fontSC: family, fontSCSerif: family,
      fontTC: family, fontTCSerif: family,
      fontJP: family, fontJPSerif: family,
      siteOverrides: { "fixture.test": variant }
    });
  }, { variant, family });
}

test.describe("@rendered-fonts actual CJK glyph selection", () => {
  test.beforeAll(async () => {
    profileDirectory = await mkdtemp(join(tmpdir(), "cj-rendered-fonts-"));
    const extensionDirectory = resolve("dist");
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: "chromium",
      executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
      headless: process.env.CJ_TEST_HEADLESS !== "0",
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`]
    });
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const installed = await worker.evaluate(async () =>
      (await chrome.fontSettings.getFontList()).map((font) => font.fontId)
    );
    for (const family of ["Noto Serif CJK JP", "Noto Serif CJK SC", ...cases.map((entry) => entry.family)]) {
      expect(installed, `Install ${family} in the test browser's environment before running test:fonts`)
        .toContain(family);
    }
    expect(installed).not.toContain(missingFamily);
  });

  test.afterAll(async () => {
    await context?.close();
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  });

  for (const entry of cases) {
    test(`renders ${entry.variant} glyphs with the selected font and restores the website font`, async ({}, testInfo) => {
      const baselineFamily = `Noto Serif CJK ${entry.baseline}`;
      const baselinePostScript = `NotoSerifCJK${entry.baseline.toLowerCase()}-Regular`;
      await worker.evaluate(async () => {
        await chrome.storage.sync.clear();
        await chrome.storage.sync.set({
          preserveWebsiteFonts: false, simpleMode: false,
          mixedLanguageDetection: false, dynamicDetection: true,
          siteOverrides: { "fixture.test": "off" }, siteDomainOverrides: {}
        });
      });
      const page = await context.newPage();
      try {
        const url = `https://fixture.test/rendered-fonts/${entry.variant}`;
        await page.route(url, (route) => route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: `<!doctype html><html lang="en"><head><style>
            body { font-family: "${baselineFamily}", serif; font-weight: 400; }
            </style></head><body><main><p id="reading">${text}</p></main></body></html>`
        }));
        await page.goto(url);
        await page.evaluate(() => document.fonts.ready);
        const cdp = await context.newCDPSession(page);
        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");
        const baseline = await renderedFonts(cdp, "#reading");
        expect(baseline).toEqual([expect.objectContaining({
          postScriptName: baselinePostScript, glyphCount: text.length, isCustomFont: false
        })]);

        await chooseFont(entry.variant, entry.family);
        await expect.poll(() => page.locator("#reading").evaluate((element) =>
          getComputedStyle(element).fontFamily
        )).toContain(entry.family);
        await expect.poll(() => renderedFonts(cdp, "#reading")).toEqual([
          expect.objectContaining({ postScriptName: entry.postScript, glyphCount: text.length, isCustomFont: false })
        ]);
        const selected = await renderedFonts(cdp, "#reading");

        // A nonexistent name still appears in computed CSS, but renders no glyphs.
        await chooseFont(entry.variant, missingFamily);
        await expect.poll(() => page.locator("#reading").evaluate((element) =>
          getComputedStyle(element).fontFamily
        )).toContain(missingFamily);
        await expect.poll(() => renderedFonts(cdp, "#reading")).toEqual(baseline);
        const missing = await renderedFonts(cdp, "#reading");

        // Same-region website families retain priority even with preservation off.
        const sameRegionFamily = `Noto Sans CJK ${entry.baseline}`;
        await chooseFont(entry.baselineVariant, sameRegionFamily);
        await expect.poll(() => page.locator("#reading").evaluate((element) =>
          getComputedStyle(element).fontFamily
        )).toContain(sameRegionFamily);
        await expect.poll(() => renderedFonts(cdp, "#reading")).toEqual(baseline);
        const sameRegion = await renderedFonts(cdp, "#reading");

        await chooseFont(entry.variant, entry.family);
        await expect.poll(() => renderedFonts(cdp, "#reading")).toEqual(selected);
        await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "fixture.test": "off" } }));
        await expect.poll(() => page.locator("#reading").evaluate((element) =>
          getComputedStyle(element).fontFamily
        )).toBe(`"${baselineFamily}", serif`);
        await expect.poll(() => renderedFonts(cdp, "#reading")).toEqual(baseline);
        await expect(page.locator("#reading")).toHaveText(text);
        await testInfo.attach("rendered-fonts.json", {
          contentType: "application/json",
          body: JSON.stringify({
            browser: context.browser()?.version(), variant: entry.variant,
            baseline, selected, missing, sameRegion, restored: await renderedFonts(cdp, "#reading")
          }, null, 2)
        });
      } finally {
        await page.close();
      }
    });
  }
});
