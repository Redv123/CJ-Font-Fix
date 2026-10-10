import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";

let context: BrowserContext;
let profileDirectory: string;

test.beforeAll(async () => {
  profileDirectory = await mkdtemp(join(tmpdir(), "cj-font-site-settings-"));
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

async function addRule(page: Page, hostname: string, scope: "hostname" | "domain", language: "sc" | "tc" | "jp" | "off"): Promise<void> {
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("form", { name: "Add website", exact: true });
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill(hostname);
  await dialog.getByRole("combobox", { name: "Apply to", exact: true }).selectOption(scope);
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption(language);
  await dialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function removeRule(page: Page, hostname: string): Promise<void> {
  const remove = page.getByRole("button", { name: `Delete website setting: ${hostname}`, exact: true });
  await remove.click();
  await expect(remove).toHaveCount(0);
}

test("collapses only the deleted language group and keeps another group's draft mounted", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "bbs.example.com": "sc", "google.com": "sc", "channel.example.jp": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: google.com", exact: true }).click();
    const input = page.getByRole("form", { name: "Edit website: google.com", exact: true }).getByRole("textbox", { name: "Website", exact: true });
    await input.fill("draft.google.com");
    await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(3, 3));
    const result = await page.getByRole("button", { name: "Delete website setting: channel.example.jp", exact: true }).evaluate(async (button) => {
      const chinese = document.querySelector('details[aria-label="Simplified Chinese rules"]')!;
      const japanese = button.closest("details")!;
      const reading = chinese.querySelector<HTMLInputElement>("input")!;
      const unchangedRow = chinese.querySelector("li")!;
      await Promise.allSettled(Array.from(document.getAnimations()).map((animation) => animation.finished));
      let replacements = 0;
      const observer = new MutationObserver((changes) => {
        replacements += changes.filter((change) => change.addedNodes.length > 0 && change.removedNodes.length > 0).length;
      });
      observer.observe(document.getElementById("siteOverrideList")!, { childList: true });
      (button as HTMLButtonElement).click();
      const frames: { opacity: number; japaneseHeight: number }[] = [];
      const deadline = performance.now() + 2000;
      do {
        await new Promise(requestAnimationFrame);
        frames.push({ opacity: Number(getComputedStyle(document.getElementById("siteRulesResults")!).opacity),
          japaneseHeight: japanese.isConnected ? japanese.getBoundingClientRect().height : 0 });
      } while ((japanese.isConnected || (document.getElementById("clearSiteOverrides") as HTMLButtonElement).disabled) && performance.now() < deadline);
      observer.disconnect();
      return { frames, replacements,
        sameGroup: document.querySelector('details[aria-label="Simplified Chinese rules"]') === chinese,
        sameRow: chinese.querySelector("li") === unchangedRow,
        sameInput: document.querySelector('form[aria-label="Edit website: google.com"] input') === reading,
        focused: document.activeElement === reading, value: reading.value, caret: reading.selectionStart };
    });
    expect(result.sameGroup, JSON.stringify({ replacements: result.replacements,
      minimumOpacity: Math.min(...result.frames.map((frame) => frame.opacity)), focused: result.focused })).toBe(true);
    expect(result.sameRow).toBe(true);
    expect(result.sameInput).toBe(true);
    expect(result.value).toBe("draft.google.com");
    expect(result.caret).toBe(3);
    expect(result.focused).toBe(true);
    expect(result.frames.every((frame) => frame.opacity === 1)).toBe(true);
    expect(new Set(result.frames.map((frame) => Math.round(frame.japaneseHeight))).size).toBeGreaterThan(3);
  } finally { await page.close(); }
});

test("inserts a Japanese rule without detaching another language group's rows", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "bbs.example.com": "sc", "google.com": "sc", "existing.example.jp": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: google.com", exact: true }).click();
    await page.getByRole("form", { name: "Edit website: google.com", exact: true }).getByRole("textbox", { name: "Website", exact: true }).fill("draft.google.com");
    const chinese = await page.getByRole("group", { name: "Simplified Chinese rules", exact: true }).evaluateHandle((group) => {
      let detachments = 0;
      const observer = new MutationObserver((changes) => {
        for (const change of changes) for (const removed of change.removedNodes) {
          if (removed === group || removed.contains(group)) detachments++;
        }
      });
      observer.observe(document.getElementById("siteOverrideList")!, { childList: true });
      return { group, row: group.querySelector("li"), input: group.querySelector<HTMLInputElement>("input")!, observer, detachments: () => detachments };
    });
    await addRule(page, "added.example.jp", "hostname", "jp");
    const result = await chinese.evaluate((saved) => {
      saved.observer.disconnect();
      return { connected: saved.group.isConnected, sameGroup: document.querySelector('details[aria-label="Simplified Chinese rules"]') === saved.group,
        sameRow: saved.group.querySelector("li") === saved.row, sameInput: saved.group.querySelector("input") === saved.input,
        value: saved.input.value, detachments: saved.detachments() };
    });
    expect(result).toEqual({ connected: true, sameGroup: true, sameRow: true, sameInput: true, value: "draft.google.com", detachments: 0 });
    await chinese.dispose();
    await expect(page.getByRole("group", { name: "Japanese rules", exact: true }).locator("summary .count")).toHaveText("2 rules");
  } finally { await page.close(); }
});

