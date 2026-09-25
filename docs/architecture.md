# Architecture

This maps the code as it exists, not proposed features. Read [design decisions](decisions.md) before changing language or font policy, and [testing](testing.md) before interpreting a browser result. The README describes user-visible behavior.

## Find the owner

| If you need to change... | Start here |
| --- | --- |
| Content startup, settings reactions, run scheduling, or status messages | `src/entries/content.ts` |
| Toolbar icon state or installation-time font selection | `src/entries/background.ts` |
| Page language and sample selection | `src/page/page-language.ts` |
| Inherited element `lang` behavior | `src/page/element-language.ts` |
| SC/TC clues or local mixed-language evidence | `src/language/chinese-clues.ts`, `src/language/local-evidence.ts` |
| DOM candidates, mutation invalidation, or work coalescing | `src/page/candidate-scan.ts`, `src/page/page-observer.ts`, `src/page/update-queue.ts` |
| Advanced variant precedence and font application | `src/fallback/controller.ts` |
| Experimental wrappers or the Bangumi heading exception | `src/fallback/mixed-language.ts`, `src/fallback/site-rules/bangumi.ts` |
| Font recognition, insertion order, or availability | `src/fonts/font-family.ts`, `src/fonts/font-support.ts`, `src/fonts/unicode-range.ts` |
| Shared CSS, cleanup, or Simple mode | `src/fallback/font-stack-rules.ts`, `src/fallback/managed-styles.ts`, `src/fallback/simple-mode.ts` |
| Defaults, installed-font choices, or hostname overrides | `src/settings/defaults.ts`, `src/settings/font-catalog.ts`, `src/settings/site-overrides.ts` |
| Settings UI, site manager, popup, or localization | `src/options/`, `src/popup/`, `src/shared/i18n.ts`, `_locales/` |
| Bundle names or files copied into `dist` | `scripts/build.mjs`, `manifest.json` |

`src/shared/` contains cross-surface types and small UI helpers, not settings implementation. Put a rule where its reason for changing belongs; do not add a forwarding module merely to make entry points symmetrical. The content entry owns orchestration because it needs settings, observer, detector, and style controller together. The background entry is smaller and directly registers its own listeners.

## Build and runtime surfaces

`manifest.json` is Manifest V3. Vite builds `src/entries/content.ts` into one self-contained IIFE, `dist/content.js`. It builds `src/entries/background.ts` into `dist/background.js`, an ES-module service worker. `src/options/main.ts` and `src/popup/main.ts` are extension-page entries. `scripts/build.mjs` also copies the manifest, icons, locales, and license into `dist`; README files, architecture docs, and screenshots stay in the source repository.

`.github/workflows/release.yml` builds from a GitHub source revision, checks that the package and manifest versions agree, requires a hand-written `docs/releases/v<version>.md`, and packages only `dist` as the Release asset. See [publishing a release](releasing.md) for the maintainer procedure.

The content script runs at `document_start` in matching HTTP(S) frames, including configured blank/origin-fallback frames. Each frame detects and styles its own document. The popup addresses the top-level frame; only that frame reports toolbar icon state. The background worker accepts `setActionState` messages from frame 0 and applies the open-book icon only when intervention is in use. On cross-document navigation, Chromium restores the manifest's closed default; the worker forgets its old per-tab state so the new page's report can repaint it. There is no navigation timer or separate page-status probe. Its in-memory icon state is not durable across worker restarts.

Browser-owned and protected pages may not run content scripts. Their popup shows an unavailable state; there is no page status message to wait for. The UI language comes from extension locales (`_locales/`); English is the fallback. There is no user-chosen UI-language setting.

## Content-script flow

```text
DOM / settings / font event
        ↓
page/page-observer.ts       decide what became invalid
        ↓
page/update-queue.ts        merge full scans, subtree roots, and direct elements
        ↓
entries/content.ts          schedule and consume a run
        ├─ page/page-language.ts       choose one stable page variant
        ├─ fallback/simple-mode.ts     root-lang-only strategy
        └─ fallback/controller.ts      advanced element strategy
             ├─ page/candidate-scan.ts
             ├─ page/element-language.ts
             ├─ fallback/mixed-language.ts (opt-in)
             └─ fonts/font-support.ts / font-family.ts
        ↓
fallback/managed-styles.ts  reversible element state
        └─ fallback/font-stack-rules.ts  reference-counted shared CSS
        ↓
top-frame status and icon message
```

`PageObserver` does not detect a language or write CSS. `UpdateQueue` does not read text. `FallbackController` receives coalesced work and owns the read-before-write style pipeline. `ManagedStyles` and `FontStackRules` own restoration and generated rules, so disabling or changing a decision does not leave stale injected CSS behind.

### Page result and element result

`PageLanguageDetector` first checks a hostname override (`off`, SC, TC, or JP). With `trustCjkLang` enabled, a specific root CJK `lang` then decides the page without browser detection. Bare `zh` lacks a script, so SC/TC clues and the configured default Chinese variant decide it. Otherwise the detector samples the title plus up to 10,000 characters from `main`, `[role=main]`, a single `article`, the nearest shared container of the first two articles, or `body`, as applicable. The shared container prevents a first advertisement card from hiding later search results. It excludes code-like and non-prose elements, rejects pages without CJK, and keeps surrounding Latin text for `chrome.i18n.detectLanguage()`. Kana and Chinese clues are fallbacks when the browser result is insufficient. A cached sample result avoids repeated asynchronous detection when the sample is unchanged.

