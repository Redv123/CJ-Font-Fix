/**
 * Main options form. Site overrides have a separate editor and reset lifecycle
 * in site-language-settings.ts, so collecting this form must omit them.
 */
import { defaultFor, getInstalledFonts, validChoice } from "../settings/font-catalog";
import { byId, errorMessage } from "../shared/dom";
import { localizeDocument, message } from "../shared/i18n";
import { DEFAULTS, FONT_SETTINGS, LEGACY_PRESERVE_KEYS, SETTINGS_STORAGE_KEYS, settingsFromStorage } from "../settings/defaults";
import { setupSiteLanguageSettings } from "./site-language-settings";
import type { FontSettingKey } from "../settings/defaults";
import type { InstalledFont, Settings } from "../shared/types";

const fontKeys = Object.keys(FONT_SETTINGS) as FontSettingKey[];
const checkKeys = [
  "trustCjkLang", "preserveWebsiteFonts", "simpleMode", "dynamicDetection",
  "mixedLanguageDetection"
] as const;

let installedFonts: InstalledFont[] = [];
let settingsLoaded = false;
let fontListError = "";
// Serialize automatic saves so a slower earlier write cannot win last.
let saveQueue: Promise<void> = Promise.resolve();
const modeAnimations = new Map<HTMLElement, Animation>();

function showStatus(message: string, isError = false): void {
  const status = byId("status");
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function collectValues(): Partial<Omit<Settings, "siteOverrides" | "siteDomainOverrides">> {
  const values: Partial<Omit<Settings, "siteOverrides" | "siteDomainOverrides">> = {
    defaultChinese: byId<HTMLSelectElement>("defaultChinese").value === "tc" ? "tc" : "sc",
    trustCjkLang: byId<HTMLInputElement>("trustCjkLang").checked,
    preserveWebsiteFonts: byId<HTMLInputElement>("preserveWebsiteFonts").checked,
    simpleMode: byId<HTMLInputElement>("simpleMode").checked,
    dynamicDetection: byId<HTMLInputElement>("dynamicDetection").checked,
    mixedLanguageDetection: byId<HTMLInputElement>("mixedLanguageDetection").checked
  };
  // An unavailable font menu must not overwrite a saved family with an empty value.
  if (installedFonts.length) {
    for (const key of fontKeys) values[key] = byId<HTMLSelectElement>(key).value;
  }
  return values;
}

async function saveSettings(): Promise<void> {
  if (!settingsLoaded) return;
  const values = collectValues();
  const operation = saveQueue.catch(() => undefined).then(async () => {
    await chrome.storage.sync.set(values);
    await chrome.storage.sync.remove([...LEGACY_PRESERVE_KEYS]);
  });
  saveQueue = operation;
  try {
    await operation;
    showStatus(fontListError, Boolean(fontListError));
  } catch (error) {
    showStatus(message("couldNotSave", errorMessage(error)), true);
  }
}

function fillFontMenus(): void {
  for (const key of fontKeys) {
    const select = byId<HTMLSelectElement>(key);
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = FONT_SETTINGS[key].category === "serif"
      ? message("sameAsSans")
      : message("notConfigured");
    select.replaceChildren(empty, ...installedFonts.map((font) => {
      const option = document.createElement("option");
      option.value = font.fontId;
      option.textContent = font.displayName === font.fontId
        ? font.displayName
        : `${font.displayName} (${font.fontId})`;
      return option;
    }));
  }
}

function updatePreviews(): void {
  for (const key of fontKeys) {
    const { variant, category } = FONT_SETTINGS[key];
    const selected = byId<HTMLSelectElement>(key).value;
    const sansKey = `font${variant.toUpperCase()}` as FontSettingKey;
    const family = selected || (category === "serif" ? byId<HTMLSelectElement>(sansKey).value : "");
    const suffix = `${variant.toUpperCase()}${category === "serif" ? "Serif" : ""}`;
    byId<HTMLElement>(`preview${suffix}`).style.fontFamily = family
      ? `"${family.replaceAll('"', '\\"')}"`
      : "";
  }
  byId("fontWarning").hidden = ["fontSC", "fontTC", "fontJP"].some((key) =>
    byId<HTMLSelectElement>(key).value
  );
}

function showModeSection(element: HTMLElement, visible: boolean, animate: boolean): void {
  const previous = modeAnimations.get(element);
  if (element.hidden === !visible && !previous) return;
  element.inert = !visible;

  const startingHeight = element.hidden ? 0 : element.getBoundingClientRect().height;
  const startingOpacity = element.hidden ? 0 : Number(getComputedStyle(element).opacity);
  previous?.cancel();
  modeAnimations.delete(element);
  element.style.overflow = "";

  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.hidden = !visible;
    return;
  }

  element.hidden = false;
  const styles = getComputedStyle(element);
  const margins = [styles.marginTop, styles.marginBottom];
  const endingHeight = visible ? element.scrollHeight : 0;
  element.style.overflow = "hidden";
  const animation = element.animate([
    { height: `${startingHeight}px`, opacity: startingOpacity,
      marginTop: visible && !startingHeight ? "0px" : margins[0],
      marginBottom: visible && !startingHeight ? "0px" : margins[1] },
    { height: `${endingHeight}px`, opacity: visible ? 1 : 0,
      marginTop: visible ? margins[0] : "0px",
      marginBottom: visible ? margins[1] : "0px" }
  ], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" });
  modeAnimations.set(element, animation);
  void animation.finished.then(() => {
    if (modeAnimations.get(element) !== animation) return;
    modeAnimations.delete(element);
    element.hidden = !visible;
    element.style.overflow = "";
  }).catch(() => undefined);
}

function updateModeControls(animate = false): void {
  const simple = byId<HTMLInputElement>("simpleMode").checked;
  for (const key of fontKeys) {
    byId<HTMLSelectElement>(key).disabled = simple || !installedFonts.length;
  }
  showModeSection(byId("fontSettings"), !simple, animate);
  showModeSection(byId("advancedDetection"), !simple, animate);
  showModeSection(byId("simpleModeNotice"), simple, animate);
}

function applyDefaults(): void {
  for (const key of fontKeys) {
    const { variant, category } = FONT_SETTINGS[key];
    byId<HTMLSelectElement>(key).value = defaultFor(installedFonts, variant, category);
  }
  byId<HTMLSelectElement>("defaultChinese").value = DEFAULTS.defaultChinese;
  for (const key of checkKeys) byId<HTMLInputElement>(key).checked = DEFAULTS[key];
  updatePreviews();
  updateModeControls(true);
}

async function restore(): Promise<void> {
  const generalControls = ["defaultChinese", ...checkKeys].map((key) =>
    byId<HTMLInputElement | HTMLSelectElement>(key)
  );
  for (const control of generalControls) control.disabled = true;
  const reset = byId<HTMLButtonElement>("resetSettings");
  reset.disabled = true;
  let stored: Record<string, unknown>;
  try {
    stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEYS);
  } catch (error) {
    showStatus(message("couldNotLoadSettings", errorMessage(error)), true);
    return;
  }
  const values = settingsFromStorage(stored);
  byId<HTMLSelectElement>("defaultChinese").value = values.defaultChinese;
  for (const key of checkKeys) byId<HTMLInputElement>(key).checked = values[key];
  settingsLoaded = true;
  for (const control of generalControls) control.disabled = false;
  updateModeControls();

  try {
    installedFonts = await getInstalledFonts();
    if (!installedFonts.length) throw new Error(message("fontListEmpty"));
  } catch (error) {
    fontListError = message("couldNotLoadFonts", errorMessage(error));
    showStatus(fontListError, true);
    return;
  }
  fillFontMenus();
  const repairedFonts: Partial<Record<FontSettingKey, string>> = {};
  for (const key of fontKeys) {
    const { variant, category } = FONT_SETTINGS[key];
    const choice = Object.hasOwn(stored, key) && stored[key] === ""
      ? ""
      : validChoice(installedFonts, values[key], variant, category);
    byId<HTMLSelectElement>(key).value = choice;
    repairedFonts[key] = choice;
  }
  updatePreviews();
  updateModeControls();
  reset.disabled = false;
  if (fontKeys.some((key) => repairedFonts[key] !== values[key])) {
    const operation = saveQueue.catch(() => undefined).then(() => chrome.storage.sync.set(repairedFonts));
    saveQueue = operation;
    try {
      await operation;
    } catch (error) {
      showStatus(message("couldNotSave", errorMessage(error)), true);
    }
  }
}

