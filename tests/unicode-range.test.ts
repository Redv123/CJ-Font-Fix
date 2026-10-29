import { describe, expect, it } from "vitest";
import { cjkRanges, uncoveredCjkPattern } from "../src/fonts/unicode-range";

describe("declared CJK ranges", () => {
  it("recognizes explicit CJK coverage", () => {
    expect(cjkRanges("U+4E00-9FFF")).toEqual([[0x4e00, 0x9fff]]);
    expect(cjkRanges("U+3040-30FF")).toEqual([[0x3040, 0x30ff]]);
    expect(cjkRanges("u+20000-2a6df")).toEqual([[0x20000, 0x2a6df]]);
    expect(cjkRanges("U+4E??")).toEqual([[0x4e00, 0x4eff]]);
  });

  it("recognizes overlap with a CJK block, not only exact block declarations", () => {
    expect(cjkRanges("U+3000-3050")).toEqual([[0x3040, 0x3050]]);
    expect(cjkRanges("U+FF00-FF70")).toEqual([[0xff66, 0xff70]]);
  });

  it("checks every range in a comma-separated declaration", () => {
    expect(cjkRanges("U+0000-00FF, U+3400-4DBF")).toEqual([[0x3400, 0x4dbf]]);
    expect(cjkRanges("invalid, U+0100-024F")).toEqual([]);
  });

  it("distinguishes non-CJK and universal declarations", () => {
    expect(cjkRanges("U+0000-00FF")).toEqual([]);
    expect(cjkRanges("U+0-10FFFF")).toEqual(null);
    expect(cjkRanges("U+000000-10FFFF, U+4E00-9FFF")).toEqual(null);
    expect(cjkRanges("")).toEqual(null);
    expect(cjkRanges("normal")).toEqual(null);
    expect(cjkRanges("U+00??")).toEqual([]);
  });
});


it("intersects declared ranges and matches uncovered supplementary Han and kana", () => {
  expect(cjkRanges("U+3000-3050, U+4E00")).toEqual([[0x3040, 0x3050], [0x4e00, 0x4e00]]);
  expect(cjkRanges("U+0000-10FFFF, U+4E00")).toBeNull();
  const pattern = uncoveredCjkPattern(new Set([0x4e00, 0x20000]));
  expect(pattern.test("一𠀀abc")).toBe(false);
  expect(pattern.test("𠀁")).toBe(true);
  expect(pattern.test("あ")).toBe(true);
  expect(pattern.test("々")).toBe(true);
});
