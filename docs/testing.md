# Testing and browser evidence

Choose checks for the behavior being changed. Unit tests establish deterministic rules; browser checks establish DOM, CSS, and extension interaction. Physical font complaints also require DevTools **Rendered Fonts**. Use [code map](code-map.md) to find the owner and [design decisions](decisions.md) before changing policy.

## Choose the check

- For language clues, font ordering, queues, or stored-value rules, start with the relevant unit tests.
- For page behavior, popup/Settings interactions, restoration, or navigation, rebuild and run the relevant browser case.
- For performance changes, compare the same page and browser conditions and verify that language, fonts, icons, and restoration still behave correctly.

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
| `CJ_FLORES_DIR=.local-test-data/flores200_dataset npm run test:corpus` | Opt-in FLORES-200 page-language evaluation in real Chromium |

## Choose the browser

Start with Playwright's bundled Chromium, headless, in a temporary profile. Use a focused case while debugging; the full site suite is a regression gate. After `npm run build`:

```sh
./node_modules/.bin/playwright test --config playwright.sites.config.ts tests/sites/local-spa.spec.ts --grep 'directly preceding strong segment' --retries=0
./node_modules/.bin/playwright test --config playwright.sites.config.ts tests/sites/real-sites.spec.ts --grep 'detects Bangumi' --retries=0
```

Use Flatpak Chromium when its version, installed fonts, or packaging could affect the result. Change only the executable for a headless comparison:

```sh
CJ_TEST_CHROMIUM_EXECUTABLE=./scripts/flatpak-chromium.sh ./node_modules/.bin/playwright test --config playwright.sites.config.ts tests/sites/local-spa.spec.ts --grep 'does not trust an English body lang for Chinese content' --retries=0
```

Use `CJ_TEST_HEADLESS=0` for a visual question or a page needing human verification. First run `npm run test:flatpak:headed:smoke` if visible Flatpak automation has not been checked in the current environment. The wrapper owns the app ID and launch setup; use it directly. The Flatpak full-suite commands are for deliberate regression passes.

If sandbox permissions prevent launch, retry the same command in an environment allowed to run the browser. `Unable to allocate instance id` is a Flatpak session/permission failure, not evidence of a wrong app ID. A launch failure alone does not justify switching browser or enabling a visible window.

All automation uses fresh temporary profiles. A visible Flatpak window has none of the user's ordinary window's cookies, extensions, login, or completed verification, and closes after the test. For issues requiring that existing session, use the installed extension and user-guided DevTools observations. Keep automation off the everyday profile to avoid profile locking and cleanup conflicts. Attaching to an existing window requires that it was launched with an appropriate debugging endpoint.

### Live-site loading and manual inspection

Check the final loaded page before interpreting a failure. Redirects, network errors, changed markup, or verification challenges can prevent the intended content from appearing. Avoid repeated automated reloads or browser switches until the cause is understood. A challenge page is not a successful language test, and detection must not be changed to classify it as the requested page.

For human verification, run `npm run inspect:flatpak -- '<exact URL>'` after building. It opens that URL in a fresh visible profile and pauses:

1. Complete the site's verification and confirm that the intended page is displayed.
2. Inspect the affected text and **Rendered Fonts** when relevant.
3. Press **Resume** in Playwright Inspector to print the final URL and extension status.

The output is an observation, not an automatic verdict. Verification cookies are discarded with the temporary profile. Redirects and page resources may make additional requests.

Playwright's bundled browser is the default evidence; Flatpak is an additional compatibility check. Record executable/version and profile conditions. Compare performance only under matched environments.

## Reproducing a font or icon issue

1. Record the exact URL, final redirected URL, browser/version, enabled settings, installed regional fonts, and whether the page is top-level or an iframe. For a protected page, first check whether any content script can run.
2. Inspect the popup's page result and applied/managed status separately. A detected language does not imply that CSS was injected.
3. Inspect the affected element's inherited `lang`, computed `font-family`, extension `data-*` attributes, and DevTools **Rendered Fonts** for the actual selected glyphs. A correct local label with the wrong rendered font is a font-stack problem, not necessarily a classifier problem.
4. If the issue appears during navigation or SPA updates, record the sequence over time rather than only the final DOM or a single screenshot. Check whether the page result changes, managed elements appear/disappear, or the icon receives conflicting states.
5. Compare with the extension disabled and, for mixed pages, with the experimental option disabled. Preserve the site's text, CSS order, and `lang` when forming a fix.

