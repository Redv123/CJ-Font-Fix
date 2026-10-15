import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Worker } from "@playwright/test";
import type { ContentStatus } from "../../src/shared/types";

const CHINESE = "在一个人类与兽人共存的世界里，住着一只整天抽着烟、过着懒散生活的兽人。没钱，没生活能力，简直是个废物，礼仪和道德早就跟烟蒂一起被丢进垃圾桶了。";
const TRADITIONAL = "在一個人類與獸人共存的世界裡，住著一隻整天抽著煙、過著懶散生活的獸人。沒錢，沒生活能力，簡直是個廢物，禮儀和道德早就跟煙蒂一起被丟進垃圾桶了。";
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
    executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
    headless: process.env.CJ_TEST_HEADLESS !== "0",
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

test("preserves website fonts using the worker catalog without reloading it during DOM updates", async () => {
  const catalog = await worker.evaluateHandle(() => {
    const state = { reads: 0, original: chrome.fontSettings.getFontList };
    Object.defineProperty(chrome.fontSettings, "getFontList", { configurable: true, value: async () => {
      state.reads++;
      return [
        { fontId: "NotoSansCJKCatalogFixture", displayName: "Noto Sans CJK SC CatalogFixture" },
        { fontId: "Hiragino Sans CatalogFixture", displayName: "Hiragino Sans CatalogFixture" }
      ];
    } });
    return state;
  });
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ fontSC: "CJ Test Sans",
      preserveWebsiteFonts: true, simpleMode: false, dynamicDetection: true,
      mixedLanguageDetection: false, siteOverrides: { "fixture.test": "sc" } }));
    await page.route("https://fixture.test/font-catalog", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><style>
        #by-name { font-family: "noto sans cjk sc catalogfixture", sans-serif; }
        #by-id { font-family: "NotoSansCJKCatalogFixture", sans-serif; }
        #missing { font-family: "Noto Sans CJK SC Missing CatalogFixture", sans-serif; }
        #wrong-region { font-family: "Hiragino Sans CatalogFixture", sans-serif; }
        </style></head><body><main>
        <p id="by-name">已安装字体的显示名称</p><p id="by-id">已安装字体的标识符</p>
        <p id="missing">未安装的字体仍然需要修正</p><p id="wrong-region">不同地区的字体仍然需要修正</p>
        </main></body></html>`
    }));
    await page.goto("https://fixture.test/font-catalog");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(2);
    await expect(page.locator("#by-name")).not.toHaveAttribute("data-cjk-fallback-stack");
    await expect(page.locator("#by-id")).not.toHaveAttribute("data-cjk-fallback-stack");
    for (const id of ["missing", "wrong-region"]) {
      expect(await page.locator(`#${id}`).evaluate((element) => getComputedStyle(element).fontFamily))
        .toContain("CJ Test Sans");
    }
    await page.evaluate(() => {
      const paragraph = document.createElement("p");
      paragraph.textContent = "动态插入的中文内容";
      paragraph.style.fontFamily = '"Noto Sans CJK SC Missing CatalogFixture", sans-serif';
      document.querySelector("main")!.append(paragraph);
    });
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(3);
    expect(await catalog.evaluate((state) => state.reads)).toBe(1);
  } finally {
    await page.close();
    await catalog.evaluate((state) => {
      Object.defineProperty(chrome.fontSettings, "getFontList", { value: state.original });
    });
    await catalog.dispose();
  }
});

test("keeps configured fallback working when the worker cannot read installed fonts", async () => {
  const original = await worker.evaluateHandle(() => chrome.fontSettings.getFontList);
  const page = await context.newPage();
  try {
    await worker.evaluate(() => {
      Object.defineProperty(chrome.fontSettings, "getFontList", { configurable: true, value: async () => {
        throw new Error("Simulated unavailable font catalog");
      } });
      return chrome.storage.sync.set({ fontSC: "CJ Test Sans", preserveWebsiteFonts: true, trustWindowsFonts: false,
        simpleMode: false, siteOverrides: { "fixture.test": "sc" } });
    });
    await page.route("https://fixture.test/font-catalog-failure", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<html><body><main><p style="font-family: Microsoft YaHei, sans-serif">读取字体列表失败后的中文内容</p></main></body></html>'
    }));
    await page.goto("https://fixture.test/font-catalog-failure");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    expect(await page.locator("p").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Sans");
    expect(await worker.evaluate(() => chrome.storage.sync.get("fontSC"))).toEqual({ fontSC: "CJ Test Sans" });
  } finally {
    await page.close();
    await worker.evaluate((getFontList) => {
      Object.defineProperty(chrome.fontSettings, "getFontList", { value: getFontList });
    }, original);
    await original.dispose();
  }
});

