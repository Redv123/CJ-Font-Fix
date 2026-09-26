import { chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const requestedUrl = process.argv[2];
if (process.argv.length !== 3 || !requestedUrl) {
  console.error("Usage: npm run inspect:flatpak -- https://example.com/page");
  process.exitCode = 2;
} else {
  let url;
  try {
    url = new URL(requestedUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("HTTP(S) URL required");
  } catch {
    console.error("Provide one complete HTTP(S) URL.");
    process.exitCode = 2;
  }

  if (url) {
    const profileDirectory = await mkdtemp(`${tmpdir()}/cj-font-inspect-`);
    let context;
    try {
      const extensionDirectory = resolve("dist");
      context = await chromium.launchPersistentContext(profileDirectory, {
        executablePath: resolve("scripts/flatpak-chromium.sh"),
        headless: false,
        args: [
          `--disable-extensions-except=${extensionDirectory}`,
          `--load-extension=${extensionDirectory}`
        ]
      });
      const page = context.pages()[0] ?? await context.newPage();
      try {
        await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 45_000 });
      } catch (error) {
        console.warn("Initial navigation did not complete; inspect the visible window:", error);
      }

      console.log("Inspect the visible Flatpak Chromium window. Complete any site verification there.");
      console.log("Resume in Playwright Inspector only after the intended page is visible; resuming is not a pass assertion.");
      await page.pause();

      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await page.bringToFront();
      let status;
      try {
        status = await worker.evaluate(async () => {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id == null) throw new Error("No active tab");
          return chrome.tabs.sendMessage(tab.id, { type: "getStatus" });
        });
      } catch {
        status = "No extension status available for this page";
      }
      console.log(JSON.stringify({ finalUrl: page.url(), status }, null, 2));
    } finally {
      await context?.close();
      await rm(profileDirectory, { recursive: true, force: true });
    }
  }
}
