# Japanese character clue sources

The mixed-language experiment uses a static character set as supporting
evidence. It is intentionally narrower than a Japanese kanji dictionary and
does not replace kana or page-level browser language detection.

## Sources

- The Agency for Cultural Affairs' [Jōyō Kanji Table (2010 Cabinet Notice
  No. 2)](https://www.bunka.go.jp/kokugo_nihongo/sisaku/joho/joho/kijun/naikaku/kanji/)
  supplies the modern Japanese forms and their parenthesized older forms.
- The National Institute for Japanese Language and Linguistics describes
  Japanese-created characters such as `畑`, `峠`, `込`, `枠`, and `働` in
  [Japanese-language teaching material on kanji formation](https://repository.ninjal.ac.jp/record/1854/files/kk_nkss_014.pdf).
- Unicode CLDR's Simplified and Traditional Chinese locale data supplies the
  [Chinese exemplar-character sets](https://github.com/unicode-org/cldr/tree/main/common/main).
  Main and auxiliary exemplars are both treated as Chinese usage evidence.
- Unicode [UAX #38](https://www.unicode.org/reports/tr38/) explains why
  `kSimplifiedVariant` and `kTraditionalVariant` are useful clues but not a
  complete language classifier.

## Selection rule

The current static set contains 201 characters:

1. Retain the earlier manually reviewed high-signal seed, including its common
   kokuji.
2. Add modern forms from the Jōyō table when an older non-compatibility form is
   shown.
3. Remove any candidate present in the project's SC or TC clue tables.
4. Remove any candidate present in CLDR's Simplified or Traditional Chinese
   main or auxiliary exemplar sets.

The filtering is deliberately asymmetric: missing a Japanese clue merely
leaves a segment unresolved, while admitting a common Chinese character can
misclassify Chinese prose. For example, `霊` is retained because it is the
Japanese standard form corresponding to older `靈`; `夢` is excluded because
it is also the normal Traditional Chinese form of Simplified Chinese `梦`.
Consequently, `霊夢` contributes one Japanese character clue, not two, and is
not enough by itself to force a Japanese result.

## Runtime cost

The set is created once when the content script loads. Local analysis already
examines at most 500 characters per segment and performs one `Set.has()` lookup
per character. Expanding the set changes only its small constant memory cost;
it does not add DOM traversal, sampling, or browser language-detection calls.