test("loads the font catalog only when website-font preservation becomes necessary", async () => {
  const catalog = await worker.evaluateHandle(() => {
    const state = { reads: 0, original: chrome.fontSettings.getFontList };
    Object.defineProperty(chrome.fontSettings, "getFontList", { configurable: true, value: async () => {
      state.reads++;
      return [];
    } });
    return state;
  });
  const page = await context.newPage();
  try {
    await worker.evaluate(() => chrome.storage.sync.set({ fontSC: "CJ Test Sans",
      preserveWebsiteFonts: true, simpleMode: false, dynamicDetection: true,
      siteOverrides: {}, siteDomainOverrides: {} }));
    await page.route("https://fixture.test/font-catalog-lazy", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html lang=en><body><main><p>This page initially contains English text only.</p></main></body></html>"
    }));
    await page.goto("https://fixture.test/font-catalog-lazy");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
    expect(await catalog.evaluate((state) => state.reads)).toBe(0);
    // Disabling preservation still allows new CJK content to be corrected without enumeration.
    await worker.evaluate(() => chrome.storage.sync.set({ preserveWebsiteFonts: false,
      siteOverrides: { "fixture.test": "sc" } }));
    await page.evaluate((text) => {
      const paragraph = document.createElement("p");
      paragraph.textContent = text;
      document.querySelector("main")!.append(paragraph);
    }, CHINESE);
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    expect(await catalog.evaluate((state) => state.reads)).toBe(0);
    await worker.evaluate(() => chrome.storage.sync.set({ preserveWebsiteFonts: true }));
    await expect.poll(() => catalog.evaluate((state) => state.reads)).toBe(1);
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
  } finally {
    await page.close();
    await catalog.evaluate((state) => {
      Object.defineProperty(chrome.fontSettings, "getFontList", { value: state.original });
    });
    await catalog.dispose();
  }
});

test("preserves Linux Windows-font substitutes and reapplies correction when trust is disabled", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontSC: "CJ Test Sans", fontJP: "CJ Test Japanese",
      preserveWebsiteFonts: true, simpleMode: false, dynamicDetection: true,
      siteOverrides: { "fixture.test": "sc" } });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/linux-font-substitutes", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><body><main>
        <p id="yahei" style="font-family: 微软雅黑, Tahoma, Helvetica, SimSun, sans-serif">网站指定的微软雅黑</p>
        <p id="missing" style="font-family: Missing CJK Font, sans-serif">未被系统规则列出的字体</p>
        <p id="japanese" style="font-family: MS Gothic, sans-serif">中文内容使用了日文字体</p>
        </main></body></html>`
    }));
    await page.goto("https://fixture.test/linux-font-substitutes");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(2);
    const family = (id: string) => page.locator(`#${id}`).evaluate((element) => getComputedStyle(element).fontFamily);
    await expect(page.locator("#yahei")).not.toHaveAttribute("data-cjk-fallback-stack");
    expect(await family("yahei")).not.toContain("CJ Test Sans");
    expect(await family("missing")).toContain("CJ Test Sans");
    expect(await family("japanese")).toContain("CJ Test Sans");
    await worker.evaluate(() => chrome.storage.sync.set({ trustWindowsFonts: false }));
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(3);
    expect(await family("yahei")).toContain("CJ Test Sans");
    await worker.evaluate(() => chrome.storage.sync.set({ trustWindowsFonts: true }));
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(2);
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "fixture.test": "jp" } }));
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    await expect(page.locator("#japanese")).not.toHaveAttribute("data-cjk-fallback-stack");
    expect(await family("japanese")).not.toContain("CJ Test Japanese");
    expect(await family("yahei")).toContain("CJ Test Japanese");
  } finally { await page.close(); }
});

for (const fixture of [
  { language: "sc", text: CHINESE, placement: "portal", root: "main" },
  { language: "tc", text: TRADITIONAL, placement: "main", root: "main" },
  { language: "jp", text: JAPANESE, placement: "portal", root: "article" }
]) {
  test(`wakes after a hidden ${fixture.root} skeleton is replaced by ${fixture.language} content in a ${fixture.placement}`, async () => {
    await worker.evaluate(() => chrome.storage.sync.set({ fontSC: "CJ Test Sans", fontTC: "CJ Test Traditional",
      fontJP: "CJ Test Japanese", defaultChinese: "sc", preserveWebsiteFonts: false,
      simpleMode: false, dynamicDetection: true, mixedLanguageDetection: false,
      siteOverrides: {}, siteDomainOverrides: {} }));
    const page = await context.newPage();
    try {
      const url = `https://fixture.test/skeleton-${fixture.language}`;
      await page.route(url, (route) => route.fulfill({ contentType: "text/html; charset=utf-8",
        body: `<html lang=en><head><title>Loading view</title></head><body>
          <${fixture.root} id=skeleton>Loading...</${fixture.root}><div id=portal></div></body></html>` }));
      await page.goto(url);
      await page.bringToFront();
      await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
      await page.waitForTimeout(350);
      await page.evaluate(({ text, placement }) => {
        const skeleton = document.querySelector<HTMLElement>("#skeleton")!;
        skeleton.style.display = "none";
        const paragraph = document.createElement("p");
        paragraph.id = "prose";
        paragraph.textContent = text.repeat(3);
        if (placement === "main") {
          const main = document.createElement("main");
          main.append(paragraph);
          document.body.append(main);
        } else document.querySelector("#portal")!.append(paragraph);
      }, fixture);
      await expect.poll(async () => (await currentStatus()).pageVariant, { timeout: 2500 }).toBe(fixture.language);
      await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    } finally { await page.close(); }
  });
}

