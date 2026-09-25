import { describe, expect, it } from "vitest";
import {
  analyzeCjkEvidence,
  hasStrongChineseJapaneseMix,
  isKanaOrJapaneseHanOnly
} from "../src/language/local-evidence";

const sc = new Set(Array.from("这为后里个书见说话体与买过没简废烟猫礼道丢"));
const tc = new Set(Array.from("這為後裡個書見說話體與買過沒簡廢煙貓禮道丟"));

const analyze = (text: string) => analyzeCjkEvidence(text, sc, tc);

describe("local CJK evidence", () => {
  it("recognizes a substantial Simplified Chinese paragraph", () => {
    const evidence = analyze("在一个人类与兽人共存的世界里，住着一只整天抽着烟、过着懒散生活的兽人。没钱，没生活能力，简直是个废物，礼仪和道德早就跟烟蒂一起被丢进垃圾桶了。");
    expect(evidence.strongVariant).toBe("sc");
    expect(evidence.kanaCount).toBe(0);
  });

  it("recognizes Japanese prose from kana evidence", () => {
    const evidence = analyze("人間と獣人が共存する世界で、タバコを吸ってダラダラ生きる獣人・ヤニねこ。生活力なし、ろくでなし。それでも充実した日々を過ごしています。");
    expect(evidence.strongVariant).toBe("jp");
    expect(evidence.kanaCount).toBeGreaterThanOrEqual(3);
  });

  it("leaves short titles and pure Han text unresolved", () => {
    expect(analyze("日本漫画").strongVariant).toBeNull();
    expect(analyze("おしまい").strongVariant).toBeNull();
  });

  it("recognizes standalone kana or kana with known Japanese-form Han only after the mixed gate", () => {
    for (const text of ["さよならララ", "『おしまい』", "お"]) {
      expect(analyze(text).strongVariant).toBeNull();
      expect(isKanaOrJapaneseHanOnly(text, analyze(text))).toBe(true);
    }
    expect(isKanaOrJapaneseHanOnly("働き", analyze("働き"))).toBe(true);
    for (const text of ["夜は", "大家将 さよならララ 标注为", "さよならララ TV", "東京駅"]) {
      expect(isKanaOrJapaneseHanOnly(text, analyze(text))).toBe(false);
    }
  });

  it("uses distinctive Japanese kanji forms as supporting evidence", () => {
    const evidence = analyze("東京駅周辺案内");
    expect(evidence.strongVariant).toBe("jp");
    expect(evidence.japaneseHanClues).toBeGreaterThanOrEqual(2);
  });

  it("does not let one Japanese-form name override strong Chinese prose", () => {
    const evidence = analyze("这是一本介绍东京駅的简体中文书，里面还有很多关于车站与周边生活的说明。");
    expect(evidence.strongVariant).toBe("sc");
  });

  it("does not call a Chinese paragraph strong when kana is mixed into it", () => {
    const evidence = analyze("这是一个很长的中文说明，其中引用了お兄ちゃんはおしまい作为作品标题，后面仍然继续使用中文介绍这本漫画的内容和故事。");
    expect(evidence.strongVariant).toBeNull();
  });

  it("requires substantial evidence from both Chinese and Japanese blocks", () => {
    const chinese = analyze("在一个人类与兽人共存的世界里，住着一只整天抽着烟、过着懒散生活的兽人。没钱，没生活能力，简直是个废物，礼仪和道德早就跟烟蒂一起被丢进垃圾桶了。");
    const japanese = analyze("人間と獣人が共存する世界で、タバコを吸ってダラダラ生きる獣人・ヤニねこ。生活力なし、ろくでなし。それでも充実した日々を過ごしています。");
    expect(hasStrongChineseJapaneseMix([{ evidence: chinese }, { evidence: japanese }], "sc")).toBe(true);
    expect(hasStrongChineseJapaneseMix([{ evidence: chinese }, { evidence: analyze("日本語です") }], "sc")).toBe(false);
  });

  it("combines fragmented page-language evidence without treating unresolved Han text as Chinese", () => {
    const fragmentedChinese = [
      "这是动画介绍",
      "这里可以看书",
      "用户说这话",
      "简体内容",
      "没看过这本书",
      "后面还有介绍",
      "这个页面为简体",
      "查看用户留言"
    ].map((text) => ({ evidence: analyze(text) }));
    const japanese = [
      "シナリオを手掛けるのは高い評価を得ている奈須きのこ。話題のクリエイターも参加しています。",
      "音楽を担当するのは、作品の持つ重さをサウンド面から表現するためです。"
    ].map((text) => ({ evidence: analyze(text) }));
    const unresolvedHan = { evidence: analyze("空之境界音楽作品制作一覧") };

    expect(fragmentedChinese.every(({ evidence }) => evidence.strongVariant === null)).toBe(true);
    expect(hasStrongChineseJapaneseMix([...fragmentedChinese, unresolvedHan, ...japanese], "sc"))
      .toBe(true);
  });
});
