import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

let context: BrowserContext;
let profileDirectory: string;

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-options-layout-"));
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

test("lays out font choices as responsive rows without cards", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));

    for (const width of [1100, 850, 700, 480]) {
      await page.setViewportSize({ width, height: 850 });
      if (width === 1100) {
        await page.screenshot({ path: test.info().outputPath("font-choices.png"), fullPage: true });
      }
      const layout = await page.evaluate(() => ({
        cards: Array.from(document.querySelectorAll(".font-choice"), (card) => {
          const heading = card.querySelector("h3");
          const labels = Array.from(card.querySelectorAll(".font-choice-field label"));
          const fields = Array.from(card.querySelectorAll(".font-choice-field"));
          const [sans, serif] = labels;
          const [firstField, secondField] = fields;
          return {
            labels: labels.map((label) => label.textContent?.trim()),
            sameLabelColor: Boolean(sans && serif &&
              getComputedStyle(sans).color === getComputedStyle(serif).color),
            hasCardBorder: getComputedStyle(card).borderLeftWidth !== "0px",
            headingLeftOfFields: Boolean(heading && firstField &&
              heading.getBoundingClientRect().right <= firstField.getBoundingClientRect().left),
            headingAboveFields: Boolean(heading && sans &&
              heading.getBoundingClientRect().bottom <= sans.getBoundingClientRect().top),
            fieldsSideBySide: Boolean(sans && serif &&
              Math.abs(sans.getBoundingClientRect().top - serif.getBoundingClientRect().top) < 6),
            fieldsStacked: Boolean(firstField && secondField &&
              firstField.getBoundingClientRect().bottom <= secondField.getBoundingClientRect().top)
          };
        }),
        helpWidth: document.getElementById("defaultChineseHelp")?.getBoundingClientRect().width ?? 0,
        selectWidth: document.getElementById("defaultChinese")?.getBoundingClientRect().width ?? 0,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth
      }));
      expect(layout.cards).toHaveLength(3);
      for (const card of layout.cards) {
        expect(card.labels).toEqual(["Sans", "Serif"]);
        expect(card.sameLabelColor).toBe(true);
        expect(card.hasCardBorder).toBe(false);
        if (width > 820) expect(card.headingLeftOfFields).toBe(true);
        else expect(card.headingAboveFields).toBe(true);
        if (width > 520) expect(card.fieldsSideBySide).toBe(true);
        else expect(card.fieldsStacked).toBe(true);
      }
      expect(layout.hasHorizontalOverflow).toBe(false);
      if (width === 1100) expect(layout.helpWidth).toBeGreaterThan(layout.selectWidth);
    }
  } finally {
    await page.close();
  }
});