test("rechecks a skeleton hidden by its ancestor after the new view was inserted", async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ fontJP: "CJ Test Japanese", preserveWebsiteFonts: false,
    simpleMode: false, dynamicDetection: true, mixedLanguageDetection: false, siteOverrides: {}, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/skeleton-delayed-hide", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang=en><head><title>Loading view</title><style>
        .retired { display: none; } #portal { display: contents; }
        </style></head><body><div id=old-view><main>Loading...</main></div><div id=portal></div></body></html>`
    }));
    await page.goto("https://fixture.test/skeleton-delayed-hide");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
    await page.waitForTimeout(350);
    await page.locator("#portal").evaluate((element, text) => {
      const paragraph = document.createElement("p");
      paragraph.id = "prose";
      paragraph.textContent = text.repeat(3);
      element.append(paragraph);
    }, JAPANESE);
    await page.waitForTimeout(350);
    expect((await currentStatus()).reason).toBe("No CJK text");
    await page.locator("#old-view").evaluate((element) => { element.setAttribute("class", "retired"); });
    await expect.poll(async () => (await currentStatus()).pageVariant, { timeout: 2500 }).toBe("jp");
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
  } finally { await page.close(); }
});

test("keeps English mutation bursts dormant without page sampling or style reads", async () => {
  await worker.evaluate(() => chrome.storage.sync.set({ preserveWebsiteFonts: false, simpleMode: false,
    dynamicDetection: true, mixedLanguageDetection: false, siteOverrides: {}, siteDomainOverrides: {} }));
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  let executionContextId: number | undefined;
  cdp.on("Runtime.executionContextCreated", ({ context: executionContext }) => {
    if (executionContext.auxData?.type === "isolated" && !executionContext.name.includes("playwright")) {
      executionContextId = executionContext.id;
    }
  });
  await cdp.send("Runtime.enable");
  try {
    await page.route("https://fixture.test/dormant-english-churn", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang=en><head><title>English dashboard</title></head><body>
        <main>${"<p>English reading content remains unchanged during background activity.</p>".repeat(1000)}</main>
        <div id=activity><span id=ticker>Loading updates</span></div></body></html>`
    }));
    await page.goto("https://fixture.test/dormant-english-churn");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
    await page.waitForTimeout(350);
    expect(executionContextId).toBeDefined();
    // Probe the extension's isolated world, where its own DOM reads occur.
    await cdp.send("Runtime.evaluate", { contextId: executionContextId, expression: `(() => {
      const metrics = globalThis.__cjkDormantProbe = { samples: 0, pageWalks: 0, styleReads: 0 };
      const main = document.querySelector('main');
      const walker = document.createTreeWalker;
      document.createTreeWalker = function(root, whatToShow, ...rest) {
        if (whatToShow === NodeFilter.SHOW_TEXT) metrics.samples++;
        if (root === main || root === document.body) metrics.pageWalks++;
        return walker.call(this, root, whatToShow, ...rest);
      };
      const styles = globalThis.getComputedStyle;
      globalThis.getComputedStyle = function(...args) {
        metrics.styleReads++;
        return styles.apply(this, args);
      };
    })()` });
    await page.evaluate(async () => {
      const activity = document.querySelector<HTMLElement>("#activity")!;
      const ticker = document.querySelector("#ticker")!.firstChild!;
      const prose = document.querySelector("main p")!.firstChild!;
      for (let frame = 0; frame < 20; frame++) {
        for (let update = 0; update < 25; update++) {
          activity.style.transform = `translateX(${update}px)`;
          activity.className = `frame-${frame}-${update}`;
          ticker.nodeValue = `Update ${frame}-${update}`;
          prose.nodeValue = `English reading content ${frame}-${update}`;
        }
        const addition = document.createElement("span");
        addition.textContent = `Background update ${frame}`;
        activity.append(addition);
        await new Promise(requestAnimationFrame);
      }
    });
    await page.waitForTimeout(350);
    const metrics = await cdp.send("Runtime.evaluate", { contextId: executionContextId,
      expression: "globalThis.__cjkDormantProbe", returnByValue: true });
    expect(metrics.result.value).toEqual({ samples: 0, pageWalks: 0, styleReads: 0 });
    expect((await currentStatus()).reason).toBe("No CJK text");
    // A sidebar in another language does not replace an intact English main.
    await page.locator("#activity").evaluate((element) => { element.append("日本語のサイドバー"); });
    await page.waitForTimeout(350);
    expect((await currentStatus()).reason).toBe("No CJK text");
    const afterSidebar = await cdp.send("Runtime.evaluate", { contextId: executionContextId,
      expression: "globalThis.__cjkDormantProbe.samples", returnByValue: true });
    expect(afterSidebar.result.value).toBe(0);
  } finally { await cdp.detach(); await page.close(); }
});

