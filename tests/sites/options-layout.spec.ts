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

test("keeps action layout and readable secondary buttons across themes", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ simpleMode: false, siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.setViewportSize({ width: 1100, height: 1000 });
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await expect(page.locator("#resetSettings")).toBeEnabled();
    await page.locator("#toggleSiteOverrides").click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    let lightLayout: unknown;
    for (const colorScheme of ["light", "dark"] as const) {
      await page.mouse.move(0, 0);
      await page.emulateMedia({ colorScheme });
      const layout = await page.evaluate(() => {
        const header = document.querySelector(".section-heading")!.getBoundingClientRect();
        return ["toggleSiteOverrides", "openAddSite", "clearSiteOverrides", "resetSettings"].map((id) => {
          const element = document.getElementById(id)!;
          const rect = element.getBoundingClientRect();
          // Animated translations can introduce tiny DOMRect rounding differences.
          return { id, width: Math.round(rect.width * 100) / 100, height: Math.round(rect.height * 100) / 100,
            margin: getComputedStyle(element).marginTop,
            insideHeader: id !== "toggleSiteOverrides" || rect.width < header.width / 2 };
        });
      });
      if (colorScheme === "light") lightLayout = layout;
      else expect(layout).toEqual(lightLayout);
      expect(layout.every((item) => item.insideHeader && item.margin === "0px")).toBe(true);
      const contrast = await page.locator("#toggleSiteOverrides").evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
          return Array.from(context.getImageData(0, 0, 1, 1).data);
        };
        let background = [255, 255, 255];
        const ancestors: Element[] = [];
        for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
        for (const current of ancestors) {
          const value = rgba(getComputedStyle(current).backgroundColor);
          const alpha = value[3]! / 255;
          background = background.map((channel, index) => value[index]! * alpha + channel * (1 - alpha));
        }
        const luminance = (value: number[]) => value.slice(0, 3).map((channel) => {
          const normalized = channel / 255;
          return normalized <= .04045 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
        }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index]!, 0);
        const ratio = (color: string) => {
          const a = luminance(rgba(color)), b = luminance(background);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        };
        const style = getComputedStyle(element);
        return { text: ratio(style.color), border: ratio(style.borderTopColor) };
      });
      expect(contrast.text).toBeGreaterThanOrEqual(4.5);
      if (colorScheme === "dark") expect(contrast.border).toBeGreaterThanOrEqual(3);
    }
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await page.evaluate(() => ["toggleSiteOverrides", "openAddSite", "siteRuleSearch"].flatMap((id) =>
      document.getElementById(id)!.getAnimations().filter((animation) =>
        animation instanceof CSSTransition && ["color", "background-color"].includes(animation.transitionProperty)
      ).map((animation) => animation.id)
    ))).toEqual([]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const restingBackground = await page.locator("#toggleSiteOverrides").evaluate((element) => getComputedStyle(element).backgroundColor);
    await page.locator("#toggleSiteOverrides").hover();
    await expect.poll(() => page.locator("#toggleSiteOverrides").evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(restingBackground);
    await page.locator("#clearSiteOverrides").click();
    await expect(page.locator("#clearSiteOverrides")).toBeDisabled();
    const appearance = () => page.locator("#clearSiteOverrides").evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.borderTopColor, style.color, style.transform];
    });
    await page.mouse.move(0, 0);
    const disabledAppearance = await appearance();
    await page.locator("#clearSiteOverrides").hover();
    expect(await appearance()).toEqual(disabledAppearance);
    await page.locator("#siteRuleSearch").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.locator("#undoSiteOverrides")).toBeFocused();
    await expect(page.locator("#undoSiteOverrides")).toHaveCSS("outline-style", "solid");
    const popup = await context.newPage();
    try {
      await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
      const dimensions = await popup.locator("#settings").evaluate((element) => {
        const parent = element.parentElement!;
        const style = getComputedStyle(parent);
        return { width: element.getBoundingClientRect().width,
          available: parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
          margin: getComputedStyle(element).marginTop };
      });
      expect(dimensions.width).toBe(dimensions.available);
      expect(dimensions.margin).toBe("12px");
    } finally { await popup.close(); }
  } finally { await page.close(); }
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
