import { describe, expect, it } from "vitest";
import {
  composeFontFamily,
  isGenericFamily,
  normalizeFamily,
  parseFamilies,
  quoteFamily,
  regionalVariantForFamily,
  usesSerifFallback
} from "../src/fonts/font-family";

describe("font-family helpers", () => {
  it("parses quoted family names without splitting their contents", () => {
    expect(parseFamilies('Inter, "Noto Sans CJK JP", sans-serif')).toEqual([
      "Inter", "Noto Sans CJK JP", "sans-serif"
    ]);
  });

  it("supports single quotes, embedded commas, whitespace, and empty entries", () => {
    expect(parseFamilies("  'A, B' ,, Arial,  ")).toEqual(["A, B", "Arial"]);
    expect(parseFamilies("")).toEqual([]);
  });

  it("normalizes only the surrounding quotes and whitespace", () => {
    expect(normalizeFamily("  'Site Font'  ")).toBe("Site Font");
    expect(normalizeFamily("Font Name")).toBe("Font Name");
  });

  it("inserts the regional fallback before the first generic family", () => {
    expect(composeFontFamily("Roboto, Arial, sans-serif", "Noto Sans CJK JP")).toBe(
      '"Roboto", "Arial", "Noto Sans CJK JP", sans-serif'
    );
  });

  it("does not add a family that is already present", () => {
    const stack = 'Roboto, "Noto Sans CJK JP", sans-serif';
    expect(composeFontFamily(stack, "Noto Sans CJK JP")).toBe(stack);
  });

  it("detects an existing fallback without regard to case", () => {
    const stack = 'Roboto, "noto sans cjk jp", sans-serif';
    expect(composeFontFamily(stack, "Noto Sans CJK JP")).toBe(stack);
  });

  it("keeps every site family in order and appends when there is no generic", () => {
    expect(composeFontFamily('"Site Latin", Arial', "Noto Sans CJK SC")).toBe(
      '"Site Latin", "Arial", "Noto Sans CJK SC"'
    );
  });

  it("inserts before the first generic even when more families follow it", () => {
    expect(composeFontFamily("Inter, system-ui, Arial, sans-serif", "Noto Sans CJK TC")).toBe(
      '"Inter", "Noto Sans CJK TC", system-ui, "Arial", sans-serif'
    );
  });

  it("puts JP before Chinese families and removes an inherited plugin SC fallback", () => {
    const base = '"SF Pro SC", "SF Pro Display", "PingFang SC", "Lucida Grande", ' +
      '"Helvetica Neue", "Helvetica", "Arial", "Verdana", "Noto Sans CJK SC", sans-serif, "Hiragino Sans GB"';
    expect(composeFontFamily(base, "Noto Sans CJK JP", "jp", ["Noto Sans CJK SC"])).toBe(
      '"SF Pro Display", "Lucida Grande", "Helvetica Neue", "Helvetica", "Arial", "Verdana", ' +
      '"Noto Sans CJK JP", "SF Pro SC", "PingFang SC", sans-serif, "Hiragino Sans GB"'
    );
  });

  it("recognizes Chinese families that commonly appear in Bangumi's stack", () => {
    expect(regionalVariantForFamily("SF Pro SC")).toBe("sc");
    expect(regionalVariantForFamily("PingFang SC")).toBe("sc");
    expect(regionalVariantForFamily("Hiragino Sans GB")).toBe("sc");
  });

  it("builds a valid stack when the original declaration is empty", () => {
    expect(composeFontFamily("", "Noto Sans CJK SC")).toBe('"Noto Sans CJK SC"');
  });

  it("escapes family names for CSS", () => {
    expect(quoteFamily('A "quoted" font')).toBe('"A \\"quoted\\" font"');
    expect(quoteFamily("A\\B")).toBe('"A\\\\B"');
  });

  it("recognizes CSS generic families case-insensitively", () => {
    expect(isGenericFamily("Sans-Serif")).toBe(true);
    expect(isGenericFamily("fangsong")).toBe(false);
    expect(isGenericFamily("emoji")).toBe(false);
    expect(isGenericFamily("Arial")).toBe(false);
  });

  it("keeps an early emoji family ahead of an inserted CJK fallback", () => {
    expect(composeFontFamily("emoji, Arial, sans-serif", "Noto Sans CJK JP", "jp")).toBe(
      '"emoji", "Arial", "Noto Sans CJK JP", sans-serif'
    );
    expect(composeFontFamily(
      '"Apple Color Emoji", "PingFang SC", sans-serif', "Noto Sans CJK JP", "jp"
    )).toBe('"Apple Color Emoji", "Noto Sans CJK JP", "PingFang SC", sans-serif');
    expect(composeFontFamily("emoji, PingFang SC, sans-serif", "Noto Sans CJK JP", "jp")).toBe(
      '"emoji", "Noto Sans CJK JP", "PingFang SC", sans-serif'
    );
    expect(composeFontFamily(
      'Arial, sans-serif, "Apple Color Emoji"', "Noto Sans CJK JP", "jp"
    )).toBe('"Arial", "Noto Sans CJK JP", sans-serif, "Apple Color Emoji"');
  });

  it("puts Japanese fallback ahead of a Chinese Fangsong family", () => {
    expect(composeFontFamily("Inter, FangSong, sans-serif", "Noto Sans CJK JP", "jp")).toBe(
      '"Inter", "Noto Sans CJK JP", "FangSong", sans-serif'
    );
    expect(composeFontFamily("Inter, STFangsong, sans-serif", "Noto Sans CJK JP", "jp")).toBe(
      '"Inter", "Noto Sans CJK JP", "STFangsong", sans-serif'
    );
  });

  it("uses Serif only for serif generic fallbacks", () => {
    expect(usesSerifFallback(parseFamilies("Georgia, serif"))).toBe(true);
    expect(usesSerifFallback(parseFamilies("Charter, ui-serif"))).toBe(true);
    expect(usesSerifFallback(parseFamilies("Inter, sans-serif"))).toBe(false);
    expect(usesSerifFallback(parseFamilies("Site Font"))).toBe(false);
    expect(usesSerifFallback(parseFamilies("Site Font, system-ui, serif"))).toBe(false);
  });
});
