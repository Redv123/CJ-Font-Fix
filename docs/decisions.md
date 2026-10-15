# Design decisions and known limits

These are the behavioral constraints and reasons to preserve when changing the project. [Architecture](architecture.md) describes the overall flow; [runtime details](runtime-details.md) describes implementation. Verify changes through [testing](testing.md).

## Product scope and modes

- The primary job is to repair Chinese/Japanese fallback and bold matching in Linux Chromium. Correct SC/TC/JP character forms are another benefit. Translation, website-copy changes, and a separate Mono font control are outside scope.
- Advanced mode is the default and preserves website Latin fonts. Simple mode changes only the root `lang`; it must remain separate from element-level font injection.
- Use suitable configured regional fonts. An unrelated installed font must not fill an empty regional choice; without a suitable choice, CSS fallback for that region stays inactive.

## Page language and sampling

### Declarations and priority

- A manual site choice takes priority over declarations and automatic detection.
- With trust enabled, a specific root SC/TC/JP declaration leaves the entire page to the browser, including nested and dynamically added content. Different rendering alone is not a reason to override that declaration.
- Without a trusted specific root, trust descendant declarations identifying supported SC/TC/JP variants. Other language tags do not suppress CJK font repair. Bare root `zh` needs SC/TC resolution; bare descendant `zh` neither skips repair nor selects another font while mixed detection is inactive.
- Ordinary pages use one page variant for extension-applied fonts. Trusted descendants remain browser-owned. Optimize this path for single-language reading; one quoted Japanese title does not make Chinese prose a mixed page.

### Sampling and stability

