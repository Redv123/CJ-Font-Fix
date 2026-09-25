import { describe, expect, it } from "vitest";
import { classifyUnicodeRange } from "../src/fonts/unicode-range";

describe("unicode-range classification", () => {
  it("recognizes explicit CJK coverage", () => {
    expect(classifyUnicodeRange("U+4E00-9FFF")).toBe("cjk");
    expect(classifyUnicodeRange("U+3040-30FF")).toBe("cjk");
    expect(classifyUnicodeRange("u+20000-2a6df")).toBe("cjk");
    expect(classifyUnicodeRange("U+4E??")).toBe("cjk");
  });

  it("recognizes overlap with a CJK block, not only exact block declarations", () => {
    expect(classifyUnicodeRange("U+3000-3050")).toBe("cjk");
    expect(classifyUnicodeRange("U+FF00-FF70")).toBe("cjk");
  });

  it("checks every range in a comma-separated declaration", () => {
    expect(classifyUnicodeRange("U+0000-00FF, U+3400-4DBF")).toBe("cjk");
    expect(classifyUnicodeRange("invalid, U+0100-024F")).toBe("other");
  });

  it("distinguishes non-CJK and universal declarations", () => {
    expect(classifyUnicodeRange("U+0000-00FF")).toBe("other");
    expect(classifyUnicodeRange("U+0-10FFFF")).toBe("unknown");
    expect(classifyUnicodeRange("U+000000-10FFFF, U+4E00-9FFF")).toBe("unknown");
    expect(classifyUnicodeRange("")).toBe("unknown");
    expect(classifyUnicodeRange("normal")).toBe("unknown");
    expect(classifyUnicodeRange("U+00??")).toBe("other");
  });
});