test("does not trust an English body lang for Chinese content", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Sans",
      defaultChinese: "sc",
      preserveWebsiteFonts: false,
      simpleMode: false,
      trustCjkLang: true,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/english-body", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>中文字体测试</title><style>
        p { font-family: "Site Latin", sans-serif; }
      </style></head><body lang="en"><main><p id="chinese">${CHINESE.repeat(3)}</p></main></body></html>`
    }));
    await page.goto("https://fixture.test/english-body", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("sc");
    await expect.poll(async () => (await currentStatus()).changedElements).toBeGreaterThan(0);
    await expect.poll(() => page.locator("#chinese").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test Sans");
  } finally {
    await page.close();
  }
});

test("keeps the selected font in every frame when hover replaces managed text", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontJP: "CJ Test Japanese", preserveWebsiteFonts: false,
      dynamicDetection: true, simpleMode: false, trustCjkLang: true });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/hover-replacement", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>日本語の動画紹介</title><style>
        #description { padding: 24px; font-family: "Site Latin", sans-serif; }
        #description:hover { background: #eef6ff; }
      </style></head><body><main><div id="description"><span id="snippet">${JAPANESE.repeat(3)}</span></div></main>
      <script>
        const description = document.querySelector('#description');
        function replaceSnippet() {
          const text = description.textContent;
          description.replaceChildren(document.createTextNode(''));
          queueMicrotask(() => {
            const wrapper = document.createElement('span');
            description.replaceChildren(wrapper);
            queueMicrotask(() => {
              const next = document.createElement('span');
              next.id = 'snippet';
              wrapper.append(next);
              const content = document.createTextNode('');
              next.append(content);
              queueMicrotask(() => { content.nodeValue = text; });
            });
          });
        }
        description.addEventListener('mouseenter', replaceSnippet);
        description.addEventListener('mouseleave', replaceSnippet);
      </script></body></html>`
    }));
    await page.goto("https://fixture.test/hover-replacement");
    await page.bringToFront();
    await expect.poll(() => page.locator("#snippet").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Japanese");
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    await page.mouse.move(600, 500);
    await page.waitForTimeout(400);
    for (const hovering of [true, false]) {
      await page.evaluate(() => {
        const samples: string[] = [];
        Object.assign(window, { hoverFontSamples: samples });
        const end = performance.now() + 300;
        const sample = () => {
          samples.push(getComputedStyle(document.querySelector("#snippet") || document.querySelector("#description")!).fontFamily);
          if (performance.now() < end) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      if (hovering) await page.locator("#description").hover();
      else await page.mouse.move(600, 500);
      await page.waitForTimeout(320);
      const samples = await page.evaluate(() => (window as unknown as { hoverFontSamples: string[] }).hoverFontSamples);
      expect(samples.length).toBeGreaterThan(3);
      expect(samples.filter((family) => !family.includes("CJ Test Japanese"))).toEqual([]);
    }
    // The temporary parent style must disappear when the replacement is no
    // longer CJK, and normal correction must still work after new text arrives.
    await page.locator("#description").evaluate((element) => {
      element.replaceChildren(document.createTextNode(""));
      queueMicrotask(() => { element.textContent = "An English description"; });
    });
    await expect.poll(() => page.locator("#description").evaluate((element) => getComputedStyle(element).fontFamily))
      .toBe('"Site Latin", sans-serif');
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    await page.locator("#description").evaluate((element, text) => { element.textContent = text; }, JAPANESE.repeat(3));
    await expect.poll(() => page.locator("#description").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Japanese");
    await page.locator("#description").evaluate((element) => element.remove());
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
  } finally {
    await page.close();
  }
});

test("corrects newly expanded content on an ordinary website before its first visible frame", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontJP: "CJ Test Japanese", preserveWebsiteFonts: false,
      dynamicDetection: true, simpleMode: false, mixedLanguageDetection: false });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/expanded-content", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>日本語の動画紹介</title><style>
        #description { font-family: "Site Latin", sans-serif; }
      </style></head><body><main><div id="description">
        <div id="preview">${JAPANESE.repeat(3)}</div>
        <div id="expanded" hidden></div><button id="show-details">Show details</button>
      </div></main><script>
        document.querySelector('#show-details').addEventListener('click', () => {
          const expanded = document.querySelector('#expanded');
          expanded.hidden = !expanded.hidden;
          document.querySelector('#preview').hidden = !expanded.hidden;
          if (expanded.hidden || expanded.childNodes.length) return;
          queueMicrotask(() => {
            const full = document.createElement('span');
            full.id = 'full-description';
            full.textContent = ${JSON.stringify(JAPANESE.repeat(6))};
            expanded.append(full);
          });
        });
      </script></body></html>`
    }));
    await page.goto("https://fixture.test/expanded-content");
    await page.bringToFront();
    await expect.poll(() => page.locator("#preview").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Japanese");
    await page.evaluate(() => {
      const samples: string[] = [];
      Object.assign(window, { expandedFontSamples: samples });
      const end = performance.now() + 400;
      const sample = () => {
        const full = document.querySelector("#full-description");
        if (full?.getClientRects().length) samples.push(getComputedStyle(full).fontFamily);
        if (performance.now() < end) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.locator("#show-details").click();
    await page.waitForTimeout(420);
    const samples = await page.evaluate(() => (window as unknown as { expandedFontSamples: string[] }).expandedFontSamples);
    expect(samples.length).toBeGreaterThan(3);
    expect(samples.filter((family) => !family.includes("CJ Test Japanese"))).toEqual([]);
    await page.locator("#full-description").evaluate((element) => element.setAttribute("data-retained", "yes"));
    await page.locator("#show-details").click();
    await expect(page.locator("#full-description")).toBeHidden();
    await page.locator("#show-details").click();
    await expect(page.locator("#full-description")).toBeVisible();
    await expect(page.locator("#full-description")).toHaveAttribute("data-retained", "yes");
    expect(await page.locator("#full-description").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Japanese");
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "fixture.test": "off" } }));
    await expect.poll(() => page.locator("#full-description").evaluate((element) => getComputedStyle(element).fontFamily))
      .toBe('"Site Latin", sans-serif');
  } finally {
    await page.close();
  }
});

test("uses only the page font when mixed detection is off despite bare zh descendants", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      mixedLanguageDetection: false,
      fontSC: "CJ Test Simplified",
      fontTC: "CJ Test Traditional",
      fontJP: "CJ Test Japanese",
      trustCjkLang: true,
      preserveWebsiteFonts: false,
      simpleMode: false,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/lyrics", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>日本語の歌詞</title></head><body>
        <div id="mw-content-text" lang="zh">
          <p>${JAPANESE.repeat(6)}</p>
          <p id="translation">${CHINESE.repeat(2)}</p>
        </div>
        <div id="catlinks">Categories: <a>日文歌词</a> <a>有翻译的歌词</a></div>
      </body></html>`
    }));
    await page.goto("https://fixture.test/lyrics", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    await expect.poll(async () => (await currentStatus()).fallbackChoice).toBe("CJ Test Japanese");
    await expect(page.locator("[data-cjk-fallback-local]")).toHaveCount(0);
    await expect.poll(() => page.locator("#translation").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test Japanese");
  } finally {
    await page.close();
  }
});