test("shrinks only a deleted row and keeps the next row's draft and its group", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "a.example.jp": "jp", "b.example.jp": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: b.example.jp", exact: true }).click();
    const result = await page.getByRole("button", { name: "Delete website setting: a.example.jp", exact: true }).evaluate(async (button) => {
      const group = button.closest("details")!;
      const disappearing = button.closest("li")!;
      const input = group.querySelector<HTMLInputElement>("input")!;
      input.focus(); input.setSelectionRange(2, 2);
      (button as HTMLButtonElement).click();
      const heights: number[] = [];
      const deadline = performance.now() + 2000;
      do { await new Promise(requestAnimationFrame); heights.push(disappearing.getBoundingClientRect().height); }
      while ((disappearing.isConnected || (document.getElementById("clearSiteOverrides") as HTMLButtonElement).disabled) && performance.now() < deadline);
      return { sameGroup: document.querySelector('details[aria-label="Japanese rules"]') === group,
        sameInput: group.querySelector("input") === input, focused: document.activeElement === input, caret: input.selectionStart, heights };
    });
    expect(result.sameGroup).toBe(true);
    expect(result.sameInput).toBe(true);
    expect(result.focused).toBe(true);
    expect(result.caret).toBe(2);
    expect(new Set(result.heights.map(Math.round)).size).toBeGreaterThan(3);
    await expect(page.getByRole("group", { name: "Japanese rules", exact: true }).locator("summary .count")).toHaveText("1 rule");
  } finally { await page.close(); }
});

test("queues rapid delete clicks without dropping the second website", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "keep.example.com": "sc", "a.example.jp": "jp", "b.example.jp": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-label]"));
      buttons.find((button) => button.getAttribute("aria-label") === "Delete website setting: a.example.jp")!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      buttons.find((button) => button.getAttribute("aria-label") === "Delete website setting: b.example.jp")!.click();
    });
    await expect(page.getByRole("button", { name: "Delete website setting: a.example.jp", exact: true })).toHaveCount(0, { timeout: 1500 });
    await expect(page.getByRole("button", { name: "Delete website setting: b.example.jp", exact: true })).toHaveCount(0, { timeout: 1500 });
    await expect(page.getByRole("group", { name: "Japanese rules", exact: true })).toHaveCount(0);
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: { "keep.example.com": "sc" } });
  } finally { await page.close(); }
});

test("switches the toolbar to inline creation and keeps search available for an empty list", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    const search = page.locator("#siteRuleSearch");
    await expect(search).toBeVisible();
    await search.fill("example.com");
    expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"])))
      .toEqual({ siteOverrides: {}, siteDomainOverrides: {} });
    await page.getByRole("button", { name: "Add website", exact: true }).click();
    const form = page.getByRole("form", { name: "Add website", exact: true });
    await expect(form).toBeVisible({ timeout: 1000 });
    await expect(search).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Add website", exact: true })).toHaveCount(0);
    await expect(form.getByRole("textbox", { name: "Website", exact: true })).toBeFocused();
    const tops = await form.locator("input, select, button").evaluateAll((controls) =>
      controls.map((control) => Math.round(control.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    await form.getByRole("textbox", { name: "Website", exact: true }).fill("draft.example.net");
    await form.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
    await page.keyboard.press("Escape");
    await expect(form).toBeHidden();
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("example.com");
    await expect(page.getByRole("button", { name: "Add website", exact: true })).toBeFocused();
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: {} });
    await page.getByRole("button", { name: "Add website", exact: true }).click();
    await expect(form.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("");
    await form.getByRole("textbox", { name: "Website", exact: true }).fill("added.example.net");
    await form.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
    await form.getByRole("button", { name: "Add website", exact: true }).click();
    await expect(form).toBeHidden();
    await expect(search).toBeVisible();
    await expect(search).toHaveValue("");
    await expect(search).toHaveAttribute("placeholder", "Search websites");
    await expect(page.getByRole("button", { name: "Edit website: added.example.net", exact: true })).toBeVisible();
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides")))
      .toEqual({ siteOverrides: { "added.example.net": "tc" } });
  } finally { await page.close(); }
});

