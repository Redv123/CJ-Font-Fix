export interface TextRange {
  start: number;
  end: number;
}

/**
 * Isolates a work title from Bangumi's fixed Chinese heading template.
 *
 * This is deliberately a site adapter rather than a general whitespace rule:
 * most Chinese and Japanese inline text cannot be separated safely by spaces.
 */
export function findBangumiTitleRange(text: string): TextRange[] {
  const match = /^(\s*大家将\s+)(.+?)(\s+标注为\s*)$/su.exec(text);
  if (!match?.[1] || !match[2]) return [];
  const start = match[1].length;
  return [{ start, end: start + match[2].length }];
}
