/**
 * Service-worker entry for per-tab icon state and install-time font defaults.
 * Only top-frame content messages can mark a tab active; the manifest supplies
 * the closed icon until a page reports actual intervention.
 */
import { getInstalledFonts, validChoice } from "../settings/font-catalog";
import { FONT_SETTINGS } from "../settings/defaults";
import type { FontSettingKey } from "../settings/defaults";
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

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (!isActionStateMessage(message) || sender.tab?.id == null || (sender.frameId ?? 0) !== 0) return;
  void setActionState(sender.tab.id, message.inUse);
});

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
