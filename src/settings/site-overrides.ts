import type { Settings, SiteChoice, SiteOverride, SiteRuleSnapshot } from "../shared/types";

let pageDomain: string | null = null;

/** Content scripts cannot access publicSuffix; resolve once through the worker. */
export async function initializeSiteDomain(): Promise<void> {
  pageDomain = await chrome.runtime.sendMessage({ type: "getSiteDomain" });
}

export function currentSiteDomain(): string | null {
  return pageDomain;
}

export function getSiteOverride(
  settings: Pick<Settings, "siteOverrides" | "siteDomainOverrides">,
  hostname = location.hostname,
  domain: string | null = pageDomain
): SiteChoice {
  const exact = Object.hasOwn(settings.siteOverrides, hostname) ? settings.siteOverrides[hostname] : undefined;
  if (isSiteChoice(exact)) return exact;
  const domains = settings.siteDomainOverrides;
  const inherited = domain && domains && Object.hasOwn(domains, domain) ? domains[domain] : undefined;
  return isSiteOverride(inherited) ? inherited : "auto";
}

/** Validates and normalizes the hostname-keyed settings stored by the UI. */
export function isSiteOverride(value: unknown): value is SiteOverride {
  return value === "sc" || value === "tc" || value === "jp" || value === "off";
}

export function isSiteChoice(value: unknown): value is SiteChoice {
  return value === "auto" || isSiteOverride(value);
}

export function sanitizeSiteOverrides(value: unknown, allowAutomatic: true): Record<string, SiteChoice>;
export function sanitizeSiteOverrides(value: unknown, allowAutomatic?: false): Record<string, SiteOverride>;
export function sanitizeSiteOverrides(value: unknown, allowAutomatic = false): Record<string, SiteChoice> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, SiteChoice> = {};
  for (const [hostname, override] of Object.entries(value)) {
    if (hostname && (isSiteOverride(override) || (allowAutomatic && override === "auto"))) {
      Object.defineProperty(result, hostname, { value: override, enumerable: true, configurable: true, writable: true });
    }
  }
  return result;
}

/** Auto needs a record only when it bypasses a saved domain choice. */
export function siteRulesFromStorage(
  stored: Record<string, unknown>,
  domainForHostname: (hostname: string) => string | null | undefined
): SiteRuleSnapshot {
  const siteOverrides = sanitizeSiteOverrides(stored.siteOverrides, true);
  const siteDomainOverrides = sanitizeSiteOverrides(stored.siteDomainOverrides);
  for (const [hostname, choice] of Object.entries(siteOverrides)) {
    if (choice !== "auto") continue;
    const normalized = normalizeHostname(hostname);
    const domain = normalized ? domainForHostname(normalized) : null;
    if (!domain || !Object.hasOwn(siteDomainOverrides, domain)) delete siteOverrides[hostname];
  }
  return { siteOverrides, siteDomainOverrides };
}

/** Accept a URL or bare host, but store only its normalized hostname. */
export function normalizeHostname(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase().replace(/\.$/, "") || null;
  } catch {
    return null;
  }
}