test("keeps a creation draft through Hide and updates and retries failed saves", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "one.example.com": "sc" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Add website", exact: true }).click();
    const form = page.getByRole("form", { name: "Add website", exact: true });
    await form.getByRole("textbox", { name: "Website", exact: true }).fill("www.added.example.net");
    await form.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("domain");
    await form.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
    await expect(form.locator('option[value=""]')).toHaveCount(0);
    await page.locator("#toggleSiteOverrides").click();
    await expect(form).toBeHidden();
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "one.example.com": "sc", "another.example.org": "tc" } }));
    await page.locator("#toggleSiteOverrides").click();
    await expect(form.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.added.example.net");
    await expect(form.getByRole("combobox", { name: "Apply to", exact: true })).toHaveValue("domain");
    await expect(form.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("jp");
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let fail = true;
      Object.defineProperty(chrome.runtime, "sendMessage", { value: async (request: { type: string }) => {
        if (request.type === "editSiteRule" && fail) { fail = false; return { ok: false, error: "Simulated creation failure" }; }
        return send(request);
      } });
    });
    await form.getByRole("button", { name: "Add website", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("Simulated creation failure");
    await expect(form.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.added.example.net");
    await expect(form.getByRole("button", { name: "Add website", exact: true })).toBeEnabled();
    for (const width of [1100, 820, 700, 400]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const scopeText = await form.getByRole("combobox", { name: "Apply to", exact: true }).evaluate((element) => {
          const select = element as HTMLSelectElement;
          const style = getComputedStyle(select);
          const context = document.createElement("canvas").getContext("2d")!;
          context.font = style.font;
          const widest = Math.max(...Array.from(select.options, (option) => context.measureText(option.text).width));
          return { widest, available: select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 24 };
        });
        expect(scopeText.available).toBeGreaterThanOrEqual(scopeText.widest);
        if (width >= 820) {
          const tops = await form.locator("input, select, button").evaluateAll((controls) =>
            controls.map((control) => Math.round(control.getBoundingClientRect().top)));
          expect(new Set(tops).size).toBe(1);
        }
      }
    }
    await form.getByRole("button", { name: "Add website", exact: true }).click();
    await expect(form).toBeHidden();
    await expect(page.getByRole("searchbox", { name: "Search websites", exact: true })).toBeVisible();
    expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"])))
      .toEqual({ siteOverrides: { "one.example.com": "sc", "another.example.org": "tc" }, siteDomainOverrides: { "example.net": "jp" } });
  } finally { await page.close(); }
});

test("uses the same row transition for Edit and Cancel", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: example.com", exact: true }).click();
    const editor = page.locator(".site-inline-editor");
    await editor.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("button", { name: "Edit website: example.com", exact: true }).click();
    const opening = await editor.evaluate(async (form) => {
      const animations = form.getAnimations();
      const motion = animations.map((animation) => ({ duration: animation.effect!.getTiming().duration,
        easing: animation.effect!.getTiming().easing,
        frames: (animation.effect as KeyframeEffect).getKeyframes().map((frame) => ({ opacity: frame.opacity, transform: frame.transform })) }));
      await Promise.allSettled(animations.map((animation) => animation.finished));
      return motion;
    });
    expect(opening.length).toBeGreaterThan(0);
    const closing = await editor.getByRole("button", { name: "Cancel", exact: true }).evaluate(async (button) => {
      (button as HTMLButtonElement).click();
      const deadline = performance.now() + 2000;
      let row: Element | null = null;
      do {
        await new Promise(requestAnimationFrame);
        row = document.querySelector(".site-rule-row");
      } while (!row && performance.now() < deadline);
      return row!.getAnimations().map((animation) => ({ duration: animation.effect!.getTiming().duration,
        easing: animation.effect!.getTiming().easing,
        frames: (animation.effect as KeyframeEffect).getKeyframes().map((frame) => ({ opacity: frame.opacity, transform: frame.transform })) }));
    });
    expect(closing).toEqual(opening);
  } finally { await page.close(); }
});

test("deletes individual websites with one click and keeps unrelated rules", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "one.example.com": "sc", "two.example.com": "jp", "three.example.com": "tc" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  let browserDialogs = 0;
  page.on("dialog", (dialog) => { browserDialogs++; void dialog.dismiss(); });
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    for (const hostname of ["one.example.com", "two.example.com"]) {
      const remove = page.getByRole("button", { name: `Delete website setting: ${hostname}`, exact: true });
      await remove.click();
      await expect(remove).toHaveCount(0, { timeout: 1000 });
      await expect(page.locator(".site-row-delete-confirm")).toHaveCount(0);
    }
    expect(browserDialogs).toBe(0);
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: { "three.example.com": "tc" } });
  } finally { await page.close(); }
});

