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
| `npm run test:sites:flatpak` | Run the same browser cases with the installed Flatpak Chromium, headless |
| `npm run test:sites:flatpak:headed` | Run the full site suite in visible Flatpak Chromium windows |
| `npm run test:flatpak:headed:smoke` | Build and check one local SPA fixture in a visible Flatpak Chromium window; no live-site requests |
| `npm run inspect:flatpak -- 'https://example.com/page'` | Open any HTTP(S) page with the built extension in visible Flatpak Chromium; pause for manual verification and print the final extension status |
| `CJ_FLORES_DIR=/path/to/flores200_dataset npm run test:corpus` | Opt-in FLORES-200 page-language evaluation in real Chromium; no corpus text is committed |

`tests/sites/real-sites.spec.ts` currently covers an ordinary DuckDuckGo search, Japanese/SC/TC Wikipedia, Bangumi, and a Japanese YouTube channel with mixed-script video titles. It also checks opt-in Bangumi mixed text, the selected Japanese stack, wrapper restoration, a mixed-script work title, and a short line appended after a Japanese summary segment in the test tab. Live-site failures can be caused by changed markup, redirects, access restrictions, or network conditions; inspect the loaded page before rewriting detection logic. Keep real-page assertions about font order or computed style when a bug concerns rendering, not only about `data-*` labels.

`tests/sites/local-spa.spec.ts` intercepts synthetic pages without contacting an external site. It checks that mixed-language wrappers are removed when an SPA changes to English-only content, that one confirmed preceding segment can resolve a short neighboring segment without chaining guesses or crossing explicit `lang`/container boundaries, and that changing or removing that predecessor updates the dependent font. It also checks that a trusted root CJK `lang` prevents font changes even for nested and new content, that `body lang="en"` and bare root `lang="zh"` do not block Chinese font repair, that in-document Back restores detection and font correction for reused Japanese content, and that later website CSS changes are reflected in managed font stacks. `tests/action-icon.test.ts` drives the background entry through mocked Chrome events to check that an active page repaints its icon after navigation, a no-intervention report closes it immediately, and navigation creates no timer.

`tests/sites/options-layout.spec.ts` loads the actual Settings page and checks its borderless font rows across four viewport widths: language headings and Sans/Serif fields reflow without horizontal overflow, both font labels share a color, and the default Chinese explanation is not constrained to the menu width.

## Independently labeled language corpus

The opt-in `tests/sites/flores-corpus.spec.ts` uses the official [FLORES-200](https://github.com/facebookresearch/flores/blob/main/flores200/README.md) `devtest` files for `zho_Hans`, `zho_Hant`, and `jpn_Jpan`. Its 120 cases are 40 non-overlapping groups per variant, alternating one, three, and ten distinct sentences per page. Half of the pages have no `lang`; half declare `en-US`. Playwright serves each group as a local page, loads the built extension, and lets Chromium actually run `chrome.i18n.detectLanguage()`. The expected region comes from the dataset label, not a stubbed detector or the extension's own output. No external website receives these page loads.

Obtain the original archive from [Meta's FLORES-200 download link](https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz), extract it outside the repository, and point `CJ_FLORES_DIR` to its `flores200_dataset` directory. The browser test does not download or redistribute the text. FLORES-200 is [CC BY-SA 4.0](https://huggingface.co/datasets/facebook/flores); keep the archive's source and license information with any local copy. `npm run test:sites` excludes these opt-in cases, and `test:corpus` requires the directory explicitly. See [language test data research](language-test-data-research.md) for the source and release decision.

These are long, translated, single-language samples presented in a controlled DOM. A passing score does **not** establish short-title or mixed-page accuracy, nor does it verify real-site DOM sampling or rendered fonts. Keep the live-site cases and inspect their computed and rendered fonts separately. Corpus failures should be reported by source label and case number rather than edited away to preserve a passing score.

## Choosing a browser

Start with Playwright's bundled Chromium, headless, in its temporary profile. Use it for local SPA fixtures, the corpus, UI layout checks, and real sites that load normally. Run only the relevant site case while debugging; `npm run test:sites` is the broader regression suite, not the first command for one URL. After `npm run build`, a focused run looks like:

```sh
./node_modules/.bin/playwright test --config playwright.sites.config.ts tests/sites/local-spa.spec.ts --grep 'directly preceding strong segment' --retries=0
./node_modules/.bin/playwright test --config playwright.sites.config.ts tests/sites/real-sites.spec.ts --grep 'detects Bangumi' --retries=0
```

Use the installed Flatpak Chromium **only when its browser version, installed fonts, or packaging could change the result**, or when a site requires a visible window for human verification. For an automated compatibility comparison, keep the test headless and change only the executable: set `CJ_TEST_CHROMIUM_EXECUTABLE=./scripts/flatpak-chromium.sh` on the same focused command. Use `CJ_TEST_HEADLESS=0` only for a visual/browser-interaction question or a site that will not present its real content unattended. First run `npm run test:flatpak:headed:smoke` if a visible Flatpak automation session has not been checked in the current environment. Flatpak uses the existing wrapper for `org.chromium.Chromium`; do not rediscover the app ID or construct a new launch command each time. `npm run test:sites:flatpak` and `npm run test:sites:flatpak:headed` run the **entire** site suite and are for deliberate compatibility/regression passes, not routine single-site debugging.

If the default browser fails to start because of sandbox permissions, retry the **same browser command** in an environment allowed to launch it; that failure is not a reason to switch to Flatpak or to headed mode. If a real site fails to load, first distinguish a network/redirect error from a human-verification page. Do not repeatedly reload or switch browsers automatically; verify that the intended page was actually shown before interpreting its language result.

All automated Flatpak commands create a fresh temporary browser profile. A **visible** window is not the user's already-open Chromium window: it has none of that window's cookies, extensions, login state, or completed human-verification challenges, and the test closes it afterward. An ordinary Chromium window cannot be attached to retroactively unless it was launched with an appropriate debugging endpoint. If an issue depends on the user's existing session, inspect it in that session with the already-installed extension and user-guided DevTools observations; do not claim a fresh automated profile reproduces the same state. Do not launch automation against the user's everyday profile, as Chromium profile locking and test cleanup could disturb it.

If a site shows a human-verification page in unattended tests, do not interpret the challenge page as a successful language result or change the classifier to fit it. Use `npm run inspect:flatpak -- '<exact URL>'` when visible Flatpak Chromium can resolve the challenge. The command opens a visible window with the current build and pauses after initial navigation. Complete the site's verification there, check that the intended page—not the challenge—is displayed, then press **Resume** in Playwright Inspector. The command prints the final URL and extension status; these are observations, not an automatic pass/fail verdict. Inspect the actual element and DevTools **Rendered Fonts** separately when the issue concerns the physical font. This manual workflow uses a fresh temporary profile, so its verification cookies are discarded when the window closes. It initiates only the supplied navigation; redirects and page resources may make other requests.

The smoke command was verified with a visible Flatpak Chromium window and passed its local font-correction assertion. In a restricted command sandbox, the same command can fail before Chromium starts with `Unable to allocate instance id`; that is a Flatpak session/permission failure, not evidence of a wrong app ID or a failed extension test. Re-run the **same command** in an environment allowed to start Flatpak rather than probing IDs or changing launch arguments. The command does not need network access for its test page.

Playwright does not guarantee compatibility with a browser version other than its bundled one. The Flatpak run is an additional compatibility check, not a replacement for the default suite. Record the actual executable/version and profile when reporting results. Do not compare performance numbers across different browser versions or environments as if they were controlled samples.

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
