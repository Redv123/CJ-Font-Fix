import { byId, errorMessage } from "../shared/dom";
import { message, variantLabel } from "../shared/i18n";
import { isSiteOverride, normalizeHostname, sanitizeSiteOverrides } from "../settings/site-overrides";
import type { SiteChoice, SiteRuleEdit, SiteRuleResult, SiteScope } from "../shared/types";

interface SiteEntry {
  hostname: string;
  scope: SiteScope;
  choice: SiteChoice;
}

const PAGE_SIZE = 10;

const GROUPS: readonly SiteChoice[] = ["sc", "jp", "tc", "off", "auto"];

function groupLabel(choice: SiteChoice): string {
  return choice === "off" ? message("disabled") : choice === "auto" ? message("automaticSiteChoices") : variantLabel(choice);
}

function entryKey(entry: SiteEntry): string {
  return `${entry.scope}:${entry.hostname}`;
}

/** Owns site-rule browsing, editing, and its separate reset lifecycle. */
export function setupSiteLanguageSettings(): void {
  let entries: SiteEntry[] = [];
  let editing: SiteEntry | null = null;
  let initialized = false;
  let panelAnimation: Animation | null = null;
  let highlightedKey = "";
  const openGroups = new Set<SiteChoice>();
  const pages = new Map<SiteChoice, number>();
  let highlightTimer = 0;
  const rowButtons = new Map<string, HTMLButtonElement>();
  const dialog = byId<HTMLDialogElement>("siteRuleDialog");
  const form = byId<HTMLFormElement>("addSiteOverride");
  const hostnameInput = byId<HTMLInputElement>("newSiteHostname");
  const languageSelect = byId<HTMLSelectElement>("newSiteVariant");
  const languagePlaceholder = languageSelect.querySelector<HTMLOptionElement>('option[value=""]')!;
  const saveButton = byId<HTMLButtonElement>("saveSiteRule");
  const removeButton = byId<HTMLButtonElement>("removeSiteRule");
  const search = byId<HTMLInputElement>("siteRuleSearch");
  let returnFocus: HTMLElement | null = null;
  let savedFocusKey = "";

  function setBusy(busy: boolean): void {
    saveButton.disabled = busy;
    removeButton.disabled = busy;
    hostnameInput.disabled = busy;
    languageSelect.disabled = busy;
    for (const id of ["siteScopeHostname", "siteScopeDomain", "closeSiteRule", "cancelSiteRule"]) {
      byId<HTMLInputElement | HTMLButtonElement>(id).disabled = busy;
    }
  }

  function showError(text: string, inDialog = false): void {
    byId(inDialog ? "siteRuleError" : "siteOverrideStatus").textContent = text;
    byId("siteOverrideStatus").classList.toggle("error", Boolean(text));
  }

  function openEditor(entry: SiteEntry | null): void {
    editing = entry ? { ...entry } : null;
    savedFocusKey = "";
    if (!dialog.open) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    form.reset();
    hostnameInput.value = entry?.hostname || "";
    if (entry && isSiteOverride(entry.choice)) languagePlaceholder.remove();
    else languageSelect.prepend(languagePlaceholder);
    languageSelect.value = entry && isSiteOverride(entry.choice) ? entry.choice : "";
    byId<HTMLInputElement>(entry?.scope === "domain" ? "siteScopeDomain" : "siteScopeHostname").checked = true;
    byId("siteRuleDialogTitle").textContent = message(entry ? "editWebsite" : "addSite");
    saveButton.textContent = message(entry ? "saveChanges" : "addSite");
    removeButton.hidden = !entry;
    showError("", true);
    if (!dialog.open) dialog.showModal();
  }

  function render(): void {
    rowButtons.clear();
    const query = search.value.trim().toLowerCase();
    const normalizedQuery = normalizeHostname(query) || query;
    const matches = entries.filter((entry) => !query || entry.hostname.includes(query) || entry.hostname.includes(normalizedQuery));
    byId("siteRuleCount").textContent = query
      ? message("siteSearchCount", [String(matches.length), String(entries.length)])
      : message("siteRuleCount", String(entries.length));
    byId("noSiteOverrides").hidden = matches.length > 0;
    byId("noSiteOverrides").textContent = message(query ? "noMatchingWebsites" : "noSiteOverrides");
    byId<HTMLButtonElement>("clearSiteOverrides").disabled = entries.length === 0;
    const groups: HTMLDetailsElement[] = [];
    for (const choice of GROUPS) {
      const members = matches.filter((entry) => entry.choice === choice);
      if (!members.length) continue;
      const group = document.createElement("details");
      group.className = "site-rule-group";
      group.open = Boolean(query) || openGroups.has(choice);
      group.setAttribute("aria-label", message("siteLanguageGroup", groupLabel(choice)));
      const heading = document.createElement("summary");
      const title = document.createElement("span");
      title.textContent = groupLabel(choice);
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = query ? `${members.length} / ${entries.filter((entry) => entry.choice === choice).length}` : String(members.length);
      heading.append(title, count);
      group.append(heading);
      group.addEventListener("toggle", () => {
        if (!group.isConnected || search.value.trim()) return;
        if (group.open) openGroups.add(choice);
        else openGroups.delete(choice);
      });
      const list = document.createElement("ul");
      list.className = "site-rule-items";
      const lastPage = Math.max(0, Math.ceil(members.length / PAGE_SIZE) - 1);
      const page = Math.min(pages.get(choice) || 0, lastPage);
      pages.set(choice, page);
      for (const entry of members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "site-rule-row";
        if (entryKey(entry) === highlightedKey) button.classList.add("recent-site-rule");
        button.setAttribute("aria-label", message("editWebsiteNamed", entry.hostname));
        const monogram = document.createElement("span");
        monogram.className = "site-monogram";
        monogram.setAttribute("aria-hidden", "true");
        monogram.textContent = entry.hostname.replace(/^www\./, "").charAt(0).toUpperCase();
        const name = document.createElement("span");
        name.className = "site-rule-name";
        name.textContent = entry.hostname;
        const scope = document.createElement("span");
        scope.className = "scope-badge";
        scope.textContent = message(entry.scope === "domain" ? "domainScope" : "hostnameScope");
        const arrow = document.createElement("span");
        arrow.className = "site-rule-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "›";
        button.append(monogram, name, scope, arrow);
        button.addEventListener("click", () => openEditor(entry));
        rowButtons.set(entryKey(entry), button);
        item.append(button);
        list.append(item);
      }
      group.append(list);
      if (members.length > PAGE_SIZE) {
        const navigation = document.createElement("nav");
        navigation.className = "site-pagination";
        navigation.setAttribute("aria-label", message("siteGroupPages", groupLabel(choice)));
        const range = document.createElement("span");
        range.textContent = message("sitePageRange", [String(page * PAGE_SIZE + 1), String(Math.min((page + 1) * PAGE_SIZE, members.length)), String(members.length)]);
        const controls = document.createElement("div");
        for (const direction of ["previous", "next"] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.id = `site-page-${choice}-${direction}`;
          button.className = "secondary compact";
          button.textContent = message(direction);
          button.disabled = direction === "previous" ? page === 0 : page === lastPage;
          button.addEventListener("click", () => {
            pages.set(choice, page + (direction === "next" ? 1 : -1));
            openGroups.add(choice);
            render();
            const target = byId<HTMLButtonElement>(button.id);
            if (!target.disabled) target.focus();
            else byId(`site-page-${choice}-${direction === "next" ? "previous" : "next"}`).focus();
          });
          controls.append(button);
        }
        navigation.append(range, controls);
        group.append(navigation);
      }
      groups.push(group);
    }
    byId("siteOverrideList").replaceChildren(...groups);
  }

  async function restore(): Promise<void> {
    const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
    entries = [
      ...Object.entries(sanitizeSiteOverrides(stored.siteOverrides, true)).map(([hostname, choice]) => ({ hostname, choice, scope: "hostname" as const })),
      ...Object.entries(sanitizeSiteOverrides(stored.siteDomainOverrides)).map(([hostname, choice]) => ({ hostname, choice, scope: "domain" as const }))
    ].sort((a, b) => a.hostname.localeCompare(b.hostname));
    if (!initialized) {
      if (entries.length <= 10) GROUPS.forEach((choice) => openGroups.add(choice));
      initialized = true;
    }
    render();
  }

  async function persist(edit: SiteRuleEdit): Promise<SiteRuleResult> {
    return chrome.runtime.sendMessage(edit);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton.disabled) return;
    showError("", true);
    const hostname = normalizeHostname(hostnameInput.value);
    const choice = languageSelect.value;
    if (!hostname || !isSiteOverride(choice)) {
      showError(message("invalidWebsite"), true);
      return;
    }
    const scope: SiteScope = byId<HTMLInputElement>("siteScopeDomain").checked ? "domain" : "hostname";
    let resolvedHost: string | null = hostname;
    try {
      if (scope === "domain") resolvedHost = chrome.publicSuffix.getDomain(hostname);
    } catch {
      showError(message("invalidWebsite"), true);
      return;
    }
    if (!resolvedHost) {
      showError(message("noRegistrableDomain"), true);
      return;
    }
    const duplicate = entries.find((entry) => entry.scope === scope && entry.hostname === resolvedHost);
    if (!editing && duplicate) {
      openEditor(duplicate);
      showError(message("siteAlreadyExists"), true);
      return;
    }
    setBusy(true);
    try {
      const reply = await persist({ type: "editSiteRule", scope, hostname, value: choice,
        previousHostname: editing?.hostname, previousScope: editing?.scope, createOnly: !editing });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      await restore();
      search.value = "";
      openGroups.add(choice);
      highlightedKey = entryKey({ hostname: resolvedHost, choice, scope });
      const position = entries.filter((entry) => entry.choice === choice).findIndex((entry) => entryKey(entry) === highlightedKey);
      pages.set(choice, Math.max(0, Math.floor(position / PAGE_SIZE)));
      render();
      savedFocusKey = highlightedKey;
      window.clearTimeout(highlightTimer);
      highlightTimer = window.setTimeout(() => {
        rowButtons.get(highlightedKey)?.classList.remove("recent-site-rule");
        highlightedKey = "";
      }, 1600);
      dialog.close();
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
    } finally {
      setBusy(false);
    }
  });

  removeButton.addEventListener("click", async () => {
    if (!editing || saveButton.disabled) return;
    setBusy(true);
    try {
      const reply = await persist({ type: "editSiteRule", scope: editing.scope, hostname: editing.hostname, value: null });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      highlightedKey = "";
      await restore();
      dialog.close();
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
    } finally {
      setBusy(false);
    }
  });

  byId("openAddSite").addEventListener("click", () => openEditor(null));
  languageSelect.addEventListener("change", () => {
    if (isSiteOverride(languageSelect.value)) languagePlaceholder.remove();
  });
  for (const id of ["closeSiteRule", "cancelSiteRule"]) byId(id).addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (saveButton.disabled) event.preventDefault();
  });
  dialog.addEventListener("close", () => {
    const target = rowButtons.get(savedFocusKey) || (returnFocus?.isConnected ? returnFocus : null) ||
      (editing ? rowButtons.get(entryKey(editing)) : null) || byId("openAddSite");
    target.focus();
  });
  byId("closeSiteRule").setAttribute("aria-label", message("close"));
  search.placeholder = message("searchWebsites");
  search.addEventListener("input", () => {
    pages.clear();
    render();
  });
  byId<HTMLButtonElement>("toggleSiteOverrides").addEventListener("click", () => {
    const panel = byId("siteOverridesPanel");
    const button = byId<HTMLButtonElement>("toggleSiteOverrides");
    const expanding = button.getAttribute("aria-expanded") !== "true";
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelAnimation?.cancel();
    panelAnimation = null;
    button.setAttribute("aria-expanded", String(expanding));
    byId("siteRuleCount").hidden = !expanding;
    button.textContent = message(expanding ? "hideSiteOverrides" : "manageSiteOverrides");

    if (reduceMotion) {
      panel.hidden = !expanding;
      return;
    }
    if (expanding) panel.hidden = false;
    const height = panel.scrollHeight;
    const animation = panel.animate(
      expanding
        ? [
          { maxHeight: "0px", opacity: 0, transform: "translateY(-6px)", overflow: "hidden" },
          { maxHeight: `${height}px`, opacity: 1, transform: "translateY(0)", overflow: "hidden" }
        ]
        : [
          { maxHeight: `${height}px`, opacity: 1, transform: "translateY(0)", overflow: "hidden" },
          { maxHeight: "0px", opacity: 0, transform: "translateY(-6px)", overflow: "hidden" }
        ],
      { duration: 180, easing: "cubic-bezier(.2, .8, .2, 1)" }
    );
    panelAnimation = animation;
    void animation.finished.then(() => {
      if (panelAnimation !== animation) return;
      panelAnimation = null;
      if (!expanding && button.getAttribute("aria-expanded") === "false") panel.hidden = true;
    }).catch(() => undefined);
  });

  byId("clearSiteOverrides").addEventListener("click", async () => {
    if (!entries.length || !window.confirm(message("clearSiteOverridesConfirm"))) return;
    try {
      const reply = await chrome.runtime.sendMessage({ type: "clearSiteRules" });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      await restore();
      showError("");
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)));
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.siteOverrides || changes.siteDomainOverrides)) {
      void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
    }
  });
  void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
}