test("animates cancel and gives its hover and keyboard focus visible contrast", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    const opener = page.getByRole("button", { name: "Edit website: example.com", exact: true });
    const editor = page.getByRole("form", { name: "Edit website: example.com", exact: true });
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await opener.click();
      const cancel = editor.getByRole("button", { name: "Cancel", exact: true });
      await page.mouse.move(0, 0);
      const resting = await cancel.evaluate((button) => {
        const style = getComputedStyle(button);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const drawing = canvas.getContext("2d")!;
        const luminance = (color: string) => {
          drawing.clearRect(0, 0, 1, 1); drawing.fillStyle = color; drawing.fillRect(0, 0, 1, 1);
          return Array.from(drawing.getImageData(0, 0, 1, 1).data).slice(0, 3).map((channel) => {
            const value = channel / 255;
            return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
          }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index]!, 0);
        };
        const border = luminance(style.borderTopColor), background = luminance(style.backgroundColor);
        return { background: style.backgroundColor, borderWidth: parseFloat(style.borderTopWidth),
          border: style.borderTopColor, contrast: (Math.max(border, background) + .05) / (Math.min(border, background) + .05) };
      });
      expect(resting.borderWidth).toBeGreaterThanOrEqual(1);
      expect(resting.border).not.toBe(resting.background);
      expect(resting.contrast).toBeGreaterThanOrEqual(3);
      await cancel.hover();
      await expect.poll(() => cancel.evaluate((button) => getComputedStyle(button).backgroundColor)).not.toBe(resting.background);
      await editor.getByRole("button", { name: "Save changes", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(cancel).toBeFocused();
      await expect(cancel).toHaveCSS("outline-style", "solid");
      await expect(cancel).not.toHaveCSS("outline-color", "rgba(0, 0, 0, 0)");
      for (const reducedMotion of ["no-preference", "reduce"] as const) {
        await page.emulateMedia({ reducedMotion });
        if (await editor.count() === 0) await opener.click();
        await editor.evaluate(async (form) => { await Promise.allSettled(form.getAnimations().map((animation) => animation.finished)); });
        const frames = await editor.getByRole("button", { name: "Cancel", exact: true }).evaluate(async (button) => {
          const form = button.closest("form")!;
          (button as HTMLButtonElement).click();
          const frames: { connected: boolean; opacity: number; animated: boolean }[] = [];
          const deadline = performance.now() + 2000;
          let row: Element | null;
          do {
            await new Promise(requestAnimationFrame);
            row = document.querySelector(".site-rule-row");
            const visible = row || form;
            frames.push({ connected: visible.isConnected, opacity: Number(getComputedStyle(visible).opacity), animated: visible.getAnimations().length > 0 });
          } while ((form.isConnected || row?.getAnimations().length) && performance.now() < deadline);
          return frames;
        });
        if (reducedMotion === "no-preference") expect(frames.some((frame) => frame.connected && frame.animated && frame.opacity > 0 && frame.opacity < 1)).toBe(true);
        else expect(frames.every((frame) => !frame.animated)).toBe(true);
        await expect(editor).toHaveCount(0);
        await expect(opener).toBeFocused();
      }
      await opener.click();
      await page.keyboard.press("Escape");
      await expect(editor).toHaveCount(0);
    }
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: { "example.com": "jp" } });
  } finally { await page.close(); }
});

test("edits only the clicked website row inline and saves or cancels its draft", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "google.com": "sc", "bangumi.tv": "sc", "ja.wikipedia.org": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByText("google.com", { exact: true }).click();
    await expect(page.locator(".site-inline-editor")).toHaveCount(0);
    await expect(page.locator("#siteRuleDialog")).toBeHidden();
    await page.getByRole("button", { name: "Edit website: google.com", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit website: google.com", exact: true });
    await expect(editor).toBeVisible();
    await expect(page.locator("#siteRuleDialog")).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit website: bangumi.tv", exact: true })).toBeVisible();
    const fields = await editor.locator("input, select, button").evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)));
    expect(new Set(fields).size).toBe(1);
    await editor.getByRole("textbox", { name: "Website", exact: true }).fill("draft.example.net");
    await editor.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({
      siteOverrides: { "google.com": "sc", "bangumi.tv": "sc", "ja.wikipedia.org": "jp" }
    });
    await expect(page.getByRole("button", { name: "Edit website: google.com", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await editor.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
    await expect(page.getByRole("group", { name: "Simplified Chinese rules", exact: true }).getByRole("form")).toBeVisible();
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Japanese rules", exact: true })
      .getByRole("button", { name: "Edit website: google.com", exact: true })).toBeFocused();
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({
      siteOverrides: { "google.com": "jp", "bangumi.tv": "sc", "ja.wikipedia.org": "jp" }
    });
  } finally { await page.close(); }
});

test("keeps an inline draft through search, Hide, unrelated updates, and a failed save", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "google.com": "sc" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: google.com", exact: true }).click();
    const editor = page.getByRole("form", { name: "Edit website: google.com", exact: true });
    await editor.getByRole("textbox", { name: "Website", exact: true }).fill("www.google.com");
    await editor.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("domain");
    await editor.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
    await page.locator("#toggleSiteOverrides").click();
    await expect(editor).toBeHidden();
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "google.com": "sc", "new.example.net": "jp" } }));
    await page.locator("#toggleSiteOverrides").click();
    await expect(editor.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.google.com");
    await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("missing");
    await expect(editor).toHaveCount(0);
    await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("");
    await expect(editor.getByRole("combobox", { name: "Apply to", exact: true })).toHaveValue("domain");
    await expect(editor.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("tc");
    await page.evaluate(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let fail = true;
      Object.defineProperty(chrome.runtime, "sendMessage", { value: async (request: { type: string }) => {
        if (request.type === "editSiteRule" && fail) { fail = false; return { ok: false, error: "Simulated save failure" }; }
        return send(request);
      } });
    });
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("Simulated save failure");
    await expect(editor.getByRole("button", { name: "Save changes", exact: true })).toBeEnabled();
    await expect(editor.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.google.com");
    await editor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]))).toEqual({
      siteOverrides: { "new.example.net": "jp" }, siteDomainOverrides: { "google.com": "tc" }
    });
    await expect(page.getByRole("button", { name: "Edit website: new.example.net", exact: true })).toBeVisible();
    for (const width of [1100, 820, 700, 400]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        await page.getByRole("button", { name: "Edit website: google.com", exact: true }).click();
        await expect(editor).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (width >= 820) {
          const tops = await editor.locator("input, select, button").evaluateAll((fields) =>
            fields.map((field) => Math.round(field.getBoundingClientRect().top)));
          expect(new Set(tops).size).toBe(1);
        }
        await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      }
    }
  } finally { await page.close(); }
});

