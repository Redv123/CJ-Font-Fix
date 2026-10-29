/**
 * Service-worker entry for per-tab icon state and install-time font defaults.
 * Only top-frame content messages can mark a tab active; the manifest supplies
 * the closed icon until a page reports actual intervention.
 */
import { getInstalledFonts, validChoice } from "../settings/font-catalog";
import { installedCjkFamilies } from "../fonts/font-support";
import { FONT_SETTINGS, LEGACY_PRESERVE_KEYS, preserveWebsiteFontsFromStorage } from "../settings/defaults";
import type { FontSettingKey } from "../settings/defaults";
import { isSiteChoice, normalizeHostname, sanitizeSiteOverrides, siteRulesFromStorage } from "../settings/site-overrides";
import type { SiteRuleEdit } from "../shared/types";
import type { ActionStateMessage, InstalledFont } from "../shared/types";

const ACTION_ICONS = {
  active: {
    16: "icons/icon-active-16.png",
    32: "icons/icon-active-32.png",
    48: "icons/icon-active-48.png",
    128: "icons/icon-active-128.png"
  },
  inactive: {
    16: "icons/icon-inactive-16.png",
    32: "icons/icon-inactive-32.png",
    48: "icons/icon-inactive-48.png",
    128: "icons/icon-inactive-128.png"
  }
} as const;

const tabStates = new Map<number, boolean>();
const FONT_FAMILIES_KEY = "installedCjkFamilies";
let fontListRequest: Promise<{ fonts: InstalledFont[]; families: string[] }> | null = null;
let fontFamiliesRequest: Promise<string[]> | null = null;

/** Installation also needs the full list for font-choice validation. */
function getRuntimeFonts(): Promise<{ fonts: InstalledFont[]; families: string[] }> {
  fontListRequest ??= (async () => {
    const fonts = await getInstalledFonts();
    const families = installedCjkFamilies(fonts);
    try {
      await chrome.storage.session.set({ [FONT_FAMILIES_KEY]: families });
    } catch (error) {
      console.warn("CJ Font Fallback Fix could not cache installed font names:", error);
    }
    return { fonts, families };
  })().finally(() => { fontListRequest = null; });
  return fontListRequest;
}

/** Session storage survives worker sleep and resets on browser/extension restart. */
function getRuntimeFontFamilies(): Promise<string[]> {
  fontFamiliesRequest ??= (async () => {
    try {
      const saved = await chrome.storage.session.get(FONT_FAMILIES_KEY);
      if (Array.isArray(saved[FONT_FAMILIES_KEY])) return saved[FONT_FAMILIES_KEY] as string[];
    } catch (error) {
      console.warn("CJ Font Fallback Fix could not read cached font names:", error);
    }
    return (await getRuntimeFonts()).families;
  })().finally(() => { fontFamiliesRequest = null; });
  return fontFamiliesRequest;
}

chrome.runtime.onStartup.addListener(() => {
  void getRuntimeFontFamilies().catch((error) => {
    console.warn("CJ Font Fallback Fix could not initialize installed font names:", error);
  });
});

function isActionStateMessage(message: unknown): message is ActionStateMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Partial<ActionStateMessage>;
  return candidate.type === "setActionState" && typeof candidate.inUse === "boolean";
}

async function setActionState(tabId: number, active: boolean): Promise<void> {
  if (tabStates.get(tabId) === active) return;
  try {
    await chrome.action.setIcon({
      tabId,
      path: active ? ACTION_ICONS.active : ACTION_ICONS.inactive
    });
    tabStates.set(tabId, active);
  } catch {
    // The tab may have closed while its page was reporting the state.
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  // Chromium clears tab-specific action icons on cross-document navigation.
  // The manifest's closed icon covers pages with no content-script report;
  // forget the old page's state so an active new page repaints immediately.
  tabStates.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const previous = await enqueueSiteRuleOperation(async () => {
      const stored = await chrome.storage.sync.get(["preserveWebsiteFonts", ...LEGACY_PRESERVE_KEYS, "siteOverrides", "siteDomainOverrides"]);
      const rules = siteRulesFromStorage(stored, (hostname) => chrome.publicSuffix.getDomain(hostname));
      if (JSON.stringify(stored.siteOverrides || {}) !== JSON.stringify(rules.siteOverrides) ||
          JSON.stringify(stored.siteDomainOverrides || {}) !== JSON.stringify(rules.siteDomainOverrides)) {
        await chrome.storage.sync.set(rules);
      }
      return stored;
    });
    if (LEGACY_PRESERVE_KEYS.some((key) => Object.hasOwn(previous, key))) {
      if (typeof previous.preserveWebsiteFonts !== "boolean") {
        await chrome.storage.sync.set({ preserveWebsiteFonts: preserveWebsiteFontsFromStorage(previous) });
      }
      await chrome.storage.sync.remove([...LEGACY_PRESERVE_KEYS]);
    }
    const { fonts } = await getRuntimeFonts();
    if (!fonts.length) return;
    const keys = Object.keys(FONT_SETTINGS) as FontSettingKey[];
    const stored = await chrome.storage.sync.get(keys);
    const repaired: Partial<Record<FontSettingKey, string>> = {};
    for (const key of keys) {
      const { variant, category } = FONT_SETTINGS[key];
      repaired[key] = validChoice(fonts, stored[key], variant, category);
    }
    await chrome.storage.sync.set(repaired);
  } catch (error) {
    console.warn("CJ Font Fallback Fix could not initialize its font list:", error);
  }
});

