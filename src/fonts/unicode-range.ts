const CJK_BLOCKS: readonly (readonly [number, number])[] = [
  [0x3040, 0x30ff],
  [0x31f0, 0x31ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xf900, 0xfaff],
  [0xff66, 0xff9d],
  [0x20000, 0x2fa1f]
];

/**
 * Intersect declared ranges with supported Han/kana blocks. Null means unknown
 * (missing, malformed or universal), not evidence of regional font coverage.
 */
export function cjkRanges(value: string): [number, number][] | null {
  const ranges = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!ranges.length) return null;
  let parsedAny = false;
  const coverage: [number, number][] = [];
  let isUniversal = false;
  for (const range of ranges) {
    const match = /^U\+([0-9A-F?]+)(?:-([0-9A-F]+))?$/i.exec(range);
    if (!match?.[1]) continue;
    parsedAny = true;
    const wildcard = match[1].includes("?");
    const start = Number.parseInt(match[1].replace(/\?/g, "0"), 16);
    const end = match[2]
      ? Number.parseInt(match[2], 16)
      : Number.parseInt(match[1].replace(/\?/g, "F"), 16);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end > 0x10ffff) continue;
    if (!wildcard && start === 0 && end >= 0x10ffff) isUniversal = true;
    for (const [blockStart, blockEnd] of CJK_BLOCKS) {
      if (start <= blockEnd && end >= blockStart) {
        coverage.push([Math.max(start, blockStart), Math.min(end, blockEnd)]);
      }
    }
  }
  return !parsedAny || isUniversal ? null : coverage;
}

/** Match supported prose characters outside a small declared CJK set. */
export function uncoveredCjkPattern(covered: ReadonlySet<number>): RegExp {
  const escape = (code: number): string => `\\u{${code.toString(16)}}`;
  const codes = [...covered].sort((a, b) => a - b);
  const uncovered: string[] = [];
  const append = (start: number, end: number): void => {
    if (start <= end) uncovered.push(start === end ? escape(start) : `${escape(start)}-${escape(end)}`);
  };
  // A positive character class lets the regex engine search directly for a missing
  // character instead of doing a negative lookahead at each position in the text.
  for (const [start, end] of [[0x3005, 0x3005] as const, ...CJK_BLOCKS]) {
    let next = start;
    for (const code of codes) {
      if (code < next) continue;
      if (code > end) break;
      append(next, code - 1);
      next = code + 1;
    }
    append(next, end);
  }
  return new RegExp(`[${uncovered.join("")}]`, "u");
}