test("does not skip font repair for bare root lang=zh", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Sans",
      defaultChinese: "sc",
      preserveWebsiteFonts: false,
      simpleMode: false,
      trustCjkLang: true,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/bare-zh", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="zh"><head><title>中文字体测试</title><style>
        p { font-family: "Site Latin", sans-serif; }
      </style></head><body><main><p id="chinese">${CHINESE.repeat(3)}</p></main></body></html>`
    }));
    await page.goto("https://fixture.test/bare-zh", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("sc");
    await expect.poll(async () => (await currentStatus()).changedElements).toBeGreaterThan(0);
    await expect.poll(() => page.locator("#chinese").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test Sans");
  } finally {
    await page.close();
  }
});

test("trusts a specific root CJK lang without inspecting nested content", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Sans",
      preserveWebsiteFonts: false,
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

test("keeps the page language stable when a local comment is expanded", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Simplified",
      fontTC: "CJ Test Traditional",
      preserveWebsiteFonts: false,
      dynamicDetection: true,
      simpleMode: false,
      trustCjkLang: true,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/comments", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>简体中文视频介绍</title></head><body><main>
        <article id="description"><p>${CHINESE.repeat(3)}</p></article>
        <section id="comments"></section>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/comments", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("sc");

    await page.locator("#comments").evaluate((comments, text) => {
      const comment = document.createElement("p");
      comment.id = "expanded-comment";
      comment.textContent = text;
      comments.append(comment);
    }, TRADITIONAL.repeat(5));

    await expect.poll(() => page.locator("#expanded-comment").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test Simplified");
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("sc");
  } finally {
    await page.close();
  }
});

test("ignores excluded attribute churn while retaining ancestor fonts and embedded stylesheet updates", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontSC: "CJ Test Sans", fontSCSerif: "CJ Test Serif",
      preserveWebsiteFonts: false, dynamicDetection: true, simpleMode: false,
      siteOverrides: { "fixture.test": "sc" } });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  let executionContextId: number | undefined;
  cdp.on("Runtime.executionContextCreated", ({ context: executionContext }) => {
    if (executionContext.auxData?.type === "isolated" && !executionContext.name.includes("playwright")) {
      executionContextId = executionContext.id;
    }
  });
  await cdp.send("Runtime.enable");
  try {
    await page.route("https://fixture.test/excluded-attributes", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><style>
        #region { font-family: sans-serif; } #region.serif { font-family: serif; }
        </style></head><body><main>
        <section id="region"><p id="prose">正常正文的中文字体</p></section>
        <pre id="code"><code><span id="code-child">代码区域</span></code></pre>
        <canvas id="canvas"></canvas><svg id="svg"><g id="svg-child"></g></svg>
        <pre><style id="embedded" media="not all">#region { font-family: serif !important; }</style></pre>
        </main></body></html>`
    }));
    await page.goto("https://fixture.test/excluded-attributes");
    await page.bringToFront();
    const family = () => page.locator("#prose").evaluate((element) => getComputedStyle(element).fontFamily);
    await expect.poll(family).toContain("CJ Test Sans");
    await page.waitForTimeout(350);
    expect(executionContextId).toBeDefined();
    // Every completed extension run reports its action state, including empty runs.
    await cdp.send("Runtime.evaluate", { contextId: executionContextId, expression: `(() => {
      globalThis.__cjkExcludedReports = 0;
      const send = chrome.runtime.sendMessage;
      chrome.runtime.sendMessage = function(...args) {
        if (args[0]?.type === 'setActionState') globalThis.__cjkExcludedReports++;
        return send.apply(this, args);
      };
    })()` });
    await page.evaluate(async () => {
      const targets = ["code", "code-child", "canvas", "svg", "svg-child"]
        .map((id) => document.getElementById(id)!);
      for (let frame = 0; frame < 20; frame++) {
        for (const target of targets) {
          target.setAttribute("class", `frame-${frame}`);
          target.setAttribute("style", `opacity: ${frame % 2 ? 0.9 : 1}`);
        }
        await new Promise(requestAnimationFrame);
      }
    });
    await page.waitForTimeout(350);
    const reports = await cdp.send("Runtime.evaluate", { contextId: executionContextId,
      expression: "globalThis.__cjkExcludedReports", returnByValue: true });
    expect(reports.result.value).toBe(0);
    expect(await family()).toContain("CJ Test Sans");

    await page.locator("#region").evaluate((element) => { element.setAttribute("class", "serif"); });
    await expect.poll(family).toContain("CJ Test Serif");
    await page.locator("#region").evaluate((element) => { element.style.fontFamily = "sans-serif"; });
    await expect.poll(family).toContain("CJ Test Sans");
    // A style node still affects the document even when its parent is excluded.
    await page.locator("#embedded").evaluate((element) => { (element as HTMLStyleElement).media = "all"; });
    await expect.poll(family).toContain("CJ Test Serif");
    const activeReports = await cdp.send("Runtime.evaluate", { contextId: executionContextId,
      expression: "globalThis.__cjkExcludedReports", returnByValue: true });
    expect(activeReports.result.value).toBeGreaterThan(0);
  } finally { await cdp.detach(); await page.close(); }
});