test("keeps another draft editable when a concurrent deletion arrives during a save", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "a.example.com": "sc", "b.example.com": "sc" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    await page.getByRole("button", { name: "Edit website: a.example.com", exact: true }).click();
    const first = page.getByRole("form", { name: "Edit website: a.example.com", exact: true });
    await first.getByRole("textbox", { name: "Website", exact: true }).fill("draft.example.net");
    await page.getByRole("button", { name: "Edit website: b.example.com", exact: true }).click();
    const second = page.getByRole("form", { name: "Edit website: b.example.com", exact: true });
    await second.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
    await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "b.example.com": "sc", "new.example.net": "tc" } }));
    await second.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(second).toHaveCount(0);
    await expect(first.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("draft.example.net");
    await first.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(first).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit website: a.example.com", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit website: new.example.net", exact: true })).toBeVisible();
    expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({
      siteOverrides: { "b.example.com": "jp", "new.example.net": "tc" }
    });
  } finally { await page.close(); }
});

test("applies Settings domain choices and popup hostname exceptions", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {}, trustCjkLang: true }));
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await expect(options.locator(".section-heading .count")).toHaveCount(0);
  await options.locator("#toggleSiteOverrides").click();
  await addRule(options, "example.co.uk", "domain", "jp");
  const site = await context.newPage();
  await site.route("https://m.example.co.uk/**", (route) => route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><body><p>这是中文内容。</p></body></html>' }));
  await site.goto("https://m.example.co.uk/");
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await popup.locator("#override").selectOption("tc");
  await expect(popup.locator("#detected")).toHaveText("Traditional Chinese");
  await popup.locator("#override").selectOption("auto");
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
  await removeRule(options, "m.example.co.uk");
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await removeRule(options, "example.co.uk");
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
});

test("removes the default site record when a popup choice returns to Auto", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "tieba.example.com": "jp" },
    siteDomainOverrides: {}, simpleMode: false, trustCjkLang: true }));
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await options.locator("#toggleSiteOverrides").click();
  await expect(options.getByRole("button", { name: "Edit website: tieba.example.com", exact: true })).toBeVisible();
  const site = await context.newPage();
  await site.route("https://tieba.example.com/**", (route) => route.fulfill({ contentType: "text/html; charset=utf-8",
    body: '<html lang="zh-CN"><body><p>这是中文内容。</p></body></html>' }));
  await site.goto("https://tieba.example.com/");
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#detected")).toHaveText("Japanese");
  await popup.locator("#override").selectOption("auto");
  await expect(popup.locator("#detected")).toHaveText("Simplified Chinese");
  await expect(options.locator(".site-rule-group")).toHaveCount(0);
  await expect(options.locator(".section-heading .count")).toHaveCount(0);
  await expect(options.getByRole("button", { name: "Edit website: tieba.example.com", exact: true })).toHaveCount(0);
  await expect(options.getByText("Automatic detection", { exact: true })).toHaveCount(0);
  expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: {} });
});

test("omits old automatic defaults and cleans them before adding a domain rule", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "old.example.com": "auto", localhost: "auto", "127.0.0.1": "auto", "[::1]": "auto", "chosen.example.com": "tc" }, siteDomainOverrides: {}
  }));
  const options = await context.newPage();
  await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await options.locator("#toggleSiteOverrides").click();
  await expect(options.locator(".site-rule-group summary .count")).toHaveText(["1 rule"]);
  await expect(options.getByRole("button", { name: "Edit website: old.example.com", exact: true })).toHaveCount(0);
  await expect(options.getByText("Automatic detection", { exact: true })).toHaveCount(0);
  await addRule(options, "example.com", "domain", "jp");
  expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]))).toEqual({
    siteOverrides: { "chosen.example.com": "tc" }, siteDomainOverrides: { "example.com": "jp" }
  });
  await expect(options.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule"]);
  // An automatic exception becomes redundant when its domain rule is removed.
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "old.example.com": "auto", "chosen.example.com": "tc" }
  }));
  await expect(options.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule", "1 rule"]);
  await removeRule(options, "example.com");
  await expect(options.locator(".site-rule-group summary .count")).toHaveText(["1 rule"]);
  expect(await worker.evaluate(() => chrome.storage.sync.get("siteOverrides"))).toEqual({ siteOverrides: { "chosen.example.com": "tc" } });
});

