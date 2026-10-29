import { byId, errorMessage } from "../shared/dom";
import { message, variantLabel } from "../shared/i18n";
import { isSiteOverride, normalizeHostname, siteRulesFromStorage } from "../settings/site-overrides";
import type { SiteChoice, SiteRuleResult, SiteRuleSnapshot, SiteScope } from "../shared/types";

interface SiteEntry {
  hostname: string;
  scope: SiteScope;
  choice: SiteChoice;
}

interface SiteRowView {
  entry: SiteEntry;
  item: HTMLLIElement;
  row: HTMLDivElement;
  edit: HTMLButtonElement;
}

interface SiteGroupView {
  group: HTMLDetailsElement;
  list: HTMLUListElement;
  count: HTMLSpanElement;
  paginationKey: string;
}

/** Leave correctly placed children connected, including focused draft inputs. */
function reconcileChildren(parent: Element, children: readonly Element[]): void {
  const wanted = new Set(children);
  for (const child of Array.from(parent.children)) {
    if (!wanted.has(child)) child.remove();
  }
  let cursor = parent.firstElementChild;
  for (const child of children) {
    if (child === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(child, cursor);
  }
}

const PAGE_SIZE = 10;

const GROUPS: readonly SiteChoice[] = ["sc", "jp", "tc", "off", "auto"];

const ICON_PATHS = {
  edit: "m15 5 4 4M5 19l4-1 10-10a2.8 2.8 0 0 0-4-4L5 14l-1 6 6-1",
  delete: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5",
  save: "m5 12 4 4L19 6",
  cancel: "m6 6 12 12M18 6 6 18"
} as const;

function iconButton(icon: keyof typeof ICON_PATHS, label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = icon === "save" ? "submit" : "button";
  button.className = `site-row-action ${icon}`;
  button.setAttribute("aria-label", label);
  button.title = label;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", ICON_PATHS[icon]);
  svg.append(path);
  button.append(svg);
  return button;
}

function groupLabel(choice: SiteChoice): string {
  return choice === "off" ? message("disabled") : choice === "auto" ? message("automaticSiteChoices") : variantLabel(choice);
}

function entryKey(entry: SiteEntry): string {
  return `${entry.scope}:${entry.hostname}`;
}

/** Owns site-rule browsing, editing, and its separate reset lifecycle. */
export function setupSiteLanguageSettings(): void {
  let entries: SiteEntry[] = [];
  const editors = new Map<string, { entry: SiteEntry; form: HTMLFormElement; busy: boolean }>();
  let editorId = 0;
  let writeBusy = false;
  let deletionQueue: Promise<void> = Promise.resolve();
  const pendingDeletions = new Set<string>();
  let initialized = false;
  let panelAnimation: Animation | null = null;
  let highlightedKey = "";
  const openGroups = new Set<SiteChoice>();
  const pages = new Map<SiteChoice, number>();
  let highlightTimer = 0;
  const rowButtons = new Map<string, HTMLButtonElement>();
  const rowViews = new Map<string, SiteRowView>();
  const groupViews = new Map<SiteChoice, SiteGroupView>();
  const toolbar = byId("siteRuleToolbar");
  const form = byId<HTMLFormElement>("addSiteOverride");
  const hostnameInput = byId<HTMLInputElement>("newSiteHostname");
  const languageSelect = byId<HTMLSelectElement>("newSiteVariant");
  const scopeSelect = byId<HTMLSelectElement>("newSiteScope");
  const languagePlaceholder = languageSelect.querySelector<HTMLOptionElement>('option[value=""]')!;
  const saveButton = byId<HTMLButtonElement>("saveSiteRule");
  const search = byId<HTMLInputElement>("siteRuleSearch");
  const clearButton = byId<HTMLButtonElement>("clearSiteOverrides");
  const undoButton = byId<HTMLButtonElement>("undoSiteOverrides");
  const deleteNotice = byId("siteDeleteNotice");
  const results = byId("siteRulesResults");
  let deletedRules: SiteRuleSnapshot | null = null;
  let bulkBusy = false;
  let deferredSiteUpdate = false;

  function setBusy(busy: boolean): void {
    saveButton.disabled = busy;
    hostnameInput.disabled = busy;
    languageSelect.disabled = busy;
    scopeSelect.disabled = busy;
    byId<HTMLButtonElement>("cancelSiteRule").disabled = busy;
  }

  function showError(text: string, inAddForm = false): void {
    byId(inAddForm ? "siteRuleError" : "siteOverrideStatus").textContent = text;
    byId("siteOverrideStatus").classList.toggle("error", Boolean(text));
  }

  function openAddEditor(): void {
    if (writeBusy || bulkBusy) return;
    form.reset();
    hostnameInput.value = "";
    languageSelect.prepend(languagePlaceholder);
    languageSelect.value = "";
    scopeSelect.value = "hostname";
    showError("", true);
    toolbar.hidden = true;
    form.hidden = false;
    animateRow(form);
    hostnameInput.focus({ preventScroll: true });
  }

  function closeAddEditor(target?: HTMLElement): void {
    form.hidden = true;
    toolbar.hidden = false;
    animateRow(toolbar);
    if (managerIsOpen()) (target?.isConnected ? target : byId("openAddSite")).focus();
  }

  function groupView(choice: SiteChoice): SiteGroupView {
    const cached = groupViews.get(choice);
    if (cached) return cached;
    const group = document.createElement("details");
    group.className = "site-rule-group";
    group.setAttribute("aria-label", message("siteLanguageGroup", groupLabel(choice)));
    const heading = document.createElement("summary");
    const title = document.createElement("span");
    title.textContent = groupLabel(choice);
    const count = document.createElement("span");
    count.className = "count";
    heading.append(title, count);
    const list = document.createElement("ul");
    list.className = "site-rule-items";
    group.append(heading, list);
    group.addEventListener("toggle", () => {
      if (!group.isConnected || search.value.trim()) return;
      if (group.open) openGroups.add(choice);
      else openGroups.delete(choice);
    });
    const view = { group, list, count, paginationKey: "" };
    groupViews.set(choice, view);
    return view;
  }

  function rowView(entry: SiteEntry): SiteRowView {
    const cached = rowViews.get(entryKey(entry));
    if (cached) { cached.entry = entry; return cached; }
    const item = document.createElement("li");
    const row = document.createElement("div");
    row.className = "site-rule-row";
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
    const copy = document.createElement("span");
    copy.className = "site-rule-copy";
    copy.append(name, scope);
    const actions = document.createElement("div");
    actions.className = "site-row-actions";
    const edit = iconButton("edit", message("editWebsiteNamed", entry.hostname));
    const remove = iconButton("delete", message("deleteWebsiteNamed", entry.hostname));
    const view = { entry, item, row, edit };
    edit.addEventListener("click", () => openInlineEditor(view.entry));
    remove.addEventListener("click", () => queueDeletion(view.entry, remove));
    actions.append(edit, remove);
    row.append(monogram, copy, actions);
    item.append(row);
    rowViews.set(entryKey(entry), view);
    return view;
  }

  function matchingEntries(): SiteEntry[] {
    const query = search.value.trim().toLowerCase();
    const normalizedQuery = normalizeHostname(query) || query;
    return entries.filter((entry) => !query || entry.hostname.includes(query) || entry.hostname.includes(normalizedQuery));
  }

  function render(): void {
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedKey = Array.from(rowButtons).find(([, button]) => button === focused)?.[0];
    rowButtons.clear();
    const query = search.value.trim().toLowerCase();
    const matches = matchingEntries();
    byId("noSiteOverrides").hidden = matches.length > 0;
    byId("noSiteOverrides").textContent = message(query ? "noMatchingWebsites" : "noSiteOverrides");
    clearButton.disabled = bulkBusy || writeBusy || entries.length === 0;
    const groups: HTMLDetailsElement[] = [];
    for (const choice of GROUPS) {
      const members = matches.filter((entry) => entry.choice === choice);
      if (!members.length) continue;
      const view = groupView(choice);
      const { group, count, list } = view;
      const opening = Boolean(query) || openGroups.has(choice);
      if (group.open !== opening) group.open = opening;
      const groupTotal = entries.filter((entry) => entry.choice === choice).length;
      const countText = message(groupTotal === 1 ? "siteRuleCountOne" : "siteRuleCount",
        query ? `${members.length} / ${groupTotal}` : String(members.length));
      if (count.textContent !== countText) count.textContent = countText;
      const lastPage = Math.max(0, Math.ceil(members.length / PAGE_SIZE) - 1);
      const page = Math.min(pages.get(choice) || 0, lastPage);
      pages.set(choice, page);
      const items: HTMLLIElement[] = [];
      for (const entry of members.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
        const { item, row, edit } = rowView(entry);
        row.classList.toggle("recent-site-rule", entryKey(entry) === highlightedKey);
        const content = editors.get(entryKey(entry))?.form || row;
        if (item.firstElementChild !== content) item.replaceChildren(content);
        rowButtons.set(entryKey(entry), edit);
        items.push(item);
      }
      reconcileChildren(list, items);
      const paginationKey = members.length > PAGE_SIZE ? `${page}/${members.length}` : "";
      if (paginationKey !== view.paginationKey) {
        group.querySelector(".site-pagination")?.remove();
        view.paginationKey = paginationKey;
        if (paginationKey) {
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
            button.className = "secondary";
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
      }
      groups.push(group);
    }
    reconcileChildren(byId("siteOverrideList"), groups);
    const liveKeys = new Set(entries.map(entryKey));
    for (const [key, view] of rowViews) {
      if (!liveKeys.has(key) || (!rowButtons.has(key) && !editors.has(key))) {
        view.item.remove();
        rowViews.delete(key);
      }
    }
    for (const choice of groupViews.keys()) {
      if (!entries.some((entry) => entry.choice === choice)) groupViews.delete(choice);
    }
    if (document.activeElement !== focused) {
      if (focused?.isConnected && focused.closest(".site-inline-editor")) focused.focus({ preventScroll: true });
      else if (focusedKey) rowButtons.get(focusedKey)?.focus({ preventScroll: true });
    }
  }

  function revealEntry(entry: SiteEntry): void {
    search.value = "";
    openGroups.add(entry.choice);
    const position = entries.filter((member) => member.choice === entry.choice).findIndex((member) => entryKey(member) === entryKey(entry));
    pages.set(entry.choice, Math.max(0, Math.floor(position / PAGE_SIZE)));
    render();
  }

  function validatedRule(host: string, scope: SiteScope, choice: string): SiteEntry {
    const hostname = normalizeHostname(host);
    if (!hostname || !isSiteOverride(choice)) throw new Error(message("invalidWebsite"));
    let resolvedHost: string | null;
    try {
      resolvedHost = scope === "domain" ? chrome.publicSuffix.getDomain(hostname) : hostname;
    } catch {
      throw new Error(message("invalidWebsite"));
    }
    if (!resolvedHost) throw new Error(message("noRegistrableDomain"));
    return { hostname: resolvedHost, scope, choice };
  }

  function highlightEntry(entry: SiteEntry): void {
    highlightedKey = entryKey(entry);
    revealEntry(entry);
    window.clearTimeout(highlightTimer);
    highlightTimer = window.setTimeout(() => {
      rowButtons.get(highlightedKey)?.closest(".site-rule-row")?.classList.remove("recent-site-rule");
      highlightedKey = "";
    }, 1600);
  }

  async function cancelInlineEditor(entry: SiteEntry): Promise<void> {
    const key = entryKey(entry);
    const state = editors.get(key);
    if (!state || state.busy || bulkBusy) return;
    state.busy = true;
    state.form.inert = true;
    try {
      editors.delete(key);
      try { await restore(); }
      catch (error) { editors.set(key, state); render(); throw error; }
      const opener = rowButtons.get(key);
      const row = opener?.closest(".site-rule-row");
      if (row) animateRow(row);
      // Keep focus on Search or Hide if the user moved there during the refresh.
      if (managerIsOpen() && (document.activeElement === document.body || state.form.contains(document.activeElement))) {
        (opener || byId("openAddSite")).focus();
      }
    } finally {
      state.form.inert = false;
      state.busy = false;
    }
  }

  function animateRow(row: Element): void {
    if (!row.isConnected || !managerIsOpen() || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    void row.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 220, easing: "ease-out"
    }).finished.catch(() => undefined);
  }

  function openInlineEditor(entry: SiteEntry): void {
    if (writeBusy || bulkBusy) return;
    const key = entryKey(entry);
    if (editors.has(key)) return;
    if (highlightedKey === key) {
      highlightedKey = "";
      window.clearTimeout(highlightTimer);
    }
    showError("");
    const editor = document.createElement("form");
    editor.className = "site-inline-editor";
    editor.setAttribute("aria-label", message("editWebsiteNamed", entry.hostname));
    const monogram = document.createElement("span");
    monogram.className = "site-monogram";
    monogram.setAttribute("aria-hidden", "true");
    monogram.textContent = entry.hostname.replace(/^www\./, "").charAt(0).toUpperCase();
    const host = document.createElement("input");
    host.type = "text";
    host.name = "hostname";
    host.value = entry.hostname;
    host.inputMode = "url";
    host.autocapitalize = "off";
    host.spellcheck = false;
    host.required = true;
    host.setAttribute("aria-label", message("website"));
    host.title = message("website");
    const scope = document.createElement("select");
    scope.name = "scope";
    scope.className = "site-inline-scope";
    scope.setAttribute("aria-label", message("siteScope"));
    scope.title = message("siteScope");
    for (const value of ["hostname", "domain"] as const) {
      scope.add(new Option(message(value === "domain" ? "domainScope" : "hostnameScope"), value));
    }
    scope.value = entry.scope;
    const language = document.createElement("select");
    language.name = "language";
    language.className = "site-inline-language";
    language.setAttribute("aria-label", message("language"));
    language.title = message("language");
    for (const choice of ["sc", "tc", "jp", "off"] as const) language.add(new Option(groupLabel(choice), choice));
    // Automatic exceptions are existing rules, not a new selectable language.
    if (entry.choice === "auto") {
      const placeholder = new Option(message("chooseLanguage"), "", true, true);
      placeholder.disabled = placeholder.hidden = true;
      language.prepend(placeholder);
    }
    else language.value = entry.choice;
    language.addEventListener("change", () => language.querySelector('option[value=""]')?.remove());
    language.required = true;
    const save = iconButton("save", message("saveChanges"));
    const cancel = iconButton("cancel", message("cancel"));
    const error = document.createElement("p");
    error.id = `site-inline-error-${++editorId}`;
    error.className = "site-inline-error error";
    error.setAttribute("role", "alert");
    host.setAttribute("aria-describedby", error.id);
    scope.setAttribute("aria-describedby", error.id);
    language.setAttribute("aria-describedby", error.id);
    editor.append(monogram, host, scope, language, save, cancel, error);
    const state = { entry: { ...entry }, form: editor, busy: false };
    editors.set(key, state);
    const cancelDraft = () => void cancelInlineEditor(entry).catch((failure: unknown) =>
      showError(message("couldNotLoadSiteOverrides", errorMessage(failure))));
    cancel.addEventListener("click", cancelDraft);
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); cancelDraft(); }
    });
    editor.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy || writeBusy || bulkBusy) return;
      error.textContent = "";
      let updated: SiteEntry;
      try { updated = validatedRule(host.value, scope.value as SiteScope, language.value); }
      catch (failure) { error.textContent = errorMessage(failure); return; }
      state.busy = true;
      writeBusy = true;
      for (const control of [host, scope, language, save, cancel]) control.disabled = true;
      clearButton.disabled = true;
      try {
        const reply: SiteRuleResult = await chrome.runtime.sendMessage({ type: "editSiteRule", hostname: updated.hostname, scope: updated.scope, value: updated.choice,
          previousHostname: entry.hostname, previousScope: entry.scope });
        if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
        editors.delete(key);
        await restore();
        highlightEntry(updated);
        rowButtons.get(entryKey(updated))?.focus();
      } catch (failure) {
        error.textContent = message("couldNotSaveSiteOverrides", errorMessage(failure));
      } finally {
        state.busy = false;
        for (const control of [host, scope, language, save, cancel]) control.disabled = false;
        finishWrite();
      }
    });
    render();
    animateRow(editor);
    host.focus({ preventScroll: true });
  }

  function queueDeletion(entry: SiteEntry, remove: HTMLButtonElement): void {
    const key = entryKey(entry);
    if (bulkBusy || pendingDeletions.has(key) || (writeBusy && !pendingDeletions.size)) return;
    pendingDeletions.add(key);
    writeBusy = true;
    remove.disabled = clearButton.disabled = true;
    // Finish each collapse before the next one, without dropping rapid clicks.
    deletionQueue = deletionQueue.catch(() => undefined).then(async () => {
      try { await deleteEntry(entry, remove); }
      finally {
        pendingDeletions.delete(key);
        remove.disabled = false;
        finishWrite();
      }
    });
    void deletionQueue.catch((error: unknown) => showError(message("couldNotSaveSiteOverrides", errorMessage(error))));
  }

  async function deleteEntry(entry: SiteEntry, remove: HTMLButtonElement): Promise<void> {
    showError("");
    let shrinking: HTMLElement | null = null;
    let animation: Animation | null = null;
    try {
      const reply: SiteRuleResult = await chrome.runtime.sendMessage({ type: "editSiteRule", scope: entry.scope, hostname: entry.hostname, value: null });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      const nextKey = Array.from(rowButtons.keys()).find((key) => key !== entryKey(entry) &&
        rowButtons.get(key)?.isConnected);
      const visibleChoice = rowViews.get(entryKey(entry))?.entry.choice || entry.choice;
      const lastMember = matchingEntries().filter((member) => member.choice === visibleChoice).length === 1;
      shrinking = lastMember ? remove.closest<HTMLDetailsElement>("details") : remove.closest<HTMLLIElement>("li");
      if (shrinking?.isConnected && managerIsOpen() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        shrinking.inert = true;
        const height = `${shrinking.getBoundingClientRect().height}px`;
        const style = getComputedStyle(shrinking);
        const gap = lastMember ? parseFloat(getComputedStyle(byId("siteOverrideList")).rowGap) || 0 : 0;
        animation = shrinking.animate([
          { height, opacity: 1, borderWidth: style.borderWidth, marginBlockEnd: style.marginBlockEnd, overflow: "hidden", minHeight: "0px" },
          { height: "0px", opacity: 0, borderWidth: "0px", marginBlockEnd: `${-gap}px`, overflow: "hidden", minHeight: "0px" }
        ], { duration: 220, easing: "ease-out", fill: "forwards" });
        await animation.finished.catch(() => undefined);
      }
      await restore();
      if (managerIsOpen() && (document.activeElement === document.body || shrinking?.contains(document.activeElement))) {
        (rowButtons.get(nextKey || "") || byId("openAddSite")).focus({ preventScroll: true });
      }
    } catch (failure) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(failure)));
    } finally {
      animation?.cancel();
      if (shrinking) shrinking.inert = false;
    }
  }

  async function restore(): Promise<void> {
    deferredSiteUpdate = false;
    const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
    const rules = siteRulesFromStorage(stored, (hostname) => chrome.publicSuffix.getDomain(hostname));
    const savedEntries = [
      ...Object.entries(rules.siteOverrides).map(([hostname, choice]) => ({ hostname, choice, scope: "hostname" as const })),
      ...Object.entries(rules.siteDomainOverrides).map(([hostname, choice]) => ({ hostname, choice, scope: "domain" as const }))
    ];
    const displayEntries = new Map<string, SiteEntry>(savedEntries.map((entry) => [entryKey(entry), entry]));
    // A save in another row must not replace or detach an unfinished draft.
    // Cancel rereads storage, so a concurrently removed rule stays removed.
    for (const draft of editors.values()) displayEntries.set(entryKey(draft.entry), draft.entry);
    entries = Array.from(displayEntries.values()).sort((a, b) => a.hostname.localeCompare(b.hostname));
    if (!initialized) {
      if (entries.length <= 10) GROUPS.forEach((choice) => openGroups.add(choice));
      initialized = true;
    }
    render();
  }

  function managerIsOpen(): boolean {
    return byId("toggleSiteOverrides").getAttribute("aria-expanded") === "true";
  }

  async function transitionSiteResults(update: () => Promise<void>): Promise<void> {
    if (!managerIsOpen() || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      await update();
      return;
    }
    const height = `${results.getBoundingClientRect().height}px`;
    let incoming: Animation | null = null;
    results.inert = true;
    const outgoing = results.animate([
      { height, opacity: 1 }, { height, opacity: 0 }
    ], { duration: 90, easing: "ease-out", fill: "forwards" });
    try {
      await outgoing.finished;
      await update();
      if (managerIsOpen() && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        incoming = results.animate([
          { height, opacity: 0, transform: "translateY(-4px)", overflow: "hidden" },
          { height: "auto", opacity: 1, transform: "translateY(0)", overflow: "hidden" }
        ], { duration: 180, easing: "cubic-bezier(.2, .8, .2, 1)" });
        outgoing.cancel();
        await incoming.finished;
      }
    } finally {
      outgoing.cancel();
      incoming?.cancel();
      results.inert = false;
    }
  }

  function finishBulkOperation(): void {
    bulkBusy = false;
    undoButton.disabled = false;
    clearButton.disabled = entries.length === 0;
    if (deferredSiteUpdate) {
      void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
    }
  }

  function finishWrite(): void {
    writeBusy = pendingDeletions.size > 0;
    clearButton.disabled = bulkBusy || writeBusy || entries.length === 0;
    if (deferredSiteUpdate && !writeBusy && !editors.size && !bulkBusy) {
      void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saveButton.disabled || writeBusy || bulkBusy) return;
    showError("", true);
    const scope = scopeSelect.value as SiteScope;
    let updated: SiteEntry;
    try { updated = validatedRule(hostnameInput.value, scope, languageSelect.value); }
    catch (error) {
      showError(errorMessage(error), true);
      return;
    }
    const duplicate = entries.find((entry) => entryKey(entry) === entryKey(updated));
    if (duplicate) {
      highlightEntry(duplicate);
      showError(message("siteAlreadyExists"));
      const target = editors.get(entryKey(duplicate))?.form.querySelector<HTMLInputElement>("input") || rowButtons.get(entryKey(duplicate));
      closeAddEditor(target);
      return;
    }
    writeBusy = true;
    setBusy(true);
    try {
      const reply: SiteRuleResult = await chrome.runtime.sendMessage({ type: "editSiteRule", hostname: updated.hostname, scope, value: updated.choice, createOnly: true });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      await restore();
      highlightEntry(updated);
      closeAddEditor(rowButtons.get(entryKey(updated)));
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
    } finally {
      setBusy(false);
      finishWrite();
    }
  });

  byId("openAddSite").addEventListener("click", openAddEditor);
  languageSelect.addEventListener("change", () => {
    if (isSiteOverride(languageSelect.value)) languagePlaceholder.remove();
  });
  const cancelAdd = () => { if (!saveButton.disabled) closeAddEditor(); };
  byId("cancelSiteRule").addEventListener("click", cancelAdd);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); cancelAdd(); }
  });
  form.setAttribute("aria-label", message("addSite"));
  saveButton.setAttribute("aria-label", message("addSite"));
  saveButton.title = message("addSite");
  byId("cancelSiteRule").setAttribute("aria-label", message("cancel"));
  byId("cancelSiteRule").title = message("cancel");
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

  clearButton.addEventListener("click", async () => {
    if (!entries.length || bulkBusy || writeBusy) return;
    bulkBusy = true;
    clearButton.disabled = true;
    undoButton.disabled = true;
    showError("");
    try {
      const reply: SiteRuleResult = await chrome.runtime.sendMessage({ type: "clearSiteRules" });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      deletedRules = reply.deletedRules || null;
      editors.clear();
      await transitionSiteResults(async () => {
        byId("siteDeleteMessage").textContent = message("siteSettingsDeleted");
        deleteNotice.hidden = !deletedRules;
        search.value = "";
        await restore();
      });
      undoButton.disabled = false;
      if (deletedRules && managerIsOpen() && form.hidden) undoButton.focus();
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)));
    } finally {
      finishBulkOperation();
    }
  });
  undoButton.addEventListener("click", async () => {
    if (!deletedRules || bulkBusy || writeBusy) return;
    bulkBusy = true;
    undoButton.disabled = true;
    clearButton.disabled = true;
    showError("");
    try {
      const reply: SiteRuleResult = await chrome.runtime.sendMessage({ type: "restoreSiteRules", rules: deletedRules });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      deletedRules = null;
      await transitionSiteResults(async () => {
        deleteNotice.hidden = true;
        byId("siteDeleteMessage").textContent = "";
        search.value = "";
        await restore();
      });
      clearButton.disabled = entries.length === 0;
      if (managerIsOpen() && form.hidden) (entries.length ? clearButton : byId("openAddSite")).focus();
    } catch (error) {
      showError(message("couldNotSaveSiteOverrides", errorMessage(error)));
    } finally {
      finishBulkOperation();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && (changes.siteOverrides || changes.siteDomainOverrides)) {
      if (bulkBusy || writeBusy || editors.size) {
        deferredSiteUpdate = true;
        return;
      }
      void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
    }
  });
  void restore().catch((error: unknown) => showError(message("couldNotLoadSiteOverrides", errorMessage(error))));
}