test("updates one split-text element without disturbing other managed elements", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontSC: "CJ Test Simplified",
      fontSCSerif: "CJ Test Serif",
      preserveWebsiteFonts: false,
      dynamicDetection: true,
      simpleMode: false,
      siteOverrides: { "fixture.test": "sc" }
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/split-text", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><style>
        .sans { font-family: "Site Latin", sans-serif; }
        .serif { font-family: "Site Serif", serif; }
      </style></head><body><main>
        <p id="changed" class="sans">第一段中文<br>第二段中文<br>第三段中文</p>
        <p id="untouched" class="sans">另一段中文内容</p>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/split-text", { waitUntil: "domcontentloaded" });
    const family = (id: string) => page.locator(`#${id}`).evaluate((element) =>
      getComputedStyle(element).fontFamily
    );
    await expect.poll(() => family("changed")).toContain("CJ Test Simplified");
    await expect.poll(() => family("untouched")).toContain("CJ Test Simplified");
    await expect(page.locator("[data-cjk-fallback-fixed]")).toHaveCount(0);

    await page.locator("#changed").evaluate((element) => {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) node.nodeValue = "English text";
      }
    });
    await expect(page.locator("#changed")).not.toHaveAttribute("data-cjk-fallback-stack", /.+/);
    expect(await family("changed")).not.toContain("CJ Test Simplified");
    expect(await family("untouched")).toContain("CJ Test Simplified");

    await page.locator("#changed").evaluate((element) => {
      for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) node.nodeValue = "更新后的中文内容";
      }
    });
    await expect.poll(() => family("changed")).toContain("CJ Test Simplified");

    await page.locator("#changed").evaluate((element) => {
      element.setAttribute("class", "serif");
    });
    await expect.poll(() => family("changed")).toContain("CJ Test Serif");
    expect(await family("changed")).not.toContain("CJ Test Simplified");
    expect(await family("untouched")).toContain("CJ Test Simplified");
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

test("uses only a directly preceding strong segment to resolve weak mixed-page text", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      mixedLanguageDetection: true,
      dynamicDetection: true,
      simpleMode: false,
      trustCjkLang: true,
      preserveWebsiteFonts: false,
      fontSC: "CJ Test SC",
      fontTC: "CJ Test TC",
      fontJP: "CJ Test JP",
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/mixed-neighbors", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en-US"><head><title>中文页面字体测试</title></head><body><main>
        <section id="chinese"><p>${CHINESE.repeat(3)}</p><p id="sc-weak">这本书</p><p id="sc-weak-next">这本书</p></section>
        <section id="japanese"><p>${JAPANESE.repeat(2)}</p></section>
        <section id="more-chinese"><p>${CHINESE.repeat(3)}</p></section>
        <section id="declared"><p lang="zh-CN">${CHINESE}</p><p id="lang-boundary">这本书</p></section>
        <section id="unrelated"><p id="isolated">这本书</p></section>
      </main></body></html>`
    }));
    await page.goto("https://fixture.test/mixed-neighbors", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    for (const id of ["sc-weak-next", "lang-boundary", "isolated"]) {
      expect(await page.locator(`#${id}`).evaluate((element) =>
        getComputedStyle(element).fontFamily
      )).not.toContain("CJ Test SC");
    }
    await expect.poll(() => page.locator("#sc-weak").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test SC");

    await page.locator("#chinese p").first().evaluate((element) => {
      element.textContent = "日本語の文章に置き換えて、隣の短い文が以前の判定を残さないか確認します。";
    });
    await expect.poll(() => page.locator("#sc-weak").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).not.toContain("CJ Test SC");

    await page.locator("#chinese p").first().evaluate((element, text) => {
      element.textContent = text;
    }, CHINESE.repeat(3));
    await expect.poll(() => page.locator("#sc-weak").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test SC");
    await page.locator("#chinese p").first().evaluate((element) => element.remove());
    await expect.poll(() => page.locator("#sc-weak").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).not.toContain("CJ Test SC");
  } finally {
    await page.close();
  }
});