// Serialize edits across Settings and popup instances; storage owns durable state.
let siteRuleSaveQueue: Promise<unknown> = Promise.resolve();

function enqueueSiteRuleOperation<T>(operation: () => Promise<T>): Promise<T> {
  // A failed edit must not block later edits or update-time cleanup.
  const queued = siteRuleSaveQueue.catch(() => undefined).then(operation);
  siteRuleSaveQueue = queued;
  return queued;
}

async function editSiteRule(edit: SiteRuleEdit): Promise<void> {
  if (edit.scope !== "hostname" && edit.scope !== "domain") throw new Error("Invalid site scope");
  if (edit.value !== null && !isSiteChoice(edit.value)) throw new Error("Invalid site choice");
  const host = normalizeHostname(edit.hostname);
  if (!host) throw new Error("Invalid hostname");
  const hostname = edit.scope === "domain" ? chrome.publicSuffix.getDomain(host) : host;
  if (!hostname) throw new Error("noRegistrableDomain");
  const key = edit.scope === "domain" ? "siteDomainOverrides" : "siteOverrides";
  const previousScope = edit.previousScope ?? edit.scope;
  if (previousScope !== "hostname" && previousScope !== "domain") throw new Error("Invalid site scope");
  const previousKey = previousScope === "domain" ? "siteDomainOverrides" : "siteOverrides";
  const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
  // Remove old defaults before adding a domain rule, so they cannot silently
  // become automatic-detection exceptions to that new rule.
  const snapshot = siteRulesFromStorage(stored, (hostname) => chrome.publicSuffix.getDomain(hostname));
  const rules = snapshot[key];
  const sameRule = edit.previousHostname === hostname && key === previousKey;
  if (edit.value !== null && (edit.createOnly || (edit.previousHostname && !sameRule)) && Object.hasOwn(rules, hostname)) {
    throw new Error("siteRuleConflict");
  }
  const previousRules = snapshot[previousKey];
  if (edit.previousHostname) delete previousRules[edit.previousHostname];
  if (edit.value === null || (edit.scope === "domain" && edit.value === "auto")) delete rules[hostname];
  else Object.defineProperty(rules, hostname, { value: edit.value, enumerable: true, configurable: true, writable: true });
  await chrome.storage.sync.set(siteRulesFromStorage(snapshot, (hostname) => chrome.publicSuffix.getDomain(hostname)));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "getPlatformInfo") {
    void (async () => {
      try {
        sendResponse(await chrome.runtime.getPlatformInfo());
      } catch (error) {
        console.warn("CJ Font Fallback Fix could not read the browser platform:", error);
        sendResponse(null);
      }
    })();
    return true;
  }
  if (message?.type === "getInstalledFontFamilies") {
    void (async () => {
      try {
        sendResponse(await getRuntimeFontFamilies());
      } catch (error) {
        console.warn("CJ Font Fallback Fix could not read installed fonts:", error);
        sendResponse([]);
      }
    })();
    return true;
  }
  if (isActionStateMessage(message) && sender.tab?.id != null && (sender.frameId ?? 0) === 0) {
    void setActionState(sender.tab.id, message.inUse);
    return false;
  }
  if (message?.type === "getSiteDomain") {
    try {
      const host = new URL(sender.url || "").hostname;
      sendResponse(chrome.publicSuffix.getDomain(host) || null);
    } catch {
      sendResponse(null);
    }
    return false;
  }
  if (!["editSiteRule", "clearSiteRules", "restoreSiteRules"].includes(message?.type)) return false;
  const operation = enqueueSiteRuleOperation(async () => {
    if (message.type === "clearSiteRules") {
      const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
      const deletedRules = siteRulesFromStorage(stored, (hostname) => chrome.publicSuffix.getDomain(hostname));
      await chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} });
      return deletedRules;
    } else if (message.type === "restoreSiteRules") {
      const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
      const current = siteRulesFromStorage(stored, (hostname) => chrome.publicSuffix.getDomain(hostname));
      // Keep choices made after the deletion, including edits from another window.
      await chrome.storage.sync.set(siteRulesFromStorage({
        siteOverrides: {
          ...sanitizeSiteOverrides(message.rules?.siteOverrides, true),
          ...current.siteOverrides
        },
        siteDomainOverrides: {
          ...sanitizeSiteOverrides(message.rules?.siteDomainOverrides),
          ...current.siteDomainOverrides
        }
      }, (hostname) => chrome.publicSuffix.getDomain(hostname)));
    } else {
      await editSiteRule(message);
    }
  });
  void (async () => {
    try {
      const deletedRules = await operation;
      sendResponse({ ok: true, deletedRules });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      sendResponse({
        ok: false,
        error: errorText,
        errorKey: ["noRegistrableDomain", "siteRuleConflict"].includes(errorText) ? errorText : undefined
      });
    }
  })();
  return true;
});
