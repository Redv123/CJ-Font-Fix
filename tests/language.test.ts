import { describe, expect, it } from "vitest";
import { classifyChinese, langToVariant, variantToLang } from "../src/language/tags";
import { defaultChineseForLanguage } from "../src/settings/defaults";

const simplifiedClues = new Set(Array.from("这为后里个书说话简体语设置买贵没单凑"));
const traditionalClues = new Set(Array.from("這為後裡個書說話簡體語設置買貴沒單湊"));

describe("language helpers", () => {
  it.each([
    ["zh-CN", "sc"],
    ["zh-TW", "tc"]
  ] as const)("maps browser UI language %j to Chinese default %j", (language, expected) => {
    expect(defaultChineseForLanguage(language)).toBe(expected);
  });

  it("maps specific Chinese and Japanese language tags", () => {
    expect(langToVariant("zh-Hans-CN")).toBe("sc");
    expect(langToVariant("zh-HK")).toBe("tc");
    expect(langToVariant("zh")).toBe("zh");
    expect(langToVariant("ja-JP")).toBe("jp");
    expect(langToVariant("en-US")).toBeNull();
  });

  it.each([
    [" ZH_hant_HK ", "tc"],
    ["zh-MO", "tc"],
    ["zh-Hans-SG", "sc"],
    ["zh-MY", "sc"],
    ["JA_jp", "jp"],
    ["zh", "zh"],
    ["", null]
  ] as const)("maps language tag %j to %j", (tag, expected) => {
    expect(langToVariant(tag)).toBe(expected);
  });

  it("maps variants back to root language tags", () => {
    expect(variantToLang("sc")).toBe("zh-CN");
    expect(variantToLang("tc")).toBe("zh-TW");
    expect(variantToLang("jp")).toBe("ja");
    expect(variantToLang(null)).toBe("");
  });

  it("classifies ordinary Simplified and Traditional Chinese prose", () => {
    const simplified = "这次是为了凑单，买了一本漫画，这个漫画其实是有中文版的。";
    const traditional = "這次是為了湊單，買了一本漫畫，這個漫畫其實是有中文版的。";

    expect(classifyChinese(simplified, simplifiedClues, traditionalClues, "tc")).toBe("sc");
    expect(classifyChinese(traditional, simplifiedClues, traditionalClues, "sc")).toBe("tc");
  });

  it("uses the configured default for text shared by both writing systems", () => {
    const sharedText = "日本漫画中心";

    expect(classifyChinese(sharedText, simplifiedClues, traditionalClues, "sc")).toBe("sc");
    expect(classifyChinese(sharedText, simplifiedClues, traditionalClues, "tc")).toBe("tc");
  });

  it("does not let a bilingual language selector override the configured page default", () => {
    const languageSelector = "语言设置：简体中文 / 語言設置：繁體中文";

    expect(classifyChinese(languageSelector, simplifiedClues, traditionalClues, "sc")).toBe("sc");
    expect(classifyChinese(languageSelector, simplifiedClues, traditionalClues, "tc")).toBe("tc");
  });
});