test("redetects Japanese content after an in-document history return", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({
      fontJP: "CJ Test Japanese",
      preserveWebsiteFonts: false,
      dynamicDetection: true,
      simpleMode: false,
      trustCjkLang: true,
      siteOverrides: {}
    });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/videos", (route) => route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>日本語の動画</title></head><body>
        <div id="videos" role="main"><p id="japanese">${JAPANESE.repeat(3)}</p></div>
        <div id="home">English home page</div>
        <script>
          addEventListener("popstate", () => {
            document.querySelector("#home").removeAttribute("role");
            document.querySelector("#videos").setAttribute("role", "main");
          });
        </script>
      </body></html>`
    }));
    await page.goto("https://fixture.test/videos", { waitUntil: "domcontentloaded" });
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");

    await page.evaluate(() => {
      document.querySelector("#videos")?.removeAttribute("role");
      document.querySelector("#home")?.setAttribute("role", "main");
      history.pushState({}, "", "/home");
      document.title = "English home page";
    });
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");

    await page.evaluate(() => history.back());
    await page.waitForURL("https://fixture.test/videos");
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    await expect.poll(() => page.locator("#japanese").evaluate((element) =>
      getComputedStyle(element).fontFamily
    )).toContain("CJ Test Japanese");
  } finally {
    await page.close();
  }
});

test("redetects a cached channel when its main role is restored after the Back scan", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontJP: "CJ Test Japanese", preserveWebsiteFonts: false,
      dynamicDetection: true, simpleMode: false, trustCjkLang: true });
  });
  const page = await context.newPage();
  try {
    // Model the freshly reloaded Home document. Its cached channel stays in
    // the DOM; returning to it changes role/hidden rather than replacing text.
    await page.route("https://fixture.test/**", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html lang="en"><head><title>YouTube</title></head><body>
        <div id="home" role="main">English home page</div>
        <div id="channel" hidden><p id="cached-japanese">${JAPANESE.repeat(3)}</p></div>
        <button id="show-channel" type="button">Show channel</button>
        <script>
          document.querySelector('#show-channel').onclick = () => {
            document.querySelector('#home').hidden = true;
            document.querySelector('#home').removeAttribute('role');
            document.querySelector('#channel').hidden = false;
            document.querySelector('#channel').setAttribute('role', 'main');
            document.title = 'konoyaAF - YouTube';
          };
          addEventListener('popstate', () => document.querySelector('#home').classList.toggle('loading'));
        </script>
      </body></html>`
    }));
    await page.goto("https://fixture.test/home");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
    await page.evaluate(() => {
      history.replaceState({ view: "channel" }, "", "/videos");
      history.pushState({ view: "home" }, "", "/home");
      history.back();
    });
    await page.waitForURL("https://fixture.test/videos");
    // Ensure the URL-change scan has run against Home before restoring the
    // channel, rather than relying on a race with the detector's scheduler.
    await page.waitForTimeout(400);
    await expect.poll(async () => (await currentStatus()).reason).toBe("No CJK text");
    await page.locator("#show-channel").click();
    await expect(page.locator("#channel")).toBeVisible();
    await expect.poll(async () => (await currentStatus()).pageVariant).toBe("jp");
    await expect.poll(() => page.locator("#cached-japanese").evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("CJ Test Japanese");
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
      preserveWebsiteFonts: false,
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

test("repairs newly inserted shadow hosts and restores their inline fonts", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontSC: "CJ Test Sans", preserveWebsiteFonts: false,
      dynamicDetection: true, siteOverrides: { "fixture.test": "sc" } });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/new-shadow-host", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><body><main><p>原有中文内容</p></main></body></html>"
    }));
    await page.goto("https://fixture.test/new-shadow-host");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    // Let startup font metadata settle before inserting a purely local subtree.
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "new-shadow-host";
      const shadow = host.attachShadow({ mode: "open" });
      shadow.innerHTML = '<p id="shadow-prose" style="font-family: serif !important">新增中文内容</p><div id="nested-host"></div>';
      shadow.querySelector("#nested-host")!.attachShadow({ mode: "open" }).innerHTML = '<p id="nested-prose">嵌套中文内容</p>';
      document.querySelector("main")!.append(host);
    });
    const prose = page.locator("#shadow-prose");
    await expect.poll(() => prose.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("CJ Test Sans");
    await expect.poll(() => page.locator("#nested-prose").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("CJ Test Sans");
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(3);

    const host = (await page.locator("#new-shadow-host").elementHandle())!;
    await host.evaluate((element) => element.remove());
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    expect(await host.evaluate((element) => (element.shadowRoot!.querySelector("#shadow-prose") as HTMLElement).style.fontFamily)).toBe("serif");
    await host.evaluate((element) => document.querySelector("main")!.append(element));
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(3);
    await prose.evaluate((element) => { element.firstChild!.nodeValue = "English text only"; });
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(2);
    await prose.evaluate((element) => { element.firstChild!.nodeValue = "重新插入后的中文内容"; });
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(3);
    await host.dispose();

    // Website edits must still be captured after the extension's write batch.
    await prose.evaluate((element) => (element as HTMLElement).style.setProperty("font-family", '"Site Updated", sans-serif', "important"));
    await expect.poll(() => prose.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("Site Updated");
    await expect.poll(() => prose.evaluate((element) => getComputedStyle(element).fontFamily)).toContain("CJ Test Sans");
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "fixture.test": "off" } }));
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    expect(await prose.evaluate((element) => (element as HTMLElement).style.getPropertyValue("font-family"))).toBe('"Site Updated", sans-serif');
    expect(await prose.evaluate((element) => (element as HTMLElement).style.getPropertyPriority("font-family"))).toBe("important");
    expect(await page.locator("#nested-prose").evaluate((element) => (element as HTMLElement).style.fontFamily)).toBe("");
  } finally {
    await page.close();
  }
});

