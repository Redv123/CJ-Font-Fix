import { describe, expect, it } from "vitest";
import {
  getSiteOverride,
  isSiteOverride,
  normalizeHostname,
  sanitizeSiteOverrides
} from "../src/settings/site-overrides";

describe("site override values", () => {
  it.each(["sc", "tc", "jp", "off"])("accepts %s", (value) => {
    expect(isSiteOverride(value)).toBe(true);
  });

  it.each(["auto", "zh", "", null, undefined, 1])("rejects %j", (value) => {
    expect(isSiteOverride(value)).toBe(false);
  });

  it("keeps only valid stored records", () => {
    expect(sanitizeSiteOverrides({
      "example.com": "sc",
      "example.jp": "jp",
      "disabled.example": "off",
      "invalid.example": "auto",
      "": "tc"
    })).toEqual({
      "example.com": "sc",
      "example.jp": "jp",
      "disabled.example": "off"
    });
  });

  it.each([null, undefined, "example.com", 42])("turns non-record storage value %j into an empty map", (value) => {
    expect(sanitizeSiteOverrides(value)).toEqual({});
  });
});

describe("site hostname normalization", () => {
  it.each([
    ["example.com", "example.com"],
    ["  EXAMPLE.COM  ", "example.com"],
    ["https://Example.COM/path?q=1#result", "example.com"],
    ["http://example.com:8080/path", "example.com"],
    ["example.com.", "example.com"],
    ["例え.jp", "xn--r8jz45g.jp"],
    ["sub.example.com", "sub.example.com"]
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeHostname(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "not a host",
    "chrome://settings",
    "file:///tmp/example.html",
    "ftp://example.com"
  ])("rejects invalid or unsupported input %j", (input) => {
    expect(normalizeHostname(input)).toBeNull();
  });
});


describe("site rule matching", () => {
  it("ignores inherited object properties when matching a local hostname", () => {
    expect(getSiteOverride({ siteOverrides: {}, siteDomainOverrides: {} }, "constructor", null)).toBe("auto");
  });
  it("keeps an explicit automatic exception in hostname settings", () => {
    expect(sanitizeSiteOverrides({ "zh.example.com": "auto" }, true)).toEqual({ "zh.example.com": "auto" });
  });
  it.each(["sc", "off", "auto"] as const)("lets an exact %s choice override the domain choice", (choice) => {
    expect(getSiteOverride({ siteOverrides: { "zh.example.com": choice }, siteDomainOverrides: { "example.com": "jp" } }, "zh.example.com", "example.com")).toBe(choice);
  });
  it("keeps separate hosted sites and local hosts automatic", () => {
    const rules = { siteOverrides: {}, siteDomainOverrides: { "alice.github.io": "jp", "github.io": "off", "example.com": "sc" } } as const;
    expect(getSiteOverride(rules, "bob.github.io", "bob.github.io")).toBe("auto");
    expect(getSiteOverride(rules, "localhost", null)).toBe("auto");
  });
  it("uses a domain choice for related subdomains", () => {
    expect(getSiteOverride({ siteOverrides: {}, siteDomainOverrides: { "example.co.uk": "jp" } }, "m.example.co.uk", "example.co.uk")).toBe("jp");
  });
});