test("keeps legacy choices and separates hosted domains in the Settings editor", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "legacy.example.com": "tc" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await expect(page.getByRole("button", { name: "Edit website: legacy.example.com", exact: true })).toBeVisible();
  await addRule(page, "https://www.alice.github.io/path", "domain", "jp");
  await expect(page.getByRole("button", { name: "Edit website: alice.github.io", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const dialog = page.getByRole("form", { name: "Add website", exact: true });
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("localhost");
  await dialog.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("domain");
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
  await dialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("cannot include subdomains");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator("#resetSettings").click();
  await expect(page.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule"]);
  await page.setViewportSize({ width: 400, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator("#clearSiteOverrides").click();
  await expect(page.locator(".site-rule-group")).toHaveCount(0);
});

test("deletes both scopes without a browser dialog and undoes while keeping newer choices", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "one.example.com": "sc", "automatic.example.com": "auto" },
    siteDomainOverrides: { "example.com": "jp" },
    fontSC: "", defaultChinese: "tc"
  }));
  const page = await context.newPage();
  const other = await context.newPage();
  let browserDialogs = 0;
  page.on("dialog", (prompt) => { browserDialogs++; void prompt.dismiss(); });
  for (const options of [page, other]) {
    await options.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await options.locator("#toggleSiteOverrides").click();
  }
  await expect(page.locator("#siteDeleteNotice")).toBeHidden();
  await page.locator("#clearSiteOverrides").click();
  await expect(page.locator(".site-rule-group")).toHaveCount(0);
  expect(browserDialogs).toBe(0);
  await expect(page.locator("#siteDeleteMessage")).toHaveText("Site settings deleted.");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeFocused();
  await expect(page.locator("#clearSiteOverrides")).toBeDisabled();
  expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides", "fontSC", "defaultChinese"])))
    .toEqual({ siteOverrides: {}, siteDomainOverrides: {}, fontSC: "", defaultChinese: "tc" });

  await page.locator("#toggleSiteOverrides").click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
  await page.locator("#toggleSiteOverrides").click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let failUndo = true;
    Object.defineProperty(chrome.runtime, "sendMessage", { value: async (request: { type: string }) => {
      if (request.type === "restoreSiteRules" && failUndo) {
        failUndo = false;
        return { ok: false, error: "Simulated storage write failure" };
      }
      return send(request);
    } });
  });
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#siteOverrideStatus")).toContainText("Simulated storage write failure");
  await expect(page.locator("#siteDeleteNotice")).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]))).toEqual({
    siteOverrides: { "one.example.com": "sc", "automatic.example.com": "auto" },
    siteDomainOverrides: { "example.com": "jp" }
  });
  await page.locator("#clearSiteOverrides").click();
  await expect(page.locator(".site-rule-group")).toHaveCount(0);
  await addRule(other, "new.example.net", "hostname", "off");
  await addRule(other, "one.example.com", "hostname", "tc");
  await addRule(other, "example.com", "domain", "tc");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator("#siteDeleteNotice")).toBeHidden();
  await expect(page.locator("#clearSiteOverrides")).toBeFocused();
  const restored = await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides", "fontSC", "defaultChinese"]));
  expect(restored).toEqual({
    siteOverrides: { "one.example.com": "tc", "automatic.example.com": "auto", "new.example.net": "off" },
    siteDomainOverrides: { "example.com": "tc" }, fontSC: "", defaultChinese: "tc"
  });
  await page.locator("#clearSiteOverrides").click();
  await expect(page.locator(".site-rule-group")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await worker.evaluate(() => chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides", "fontSC", "defaultChinese"]))).toEqual(restored);
  await page.close();
  await other.close();
});

test("preserves unrelated edits from two Settings pages and rejects rename collisions", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} }));
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
  }
  await Promise.all([addRule(pages[0]!, "first.example.com", "hostname", "sc"), addRule(pages[1]!, "second.example.com", "hostname", "jp")]);
  const page = pages[0]!;
  await expect(page.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule"]);
  await page.getByRole("button", { name: "Edit website: first.example.com", exact: true }).click();
  const dialog = page.locator(".site-inline-editor");
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("second.example.com");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: first.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: second.example.com", exact: true })).toBeVisible();
});

