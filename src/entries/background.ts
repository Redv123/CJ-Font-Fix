/**
 * Service-worker entry for per-tab icon state and install-time font defaults.
 * Only top-frame content messages can mark a tab active; the manifest supplies
 * the closed icon until a page reports actual intervention.
 */
import { getInstalledFonts, validChoice } from "../settings/font-catalog";
import { FONT_SETTINGS, LEGACY_PRESERVE_KEYS, preserveWebsiteFontsFromStorage } from "../settings/defaults";
import type { FontSettingKey } from "../settings/defaults";
import { isSiteChoice, normalizeHostname, sanitizeSiteOverrides } from "../settings/site-overrides";
import type { SiteRuleEdit } from "../shared/types";
import type { ActionStateMessage } from "../shared/types";

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
    const previous = await chrome.storage.sync.get(["preserveWebsiteFonts", ...LEGACY_PRESERVE_KEYS]);
    if (LEGACY_PRESERVE_KEYS.some((key) => Object.hasOwn(previous, key))) {
      if (typeof previous.preserveWebsiteFonts !== "boolean") {
        await chrome.storage.sync.set({ preserveWebsiteFonts: preserveWebsiteFontsFromStorage(previous) });
      }
      await chrome.storage.sync.remove([...LEGACY_PRESERVE_KEYS]);
    }
    const fonts = await getInstalledFonts();
    if (!fonts.length) return;
    const keys = Object.keys(FONT_SETTINGS) as FontSettingKey[];
    const stored = await chrome.storage.sync.get(keys);
    const repaired: Partial<Record<FontSettingKey, string>> = {};
    for (const key of keys) {
      const { variant, category } = FONT_SETTINGS[key];
      repaired[key] = Object.hasOwn(stored, key) && stored[key] === ""
        ? ""
        : validChoice(fonts, stored[key], variant, category);
    }
    await chrome.storage.sync.set(repaired);
  } catch (error) {
    console.warn("CJ Font Fallback Fix could not initialize its font list:", error);
  }
});

// Serialize edits across Settings and popup instances; storage owns durable state.
let siteRuleSaveQueue: Promise<unknown> = Promise.resolve();

async function editSiteRule(edit: SiteRuleEdit): Promise<void> {
  if (edit.scope !== "hostname" && edit.scope !== "domain") throw new Error("Invalid site scope");
  if (edit.value !== null && !isSiteChoice(edit.value)) throw new Error("Invalid site choice");
  const host = normalizeHostname(edit.hostname);
  if (!host) throw new Error("Invalid hostname");
  const hostname = edit.scope === "domain" ? chrome.publicSuffix.getDomain(host) : host;
  if (!hostname) throw new Error("noRegistrableDomain");
  const key = edit.scope === "domain" ? "siteDomainOverrides" : "siteOverrides";
  const stored = await chrome.storage.sync.get(key);
  const rules = sanitizeSiteOverrides(stored[key], true);
  if (edit.previousHostname && edit.previousHostname !== hostname && Object.hasOwn(rules, hostname)) {
    throw new Error("siteRuleConflict");
  }
  if (edit.previousHostname) delete rules[edit.previousHostname];
  if (edit.value === null || (edit.scope === "domain" && edit.value === "auto")) delete rules[hostname];
  else Object.defineProperty(rules, hostname, { value: edit.value, enumerable: true, configurable: true, writable: true });
  await chrome.storage.sync.set({ [key]: rules });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
  if (message?.type !== "editSiteRule" && message?.type !== "clearSiteRules") return false;
  const previous = siteRuleSaveQueue;
  const operation = (async () => {
    try { await previous; } catch { /* A failed edit must not block later edits. */ }
    if (message.type === "clearSiteRules") {
      await chrome.storage.sync.set({ siteOverrides: {}, siteDomainOverrides: {} });
    } else {
      await editSiteRule(message);
    }
  })();
  siteRuleSaveQueue = operation;
  void (async () => {
    try {
      await operation;
      sendResponse({ ok: true });
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