## Performance checks

Match browser/version, profile, viewport, URL, font settings, and cache policy for extension-off/on comparisons. Repeat runs and compare distributions or medians. Record DOM size, managed-element count, load-to-stable time, scripting/task time, and settled-page idle activity. On large dynamic pages such as Touhou Vote, separate initial insertion bursts from steady-state mutations and attribute long tasks before changing batching.

For performance changes, verify SC/TC/JP results, CSS rule reuse, icon state, and restoration on representative pages.

### Historical measurement

A 0.8.38 diagnostic comparison used isolated Flatpak Chromium 154 profiles on Touhou Vote's character-results page, opening and closing 50 rows five times. Expansions added about 450 candidates and raised managed elements from 1,113 to 1,513. Median font-plan calculation was about 9.1 ms before caching and 1.3 ms afterward. This measured one instrumented stage in separate profiles, not total interaction time or a permanent baseline. Unit, live-site, and later website-CSS-change checks passed; temporary instrumentation was removed.

## Coverage index

Use the test source for individual assertions and case names.

| Test file or group | Main coverage |
| --- | --- |
| `tests/*.test.ts` | Deterministic language evidence, font ordering/support, update queues, declarations, settings, and managed-style write suppression |
| `tests/action-icon.test.ts` | Toolbar navigation state, timer-free icon behavior, and update-time cleanup concurrent with a rule edit |
| `tests/page-language.test.ts` | Sampling and actual versus unrelated primary-region changes |
| `tests/sites/real-sites.spec.ts` | DuckDuckGo, Japanese/SC/TC Wikipedia, Bangumi, and a Japanese YouTube channel; computed fonts and mixed-text restoration |
| `tests/sites/local-spa.spec.ts` | Local intercepted pages: stable language, mixed context and cleanup, trusted declarations, history/cached views, website CSS changes, shadow trees, and effective-rule updates |
| `tests/sites/options-layout.spec.ts` | Responsive font controls, overflow, themes, button contrast, focus, and popup action layout |
| `tests/sites/options-loading.spec.ts` | Font-list failure/empty lists, preserved choices, independent controls, stored-settings errors, and repair-write failures |
| `tests/sites/site-settings.spec.ts` | Actual popup/Settings flow, inline drafts, scope/conflict/concurrency rules, search/pagination, deletion/Undo, animations, and unchanged groups retaining DOM and focus |
| `tests/sites/flores-corpus.spec.ts` | Optional labeled single-language evaluation described below |

Live-site rendering checks should select the website's own reading structure or text, not extension-generated markers. Check multiple passages for whole-area behavior and preserve computed-font/order assertions. Keep test content local and original for synthetic fixtures; current local SPA cases intercept requests without contacting external sites. The Bangumi checks read its existing content rather than insert test sentences into the live page.

## Independently labeled language corpus

The opt-in `tests/sites/flores-corpus.spec.ts` uses the official [FLORES-200](https://github.com/facebookresearch/flores/blob/main/flores200/README.md) `devtest` files for `zho_Hans`, `zho_Hant`, and `jpn_Jpan`. Its 120 cases are 40 non-overlapping groups per variant, alternating one, three, and ten distinct sentences per page. Half of the pages have no `lang`; half declare `en-US`. Playwright serves each group as a local page, loads the built extension, and lets Chromium actually run `chrome.i18n.detectLanguage()`. The expected region comes from the dataset label, not a stubbed detector or the extension's own output. No external website receives these page loads.

Obtain the original archive from [Meta's FLORES-200 download link](https://dl.fbaipublicfiles.com/nllb/flores200_dataset.tar.gz) and extract it to `.local-test-data/flores200_dataset`. You can instead keep it elsewhere and set `CJ_FLORES_DIR` to that directory. The browser test does not download or redistribute the text. FLORES-200 is [CC BY-SA 4.0](https://huggingface.co/datasets/facebook/flores); keep the archive's source and license information with any local copy. `npm run test:sites` excludes these opt-in cases, and `test:corpus` requires the directory explicitly. See [language test data research](language-test-data-research.md) for the source and release decision.

These are long, translated, single-language samples presented in a controlled DOM. A passing score does **not** establish short-title or mixed-page accuracy, nor does it verify real-site DOM sampling or rendered fonts. Keep the live-site cases and inspect their computed and rendered fonts separately. Corpus failures should be reported by source label and case number rather than edited away to preserve a passing score.
