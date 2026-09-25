/** Whether an @font-face declaration gives usable evidence of CJK coverage. */
export type UnicodeRangeClass = "cjk" | "other" | "unknown";

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
 * Report CJK only for a parsed range overlapping the supported Han or kana
 * blocks. A missing, malformed, or universal range is unknown rather than
 * proof that the web font can replace a regional fallback.
 */
export function classifyUnicodeRange(value: string): UnicodeRangeClass {
  const ranges = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (!ranges.length) return "unknown";
  let parsedAny = false;
  let coversCjk = false;
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
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (!wildcard && start === 0 && end >= 0x10ffff) isUniversal = true;
    if (CJK_BLOCKS.some(([blockStart, blockEnd]) => start <= blockEnd && end >= blockStart)) {
      coversCjk = true;
    }
  }
  if (!parsedAny || isUniversal) return "unknown";
  return coversCjk ? "cjk" : "other";
}
