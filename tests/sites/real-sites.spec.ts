import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import type { ContentStatus, Settings, Variant } from "../../src/shared/types";

interface SiteCase {
  name: string;
  url: string;
  expectedVariant: Variant | null;
  expectedLang?: RegExp;
}

const SITES: readonly SiteCase[] = [
  {
    name: "DuckDuckGo ordinary search",
    url: "https://duckduckgo.com/?q=1&t=brave&ia=web",
    expectedVariant: null
  },
  {
    name: "Japanese Wikipedia",
    url: "https://ja.wikipedia.org/wiki/日本語",
    expectedVariant: "jp",
    expectedLang: /^ja(?:-|$)/i
  },
  {
    name: "Simplified Chinese Wikipedia",
    url: "https://zh.wikipedia.org/zh-cn/汉字",
    expectedVariant: "sc",
    expectedLang: /^zh(?:-|$)/i
  },
  {
    name: "Traditional Chinese Wikipedia",
    url: "https://zh.wikipedia.org/zh-tw/漢字",
    expectedVariant: "tc",
    expectedLang: /^zh(?:-|$)/i
  },
  {
    name: "Bangumi",
    url: "https://bangumi.tv/subject/622206",
    expectedVariant: "sc"
  }
];

let context: BrowserContext;
let worker: Worker;
let profileDirectory: string;

async function extensionStatus(page: Page): Promise<ContentStatus> {
  await page.bringToFront();
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error("The test page has no active Chrome tab");
    return chrome.tabs.sendMessage(tab.id, { type: "getStatus" });
  });
}

