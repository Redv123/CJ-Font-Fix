import { byId, errorMessage } from "../shared/dom";
import { message } from "../shared/i18n";
import { isSiteOverride, normalizeHostname, sanitizeSiteOverrides } from "../settings/site-overrides";
import type { SiteOverride } from "../shared/types";

/**
 * Sets up the self-contained per-site override editor.
 *
 * Site overrides deliberately have their own save queue and reset action: the
 * main settings form must neither overwrite them nor delete them when its
 * Restore defaults button is used.
 */
export function setupSiteLanguageSettings(): void {
  let saveQueue: Promise<void> = Promise.resolve();
  let overrides: Record<string, SiteOverride> = {};
  let panelAnimation: Animation | null = null;

  const showStatus = (text: string, isError = false): void => {
    const status = byId("siteOverrideStatus");
    status.textContent = text;
    status.classList.toggle("error", isError);
  };

  const variantOption = (value: SiteOverride, labelKey: string): HTMLOptionElement => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = message(labelKey);
    return option;
  };

  const save = async (next: Record<string, SiteOverride>): Promise<void> => {
    overrides = next;
    render();
    showStatus("");
    const snapshot = { ...next };
    const operation = saveQueue.catch(() => undefined).then(async () => {
      await chrome.storage.sync.set({ siteOverrides: snapshot });
    });
    saveQueue = operation;
    try {
      await operation;
    } catch (error) {
      showStatus(message("couldNotSaveSiteOverrides", errorMessage(error)), true);
    }
  };

  const render = (): void => {
    const list = byId("siteOverrideList");
    const entries = Object.entries(overrides).sort(([left], [right]) => left.localeCompare(right));
    const rows = entries.map(([hostname, override]) => {
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
        const next = { ...overrides };
        delete next[hostname];
        next[normalized] = override;
        void save(next);
      });

      const select = document.createElement("select");
      select.setAttribute("aria-label", message("language"));
      select.append(
        variantOption("sc", "simplifiedChinese"),
        variantOption("tc", "traditionalChinese"),
        variantOption("jp", "japanese"),
        variantOption("off", "disabled")
      );
      select.value = override;
      select.addEventListener("change", () => {
        const next = { ...overrides };
        if (isSiteOverride(select.value)) next[hostname] = select.value;
        void save(next);
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "secondary compact";
      remove.textContent = message("remove");
      remove.addEventListener("click", () => {
        const next = { ...overrides };
        delete next[hostname];
        void save(next);
      });

      row.append(hostnameInput, select, remove);
      return row;
    });
    list.replaceChildren(...rows);
    byId("noSiteOverrides").hidden = entries.length > 0;
    byId<HTMLButtonElement>("clearSiteOverrides").disabled = entries.length === 0;
  };

  const restore = async (): Promise<void> => {
    try {
      const stored = await chrome.storage.sync.get("siteOverrides");
      overrides = sanitizeSiteOverrides(stored.siteOverrides);
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

  byId<HTMLFormElement>("addSiteOverride").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = byId<HTMLInputElement>("newSiteHostname");
    const hostname = normalizeHostname(input.value);
    const override = byId<HTMLSelectElement>("newSiteVariant").value;
    if (!hostname || !isSiteOverride(override)) {
      showStatus(message("invalidWebsite"), true);
      return;
    }
    input.value = "";
    void save({ ...overrides, [hostname]: override });
  });

  byId<HTMLButtonElement>("clearSiteOverrides").addEventListener("click", () => {
    if (!Object.keys(overrides).length) return;
    if (!window.confirm(message("clearSiteOverridesConfirm"))) return;
    void save({});
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.siteOverrides) return;
    overrides = sanitizeSiteOverrides(changes.siteOverrides.newValue);
    render();
  });

  void restore();
}
