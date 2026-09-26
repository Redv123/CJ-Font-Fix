/** Bounded, opt-in local clues; never a complete CJK language dictionary. */
import { CJK_TEXT_RE } from "../page/candidate-scan";
import type { Variant } from "../shared/types";

export interface CjkEvidence {
  cjkCount: number;
  kanaCount: number;
  iterationMarkCount: number;
  japaneseHanClues: number;
  scClues: number;
  tcClues: number;
  distinctJapaneseHanClues: number;
  distinctScClues: number;
  distinctTcClues: number;
  strongVariant: Variant | null;
}

export interface LocalEvidenceSample {
  evidence: CjkEvidence;
}

const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/u;
const KANA_OR_HAN_RE = /^[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d\p{Script=Han}々\s\p{P}\p{S}]+$/u;

// Common kokuji and Japanese character forms which differ from both modern
// Simplified and Traditional Chinese. They are supporting evidence rather
// than a complete Japanese kanji dictionary.
const JAPANESE_HAN_CLUES = new Set(Array.from(
  "働畑峠込辻榊栃凪凧匂枠駅円桜沢浜辺鉄広仏払塩県児徳黒歩歳気対団図伝転読続楽帰険処実収渋縄戦銭庁脳売竜亜悪圧囲栄縁"
));

/**
 * Return a variant only when one segment clears local thresholds. Null means
 * inherit the page result, not that the text contains no CJK. Japanese-form
 * Han clues are weaker than kana and can mislabel short Chinese quotations of
 * Japanese titles or place names; this path is gated by mixed-page opt-in.
 */
export function analyzeCjkEvidence(
  text: string,
  simplifiedClues: ReadonlySet<string>,
  traditionalClues: ReadonlySet<string>
): CjkEvidence {
  let cjkCount = 0;
  let kanaCount = 0;
  let iterationMarkCount = 0;
  let japaneseHanClues = 0;
  let scClues = 0;
  let tcClues = 0;
  const distinctJapaneseHan = new Set<string>();
  const distinctSc = new Set<string>();
  const distinctTc = new Set<string>();

  for (const char of text.slice(0, 500)) {
    if (CJK_TEXT_RE.test(char)) cjkCount++;
    if (KANA_RE.test(char)) kanaCount++;
    if (char === "々") iterationMarkCount++;
    if (JAPANESE_HAN_CLUES.has(char)) {
      japaneseHanClues++;
      distinctJapaneseHan.add(char);
    }
    if (simplifiedClues.has(char)) {
      scClues++;
      distinctSc.add(char);
    }
    if (traditionalClues.has(char)) {
      tcClues++;
      distinctTc.add(char);
    }
  }

  let strongVariant: Variant | null = null;
  const hasStrongChineseClues =
    (scClues >= 4 && distinctSc.size >= 3) || (tcClues >= 4 && distinctTc.size >= 3);
  const requiredKanaShare = hasStrongChineseClues ? 0.25 : 0.10;
  if (cjkCount >= 10 && kanaCount >= 3 && kanaCount / cjkCount >= requiredKanaShare) {
    strongVariant = "jp";
  } else if (
    cjkCount >= 2 &&
    !hasStrongChineseClues &&
    japaneseHanClues >= 1 &&
    japaneseHanClues / cjkCount >= 0.08
  ) {
    strongVariant = "jp";
  } else if (cjkCount >= 25 && kanaCount === 0) {
    const scStrong = scClues >= 4 && distinctSc.size >= 3 && scClues >= Math.max(1, tcClues) * 2;
    const tcStrong = tcClues >= 4 && distinctTc.size >= 3 && tcClues >= Math.max(1, scClues) * 2;
    if (scStrong !== tcStrong) strongVariant = scStrong ? "sc" : "tc";
  }

  return {
    cjkCount,
    kanaCount,
    iterationMarkCount,
    japaneseHanClues,
    scClues,
    tcClues,
    distinctJapaneseHanClues: distinctJapaneseHan.size,
    distinctScClues: distinctSc.size,
    distinctTcClues: distinctTc.size,
    strongVariant
  };
}

/**
 * A self-contained Japanese-script segment may be short without being
 * ambiguous. This is only a local choice after the mixed-page gate has passed;
 * these segments do not contribute to activating that gate.
 */
