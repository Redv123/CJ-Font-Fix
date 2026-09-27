/** Bounded, opt-in local clues; never a complete CJK language dictionary. */
import { CJK_TEXT_RE } from "../page/candidate-scan";
import type { Variant } from "../shared/types";
import { JAPANESE_CHARACTER_CLUES } from "./japanese-character-clues";

export interface CjkEvidence {
  cjkCount: number;
  kanaCount: number;
  japaneseCharacterClues: number;
  scClues: number;
  tcClues: number;
  distinctJapaneseCharacterClues: number;
  distinctScClues: number;
  distinctTcClues: number;
  strongVariant: Variant | null;
}

export interface LocalEvidenceSample {
  evidence: CjkEvidence;
}

const KANA_RE = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d]/u;
const JAPANESE_TEXT_RE = /^[\u3005\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9d\p{Script=Han}\s\p{P}\p{S}]+$/u;

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
  let japaneseCharacterClues = 0;
  let scClues = 0;
  let tcClues = 0;
  const distinctJapaneseCharacters = new Set<string>();
  const distinctSc = new Set<string>();
  const distinctTc = new Set<string>();

  for (const char of text.slice(0, 500)) {
    if (CJK_TEXT_RE.test(char)) cjkCount++;
    if (KANA_RE.test(char)) kanaCount++;
    if (JAPANESE_CHARACTER_CLUES.has(char)) {
      japaneseCharacterClues++;
      distinctJapaneseCharacters.add(char);
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
    japaneseCharacterClues >= 2 &&
    distinctJapaneseCharacters.size >= 2 &&
    japaneseCharacterClues / cjkCount >= 0.08
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
    japaneseCharacterClues,
    scClues,
    tcClues,
    distinctJapaneseCharacterClues: distinctJapaneseCharacters.size,
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
  if (text.length > 500 || !JAPANESE_TEXT_RE.test(text)) return false;
  if (evidence.kanaCount > 0 &&
    evidence.cjkCount === evidence.kanaCount + evidence.japaneseCharacterClues) return true;
  return false;
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
  const scriptCount = evidence.cjkCount;
  if (!precedingVariant || evidence.strongVariant || scriptCount < 2 || scriptCount > 30) return null;
  if (precedingVariant === "jp") {
    if (evidence.scClues >= 2 || evidence.tcClues >= 2) return null;
    return evidence.kanaCount > 0 || evidence.japaneseCharacterClues > 0 ? "jp" : null;
  }
  if (evidence.kanaCount > 0 || evidence.japaneseCharacterClues > 0) return null;
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
