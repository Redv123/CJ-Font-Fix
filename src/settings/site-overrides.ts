import type { SiteOverride } from "../shared/types";

/** Validates and normalizes the hostname-keyed settings stored by the UI. */
export function isSiteOverride(value: unknown): value is SiteOverride {
  return value === "sc" || value === "tc" || value === "jp" || value === "off";
}

export function sanitizeSiteOverrides(value: unknown): Record<string, SiteOverride> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, SiteOverride> = {};
  for (const [hostname, override] of Object.entries(value)) {
    if (hostname && isSiteOverride(override)) result[hostname] = override;
  }
  return result;
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