- Prefer primary reading content and keep samples bounded. On multiple-article pages, use a shared container rather than only the first article: an advertisement can otherwise hide the language of the results. Selection order and limits are in [runtime details](runtime-details.md#language-sampling).
- Keep an established page result during ordinary same-URL additions. Expanding a comment or loading feed items must not change the whole page's language.
- Re-detection is valid for navigation, Back/Forward, root-language or settings changes, unresolved pages gaining CJK content, and substantial replacement of the sampled region. Removing that region or rewriting multiple existing sampled CJK nodes qualifies; a single appended or edited comment does not.
- Re-select the sample when a `role` change actually switches primary content, even on a no-CJK page. Cached SPA views can remain connected after a history scan reads the old view. Other role changes cause no font work; use the existing scheduler without adding a fixed navigation wait.
- A close browser Chinese/Japanese result may use multiple independently supported Japanese passages for corroboration. This is a page-level decision, separate from experimental mixed detection. Duplicate passages count once for corroboration; the original sample is not deduplicated.
- Retain sample text without per-parent `checkVisibility()` filtering or broad deduplication unless a demonstrated failure justifies changing it. `display: contents` can make visible text fail a parent check, and repeated titles can be valid evidence. Any visibility filter also needs to invalidate results when visibility changes.
- A dormant SPA must recover when a hidden skeleton remains connected and CJK arrives in another region. Check candidate-region visibility only after observing that CJK; English-only attribute churn must not start visibility polling or whole-page sampling. An intact English main remains authoritative over another-language sidebar.

## Experimental mixed-language detection

### Activation and consent

- Keep the experiment off by default, Advanced-only, and restricted to automatically classified pages without a root CJK declaration or manual site choice. Both languages must have substantial evidence; uncertain passages use the page result.
- Enabling the Settings checkbox requires warning confirmation each time. Cancel or dismissal leaves it off; disabling needs no confirmation. This is a Settings gate, without a new per-page prompt or storage schema.
- Local decisions leave root and element `lang` declarations and the page result unchanged.

### Short passages and context

- After activation, independent passages consisting of kana, or kana plus recognized Japanese character clues, may use JP below the ordinary text-length threshold. Short passages cannot activate the experiment themselves.
- Shared Han in a short passage remains uncertain unless matching clues and one directly preceding, independently classified passage support it. Context-derived guesses cannot propagate.
- Context is limited to the same direct-text owner or a peer paragraph and stops at block, explicit-language, and large line-break boundaries. Changing or removing the predecessor must invalidate its dependent decision.
- Character clues are heuristics, not dictionaries. Preserve Chinese-exemplar exclusions and source attribution in [the character research note](japanese-character-clues-research.md). Strong classification from these clues needs at least two distinct clues when kana has not met its threshold. Expanding a clue set alone must not increase confidence; Japanese names quoted in Chinese can still be false positives.
- Preserve ordinary inline text instead of splitting at spaces. The Bangumi heading adapter handles one fixed template and must remain a site-specific exception.

### Unimplemented proposal

Removing classified blocks and making another browser-language call on the remainder has **not been implemented**. The mixed path uses local evidence; it has no per-element browser-language calls or iterative residual-text loop.

## Font preservation and ordering

- Preserve website Latin families and support stacks from all platforms. Runtime font composition must not assume a Linux-specific stack.
- One website-font preference covers declared CJK faces and suitable installed families named by the website. Legacy preferences migrate to enabled if either was enabled, otherwise disabled.
- Linux additionally offers default-on trust for common Windows Chinese/Japanese font declarations, allowing system substitutes without proving those fonts are installed. Turning off website-font preservation also unchecks and saves this exception as off; turning preservation back on does not re-enable it. Wrong-region and mixed-language decisions still follow the existing rules. Other platforms neither show nor apply this exception.
- Declared Unicode subsets may be respected before all subsets download; an errored face does not count as suitable coverage.
- Preserve an available named Fangsong font for Chinese when preservation is enabled, including names with another Chinese regional suffix. For Japanese, put the Japanese fallback before Fangsong. Check installed font IDs and display names from the worker's system font list rather than assuming a portable name or measuring Canvas widths. A missing or unavailable list must not be treated as proof a font is installed.
- Treat bare `emoji` as a named family. Keep early emoji families ahead of the inserted CJK fallback; those after the first generic do not affect insertion.

## Site language settings

- Default to **Exact match**; **Include subdomains** uses registered-domain scope. Exact choices take priority, and scope never depends on URL paths.
- Keep hostname Auto only when it bypasses an existing domain rule. Otherwise it is a redundant default and leaves no record. Remove obsolete defaults on rule writes and extension updates. Deleting a hostname rule restores inheritance; domain Auto removes its rule.
- **Restore defaults** and site-rule deletion have separate scopes. Delete all offers Undo while Settings remains open; restoration keeps newer choices on conflicting records.
- Delete individual rules with one click, without confirmation. Show counts within language groups, with no total on the section heading.
- Creation and editing use inline forms. Search remains visible when the list is empty, and Manage/Hide controls the whole manager. Search text and unfinished drafts do not create rules.
- When the installed-font list is unavailable or empty, disable font choices and Restore defaults while preserving saved fonts. Mode, detection, and site controls remain usable. Missing recommended fonts alone must not disable manual selection.

## Browser and UI behavior

- Both book icons indicate actual intervention: applied Advanced CSS or an applied Simple-mode language. Detection alone does not open them. Protected pages may not supply status.
- Follow browser UI language using English, Japanese, Simplified Chinese, or Traditional Chinese locales, with English fallback and no manual language picker.
- Support discovered open shadow roots; closed roots cannot be inspected. A root attached to an already-connected host without an observable mutation can wait for another scan. Code-like and non-prose content remains excluded.
- Extension markers and computed font lists do not prove which physical font drew each character. Use DevTools **Rendered Fonts** for physical-font complaints.

## Changing these decisions

Use an affected page and before/after observations for language, font order, icon, or performance changes. Check the ordinary single-language path and add a focused regression for changed behavior. Synthetic character ratios alone do not establish a need; experimental behavior stays opt-in until broader evidence supports it.