async function replaceSettings(values: Partial<Settings>): Promise<void> {
  await worker.evaluate(async (settings) => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(settings);
  }, values);
}

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-sites-"));
  const extensionDirectory = resolve("dist");
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionDirectory}`,
      `--load-extension=${extensionDirectory}`
    ]
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
});

test.afterAll(async () => {
  await context?.close();
  if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
});

test.describe("real websites in Chromium", () => {
  for (const site of SITES) {
    test(`detects ${site.name}`, async () => {
      await replaceSettings({
        trustCjkLang: true,
        defaultChinese: "sc",
        simpleMode: false,
        dynamicDetection: true,
        siteOverrides: {}
      });
      const page = await context.newPage();
      try {
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await expect.poll(async () => (await extensionStatus(page)).pageVariant).toBe(site.expectedVariant);
        const status = await extensionStatus(page);
        expect(status.hostname).toBe(new URL(page.url()).hostname);
        if (site.expectedLang) expect(status.htmlLang).toMatch(site.expectedLang);
        if (site.name === "Bangumi") {
          expect(await page.locator("[data-cjk-fallback-local]").count()).toBe(0);
        }
      } finally {
        await page.close();
      }
    });
  }

  test("applies Japanese fallback to every Japanese paragraph in a Bangumi summary", async () => {
    const japaneseFont = "CJ Font Fallback E2E JP";
    await replaceSettings({
      fontSC: "CJ Font Fallback E2E SC",
      fontJP: japaneseFont,
      trustCjkLang: true,
      preserveWebFonts: false,
      preserveKnownCjk: true,
      simpleMode: false,
      dynamicDetection: true,
      mixedLanguageDetection: true,
      siteOverrides: {}
    });
    const page = await context.newPage();
    try {
      await page.goto("https://bangumi.tv/subject/36140", {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const japaneseSegments = page.locator(
        "#subject_summary [data-cjk-fallback-local='jp']"
      );
      await expect.poll(() => japaneseSegments.count()).toBe(3);
      await expect.poll(() => page.locator("#subject_summary").getAttribute("data-cjk-fallback-fixed"))
        .not.toBe("sc");
      const japaneseFamily = await japaneseSegments.first().evaluate((element) =>
        getComputedStyle(element).fontFamily
      );
      expect(japaneseFamily).toContain(japaneseFont);
      expect(japaneseFamily).not.toContain("CJ Font Fallback E2E SC");
      expect(japaneseFamily.indexOf(japaneseFont)).toBeLessThan(japaneseFamily.indexOf("PingFang SC"));
      const inlineTitles = page.locator(
        "[data-cjk-fallback-local='jp']",
        { hasText: "魔法使いの夜 オリジナルサウンドトラック" }
      );
      await expect.poll(() => inlineTitles.count()).toBeGreaterThan(0);
      const inlineTexts = await inlineTitles.allTextContents();
      expect(inlineTexts).toContain("魔法使いの夜 オリジナルサウンドトラック");
      expect(inlineTexts.every((text) => !text.includes("大家将") && !text.includes("标注为")))
        .toBe(true);
      const status = await extensionStatus(page);
      expect(status.detectedVariants).toEqual(expect.arrayContaining(["sc", "jp"]));
      await worker.evaluate(() => chrome.storage.sync.set({ mixedLanguageDetection: false }));
      await expect.poll(() => japaneseSegments.count()).toBe(0);
      await expect(page.locator("#subject_summary")).toContainText("シナリオを手掛けるのは");
    } finally {
      await page.close();
    }
  });

  test("injects the selected Japanese fallback into a real page", async () => {
    const testFont = "CJ Font Fallback E2E JP";
    await replaceSettings({
      fontJP: testFont,
      trustCjkLang: true,
      preserveWebFonts: false,
      preserveKnownCjk: true,
      simpleMode: false,
      dynamicDetection: true,
      siteOverrides: { "ja.wikipedia.org": "jp" }
    });
    const page = await context.newPage();
    try {
      await page.goto("https://ja.wikipedia.org/wiki/日本語", {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      await expect.poll(async () => (await extensionStatus(page)).reason).toBe("Site override");
      await expect.poll(async () => (await extensionStatus(page)).changedElements ?? 0).toBeGreaterThan(0);
      const status = await extensionStatus(page);
      expect(status.fallbackChoice).toContain(testFont);
      await expect.poll(() => page.locator("[data-cjk-fallback-fixed]").count()).toBeGreaterThan(0);
      expect(await page.locator("#cjk-font-fallback-generated-rules").textContent()).toContain(testFont);
    } finally {
      await page.close();
    }
  });

  test("keeps a complete mixed-script Bangumi work title Japanese", async () => {
    await replaceSettings({
      fontSC: "CJ Font Fallback E2E SC",
      fontJP: "CJ Font Fallback E2E JP",
      trustCjkLang: true,
      preserveWebFonts: false,
      preserveKnownCjk: true,
      simpleMode: false,
      dynamicDetection: true,
      mixedLanguageDetection: true,
      siteOverrides: {}
    });
    const page = await context.newPage();
    try {
      await page.goto("https://bangumi.tv/subject/633836", {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const title = "Re:ゼロから始める異世界生活 4th season 奪還編";
      const heading = page.locator("h2.subtitle", { hasText: "大家将" });
      const localTitle = heading.locator("[data-cjk-fallback-local='jp']");
      await expect(localTitle).toHaveText(title);
      const titleFamily = await localTitle.evaluate((element) => getComputedStyle(element).fontFamily);
      expect(titleFamily).toContain("CJ Font Fallback E2E JP");
      expect(titleFamily).not.toContain("CJ Font Fallback E2E SC");
      expect(titleFamily.indexOf("CJ Font Fallback E2E JP"))
        .toBeLessThan(titleFamily.indexOf("SF Pro SC"));
      await expect(heading).toContainText(`大家将 ${title} 标注为`);
      await expect(heading).toHaveAttribute("data-cjk-fallback-fixed", "sc");
      const status = await extensionStatus(page);
      expect(status.detectedVariants).toEqual(expect.arrayContaining(["sc", "jp"]));
    } finally {
      await page.close();
    }
  });

  test("uses Japanese font for a short all-kana title on a mixed Bangumi page", async () => {
    const japaneseFont = "CJ Font Fallback E2E JP";
    const chineseFont = "CJ Font Fallback E2E SC";
    await replaceSettings({
      fontSC: chineseFont,
      fontJP: japaneseFont,
      trustCjkLang: true,
      preserveWebFonts: false,
      preserveKnownCjk: true,
      simpleMode: false,
      dynamicDetection: true,
      mixedLanguageDetection: true,
      siteOverrides: {}
    });
    const page = await context.newPage();
    try {
      await page.goto("https://bangumi.tv/subject/495291", {
        waitUntil: "domcontentloaded",
        timeout: 45_000
      });
      const title = page.locator("h1.nameSingle a", { hasText: "さよならララ" });
      await expect(title).toHaveAttribute("data-cjk-fallback-fixed", "jp", { timeout: 5_000 });
      const titleFamily = await title.evaluate((element) => getComputedStyle(element).fontFamily);
      expect(titleFamily).toContain(japaneseFont);
      expect(titleFamily).not.toContain(chineseFont);
      await expect(page.locator("h2.subtitle", { hasText: "大家将" }))
        .toHaveAttribute("data-cjk-fallback-fixed", "sc");
      expect((await extensionStatus(page)).pageVariant).toBe("sc");
    } finally {
      await page.close();
    }
  });
});