for (const key of fontKeys) {
  byId<HTMLSelectElement>(key).addEventListener("change", updatePreviews);
}

byId<HTMLInputElement>("simpleMode").addEventListener("change", () => updateModeControls(true));
const mixedLanguageCheckbox = byId<HTMLInputElement>("mixedLanguageDetection");
const mixedLanguageConsent = byId<HTMLDialogElement>("mixedLanguageConsent");
mixedLanguageCheckbox.addEventListener("change", () => {
  if (!mixedLanguageCheckbox.checked) {
    void saveSettings();
    return;
  }
  // Undo the tentative checkbox change before any automatic save can observe it.
  mixedLanguageCheckbox.checked = false;
  mixedLanguageConsent.returnValue = "";
  mixedLanguageConsent.showModal();
});
mixedLanguageConsent.addEventListener("close", () => {
  if (mixedLanguageConsent.returnValue !== "enable") return;
  mixedLanguageCheckbox.checked = true;
  void saveSettings();
});
byId("settingsForm").addEventListener("change", (event) => {
  if (event.target === mixedLanguageCheckbox) return;
  if (event.target instanceof Element && event.target.closest(".site-overrides-section")) return;
  void saveSettings();
});
byId<HTMLButtonElement>("resetSettings").addEventListener("click", async () => {
  if (!installedFonts.length) return;
  applyDefaults();
  await saveSettings();
});

localizeDocument();
setupSiteLanguageSettings();
void restore();
