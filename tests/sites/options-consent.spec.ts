import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext } from "@playwright/test";

let context: BrowserContext;
let profileDirectory: string;

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-options-consent-"));
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

test("requires explicit consent each time mixed-language detection is enabled", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ mixedLanguageDetection: false }));
  const page = await context.newPage();
  const storedValue = () => worker.evaluate(async () =>
    (await chrome.storage.sync.get("mixedLanguageDetection")).mixedLanguageDetection as boolean
  );
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    const checkbox = page.locator("#mixedLanguageDetection");
    const dialog = page.locator("#mixedLanguageConsent");
    await expect(checkbox).not.toBeChecked();

    await checkbox.click();
    await expect(dialog).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    expect(await storedValue()).toBe(false);
    const transition = await dialog.evaluate((element) => getComputedStyle(element).transitionProperty);
    expect(transition).toContain("opacity");
    expect(transition).toContain("overlay");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(dialog).toHaveCSS("transition-duration", "0s");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const enableButton = dialog.getByRole("button", { name: /enable anyway/i });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.mouse.move(0, 0);
      await expect(enableButton).toHaveCSS("background-color", "rgb(180, 35, 24)");
      await expect(enableButton).toHaveCSS("color", "rgb(255, 255, 255)");
      await enableButton.hover();
      await expect(enableButton).toHaveCSS("background-color", "rgb(146, 30, 21)");
    }

    await dialog.getByRole("button", { name: /cancel/i }).click();
    await expect(dialog).toBeHidden();
    await expect(checkbox).not.toBeChecked();
    expect(await storedValue()).toBe(false);

    await checkbox.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(checkbox).not.toBeChecked();
    expect(await storedValue()).toBe(false);

    await checkbox.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /enable anyway/i }).click();
    await expect(dialog).toBeHidden();
    await expect(checkbox).toBeChecked();
    await expect.poll(storedValue).toBe(true);

    await checkbox.uncheck();
    await expect(dialog).toBeHidden();
    await expect.poll(storedValue).toBe(false);

    await checkbox.click();
    await expect(dialog).toBeVisible();
    await expect(checkbox).not.toBeChecked();
    expect(await storedValue()).toBe(false);
  } finally {
    await page.close();
  }
});