test("ignores unrelated site rules while applying effective rule and global font changes", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontSC: "CJ Test Simplified", fontTC: "CJ Test Traditional",
      preserveWebsiteFonts: false, dynamicDetection: true,
      siteOverrides: { "news.example.com": "sc" }, siteDomainOverrides: { "example.com": "jp" } });
  });
  const page = await context.newPage();
  try {
    await page.route("https://news.example.com/settings-changes", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<html><body><main><p id='prose'>中文内容</p></main></body></html>"
    }));
    await page.goto("https://news.example.com/settings-changes");
    await page.bringToFront();
    const family = () => page.locator("#prose").evaluate((element) => getComputedStyle(element).fontFamily);
    await expect.poll(family).toContain("CJ Test Simplified");
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const prose = document.querySelector("#prose")!;
      prose.setAttribute("data-test-style-writes", "0");
      let writes = 0;
      new MutationObserver((records) => {
        writes += records.length;
        prose.setAttribute("data-test-style-writes", String(writes));
      }).observe(prose, { attributes: true, attributeFilter: ["style", "data-cjk-fallback-stack"] });
    });
    await worker.evaluate(() => chrome.storage.sync.set({
      siteOverrides: { "news.example.com": "sc", "unrelated.test": "jp" },
      siteDomainOverrides: { "example.com": "tc", "unrelated.com": "off" }
    }));
    await page.waitForTimeout(400);
    expect(await page.locator("#prose").getAttribute("data-test-style-writes")).toBe("0");
    expect(await family()).toContain("CJ Test Simplified");

    // Removing the exact rule must use the domain choice saved above.
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "unrelated.test": "jp" } }));
    await expect.poll(family).toContain("CJ Test Traditional");
    await worker.evaluate(() => chrome.storage.sync.set({ siteDomainOverrides: { "example.com": "off" } }));
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(0);
    await worker.evaluate(() => chrome.storage.sync.set({ siteDomainOverrides: { "example.com": "sc" } }));
    await expect.poll(family).toContain("CJ Test Simplified");

    // A combined notification must still honor the global font change.
    await worker.evaluate(() => chrome.storage.sync.set({ fontSC: "CJ Test Updated",
      siteOverrides: { "another.test": "tc" } }));
    await expect.poll(family).toContain("CJ Test Updated");
  } finally {
    await page.close();
  }
});

test("restores non-CJK descendants across light and shadow trees without changing other regions", async () => {
  await worker.evaluate(async () => {
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set({ fontSC: "CJ Test Sans", preserveWebsiteFonts: false,
      dynamicDetection: true, siteOverrides: { "fixture.test": "sc" } });
  });
  const page = await context.newPage();
  try {
    await page.route("https://fixture.test/affected-regions", (route) => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<html><head><style>body { font-family: "Site Latin", sans-serif; }</style></head><body>
        <main><section id="region"><p id="light-prose">局部中文内容</p><div id="shadow-host"></div></section>
        <section><p id="outside">区域外的中文内容</p></section></main>
        <script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML =
          '<p id="shadow-prose">影子树中文内容</p><div id="deep-host"></div>';
        document.querySelector('#shadow-host').shadowRoot.querySelector('#deep-host').attachShadow({mode:'open'}).innerHTML =
          '<p id="deep-prose">嵌套影子树中文内容</p>';</script>
      </body></html>`
    }));
    await page.goto("https://fixture.test/affected-regions");
    await page.bringToFront();
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(4);
    const family = (id: string) => page.locator(`#${id}`).evaluate((element) => getComputedStyle(element).fontFamily);
    await page.evaluate(() => {
      document.querySelector("#light-prose")!.firstChild!.nodeValue = "English only";
      const shadow = document.querySelector("#shadow-host")!.shadowRoot!;
      shadow.querySelector("#shadow-prose")!.firstChild!.nodeValue = "English only";
      shadow.querySelector("#deep-host")!.shadowRoot!.querySelector("#deep-prose")!.firstChild!.nodeValue = "English only";
      document.querySelector("#region")!.classList.add("changed");
    });
    await expect.poll(async () => (await currentStatus()).changedElements).toBe(1);
    for (const id of ["light-prose", "shadow-prose", "deep-prose"]) expect(await family(id)).not.toContain("CJ Test Sans");
    expect(await family("outside")).toContain("CJ Test Sans");
    // Changing the document-wide stack still revisits every managed descendant.
    await page.locator("body").evaluate((element) => (element as HTMLElement).style.fontFamily = '"Site Updated", sans-serif');
    await expect.poll(() => family("outside")).toContain("Site Updated");
    expect(await family("outside")).toContain("CJ Test Sans");
  } finally {
    await page.close();
  }
});
