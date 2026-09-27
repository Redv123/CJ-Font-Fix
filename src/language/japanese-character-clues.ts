/**
 * Conservative character evidence for Japanese text.
 *
 * This is not a kanji dictionary. It combines a manually reviewed seed
 * (including common kokuji) with Japanese standard forms that differ from
 * their older forms. Candidates found in the CLDR Simplified or Traditional
 * Chinese exemplar sets are excluded so common Chinese characters do not
 * gain Japanese weight.
 * See docs/japanese-character-clues-research.md for sources and maintenance.
 */
export const JAPANESE_CHARACTER_CLUES = new Set(Array.from([
  // Common Japanese-created characters retained from the reviewed seed.
  "働畑峠込辻榊栃凪凧匂枠",
  // Japanese forms retained after excluding common SC and TC exemplars.
  "駅円桜沢浜辺鉄広仏払塩県児徳黒歩歳気対団図伝転読続楽帰険処実収渋縄戦銭庁脳売竜亜悪圧囲栄縁霊",
  "壱隠営艶応穏仮価絵壊懐拡殻覚渇巻陥勧寛関歓観戯犠拠挙郷暁駆勲薫恵掲渓経蛍軽継鶏芸撃倹剣圏検権顕験厳効鉱",
  "砕済斎剤雑桟賛歯釈従獣縦粛渉焼奨乗浄剰畳壌嬢譲醸粋酔穂髄瀬斉摂専繊荘捜挿巣曽痩総騒増蔵臓帯滝択単弾遅",
  "鋳徴聴勅逓稲闘弐悩覇拝廃発髪抜晩併変豊毎満麺黙訳薬揺様謡頼覧両猟緑涙塁戻齢暦歴錬労録",
  // U+3005 is supporting evidence, not a standalone Japanese decision.
  "々"
].join("")));
