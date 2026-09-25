# Testing and browser evidence

The tests answer different questions. A passing unit test proves a deterministic rule; it does not prove that the website's CSS, Chromium's font matching, or the toolbar state is correct. Read [architecture](architecture.md) for code owners and [design decisions](decisions.md) before changing behavior.

## Commands

| Command | Checks |
| --- | --- |
| `npm test` | Fast Vitest rules for language clues, font stacks, queues, settings, and DOM helpers |
| `npm run typecheck` | Source and unit-test TypeScript |
| `npm run typecheck:sites` | Browser-test TypeScript |
| `npm run build` | Typecheck and rebuild the loadable MV3 extension in `dist` |
| `npm run test:sites` | Build, typecheck, then load `dist` in Playwright Chromium for local SPA and live-site checks |
| `CJ_FLORES_DIR=/path/to/flores200_dataset npm run test:corpus` | Opt-in FLORES-200 page-language evaluation in real Chromium; no corpus text is committed |

`tests/sites/real-sites.spec.ts` currently covers an ordinary DuckDuckGo search, Japanese/SC/TC Wikipedia, and Bangumi. It also checks opt-in Bangumi mixed text, the selected Japanese stack, wrapper restoration, and a mixed-script work title. Live-site failures can be caused by changed markup, redirects, access restrictions, or network conditions; inspect the loaded page before rewriting detection logic. Keep real-page assertions about font order or computed style when a bug concerns rendering, not only about `data-*` labels.

`tests/sites/local-spa.spec.ts` intercepts synthetic pages without contacting an external site. It checks that mixed-language wrappers are removed when an SPA changes to English-only content, that a trusted root `lang` prevents font changes even for nested and new content, and that later website CSS changes are reflected in managed font stacks. `tests/action-icon.test.ts` drives the background entry through mocked Chrome events to check that an active page repaints its icon after navigation, a no-intervention report closes it immediately, and navigation creates no timer.

## Independently labeled language corpus

The opt-in `tests/sites/flores-corpus.spec.ts` uses the official [FLORES-200](https://github.com/facebookresearch/flores/blob/main/flores200/README.md) `devtest` files for `zho_Hans`, `zho_Hant`, and `jpn_Jpan`. Its 120 cases are 40 non-overlapping groups per variant, alternating one, three, and ten distinct sentences per page. Half of the pages have no `lang`; half declare `en-US`. Playwright serves each group as a local page, loads the built extension, and lets Chromium actually run `chrome.i18n.detectLanguage()`. The expected region comes from the dataset label, not a stubbed detector or the extension's own output. No external website receives these page loads.

Obtain the original archive from [Meta's FLORES-200 download link](https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz), extract it outside the repository, and point `CJ_FLORES_DIR` to its `flores200_dataset` directory. The browser test does not download or redistribute the text. FLORES-200 is [CC BY-SA 4.0](https://huggingface.co/datasets/facebook/flores); keep the archive's source and license information with any local copy. `npm run test:sites` excludes these opt-in cases, and `test:corpus` requires the directory explicitly. See [language test data research](language-test-data-research.md) for the source and release decision.

These are long, translated, single-language samples presented in a controlled DOM. A passing score does **not** establish short-title or mixed-page accuracy, nor does it verify real-site DOM sampling or rendered fonts. Keep the live-site cases and inspect their computed and rendered fonts separately. Corpus failures should be reported by source label and case number rather than edited away to preserve a passing score.

The committed site suite launches Playwright's bundled `channel: "chromium"` in a temporary profile. It is **not** the user's Flatpak Chromium or normal browsing profile. Record the actual executable/version and profile when reporting results. Merely swapping executables in an otherwise identical headless temporary-profile run adds limited evidence; a GUI check in the affected everyday environment can expose timing or profile-specific behavior the automation misses. Do not compare performance numbers across different browser versions or environments as if they were controlled samples.

## Reproducing a font or icon issue

1. Record the exact URL, final redirected URL, browser/version, enabled settings, installed regional fonts, and whether the page is top-level or an iframe. For a protected page, first check whether any content script can run.
2. Inspect the popup's page result and applied/managed status separately. A detected language does not imply that CSS was injected.
3. Inspect the affected element's inherited `lang`, computed `font-family`, extension `data-*` attributes, and DevTools **Rendered Fonts** for the actual selected glyphs. A correct local label with the wrong rendered font is a font-stack problem, not necessarily a classifier problem.
4. If the issue appears during navigation or SPA updates, record the sequence over time rather than only the final DOM or a single screenshot. Check whether the page result changes, managed elements appear/disappear, or the icon receives conflicting states.
5. Compare with the extension disabled and, for mixed pages, with the experimental option disabled. Preserve the site's text, CSS order, and `lang` when forming a fix.

## Performance checks

Use the same browser executable, version, profile conditions, viewport, page URL, font settings, and cache policy for extension-off and extension-on runs. Repeat runs and compare a distribution such as medians, not one load. Record at least the page's DOM size, managed-element count, load-to-stable interval, main-thread scripting/task time, and idle activity after the page has settled. For a large dynamic page such as `https://touhou.vote/v11/characterDetail`, distinguish the initial SPA insertion burst from steady-state mutation cost. If a profile shows long tasks, attribute them before changing batching; a browser-wide long task is not automatically caused by the content script.

When performance code changes, verify that SC/TC/JP results, CSS rule reuse, icon state, and restoration remain unchanged on representative real sites. The old one-off Touhou benchmark numbers are not a permanent performance baseline: they came from a particular browser build, page state, and test interval.

For the 0.8.38 font-plan cache, a diagnostic build loaded the live Touhou Vote character-results page in isolated Flatpak Chromium 154 profiles, then opened and closed 50 result rows five times without reloading. Each expansion produced about 450 font candidates and increased managed elements from 1,113 to 1,513. The median time inside font-rule calculation was about 9.1 ms before the change and 1.3 ms after it. These runs used separate profiles and measure one instrumented processing stage, not total page-load or interaction time; do not treat the difference as a general speedup percentage. The unit suite, existing DuckDuckGo/Wikipedia/Bangumi browser cases, and the local SPA test for a website changing its CSS after load passed. Temporary instrumentation was removed after the comparison.