test("animates deletion and undo locally while respecting reduced motion and Hide", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "sc.example.com": "sc", "jp.example.com": "jp", "tc.example.com": "tc" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  try {
    await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
    await page.locator("#toggleSiteOverrides").click();
    const sampleAction = (id: string) => page.evaluate(async (buttonId) => {
      const results = document.getElementById("siteRulesResults")!;
      (document.getElementById(buttonId) as HTMLButtonElement).click();
      const frames: { height: number; opacity: number; animations: number }[] = [];
      const deadline = performance.now() + 4000;
      do {
        await new Promise(requestAnimationFrame);
        frames.push({ height: Math.round(results.getBoundingClientRect().height),
          opacity: Number(getComputedStyle(results).opacity), animations: results.getAnimations().length });
        const finished = buttonId === "clearSiteOverrides"
          ? !document.getElementById("siteDeleteNotice")!.hidden && !(document.getElementById("undoSiteOverrides") as HTMLButtonElement).disabled
          : document.getElementById("siteDeleteNotice")!.hidden && !(document.getElementById("clearSiteOverrides") as HTMLButtonElement).disabled;
        if (finished && !results.inert) break;
      } while (performance.now() < deadline);
      return frames;
    }, id);
    for (const action of ["clearSiteOverrides", "undoSiteOverrides"]) {
      const frames = await sampleAction(action);
      expect(frames.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
      expect(new Set(frames.map((frame) => frame.height)).size).toBeGreaterThan(3);
      expect(frames.at(-1)?.animations).toBe(0);
      await expect(page.locator("#siteRulesResults")).toHaveJSProperty("inert", false);
      await expect(page.locator("#siteRulesResults")).toHaveCSS("overflow", "visible");
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const action of ["clearSiteOverrides", "undoSiteOverrides"]) {
      const frames = await sampleAction(action);
      expect(frames.every((frame) => frame.animations === 0 && frame.opacity === 1)).toBe(true);
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("#clearSiteOverrides").click();
    await expect.poll(() => page.locator("#siteRulesResults").evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);
    await page.locator("#toggleSiteOverrides").click();
    await expect(page.locator("#siteOverridesPanel")).toBeHidden();
    await expect(page.locator("#toggleSiteOverrides")).toBeFocused();
    await page.locator("#toggleSiteOverrides").click();
    await expect(page.locator("#undoSiteOverrides")).toBeEnabled();
    await page.locator("#undoSiteOverrides").click();
    await expect(page.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule", "1 rule"]);
  } finally { await page.close(); }
});

test("shows intervention details only while correction is active", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    simpleMode: false, dynamicDetection: true, trustCjkLang: false,
    fontSC: "CJ Test Sans", preserveWebsiteFonts: false,
    siteOverrides: { "example.net": "sc" }, siteDomainOverrides: {}
  }));
  const site = await context.newPage();
  await site.route("https://example.net/**", (route) => route.fulfill({
    contentType: "text/html", body: '<html lang="en"><body><p id="reading">English reading text.</p></body></html>'
  }));
  await site.goto("https://example.net/");
  const popup = await context.newPage();
  await popup.goto(await worker.evaluate(() => chrome.runtime.getURL("popup.html")));
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#site")).toHaveText("example.net");
  await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-inactive-128\.png$/);
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeHidden();
  }
  await site.locator("#reading").evaluate((element) => { element.textContent = "这是用于验证字体修正的中文段落。"; });
  await expect.poll(() => site.locator("#reading").evaluate((element) => getComputedStyle(element).fontFamily)).toContain("CJ Test Sans");
  await popup.reload();
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeVisible();
  }
  await expect(popup.locator("#font")).toHaveText("CJ Test Sans");
  await expect(popup.locator("#changed")).toHaveText("1");
  await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-active-128\.png$/);
  await popup.locator("#override").selectOption("off");
  for (const id of ["fontRow", "interventionRow", "managedRow"]) {
    await expect(popup.locator(`#${id}`)).toBeHidden();
  }
  await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-inactive-128\.png$/);
  await worker.evaluate(() => chrome.storage.sync.set({ simpleMode: true }));
  await popup.locator("#override").selectOption("sc");
  await expect(popup.locator("#interventionRow")).toBeVisible();
  await expect(popup.locator("#interventionLabel")).toHaveText("Applied lang");
  await expect(popup.locator("#fontRow")).toBeHidden();
  await expect(popup.locator("#managedRow")).toBeHidden();
  await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-active-128\.png$/);
  await site.goto("chrome://version/");
  await site.bringToFront();
  await popup.reload();
  await expect(popup.locator("#unavailableState")).toBeVisible();
  await expect(popup.locator("#pageIcon")).toHaveAttribute("src", /icon-inactive-128\.png$/);
});

test("edits a saved hostname into a domain rule and preserves the Hide switch", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "www.example.co.uk": "jp" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true }).click();
  const dialog = page.locator(".site-inline-editor");
  await expect(dialog.getByRole("textbox", { name: "Website", exact: true })).toHaveValue("www.example.co.uk");
  await dialog.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("domain");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hide site language settings", exact: true }).click();
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit website: example.co.uk", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Website", exact: true }).fill("www.example.co.uk");
  await dialog.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("hostname");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: www.example.co.uk", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: example.co.uk", exact: true })).toHaveCount(0);
});

