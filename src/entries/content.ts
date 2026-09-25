import { FallbackController } from "../fallback/controller";
import { ManagedStyles } from "../fallback/managed-styles";
import { SimpleMode } from "../fallback/simple-mode";
import { FontSupport } from "../fonts/font-support";
import { SC_CLUES, TC_CLUES } from "../language/chinese-clues";
import { analyzeCjkEvidence } from "../language/local-evidence";
import type { CjkEvidence } from "../language/local-evidence";
import { classifyChinese as classifyChineseText } from "../language/tags";
import { PageLanguageDetector } from "../page/page-language";
import type { ExtendedDetection } from "../page/page-language";
import { PageObserver } from "../page/page-observer";
import { subtreeContainsCjk } from "../page/candidate-scan";
import { UpdateQueue } from "../page/update-queue";
import { DEFAULTS } from "../settings/defaults";
import type { ActionStateMessage, ContentMessage, Settings, Variant } from "../shared/types";

/**
 * Coordinates the content-script lifecycle.
 *
 * The application owns settings, run scheduling, page-level detection, and
 * extension messaging. DOM invalidation belongs to PageObserver; language,
 * font, and style policies remain in their respective feature modules.
 */
function startContentApplication(): void {
  "use strict";

  const updates = new UpdateQueue();
  const fontSupport = new FontSupport();
  const openShadowRoots = new Set<ShadowRoot>();
  const managedStyles = new ManagedStyles((root) => openShadowRoots.delete(root));
  const fontStackRules = managedStyles.rules;

  let settings: Settings = { ...DEFAULTS };
  let pageVariant: Variant | null = null;
  let detection: ExtendedDetection = { htmlLang: "", detectedLanguage: "", reliable: false, variant: null, reason: "" };
  let debounceTimer = 0;
  let lastRunAt = 0;
  let applying = false;
  let rerunRequested = false;
  let fontRefreshTimer = 0;
  const languageDetector = new PageLanguageDetector();
  const simpleMode = new SimpleMode(() => {
    requestFullScan(true);
    requestRunForQueuedWork();
  }, subtreeContainsCjk);

  function classifyChinese(text: string): "sc" | "tc" {
    return classifyChineseText(text, SC_CLUES, TC_CLUES, settings.defaultChinese);
  }

  function localEvidence(text: string): CjkEvidence {
    return analyzeCjkEvidence(text, SC_CLUES, TC_CLUES);
  }

  const fallbackController = new FallbackController(
    managedStyles,
    fontSupport,
    () => settings,
    classifyChinese,
    localEvidence
  );

  const pageObserver = new PageObserver({
    settings: () => settings,
    pageVariant: () => pageVariant,
    detection: () => detection,
    updates,
    languageDetector,
    fontSupport,
    managedStyles,
    simpleMode,
    openShadowRoots,
    requestRun: requestRunForQueuedWork
  });

  function requestFullScan(redetect = false) {
    updates.requestFullScan(redetect);
  }

  function pageIsDormant(): boolean {
    return !pageVariant && detection.reason === "No CJK text";
  }

  // Simple mode and advanced fallback are mutually exclusive application
  // strategies. Switching modes first removes state owned by the other one.
  function applyFallbacks(fullScan: boolean, roots: HTMLElement[], elements: HTMLElement[]) {
    if (settings.simpleMode) {
      fallbackController.restoreMixedLanguage();
      managedStyles.restoreAll();
      fontStackRules.prune();
      if (detection.reason === "Disabled for this site" || !pageVariant) {
        simpleMode.restore();
      } else {
        simpleMode.apply(pageVariant);
      }
      return { count: 0, variants: [], fonts: [] };
    }
    return fallbackController.apply({ pageVariant, detection, fullScan, roots, elements });
  }

  // One run consumes a snapshot of queued work. At most one immediate second
  // pass is allowed; anything arriving later is scheduled through the throttle.
  async function run() {
    if (applying) {
      rerunRequested = true;
      return;
    }
    applying = true;
    let scheduleAgain = false;
    try {
      let passes = 0;
      do {
        rerunRequested = false;
        const update = updates.consume();
        let fullScan = update.fullScan;
        const redetect = update.redetectLanguage;
        const { roots, elements } = update;

        if (!settings.simpleMode) simpleMode.restore();
        const oldVariant = pageVariant;
        if (redetect) {
          const result = await languageDetector.detect(
            settings,
            classifyChinese,
            simpleMode.originalLangValue
          );
          pageVariant = result.variant;
          detection = result.detection;
        }
        if (oldVariant !== pageVariant) fullScan = true;
        const result = applyFallbacks(fullScan, roots, elements);
        if (settings.simpleMode && pageVariant) simpleMode.stopBootstrap();
        if (oldVariant !== pageVariant) {
          document.dispatchEvent(new CustomEvent("cjk-font-fallback-updated"));
        }
        detection.changedElements = result.count;
        detection.appliedVariants = result.variants;
        detection.appliedFonts = result.fonts;
        passes++;
      } while ((rerunRequested || updates.hasWork) && passes < 2);
      const inUse = settings.simpleMode
        ? Boolean(simpleMode.appliedLang)
        : (detection.changedElements || 0) > 0;
      reportActionState(inUse);
      scheduleAgain = rerunRequested || updates.hasWork;
    } finally {
      lastRunAt = Date.now();
      applying = false;
      if (scheduleAgain) {
        rerunRequested = false;
        scheduleRun(0);
      }
    }
  }

  function scheduleRun(delay = 60) {
    if (debounceTimer) return;
    const remainingCooldown = Math.max(0, 220 - (Date.now() - lastRunAt));
    debounceTimer = setTimeout(async () => {
      debounceTimer = 0;
      await run();
    }, Math.max(delay, remainingCooldown));
  }


  // Callers do not run recursively while styles are being applied. They mark a
  // follow-up pass instead, preserving the read-then-write batching invariant.
  function requestRunForQueuedWork() {
    if (applying) rerunRequested = true;
    else scheduleRun();
  }

  function reportActionState(inUse: boolean): void {
    if (window !== window.top) return;
    const message: ActionStateMessage = { type: "setActionState", inUse };
    try {
      void chrome.runtime.sendMessage(message).catch(() => undefined);
    } catch {
      // Reloading the extension invalidates content scripts already present
      // in open tabs before sendMessage can return a rejectable Promise.
    }
  }


  // Settings and messages are intentionally wired here: they change both the
  // observer lifecycle and the next language/style run.
  async function loadSettings() {
    settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    settings.siteOverrides = settings.siteOverrides || {};
  }

  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    // tabs.sendMessage without a frame ID can reach every injected frame. Only
    // the top frame should represent the page in the popup or own site overrides.
    if (window !== window.top) return false;
    if (message?.type === "getStatus") {
      const appliedFonts = detection.appliedFonts || [];
      sendResponse({
        ...detection,
        htmlLang: document.documentElement?.lang || "",
        pageVariant,
        detectedVariants: pageVariant
          ? Array.from(new Set([pageVariant, ...fallbackController.detectedLocalVariants]))
          : [],
        hostname: location.hostname,
        siteOverride: settings.siteOverrides?.[location.hostname] || "auto",
        fallbackChoice: !settings.simpleMode ? appliedFonts.join(", ") : "",
        simpleMode: Boolean(settings.simpleMode),
        simpleLang: simpleMode.appliedLang
      });
      return false;
    }
    if (message?.type === "setSiteOverride") {
      (async () => {
        const siteOverrides = { ...settings.siteOverrides };
        if (message.value === "auto") delete siteOverrides[location.hostname];
        else siteOverrides[location.hostname] = message.value;
        settings.siteOverrides = siteOverrides;
        await chrome.storage.sync.set({ siteOverrides });
        pageObserver.configure();
        requestFullScan(true);
        await run();
        sendResponse({ ok: true });
      })();
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    if (Object.keys(changes).length === 1 && changes.siteOverrides &&
        JSON.stringify(changes.siteOverrides.newValue || {}) === JSON.stringify(settings.siteOverrides || {})) {
      return;
    }
    for (const [key, change] of Object.entries(changes)) {
      if (!(key in DEFAULTS)) continue;
      const settingKey = key as keyof Settings;
      const value = change.newValue === undefined ? DEFAULTS[settingKey] : change.newValue;
      (settings as unknown as Record<string, unknown>)[key] = value;
    }
    settings.siteOverrides = settings.siteOverrides || {};
    fontSupport.clearAvailability();
    pageObserver.configure();
    requestFullScan(true);
    await run();
  });

  // An SPA can restore already-existing content on Back without changing any
  // text nodes observed by PageObserver. History traversal is therefore a
  // separate reason to reconsider the page sample and its applied styles.
  window.addEventListener("popstate", () => {
    if (settings.simpleMode || !settings.dynamicDetection) return;
    requestFullScan(true);
    requestRunForQueuedWork();
  });

  (async () => {
    await loadSettings();
    pageObserver.configure();
    await run();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        pageObserver.configure();
        requestFullScan(true);
        scheduleRun(0);
      }, { once: true });
    }
    const fontsChanged = (event?: Event): void => {
      if (settings.simpleMode) return;
      const fontfaces = event && "fontfaces" in event
        ? (event as Event & { fontfaces: FontFace[] }).fontfaces
        : [];
      fontSupport.noteLoadedFaces(fontfaces);
      if (pageIsDormant()) return;
      if (fontRefreshTimer) clearTimeout(fontRefreshTimer);
      fontRefreshTimer = setTimeout(() => {
        fontRefreshTimer = 0;
        requestFullScan(false);
        scheduleRun(0);
      }, 120);
    };
    void document.fonts.ready.then(() => fontsChanged());
    document.fonts.addEventListener?.("loadingdone", fontsChanged);
  })();
}

startContentApplication();