The page result is **not** the final choice for every element. In advanced mode, `ElementLanguage` checks inherited local `lang`; with the trust setting on, an explicit descendant language declaration is left to the browser unless the user forced a site override. This includes specific CJK tags and other deliberate descendant tags. For an element that still needs intervention, precedence is: forced site variant, explicit local variant, experimental strong local variant, then page variant. Mixed-language handling does not rewrite `lang` and does not change the page-level result. A manual site override takes precedence over automatic and declared results.

### Candidates and CSS

`candidate-scan.ts` collects elements that directly own CJK text nodes, plus input/textarea values or placeholders. It avoids styling large ancestors just because descendants contain CJK. Excluded elements include code, preformatted text, scripts, styles, SVG, and canvas. Advanced mode skips an element when no appropriate regional font is configured, when the chosen family is already in its stack, or when an acceptable reachable CJK family or declared CJK web font should be preserved.

For elements that do need intervention, the controller removes its old attachment, reads the website's computed `font-family` values in a batch, computes new stacks, then writes them in a batch. Explicit Latin families stay ahead of the selected CJK family. A recognized conflicting regional CJK family is moved behind the selected fallback; otherwise insertion is before the first generic family. No platform stack is hard-coded. Serif selection depends on the first generic family (`serif` or `ui-serif`); there is no separate Mono policy.

Identical completed stacks share a generated CSS rule. The element stores a short `data-cjk-fallback-stack` identifier; `ManagedStyles` tracks the reversible state and `FontStackRules` reference-counts rules. Open shadow roots and elements with an inline `font-family: ... !important` receive a reversible inline fallback because the document rule cannot reliably style them. The managed-element count means attached CSS intervention, not proof that the selected font rendered every glyph.

### Updates and modes

Initial detection starts early; it does not wait for all web fonts to load. In advanced mode, new DOM subtrees and changed direct text owners are normally rescanned locally. A changed page sample, root setting/style, stylesheet, or font metadata can request broader work. `UpdateQueue` coalesces roots and elements at consumption time: a full scan subsumes all local work, and an ancestor subtree subsumes descendants. The page result is cached and is not recomputed for every feed item. Once a page is confirmed to have no CJK text, the observer uses a cheaper dormant path until relevant sampled CJK content appears.

If dynamic detection is disabled, the initial result is retained and only lightweight removal cleanup remains. Simple mode never applies element CSS: it temporarily sets the root `lang`, remembers the original value for restoration, and uses a short startup observer for client-rendered content. It stops once a variant is found or its two-second bootstrap window ends.

### Experimental mixed-language path

The mixed detector is off by default, advanced-mode-only, and ineligible when the page has a root CJK declaration or a manual site override. It reuses candidate scanning rather than making a second whole-body pass. Direct segments are capped at 500 characters each and about 10,000 CJK characters overall. It activates only when both page-language and opposing-language evidence have substantial text; separate segments can then choose their own fallback. After this gate, standalone segments made entirely of kana, or kana plus recognized Japanese-form Han, may also choose JP despite being too short for the ordinary strong-evidence threshold. These short segments never activate the mixed mode by themselves. Multiple direct text nodes, such as paragraphs separated by `<br>`, may receive reversible spans. A narrow Bangumi `h2.subtitle` rule can isolate a work title inside its fixed Chinese heading template. No generic whitespace-based inline splitting is performed, and no second `chrome.i18n.detectLanguage()` pass over residual text exists.

## Settings and UI state

Defaults and font choices live in `src/settings/`; the options page saves changes immediately. Site overrides are stored by hostname, not URL path, and are managed separately. In the site manager, `Auto` means deleting the entry; it is not a persisted override value. The main **Restore defaults** action does not delete site overrides. An unavailable page has no per-site controls in the popup because its content script cannot receive messages.

The popup distinguishes the page result from actual intervention: a page may be detected as SC, TC, or JP while CSS is **Not needed**, or while no configured regional font can be applied. The icon opens only when CSS is attached (or Simple mode applies a root language), not merely because a CJK language was detected.

## Maintenance rules

- Preserve the website's Latin families, trusted language declarations, and current user text. Do not replace them with a fixed OS-specific stack or a guessed language tag.
- Keep page detection, local evidence, DOM mutation interpretation, and style application in their existing ownership boundaries. A site-specific parser belongs under `fallback/site-rules/`, not in the general language classifier.
- Preserve the remove/read/write order for style work and restoration of wrappers, inline styles, and shared rules.
- Treat language clue lists as evidence, not complete dictionaries or proof that a glyph uses a particular physical font.
- Keep comments in English and explain non-obvious policy or browser constraints rather than restating syntax.
- For browser-visible behavior changes, update the manifest/package version together, rebuild `dist`, and verify the relevant real site. Documentation-only edits do not need a version bump.

See [design decisions](decisions.md) for accepted limits and [testing](testing.md) for commands and browser-test interpretation.