test("searches all 100 rules and paginates within a language group", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    const rules: Record<string, string> = {};
    for (let n = 1; n <= 100; n++) {
      rules[`site${String(n).padStart(3, "0")}.example.com`] = n <= 42 ? "sc" : n <= 77 ? "jp" : n <= 95 ? "tc" : "off";
    }
    await chrome.storage.sync.set({ siteOverrides: rules, siteDomainOverrides: {} });
  });
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.getByRole("button", { name: "Manage site language settings", exact: true }).click();
  await expect(page.locator(".section-heading .count")).toHaveCount(0);
  await expect(page.locator(".site-rule-group summary .count")).toHaveText(["42 rules", "35 rules", "18 rules", "5 rules"]);
  const japanese = page.getByRole("group", { name: "Japanese rules", exact: true });
  await japanese.locator("summary").click();
  await expect(japanese.getByRole("button", { name: /^Edit website:/ })).toHaveCount(10);
  await japanese.getByRole("button", { name: "Next", exact: true }).click();
  await expect(japanese.getByRole("button", { name: "Edit website: site053.example.com", exact: true })).toBeVisible();
  await expect(japanese.getByRole("button", { name: "Edit website: site043.example.com", exact: true })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("site077");
  await expect(page.getByRole("button", { name: "Edit website: site077.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit website:/ })).toHaveCount(1);
  await expect(japanese.locator("summary .count")).toHaveText("1 / 35 rules");
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("missing.example");
  await expect(page.getByText("No matching websites.", { exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search websites", exact: true }).fill("");
  await expect(page.locator(".section-heading .count")).toHaveCount(0);
  await expect(page.locator(".site-rule-group summary .count")).toHaveText(["42 rules", "35 rules", "18 rules", "5 rules"]);
  await expect(japanese.getByRole("button", { name: /^Edit website:/ })).toHaveCount(10);
});

test("cancels drafts, redirects duplicate additions, and protects scope-move conflicts", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "www.example.com": "jp" }, siteDomainOverrides: { "example.com": "sc" }
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await page.getByRole("button", { name: "Edit website: www.example.com", exact: true }).click();
  const editDialog = page.locator(".site-inline-editor");
  await editDialog.getByRole("textbox", { name: "Website", exact: true }).fill("draft.example.net");
  await page.keyboard.press("Escape");
  await expect(editDialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit website: www.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: draft.example.net", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add website", exact: true }).click();
  const addDialog = page.getByRole("form", { name: "Add website", exact: true });
  await addDialog.getByRole("textbox", { name: "Website", exact: true }).fill("www.example.com");
  await addDialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("tc");
  await addDialog.getByRole("button", { name: "Add website", exact: true }).click();
  await expect(addDialog).toBeHidden();
  await expect(editDialog).toHaveCount(0, { timeout: 1000 });
  await expect(page.locator("#siteOverrideStatus")).toContainText("already has a rule");
  await page.getByRole("button", { name: "Edit website: www.example.com", exact: true }).click();
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole("combobox", { name: "Language", exact: true })).toHaveValue("jp");
  await editDialog.getByRole("combobox", { name: "Apply to", exact: true }).selectOption("domain");
  await editDialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(editDialog.getByRole("alert")).toContainText("already exists");
  await editDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Edit website: www.example.com", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit website: example.com", exact: true })).toBeVisible();
  await expect(page.locator(".site-rule-group summary .count")).toHaveText(["1 rule", "1 rule"]);
});

test("animates Manage and Hide while respecting reduced motion", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ siteOverrides: { "example.com": "jp" }, siteDomainOverrides: {} }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  const button = page.locator("#toggleSiteOverrides");
  const hasAnimation = () => button.evaluate((element) => {
    (element as HTMLButtonElement).click();
    return document.getElementById("siteOverridesPanel")!.getAnimations().some((animation) =>
      Number(animation.effect?.getComputedTiming().duration) > 0
    );
  });
  expect(await hasAnimation()).toBe(true);
  await expect(page.locator("#siteOverridesPanel")).toBeVisible();
  await expect(button).toHaveText("Hide site language settings");
  expect(await hasAnimation()).toBe(true);
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await hasAnimation()).toBe(false);
  await expect(page.locator("#siteOverridesPanel")).toBeVisible();
  await page.locator("#siteRuleSearch").focus();
  expect(await page.locator("#siteRuleSearch").evaluate((element) => {
    getComputedStyle(element).borderTopColor;
    return element.getAnimations().some((animation) => Number(animation.effect?.getComputedTiming().duration) > 0);
  })).toBe(false);
  expect(await hasAnimation()).toBe(false);
  await expect(page.locator("#siteOverridesPanel")).toBeHidden();
});

test("returns focus to the opener when canceling after another rule was saved", async () => {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({
    siteOverrides: { "a.example.com": "sc", "b.example.com": "sc" }, siteDomainOverrides: {}
  }));
  const page = await context.newPage();
  await page.goto(await worker.evaluate(() => chrome.runtime.getURL("options.html")));
  await page.locator("#toggleSiteOverrides").click();
  await page.getByRole("button", { name: "Edit website: b.example.com", exact: true }).click();
  const dialog = page.locator(".site-inline-editor");
  await dialog.getByRole("combobox", { name: "Language", exact: true }).selectOption("jp");
  await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(dialog).toBeHidden();
  const opener = page.getByRole("button", { name: "Edit website: a.example.com", exact: true });
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  const add = page.getByRole("button", { name: "Add website", exact: true });
  await add.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add website", exact: true })).toBeHidden();
  await expect(add).toBeFocused();
});
