/** Content scripts ask the worker; extension pages can query the platform directly. */
export async function getPlatformOs(): Promise<chrome.runtime.PlatformInfo["os"] | null> {
  try {
    const info: chrome.runtime.PlatformInfo | null = typeof chrome.runtime.getPlatformInfo === "function"
      ? await chrome.runtime.getPlatformInfo()
      : await chrome.runtime.sendMessage({ type: "getPlatformInfo" });
    return info?.os ?? null;
  } catch (error) {
    console.warn("CJ Font Fallback Fix could not read the browser platform:", error);
    return null;
  }
}
