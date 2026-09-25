export function message(
  key: string,
  substitutions?: string | string[],
  fallback = key
): string {
  return chrome.i18n.getMessage(key, substitutions) || fallback;
}

export function localizeDocument(): void {
  const locale = chrome.i18n.getMessage("@@ui_locale");
  if (locale) document.documentElement.lang = locale.replace(/_/g, "-");

  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (!key) continue;
    const translated = chrome.i18n.getMessage(key);
    if (translated) element.textContent = translated;
  }
}
