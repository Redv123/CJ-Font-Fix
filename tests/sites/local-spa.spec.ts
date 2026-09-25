import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import type { ContentStatus } from "../../src/shared/types";

const CHINESE = "在一个人类与兽人共存的世界里，住着一只整天抽着烟、过着懒散生活的兽人。没钱，没生活能力，简直是个废物，礼仪和道德早就跟烟蒂一起被丢进垃圾桶了。";
const JAPANESE = "人間と獣人が共存する世界で、タバコを吸ってダラダラ生きる獣人・ヤニねこ。生活力なし、ろくでなし。それでも充実した日々を過ごしています。";

let context: BrowserContext;
let worker: Worker;
let profileDirectory: string;

async function currentStatus(): Promise<ContentStatus> {
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error("The fixture tab is not active");
    return chrome.tabs.sendMessage(tab.id, { type: "getStatus" });
  });
}

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-local-spa-"));
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

test("removes mixed-language wrappers when an SPA becomes English-only", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.set({
      mixedLanguageDetection: true,
      dynamicDetection: true,
      simpleMode: false,
      trustCjkLang: true,
      fontSC: "Noto Sans CJK SC",
      fontJP: "Noto Sans CJK JP",
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/mixed", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en-US"><head><title>中文网站字体设置</title></head><body><main>
        <p>${CHINESE.repeat(3)}<br>${JAPANESE.repeat(2)}</p>
        <p>${CHINESE.repeat(3)}</p><p>${JAPANESE.repeat(2)}</p>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/mixed", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    const wrappers = page.locator("[data-cjk-fallback-local]");
    await expect.poll(() => wrappers.count()).toBe(1);

    await page.evaluate(() => {
      document.title = "English page";
      for (const paragraph of document.querySelectorAll("main p")) {
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          node.nodeValue = "English content only";
        }
      }
    });
    await expect.poll(async () => (await currentStatus()).pageVariant).toBeNull();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    await expect(wrappers).toHaveCount(0);
  } finally {
    await page.close();
  }
});