export function isShortJapaneseScriptSegment(text: string, evidence: CjkEvidence): boolean {
  if (text.length > 500 || !KANA_OR_HAN_RE.test(text)) return false;
  if (evidence.kanaCount > 0 &&
    evidence.cjkCount === evidence.kanaCount + evidence.japaneseHanClues) return true;

  // Count the iteration mark as independent but weaker Japanese evidence.
  // It can tip a short ambiguous line over the threshold alongside kana or
  // Japanese-form Han, but cannot classify an otherwise uninformative line.
  const scriptCount = evidence.cjkCount + evidence.iterationMarkCount;
  const japaneseScore = evidence.kanaCount * 2 +
    evidence.japaneseHanClues + evidence.iterationMarkCount * 0.5;
  return evidence.iterationMarkCount > 0 && scriptCount <= 20 &&
    evidence.scClues < 4 && evidence.tcClues < 4 &&
    japaneseScore >= 2.5 && japaneseScore / scriptCount >= 0.5;
}

/**
 * A confirmed preceding segment may resolve a short ambiguous neighbor, but
 * it cannot assign a language to shared Han text with no local script clues.
 * Callers must provide only one directly adjacent, independently classified
 * segment; passing a context-derived choice would allow errors to cascade.
 */
export function variantFromPrecedingEvidence(
  evidence: CjkEvidence,
  precedingVariant: Variant | null
): Variant | null {
  const scriptCount = evidence.cjkCount + evidence.iterationMarkCount;
  if (!precedingVariant || evidence.strongVariant || scriptCount < 2 || scriptCount > 30) return null;
  if (precedingVariant === "jp") {
    if (evidence.scClues >= 2 || evidence.tcClues >= 2) return null;
    return evidence.kanaCount > 0 || evidence.iterationMarkCount > 0 ||
      evidence.japaneseHanClues > 0 ? "jp" : null;
  }
  if (evidence.kanaCount > 0 || evidence.iterationMarkCount > 0 ||
      evidence.japaneseHanClues > 0) return null;
  const matching = precedingVariant === "sc" ? evidence.scClues : evidence.tcClues;
  const conflicting = precedingVariant === "sc" ? evidence.tcClues : evidence.scClues;
  return matching > 0 && conflicting === 0 ? precedingVariant : null;
}

/**
 * Gate local styling on substantial evidence for both languages across the
 * already-collected segments. This does not re-detect the remaining page or
 * change its page-level language result.
 */
export function hasStrongChineseJapaneseMix(
  samples: readonly LocalEvidenceSample[],
  pageVariant: Variant
): boolean {
  let pageEvidenceCharacters = 0;
  let opposingCharacters = 0;
  let opposingBlocks = 0;
  let longestOpposingBlock = 0;

  for (const { evidence } of samples) {
    const isOpposing = pageVariant === "jp"
      ? evidence.strongVariant === "sc" || evidence.strongVariant === "tc"
      : evidence.strongVariant === "jp";
    if (isOpposing) {
      opposingCharacters += evidence.cjkCount;
      opposingBlocks++;
      longestOpposingBlock = Math.max(longestOpposingBlock, evidence.cjkCount);
      continue;
    }

    if (pageVariant === "jp") {
      if (evidence.strongVariant === "jp") pageEvidenceCharacters += evidence.cjkCount;
      continue;
    }

    const pageClues = pageVariant === "sc" ? evidence.scClues : evidence.tcClues;
    const otherClues = pageVariant === "sc" ? evidence.tcClues : evidence.scClues;
    if (
      evidence.strongVariant === pageVariant ||
      (evidence.kanaCount === 0 && pageClues > otherClues)
    ) {
      pageEvidenceCharacters += evidence.cjkCount;
    }
  }

  const classifiedCharacters = opposingCharacters + pageEvidenceCharacters;
  if (opposingCharacters < 40 || pageEvidenceCharacters < 40) return false;
  if (Math.min(opposingCharacters, pageEvidenceCharacters) / classifiedCharacters < 0.15) return false;
  return opposingBlocks >= 2 || longestOpposingBlock >= 40;
}
