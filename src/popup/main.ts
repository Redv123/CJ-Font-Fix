/**
 * Current-tab status UI. A failed content-script message means the page may be
 * browser-protected; it is not evidence that language detection returned null.
 */
import { byId } from "../shared/dom";
import { localizeDocument, message, variantLabel } from "../shared/i18n";
import { isVariant } from "../language/tags";
import { isSiteChoice } from "../settings/site-overrides";
import type { ContentMessage, ContentStatus, SiteRuleResult } from "../shared/types";

const REASON_MESSAGE_KEYS: Record<string, string> = {
  "Disabled for this site": "reasonDisabledSite",
  "Site override": "reasonSiteOverride",
  "HTML lang": "reasonHtmlLang",
  "HTML lang + Chinese script clues": "reasonHtmlLangChinese",
  "No CJK text": "reasonNoCjk",
  "Not enough CJK text": "reasonNotEnoughCjk",
  "Chrome language detection": "reasonChromeLanguage",
  "Chrome detection + Chinese script clues": "reasonChromeChinese",
  "Japanese kana fallback": "reasonJapaneseKana",
  "Chinese script clues fallback": "reasonChineseClues",
  "CJK text is too sparse": "reasonCjkSparse"
};

let tabId: number | null = null;
function send(message: Extract<ContentMessage, { type: "getStatus" }>): Promise<ContentStatus>;
function send(message: Extract<ContentMessage, { type: "setSiteOverride" }>): Promise<SiteRuleResult>;
async function send(message: ContentMessage): Promise<ContentStatus | SiteRuleResult> {
  if (tabId == null) throw new Error("No active tab");
  return chrome.tabs.sendMessage(tabId, message);
}

function reasonLabel(reason: string): string {
  const key = REASON_MESSAGE_KEYS[reason];
  return key ? message(key, undefined, reason) : reason;
}

async function load(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  try {
    const status = await send({ type: "getStatus" });
    byId("unavailableState").hidden = true;
    byId("statusGrid").hidden = false;
    byId("siteControls").hidden = false;
    byId("site").textContent = status.hostname || message("currentPage");
    byId("mode").textContent = status.simpleMode ? message("modeSimple") : message("modeAdvanced");
    byId("htmlLang").textContent = status.htmlLang || message("notSet");

    const languageLabel = byId("languageLabel");
    const detected = byId("detected");
    if (status.siteOverride === "off") {
      languageLabel.textContent = message("statusLabel");
      detected.textContent = message("disabled");
    } else if (isVariant(status.siteOverride)) {
      languageLabel.textContent = message("selected");
      detected.textContent = variantLabel(status.siteOverride);
    } else if (status.reason?.startsWith("HTML lang")) {
      languageLabel.textContent = message("declared");
      detected.textContent = status.pageVariant ? variantLabel(status.pageVariant) : reasonLabel(status.reason);
    } else {
      languageLabel.textContent = message("detected");
      const detectedVariants = status.detectedVariants?.filter(isVariant) || [];
      const detectedLabel = detectedVariants.length > 1
        ? detectedVariants.map(variantLabel).join(" + ")
        : status.pageVariant ? variantLabel(status.pageVariant) : "";
      detected.textContent = status.pageVariant
        ? `${detectedLabel} · ${reasonLabel(status.reason || "")}`
        : reasonLabel(status.reason || "No CJK text");
    }

    const changedElements = status.changedElements ?? 0;
    const inUse = status.siteOverride !== "off" && (status.simpleMode
      ? Boolean(status.simpleLang)
      : changedElements > 0);
    byId<HTMLImageElement>("pageIcon").src = `icons/icon-${inUse ? "active" : "inactive"}-128.png`;
    byId("statusGrid").classList.toggle("simple-status", status.simpleMode);
    byId("statusGrid").classList.toggle("inactive-status", !inUse);
    byId("fontRow").hidden = status.simpleMode || !inUse;
    byId("interventionRow").hidden = !inUse;
    byId("managedRow").hidden = status.simpleMode || !inUse;
    byId("font").textContent = status.fallbackChoice || message("none");
    byId("interventionLabel").textContent = status.simpleMode ? message("appliedLang") : message("cssIntervention");

    let intervention = message("notApplicable");
    if (status.siteOverride === "off") intervention = message("disabled");
    else if (status.simpleMode && status.simpleLang) intervention = message("setTo", status.simpleLang);
    else if (status.simpleMode) intervention = message("noChange");
    else if (changedElements > 0) intervention = message("applied");
    else if (status.pageVariant) intervention = message("notNeeded");
    byId("intervention").textContent = intervention;
    byId("changed").textContent = String(changedElements);
    byId<HTMLSelectElement>("override").value = status.hostnameChoice || status.siteOverride || "auto";
  } catch {
    byId<HTMLImageElement>("pageIcon").src = "icons/icon-inactive-128.png";
    byId("site").textContent = message("notEnabledOnPage");
    byId("statusGrid").hidden = true;
    byId("siteControls").hidden = true;
    byId("unavailableState").hidden = false;
    byId("message").textContent = "";
  }
}

byId<HTMLSelectElement>("override").addEventListener("change", async (event) => {
  const statusMessage = byId("message");
  statusMessage.textContent = "";
  try {
    const value = (event.currentTarget as HTMLSelectElement).value;
    if (!isSiteChoice(value)) return;
    const reply = await send({ type: "setSiteOverride", value, scope: "hostname" });
    if (!reply.ok) throw new Error("Could not save site choice");
    statusMessage.textContent = "";
    window.setTimeout(() => void load(), 150);
  } catch {
    statusMessage.textContent = message("couldNotUpdatePage");
  }
});

byId<HTMLButtonElement>("settings").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

localizeDocument();
byId("version").textContent = chrome.runtime.getManifest().version;
void load();
