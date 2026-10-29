import { defineConfig } from "@playwright/test";
import sitesConfig from "./playwright.sites.config";

export default defineConfig(sitesConfig, {
  testIgnore: ["**/real-sites.spec.ts", "**/flores-corpus.spec.ts", "**/rendered-fonts.spec.ts"],
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  globalTimeout: 10 * 60 * 1000
});
