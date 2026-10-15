# Release notes — 0.9.6

## Changes

- Delete all site settings now offers Undo instead of a browser confirmation dialog.
- Add and edit website language settings inline, with edit/delete icons and updates that keep other language groups stable.
- Fixed font-list errors blocking other Settings controls.
- Improved button visibility in dark mode.
- The popup's book icon now matches the toolbar's open or closed state.
- Returning a website to default Auto now removes its saved site setting; old automatic defaults no longer clutter the list.
- Fixed cases where text added by a website kept the wrong font.
- Fixed Japanese detection when returning to a YouTube channel after refreshing the homepage.
- Fixed font correction not starting when a page keeps its hidden loading placeholder beside newly loaded content.
- Fixed brief font changes when hovering over YouTube descriptions or expanding new content on dynamic pages.
- Improved website font preservation in browsers with fingerprinting protection.
- Added a Linux-only option, enabled by default, to trust fontconfig replacements for common Windows Chinese and Japanese fonts.
- Reduced unnecessary font processing and memory use on dynamic pages.

## Install

Extract the release ZIP, then load the extracted folder through chrome://extensions in Developer mode.
