# Code map

Use this index to locate an implementation owner. Read [architecture](architecture.md) for the full runtime flow and [design decisions](decisions.md) before changing policy.

## Runtime orchestration

| Behavior | Owner | Start at |
| --- | --- | --- |
| Content-script startup, settings changes, scheduling, status reports | `src/entries/content.ts` | top-level initialization and run scheduler |
| Toolbar icon and install/update font initialization | `src/entries/background.ts` | Chrome event listeners |
| Interpret DOM mutations | `src/page/page-observer.ts` | `PageObserver.configure()` |
| Keep or invalidate a page-language result after DOM changes | `src/page/page-observer.ts` | `pageLanguageIsStable()`, `sampleWasSubstantiallyRewritten()` |
| Merge full scans, roots, and direct elements | `src/page/update-queue.ts` | `UpdateQueue.requestFullScan()`, `queueRoot()`, `queueElement()`, `consume()` |
| Apply one advanced-mode run | `src/fallback/controller.ts` | `FallbackController.apply()` |
| Set and restore root `lang` in Simple mode | `src/fallback/simple-mode.ts` | `SimpleMode.apply()`, `restore()` |

## Language decisions

| Behavior | Owner | Start at |
| --- | --- | --- |
| Normalize `lang` and map SC, TC, JP | `src/language/tags.ts` | `langToVariant()`, `variantToLang()` |
| Choose SC or TC from Chinese clues | `src/language/tags.ts` | `classifyChinese()` |
| Store the simplified and traditional clue sets | `src/language/chinese-clues.ts` | `SC_CLUES`, `TC_CLUES` |
| Store conservative Japanese character clues | `src/language/japanese-character-clues.ts` | `JAPANESE_CHARACTER_CLUES` |
| Select the page sample and final page variant | `src/page/page-language.ts` | `PageLanguageDetector.collectSample()`, `detect()` |
| Decide whether a DOM change touches the sample | `src/page/page-language.ts` | `touchesSample()`, `sampleRootWasRemoved()` |
| Respect explicit descendant CJK `lang` | `src/page/element-language.ts` | `ElementLanguage.explicitVariantFor()`, `browserHandlesLanguageFor()` |
| Calculate local SC, TC, and JP evidence | `src/language/local-evidence.ts` | `analyzeCjkEvidence()` |
| Gate mixed Chinese/Japanese pages | `src/language/local-evidence.ts` | `hasStrongChineseJapaneseMix()` |
| Resolve short Japanese segments and preceding context | `src/language/local-evidence.ts` | `isShortJapaneseScriptSegment()`, `variantFromPrecedingEvidence()` |
| Apply mixed-page local decisions and wrappers | `src/fallback/mixed-language.ts` | `MixedLanguage.prepare()`, `variantFor()`, `restoreAll()` |
| Split the fixed Bangumi heading template | `src/fallback/site-rules/bangumi.ts` | `findBangumiTitleRange()` |

## DOM and font application

| Behavior | Owner | Start at |
| --- | --- | --- |
| Find elements that directly own CJK text | `src/page/candidate-scan.ts` | `collectCandidateElements()`, `addCandidate()` |
| Detect CJK in a changed subtree | `src/page/candidate-scan.ts` | `subtreeContainsCjk()` |
| Cross open shadow-root boundaries | `src/page/candidate-scan.ts` | `composedParentElement()`, `closestComposed()`, `isInShadowTree()` |
| Parse and normalize CSS font-family lists | `src/fonts/font-family.ts` | `parseFamilies()`, `normalizeFamily()` |
| Recognize SC, TC, JP, Fangsong, and generic families | `src/fonts/font-family.ts` | `regionalVariantForFamily()`, `isFangsongFamily()`, `isGenericFamily()` |
| Check whether the selected font is already in an effective position | `src/fonts/font-family.ts` | `hasEffectiveFallback()` |
| Insert or reorder the selected font | `src/fonts/font-family.ts` | `composeFontFamily()` |
| Choose Sans or Serif from the website stack | `src/fonts/font-family.ts` | `usesSerifFallback()` |
| Preserve an available website CJK font | `src/fonts/font-support.ts` | `FontSupport.shouldPreserve()` |
| Track website `@font-face` coverage and availability | `src/fonts/font-support.ts` | `refreshCustomFonts()`, `noteLoadedFaces()`, `clearAvailability()` |
| Classify an `@font-face unicode-range` | `src/fonts/unicode-range.ts` | `classifyUnicodeRange()` |
| Record, restore, and summarize managed elements | `src/fallback/managed-styles.ts` | `ManagedStyles.commit()`, `restore()`, `restoreAll()`, `summary()` |
| Share generated CSS rules between identical stacks | `src/fallback/font-stack-rules.ts` | `FontStackRules.acquire()`, `release()`, `render()` |

`FallbackController.createStyleActions()` joins font selection and application. It obtains the user's configured font through `fontForVariant()`, checks website-font preservation through `FontSupport`, checks existing order through `hasEffectiveFallback()`, and calls `composeFontFamily()` only when a change is required.

## Settings and UI

| Behavior | Owner | Start at |
| --- | --- | --- |
| Default settings and storage migration | `src/settings/defaults.ts` | `DEFAULTS`, `settingsFromStorage()`, `preserveWebsiteFontsFromStorage()` |
| Browser UI language to default Chinese variant | `src/settings/defaults.ts` | `defaultChineseForLanguage()` |
| Installed font list and OS-dependent defaults | `src/settings/font-catalog.ts` | `getInstalledFonts()`, `defaultFor()`, `validChoice()` |
| Validate and normalize site overrides | `src/settings/site-overrides.ts` | `sanitizeSiteOverrides()`, `normalizeHostname()` |
| Settings form, autosave, previews, and mixed-mode consent | `src/options/main.ts` | form initialization and event listeners |
| Site-language manager | `src/options/site-language-settings.ts` | `setupSiteLanguageSettings()` |
| Popup status and site selection | `src/popup/main.ts` | popup initialization and event listeners |
| Shared UI element lookup and error text | `src/shared/dom.ts` | `byId()`, `errorMessage()` |
| Localized strings | `src/shared/i18n.ts`, `_locales/` | `message()`, `localizeDocument()` |
| Shared settings and message shapes | `src/shared/types.ts` | `Settings`, `ContentStatus`, `ContentMessage` |

## Tests by owner

Tests mirror the implementation names: `font-family.test.ts`, `font-support.test.ts`, `language.test.ts`, `local-language.test.ts`, `page-language.test.ts`, `element-language.test.ts`, `update-queue.test.ts`, and `site-overrides.test.ts`. Browser behavior belongs under `tests/sites/`; `flores-corpus.spec.ts` is the optional labeled-language evaluation. See [testing](testing.md) before treating a unit test as browser evidence.
