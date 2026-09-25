import { describe, expect, it } from "vitest";
import { findBangumiTitleRange } from "../src/fallback/site-rules/bangumi";

describe("Bangumi heading rule", () => {
  it("isolates the complete title between the fixed Chinese labels", () => {
    const text = "大家将 魔法使いの夜 オリジナルサウンドトラック 标注为";
    const ranges = findBangumiTitleRange(text);
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([
      "魔法使いの夜 オリジナルサウンドトラック"
    ]);
  });

  it("keeps English and pure-Han suffixes inside the title", () => {
    const text = "大家将 Re:ゼロから始める異世界生活 4th season 奪還編 标注为";
    const ranges = findBangumiTitleRange(text);
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([
      "Re:ゼロから始める異世界生活 4th season 奪還編"
    ]);
  });

  it("does not split text without the site template", () => {
    expect(findBangumiTitleRange("魔法使いの夜 オリジナルサウンドトラック")).toEqual([]);
  });
});
