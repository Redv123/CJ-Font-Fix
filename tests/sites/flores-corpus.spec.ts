import { expect, test, chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Page, Worker } from "@playwright/test";
import type { ContentStatus, Variant } from "../../src/shared/types";

// FLORES text stays outside the repository. Its independently assigned script
// labels are the oracle; neither the extension nor another detector labels it.
const sourceDir = process.env.CJ_FLORES_DIR;
const sourceCodes = {
  sc: "zho_Hans",
  tc: "zho_Hant",
  jp: "jpn_Jpan"
} as const satisfies Record<Variant, string>;
const expectedFonts = {
  sc: "Noto Sans CJK SC",
  tc: "Noto Sans CJK TC",
  jp: "Noto Sans CJK JP"
} as const satisfies Record<Variant, string>;
const pagesPerVariant = 40;
const sentenceCounts = [1, 3, 10] as const;
const maxSentencesPerPage = Math.max(...sentenceCounts);

function readSentences(code: string): string[] {
  const path = resolve(sourceDir!, "devtest", `${code}.devtest`);
  const sentences = readFileSync(path, "utf8").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (sentences.length < pagesPerVariant * maxSentencesPerPage) {
    throw new Error(`Expected at least ${pagesPerVariant * maxSentencesPerPage} sentences in ${path}`);
  }
  return sentences;
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

async function statusFor(page: Page, worker: Worker): Promise<ContentStatus> {
  await page.bringToFront();
  return worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id == null) throw new Error("No active tab for corpus page");
    return chrome.tabs.sendMessage(tab.id, { type: "getStatus" });
  });
}

test.describe("@corpus FLORES-200 browser classification", () => {
  if (!sourceDir) {
    test("requires CJ_FLORES_DIR pointing to an extracted FLORES-200 dataset", () => {
      throw new Error("Set CJ_FLORES_DIR to the extracted flores200_dataset directory");
    });
    return;
  }

  const sentencesByVariant = Object.fromEntries(
    Object.entries(sourceCodes).map(([variant, code]) => [variant, readSentences(code)])
  ) as Record<Variant, string[]>;
  let context: BrowserContext;
  let worker: Worker;
  let profileDirectory: string;

  test.beforeAll(async () => {
    profileDirectory = await mkdtemp(join(tmpdir(), "cj-flores-sites-"));
    const extensionDirectory = resolve("dist");
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: "chromium",
      executablePath: process.env.CJ_TEST_CHROMIUM_EXECUTABLE,
      headless: true,
      args: [
        `--disable-extensions-except=${extensionDirectory}`,
        `--load-extension=${extensionDirectory}`
      ]
    });
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set({
        fontSC: "Noto Sans CJK SC",
        fontTC: "Noto Sans CJK TC",
        fontJP: "Noto Sans CJK JP",
        preserveWebFonts: false,
        preserveKnownCjk: false,
        simpleMode: false,
        dynamicDetection: false,
        mixedLanguageDetection: false,
        trustCjkLang: true,
        siteOverrides: {}
      });
    });
  });

  test.afterAll(async () => {
    await context?.close();
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true });
  });

  for (const [expected, sentences] of Object.entries(sentencesByVariant) as [Variant, string[]][]) {
    for (let index = 0; index < pagesPerVariant; index++) {
      const count = sentenceCounts[index % sentenceCounts.length]!;
      const start = Math.floor(index * (sentences.length - maxSentencesPerPage) / pagesPerVariant);
      const pageSentences = sentences.slice(start, start + count);
      const code = sourceCodes[expected];
      test(`${code} page ${String(index + 1).padStart(2, "0")} (${count} sentence${count === 1 ? "" : "s"}, ${index % 2 ? "en-US" : "no lang"})`, async () => {
        const page = await context.newPage();
        const url = `https://fixture.test/flores/${code}/${index}`;
        const lang = index % 2 ? ' lang="en-US"' : "";
        const paragraphs = pageSentences.map((sentence) => `<p>${escapeHtml(sentence)}</p>`).join("\n");
        try {
          await page.route(url, (route) => route.fulfill({
            status: 200,
            contentType: "text/html; charset=utf-8",
            body: `<!doctype html><html${lang}><head><title>Corpus page ${index + 1}</title>
              <style>body{font-family:Arial,sans-serif}main{max-width:70ch;margin:auto}</style>
              </head><body><header>Corpus evaluation</header><main>${paragraphs}</main></body></html>`
          }));
          await page.goto(url, { waitUntil: "domcontentloaded" });
          await expect.poll(async () => (await statusFor(page, worker)).reason, { timeout: 10_000 })
            .not.toBe("");
          const status = await statusFor(page, worker);
          expect(status.pageVariant, `${code} devtest lines ${start + 1}-${start + count}: ${status.reason}`)
            .toBe(expected);
          expect(status.changedElements).toBeGreaterThan(0);
          expect(status.fallbackChoice).toContain(expectedFonts[expected]);
          const family = await page.locator("main p").first().evaluate((element) =>
            getComputedStyle(element).fontFamily
          );
          expect(family).toContain(expectedFonts[expected]);
        } finally {
          await page.close();
        }
      });
    }
  }
});
