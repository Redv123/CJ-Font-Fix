import { byId, errorMessage } from "../shared/dom";
import { message, variantLabel } from "../shared/i18n";
import { isSiteChoice, normalizeHostname, sanitizeSiteOverrides } from "../settings/site-overrides";
import type { SiteChoice, SiteScope } from "../shared/types";

/**
 * Sets up the self-contained per-site override editor.
 *
 * Site overrides deliberately have their own save queue and reset action: the
 * main settings form must neither overwrite them nor delete them when its
 * Restore defaults button is used.
 */
export function setupSiteLanguageSettings(): void {
  let overrides: Record<string, SiteChoice> = {};
  let domains: Record<string, SiteChoice> = {};
  let panelAnimation: Animation | null = null;

  const showStatus = (text: string, isError = false): void => {
    const status = byId("siteOverrideStatus");
    status.textContent = text;
    status.classList.toggle("error", isError);
  };

  const variantOption = (value: SiteChoice): HTMLOptionElement => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value === "off" ? message("disabled") : value === "auto" ? message("auto") : variantLabel(value);
    return option;
  };

  const save = async (scope: SiteScope, hostname: string, value: SiteChoice | null, previousHostname?: string): Promise<boolean> => {
    showStatus(message("applying"));
    try {
      const reply = await chrome.runtime.sendMessage({ type: "editSiteRule", scope, hostname, value, previousHostname });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      await restore();
      showStatus("");
      return true;
    } catch (error) {
      await restore();
      showStatus(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
      return false;
    }
  };

  const render = (): void => {
    const list = byId("siteOverrideList");
    const entries = [
      ...Object.entries(overrides).map(([hostname, override]) => ({ hostname, override, scope: "hostname" as const })),
      ...Object.entries(domains).map(([hostname, override]) => ({ hostname, override, scope: "domain" as const }))
    ].sort((left, right) => left.hostname.localeCompare(right.hostname));
    const rows = entries.map(({ hostname, override, scope }) => {
      const row = document.createElement("div");
      row.className = "site-override-row";

      const hostnameInput = document.createElement("input");
      hostnameInput.type = "text";
      hostnameInput.value = hostname;
      hostnameInput.setAttribute("aria-label", message("website"));
      hostnameInput.addEventListener("change", () => {
        const normalized = normalizeHostname(hostnameInput.value);
        if (!normalized) {
          hostnameInput.value = hostname;
          showStatus(message("invalidWebsite"), true);
          return;
        }
        void save(scope, normalized, override, hostname);
      });

      const select = document.createElement("select");
      select.setAttribute("aria-label", message("language"));
      select.append(
        variantOption("auto"),
        variantOption("sc"),
        variantOption("tc"),
        variantOption("jp"),
        variantOption("off")
      );
      select.value = override;
      select.addEventListener("change", () => {
        if (isSiteChoice(select.value)) void save(scope, hostname, select.value);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary compact";
      remove.textContent = message("remove");
      remove.addEventListener("click", () => {
        void save(scope, hostname, null);
      });

      const hostField = document.createElement("div");
      const scopeLabel = document.createElement("small");
      scopeLabel.className = "site-rule-scope";
      scopeLabel.textContent = message(scope === "domain" ? "domainScope" : "hostnameScope");
      hostField.append(hostnameInput, scopeLabel);
      row.append(hostField, select, remove);
      return row;
    });
    list.replaceChildren(...rows);
    byId("noSiteOverrides").hidden = entries.length > 0;
    byId<HTMLButtonElement>("clearSiteOverrides").disabled = entries.length === 0;
  };

  const restore = async (): Promise<void> => {
    try {
      const stored = await chrome.storage.sync.get(["siteOverrides", "siteDomainOverrides"]);
      overrides = sanitizeSiteOverrides(stored.siteOverrides, true);
      domains = sanitizeSiteOverrides(stored.siteDomainOverrides);
      render();
    } catch (error) {
      showStatus(message("couldNotLoadSiteOverrides", errorMessage(error)), true);
    }
  };

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
          { maxHeight: "0px", opacity: 0, transform: "translateY(-6px)" },
          { maxHeight: `${height}px`, opacity: 1, transform: "translateY(0)" }
        ]
        : [
          { maxHeight: `${height}px`, opacity: 1, transform: "translateY(0)" },
          { maxHeight: "0px", opacity: 0, transform: "translateY(-6px)" }
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

  byId<HTMLFormElement>("addSiteOverride").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = byId<HTMLInputElement>("newSiteHostname");
    const hostname = normalizeHostname(input.value);
    const override = byId<HTMLSelectElement>("newSiteVariant").value;
    if (!hostname || !isSiteChoice(override)) {
      showStatus(message("invalidWebsite"), true);
      return;
    }
    const scope = byId<HTMLSelectElement>("newSiteScope").value as SiteScope;
    if (await save(scope, hostname, override)) input.value = "";
  });

  byId<HTMLButtonElement>("clearSiteOverrides").addEventListener("click", async () => {
    if (!Object.keys(overrides).length && !Object.keys(domains).length) return;
    if (!window.confirm(message("clearSiteOverridesConfirm"))) return;
    try {
      const reply = await chrome.runtime.sendMessage({ type: "clearSiteRules" });
      if (!reply.ok) throw new Error(reply.errorKey ? message(reply.errorKey) : reply.error);
      await restore();
    } catch (error) {
      showStatus(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || (!changes.siteOverrides && !changes.siteDomainOverrides)) return;
    void restore();
  });

  void restore();
}
