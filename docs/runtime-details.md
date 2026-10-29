# Runtime details

Use this reference when changing startup, scheduling, language sampling, font restoration, settings synchronization, or state lifetime. [Architecture](architecture.md) gives the overall flow; [code map](code-map.md) locates functions; [design decisions](decisions.md) records behavioral constraints.

## Startup and updates

The content script starts at `document_start` in matching HTTP(S) frames, including configured blank/origin-fallback frames. After settings and the registered-domain lookup complete, it configures observation and runs immediately. It does not wait for images or all web fonts.

| Trigger | Requested work |
| --- | --- |
| Startup | Initial language detection and full style scan |
| `DOMContentLoaded`, if registered while parsing is still in progress after the first run | Full scan and language re-detection, even when an early result already exists |
| Ordinary additions or edits with dynamic detection enabled | Usually a subtree or direct-element update with the existing page result |
| SPA URL change, Back/Forward, or an actual primary-region switch | Full scan and language re-detection |
| Relevant general settings or an effective site-choice change | Full scan and language re-detection |
| Font metadata/loading event on a non-dormant Advanced page | Full style scan with the existing page result |
| Confirmed no-CJK page receives ordinary non-CJK changes | Dormant observation; skip font application |

`UpdateQueue` merges work at consumption: full scans replace local work, and an ancestor subtree covers queued descendants. The content entry uses a 60 ms default scheduling delay and a 220 ms cooldown after a completed run. Startup runs directly. A running invocation permits at most two passes, then schedules remaining work. Font refresh notifications are debounced separately for 120 ms before entering this scheduler.

After a click, ordinary dynamic Advanced mode can process a small queued local update containing CJK text immediately using the existing page result. The queue checks for CJK during its size check, counts overlapping regions once, and limits this path to 128 nodes and 10,000 characters. When unrelated work exceeds that budget, it can instead take a bounded subtree update from queued content changes within the clicked control's ancestor containers, excluding `body` and the document root. This partial run makes one pass; remaining updates keep normal batching. Purely non-CJK updates, full scans, language re-detection, shadow-tree work, and larger updates retain normal batching. With no queued DOM work, reopening cached content schedules no scan.

For asynchronous insertions, the queue discovers direct CJK text owners within newly added or filled elements, including small wrappers and text alongside links or emoji. Discovery visits at most 128 descendant nodes and 10,000 text characters per queued element; the resulting immediate correction also retains the existing 128-node/10,000-character budget. It uses the existing page result, including with experimental mixed detection enabled, and skips already managed elements and shadow trees. Unvisited descendants, surrounding controls, and pending ancestor updates retain normal batching. Pages without a CJK result do not enter this path. This avoids waiting for the scheduler when reply text arrives after its click handler has finished.

`PageObserver` watches DOM changes, including discoverable open shadow trees. A changed URL seen during DOM work and in-document `popstate` can invalidate the page result. Removing the selected sample region, rewriting multiple existing sampled CJK text nodes as non-CJK, or a `role` change that selects a different primary region can also invalidate it. One added comment or unrelated role does not.

A cached SPA view may become primary after a history scan has already read the old view. The `role` check catches that later switch, including on the dormant no-CJK path, without adding a navigation wait. With dynamic detection disabled, DOM observation retains removal cleanup instead of correction for later additions; settings and font events still have their own update paths.

On a dormant page, CJK added outside the current sample can wake detection if the old reading region, or its ancestor, is now `display: none`. If the content arrives first, a later style/class/hidden change covering the old region can complete the switch. Ordinary English mutations do not enable these computed-style checks or request a new page sample; text checks stay within changed content. After such a switch is discovered, selection skips hidden reading-region candidates, excluding their text if sampling falls back to `body`. `display: contents` remains eligible. No per-text-owner visibility checks or additional minimum CJK length are used.

Simple mode has separate startup observation: it stops when a variant is found or after its two-second window. It remembers the original root `lang` for restoration and never applies per-element font CSS.

## Language sampling

`PageLanguageDetector` resolves the effective site choice, then a trusted root language declaration, then automatic detection. Manual choices and trusted specific SC/TC/JP declarations leave no automatic sample region to invalidate. Bare root `zh` requires Chinese-script resolution.

Automatic sampling includes the title and chooses the first applicable content region:

1. `main`, then `[role=main]`.
2. One `article`, or the nearest shared container of the first two articles.
3. `body` when there are no articles.

The final sample is capped at 10,000 characters. DOM lookup and processing of a single oversized text node before truncation can exceed that bound. Sampling excludes code-like and non-prose elements and retains surrounding Latin text for `chrome.i18n.detectLanguage()`. Kana and Chinese-script clues supplement its result. A close Chinese/Japanese result has a conservative corroboration check using distinct Japanese segments.

