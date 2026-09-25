import { afterEach, describe, expect, it, vi } from "vitest";
import { PageLanguageDetector } from "../src/page/page-language";
import { DEFAULTS } from "../src/settings/defaults";
import type { Settings } from "../src/shared/types";

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    ...DEFAULTS,
    siteOverrides: {},
    ...overrides
  };
}

function browserEnvironment(
  htmlLang: string,
  detectLanguage = vi.fn().mockResolvedValue({ isReliable: false, languages: [] })
): typeof detectLanguage {
  vi.stubGlobal("document", { documentElement: { lang: htmlLang } });
  vi.stubGlobal("location", { hostname: "example.com" });
  vi.stubGlobal("chrome", { i18n: { detectLanguage } });
  return detectLanguage;
}

function detectorWithSample(sample: string): PageLanguageDetector {
  const detector = new PageLanguageDetector();
  vi.spyOn(detector, "collectSample").mockReturnValue(sample);
  return detector;
}

function resultListEnvironment() {
  const results = { tagName: "OL", parentElement: null, isConnected: true,
    contains: (node: unknown) => node === result };
  const adItem = { tagName: "LI", parentElement: results, isConnected: true,
    contains: () => false };
  const resultItem = { tagName: "LI", parentElement: results, isConnected: true };
  const ad = { tagName: "ARTICLE", parentElement: adItem, isConnected: true };
  const result = { tagName: "ARTICLE", parentElement: resultItem, isConnected: true };
  const articles: object[] = [ad];
  const textByRoot = new Map<object, string[]>([
    [ad, ["Report Ad", "Köp Pokemon Kläder Online"]],
    [results, ["Report Ad", "Köp Pokemon Kläder Online", "ポケモン公式サイト", "ポケモン図鑑"]]
  ]);
  vi.stubGlobal("NodeFilter", { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 });
  vi.stubGlobal("document", {
    title: "ポケモン at DuckDuckGo",
    body: { tagName: "BODY", isConnected: true },
    querySelector: (selector: string) => selector === "article" ? articles[0] : null,
    querySelectorAll: (selector: string) => selector === "article" ? articles : [],
    createTreeWalker: (root: object, _whatToShow: number,
      filter: { acceptNode: (node: Node) => number }) => {
      const nodes = (textByRoot.get(root) || []).map((nodeValue) => ({
        nodeValue,
        parentElement: { closest: () => null }
      }));
      let index = 0;
      return {
        nextNode: () => {
          while (index < nodes.length) {
            const node = nodes[index++];
            if (filter.acceptNode(node as unknown as Node) === NodeFilter.FILTER_ACCEPT) return node;
          }
          return null;
        }
      };
    }
  });
  return { articles, result };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("page language decision order", () => {
  it("samples the result list rather than only its first ad article", () => {
    const { articles, result } = resultListEnvironment();
    articles.push(result);

    const sample = new PageLanguageDetector().collectSample();

    expect(sample).toContain("ポケモン公式サイト");
    expect(sample).toContain("ポケモン図鑑");
  });

  it("switches from a lone article to its result list when another article arrives", () => {
    const { articles, result } = resultListEnvironment();
    const detector = new PageLanguageDetector();
    expect(detector.collectSample()).not.toContain("ポケモン図鑑");

    articles.push(result);

    expect(detector.collectSample()).toContain("ポケモン図鑑");
  });

  it("treats an added result article as a change to the sampled region", () => {
    const { result } = resultListEnvironment();
    const detector = new PageLanguageDetector();
    detector.collectSample();
    vi.stubGlobal("Node", { TEXT_NODE: 3 });
    class AddedResult {
      readonly nodeType = 1;
      matches(): boolean { return false; }
      querySelector(): object { return result; }
    }
    vi.stubGlobal("Element", AddedResult);
    const addedResult = new AddedResult();

    expect(detector.touchesSample(addedResult as unknown as Node, true)).toBe(true);
  });

  it("disables the page before consulting its lang or contents", async () => {
    const detectLanguage = browserEnvironment("ja");
    const detector = detectorWithSample("日本語のページです");

    const result = await detector.detect(
      settings({ siteOverrides: { "example.com": "off" } }),
      () => "sc",
      null
    );

    expect(result.variant).toBeNull();
    expect(result.detection.reason).toBe("Disabled for this site");
    expect(detector.collectSample).not.toHaveBeenCalled();
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("gives an explicit site language precedence over the HTML lang", async () => {
    const detectLanguage = browserEnvironment("ja-JP");
    const result = await detectorWithSample("日本語のページです").detect(
      settings({ siteOverrides: { "example.com": "tc" } }),
      () => "sc",
      null
    );

    expect(result.variant).toBe("tc");
    expect(result.detection.reason).toBe("Site override");
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it.each([
    ["ja-JP", "jp"],
    ["zh-Hans", "sc"],
    ["zh-Hant", "tc"]
  ] as const)("trusts the specific HTML lang %s", async (htmlLang, expected) => {
    const detectLanguage = browserEnvironment(htmlLang);
    const result = await detectorWithSample("contents do not matter").detect(
      settings(),
      () => "sc",
      null
    );

    expect(result.variant).toBe(expected);
    expect(result.detection.reason).toBe("HTML lang");
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("uses Chinese script clues for an unspecific zh declaration", async () => {
    const detectLanguage = browserEnvironment("zh");
    const classify = vi.fn().mockReturnValue("tc");
    const result = await detectorWithSample("這是一段繁體中文內容").detect(
      settings(),
      classify,
      null
    );

    expect(result.variant).toBe("tc");
    expect(result.detection.reason).toBe("HTML lang + Chinese script clues");
    expect(classify).toHaveBeenCalledWith("這是一段繁體中文內容");
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("keeps a mostly Chinese mixed-language page Chinese when Chrome detects zh", async () => {
    const sample = [
      "我之前一直想买原版漫画来着，不过好像因为单行本太贵了所以没买。",
      "《お兄ちゃんはおしまい》",
      "这个漫画其实是有中文版的，还是官方的。"
    ].join("\n");
    const detectLanguage = browserEnvironment("", vi.fn().mockResolvedValue({
      isReliable: true,
      languages: [{ language: "zh-CN", percentage: 86 }]
    }));
    const classify = vi.fn().mockReturnValue("sc");

    const result = await detectorWithSample(sample).detect(settings(), classify, null);

    expect(result.variant).toBe("sc");
    expect(result.detection.reason).toBe("Chrome detection + Chinese script clues");
    expect(detectLanguage).toHaveBeenCalledOnce();
  });

  it("uses the leading Chinese result on mixed content despite an unstable reliability flag", async () => {
    const sample = [
      "Bangumi 番组计划 动画 书籍 游戏 音乐 登录 注册",
      "中文名：尼古喵喵，话数十二，放送星期四。",
      "原作：にゃんにゃんファクトリー（講談社「ヤングマガジン」連載）"
    ].join("\n");
    browserEnvironment("", vi.fn().mockResolvedValue({
      isReliable: false,
      languages: [
        { language: "zh", percentage: 48 },
        { language: "ja", percentage: 43 }
      ]
    }));
    const classify = vi.fn().mockReturnValue("sc");

    const result = await detectorWithSample(sample).detect(settings(), classify, null);

    expect(result.variant).toBe("sc");
    expect(result.detection.reason).toBe("Chrome detection + Chinese script clues");
    expect(classify).toHaveBeenCalledWith(sample);
  });

  it("keeps a clearly Japanese page Japanese even if Chrome also reports some Chinese", async () => {
    const sample = "日本語のページです。漫画とアニメについて紹介しています。";
    browserEnvironment("", vi.fn().mockResolvedValue({
      isReliable: true,
      languages: [
        { language: "ja", percentage: 82 },
        { language: "zh", percentage: 12 }
      ]
    }));

    const result = await detectorWithSample(sample).detect(settings(), () => "sc", null);

    expect(result.variant).toBe("jp");
    expect(result.detection.reason).toBe("Chrome language detection");
  });

  it("falls back to Japanese when language detection fails but kana evidence is strong", async () => {
    browserEnvironment("", vi.fn().mockRejectedValue(new Error("unavailable")));
    vi.spyOn(console, "debug").mockImplementation(() => undefined);

    const result = await detectorWithSample("漫画お兄ちゃんはおしまい物語です").detect(
      settings(),
      () => "sc",
      null
    );

    expect(result.variant).toBe("jp");
    expect(result.detection.reason).toBe("Japanese kana fallback");
  });

  it("does not activate for a page with no CJK text", async () => {
    const detectLanguage = browserEnvironment("");
    const result = await detectorWithSample("An ordinary English page").detect(
      settings(),
      () => "sc",
      null
    );

    expect(result.variant).toBeNull();
    expect(result.detection.reason).toBe("No CJK text");
    expect(detectLanguage).not.toHaveBeenCalled();
  });

  it("caches an unchanged automatic detection result", async () => {
    const detectLanguage = browserEnvironment("", vi.fn().mockResolvedValue({
      isReliable: true,
      languages: [{ language: "zh", percentage: 90 }]
    }));
    const detector = detectorWithSample("这是足够长的中文内容用于检测");
    const currentSettings = settings();

    const first = await detector.detect(currentSettings, () => "sc", null);
    const second = await detector.detect(currentSettings, () => "sc", null);

    expect(first.variant).toBe("sc");
    expect(second.variant).toBe("sc");
    expect(detectLanguage).toHaveBeenCalledOnce();
  });
});
