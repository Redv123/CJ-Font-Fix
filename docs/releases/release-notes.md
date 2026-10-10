# Release notes — 0.9.5

## Site settings redesign

- Redesigned only the site-language manager, keeping the existing Mode, Font choices, Detection, and popup layouts.
- Kept the Manage / Hide site language settings control and its original expand/collapse animation. Reduced-motion preferences disable that animation.
- Grouped saved websites by Simplified Chinese, Japanese, Traditional Chinese, Disabled, or existing automatic exceptions. Each language group can be expanded or collapsed.
- Added search across all saved rules and ten-rule pages within each language group. Group counts and search results update as settings change.
- Add website opens an empty dialog. Selecting a saved website opens the same dialog with its current hostname, scope, and language. Cancel, Escape, and closing the dialog discard draft changes.
- Users can change Apply to after a website is added. Moving between hostname and whole-domain scope saves both rule maps together; conflicting destinations leave the original rule intact.
- Duplicate additions open the existing rule for editing. Newly saved entries are revealed in their group and page, with a brief highlight.
- Removed Auto choices from website editing forms and transient Applying messages. Errors remain visible when a change fails.
- Restore defaults preserves site rules; Delete all site settings clears both scopes.

## Current-page popup

- Simplified the popup to one site-language menu. Popup changes apply to the current hostname; whole-domain rules are managed in Settings.
- Removed the redundant Use domain setting / Auto choice and Apply to selector.
- Applied fonts, CSS intervention, and Managed elements are hidden when no correction is active. Active Simple mode shows only Applied lang.

## Domain rules and maintenance

- Whole-domain choices use the browser's publicSuffix list. Exact hostname choices take priority, and existing hostname Auto exceptions can bypass a domain choice.
- Popup and Settings edits share a save queue to preserve unrelated changes across windows.
- Localized new controls, search, pagination, and validation messages in English, Japanese, Simplified Chinese, and Traditional Chinese.
- Expanded Chromium coverage for editing, scope moves, conflicts, cancellation, search, pagination, the Hide control, responsive layouts, and inactive/active popup states.
- Renamed the current release notes to docs/releases/release-notes.md and updated the release workflow and publishing instructions to use that file.

## Requirements

Chrome/Chromium 153 or newer. The publicSuffix permission uses the browser's built-in domain list; no domain list is bundled with the extension.

## Install

Extract the release ZIP, then load the extracted folder through chrome://extensions in Developer mode.
