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

test("trusts a specific root CJK lang without inspecting nested content", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Sans",
      preserveWebFonts: false,
      preserveKnownCjk: false,
      dynamicDetection: true,
      simpleMode: false,
      trustCjkLang: true,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/trusted-root", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="zh-cn"><head><title>中文字体测试</title></head><body><main>
        <p id="declared" lang="">这是一段用于检查中文字体的文字。</p>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/trusted-root", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).reason).toBe("HTML lang");
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    await expect(page.locator("#declared")).not.toHaveAttribute("data-cjk-fallback-stack", /.+/);

    await page.locator("main").evaluate((main) => {
      const paragraph = document.createElement("p");
      paragraph.lang = "";
      paragraph.textContent = "这是动态加入的中文文字。";
      main.append(paragraph);
    });
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    await expect(page.locator("[data-cjk-fallback-stack]")).toHaveCount(0);
  } finally {
    await page.close();
  }
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

test("uses the current website stack when repeated text elements change style", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Sans",
      fontSCSerif: "CJ Test Serif",
      preserveWebFonts: false,
      preserveKnownCjk: false,
      dynamicDetection: true,
      simpleMode: false,
      siteOverrides: { "fixture.test": "sc" }
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/font-stacks", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en-US"><head><style>
        .sans { font-family: "Site Latin", sans-serif; }
        .serif { font-family: "Site Serif", serif; }
      </style></head><body><main>
        <p id="first" class="sans">第一段中文内容</p>
        <p id="second" class="sans">第二段中文内容</p>
        <p id="third" class="serif">第三段中文内容</p>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/font-stacks", { waitUntil: "domcontentloaded" });

    const family = (id: string) => page.locator(`#${id}`).evaluate((element) =>
      getComputedStyle(element).fontFamily
    );
    await expect.poll(() => family("first")).toContain("CJ Test Sans");
    await expect.poll(() => family("second")).toContain("CJ Test Sans");
    await expect.poll(() => family("third")).toContain("CJ Test Serif");
    expect(await family("first")).toContain("Site Latin");
    expect(await family("third")).toContain("Site Serif");

    await page.locator("#first").evaluate((element) => {
      element.setAttribute("class", "serif");
    });
    await expect.poll(() => family("first")).toContain("CJ Test Serif");
    expect(await family("first")).not.toContain("CJ Test Sans");
    expect(await family("second")).toContain("CJ Test Sans");
    expect(await family("third")).toContain("CJ Test Serif");
  } finally {
    await page.close();
  }
});