The automatic cache key includes the root language, sample, default Chinese variant, and trust setting. An unchanged key avoids another browser detection call; building the key still requires collecting the sample. Reusing the current page result during ordinary local updates avoids that sampling step too. Visibility filtering and sample deduplication constraints are recorded in [design decisions](decisions.md#page-language-and-sampling).

## Advanced font processing

Language sampling and text-element discovery are separate operations. `candidate-scan.ts` walks the eligible body for a full scan, or queued regions for an incremental scan. It tests text nodes for Han/kana and collects their direct owning elements, including input/textarea values or placeholders. It skips code, preformatted text, scripts, styles, SVG, canvas, and other excluded elements. Scanning includes the entry host's own open shadow root and descendant hosts.

`ElementLanguage` filters trusted descendant declarations before font reads. Ordinary mode uses the page variant; an active mixed-language decision can supply a local variant. Bare descendant `zh` classification collects the first 3,000 UTF-16 code units in text order without reading the remaining descendants, and caches the result for that declaration owner within the run. The controller then:

1. Removes prior extension attachments and obsolete parent styles so computed styles reflect the website.
2. Reads computed `font-family` values in a batch.
3. Selects the configured font, checks preservation and existing ordering, and computes replacement stacks.
4. Restores skipped entries and commits new actions.

Font plans are cached by stack and variant for that run. They are reevaluated on later runs so website font changes remain observable. Explicit Latin and unclassified families retain precedence. Insertion is normally before the first generic family; recognized conflicting regional fonts can move behind the selected fallback. The first generic chooses Sans versus Serif. The detailed preservation rules belong in [design decisions](decisions.md#font-preservation-and-ordering).

For named local fonts, the worker prepares normalized, deduplicated names from installed font IDs and display names, retaining only recognized CJK and Fangsong names. It stores this result in `chrome.storage.session` at browser startup or extension installation/reload, so worker sleep and later page loads reuse it. A missing snapshot is built on the first request; failed font enumeration is not cached. Each document requests the shared result once through `getInstalledFontFamilies`, before its first Advanced run with a CJK variant and website-font preservation enabled, and creates a lookup Set without filtering the font list again. New local fonts enter this snapshot after browser restart or extension reload. The Settings font menu still reads the full font list independently. Website-declared CJK `@font-face` coverage remains separate and refreshes on font-loading events. Small declarations are combined by family up to 16 distinct CJK codepoints; larger sets retain the normal stack-wide fast path. Only small-set stacks test each owner's direct text (or input value/placeholder) against a cached uncovered-character pattern, stopping at the first match. Font metadata changes clear those patterns; their stack cache is capped at 128 entries and retains no page text. Final text decisions are not shared by the font-stack plan or kept across updates. The check uses declared ranges without requesting or awaiting font downloads, so it does not prove the file's actual glyph coverage. Availability does not use Canvas measurements.

The same lazy load obtains the browser OS through `getPlatformInfo`; English-only pages make neither request. On Linux, `trustWindowsFonts` defaults to enabled under website-font preservation. Its exact family names are based on `40/65-nonlatin.conf` in [Ubuntu 24.04's fontconfig-config 2.15.0 package](https://packages.ubuntu.com/noble/fontconfig-config) and `40/69-nonlatin.conf` in [Fedora 44's fontconfig package](https://packages.fedoraproject.org/pkgs/fontconfig/fontconfig/fedora-44.html), with localized names and Meiryo included. This policy permits system fallback; it neither reads the user's fontconfig files nor claims to resolve their mappings. Disabling it restores installed-list checks. The setting is hidden and ignored outside Linux, and existing regional checks still apply.

A renderer can replace corrected text with an empty text placeholder before rebuilding the same content. During dynamic updates, including experimental mixed-language mode, removal cleanup temporarily keeps a single removed font owner's stack on the placeholder's parent. The queued scan reevaluates local language decisions and removes this temporary attachment before reading descendant styles. Navigation and removals with multiple font owners retain ordinary cleanup.

Identical completed stacks share a rule through `FontStackRules`. Ordinary elements receive a short `data-cjk-fallback-stack` identifier. Elements in open shadow trees and those with inline `font-family: ... !important` receive reversible inline fallback.

Only inline style writes need self-mutation suppression. One timer clears the weak suppression batch after mutation delivery; shared-rule attributes are outside the observer's attribute filter. Inherited fallback lookup skips ancestor traversal when nothing is managed or every managed element uses the requested variant. `ManagedStyles.affected()` checks native containment for one changed root, following shadow hosts where needed. Multiple roots use ancestor lookup; direct-only work and full scans have separate selection paths.

### Experimental local language decisions

`MixedLanguage` reuses the text candidates. Direct segments are bounded at 500 characters each and about 10,000 CJK characters overall. The activation gate requires substantial evidence for the page language and an opposing language. Local analysis uses character evidence rather than per-element browser-language calls.

After activation, qualifying short passages may use a local font or consult one independently classified predecessor. Changed or removed predecessors invalidate their dependents. Temporary spans isolate multiple direct-text segments; restoration removes them, although adjacent text nodes may merge. The Bangumi adapter isolates a title in one fixed heading structure. Eligibility and context limits are in [design decisions](decisions.md#experimental-mixed-language-detection); character provenance is in [the research note](japanese-character-clues-research.md).

## State and cleanup

| State | Owner | Lifetime |
| --- | --- | --- |
| Font choices, detection options, and both site-rule maps | `chrome.storage.sync` | Persistent browser settings |
| Page result and automatic sample cache | Content entry / `PageLanguageDetector` | Current frame's content-script instance |
| Pending regions and scan flags | `UpdateQueue` | Consumed by a run |
| Managed elements and reversible styles | `ManagedStyles` | Until restored, removed, or the document is destroyed |
| Installed CJK font names | Background / `chrome.storage.session`; `FontSupport` lookup copies | Browser session, reset on extension reload/update |
| Shared CSS and reference counts | `FontStackRules` | While managed elements use the stack |
| Original root language and startup observation | `SimpleMode` | Current application / bounded observation |
| Search, pages, group visibility, drafts, and Undo snapshot | Site manager | Current Settings page |
| Site operation queue and toolbar bookkeeping | Background entry | Current worker instance |

`ManagedStyles` holds an iterable strong element set and a `WeakMap` of style records; it references existing DOM rather than copying text or subtrees. Observed removals release managed descendants, and summaries also clear disconnected elements. Unused shared rules are pruned. Observer deduplication uses a `WeakSet` without another strong registry of shadow roots.

## Settings and site manager

`defaults.ts` supplies general defaults and migration; `font-catalog.ts` selects installed candidates. General Settings saves omit site-rule maps and preserve existing font choices when the installed-font list is unavailable.

Content scripts request their registered domain once through the worker because they cannot call `publicSuffix` directly. Site choices use separate exact-hostname and registered-domain maps. The worker resolves scope, checks destination conflicts, moves rules in one storage write, and serializes edits, deletion, Undo, and update-time cleanup. `siteRulesFromStorage()` removes redundant Auto records before and after changes so old defaults cannot become exceptions to a newly created domain rule.

Content scripts keep both maps current on storage notifications. Rule-only changes request a rescan only when the document's effective choice changes. Masked domain rules and unrelated sites do not cause font work; notifications that also change general settings follow the broader update path.

The site manager reconciles language groups and rows by scope/hostname. Normal-row caches cover displayed pages; drafts remain until their editors close, and removed records are evicted. Notifications are deferred while drafts or writes are active. Refreshes merge active drafts with current stored entries, preserving unfinished inputs during operations on another row.

Adding and editing use inline forms. Search and pagination remain manager state; successful edits reveal the affected rule. Individual deletion collapses the row, or its group when the last matching rule disappears. Rapid delete clicks queue operations and transitions. Delete all and Undo animate the results region after storage succeeds. `ui.css` supplies shared palette and interaction states; page selectors own layout, and transitions respect reduced motion.

## Popup and toolbar

Only the top frame answers popup messages and reports actual use. The popup requests status from that frame; it has no separate detector. Unavailable pages show no site controls. The popup header icon uses the returned intervention state; inactive intervention rows are hidden.

The worker accepts toolbar reports from frame 0. On cross-document navigation Chromium restores the closed default icon, and a new content-script report can reopen it. The worker clears old per-tab bookkeeping; there is no navigation timer or separate status probe. In-memory bookkeeping is lost on worker restart. Icon semantics and UI language choices are recorded in [design decisions](decisions.md#browser-and-ui-behavior).

## Build and maintenance

Vite builds one self-contained content-script IIFE and an ES-module background worker. `scripts/build.mjs` also builds the extension pages and copies the manifest, icons, locales, and license. Repository docs and screenshots stay outside `dist`; [releasing](releasing.md) owns packaging and publication instructions.

Keep site-specific parsing in `fallback/site-rules/` and shared types/UI helpers in `src/shared/`. Preserve the controller's remove/read/write order and restoration of wrappers, inline styles, and shared rules. Comments should explain non-obvious policy or browser constraints in English. For browser-visible changes, update manifest/package versions together, rebuild `dist`, and verify the affected behavior through [testing](testing.md). Documentation-only edits need no version bump.
