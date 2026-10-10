# Release notes — 0.9.6

## Changes

- Delete all site settings now offers Undo instead of a browser confirmation dialog.
- Add and edit website language settings inline, with edit/delete icons and updates that keep other language groups stable.
- Mode, detection, and website settings remain usable if the installed-font list cannot be loaded.
- Improved button visibility in dark mode.
- The popup's book icon now matches the toolbar's open or closed state.
- Returning a website to default Auto now removes its saved site setting; old automatic defaults no longer clutter the list.
- Fixed font correction for newly added content inside open Shadow DOM.
- Fixed Japanese detection when returning to a YouTube channel after refreshing the homepage.
- Reduced processing for local page updates and changes to other websites' settings, and fixed retained references to removed Shadow DOM content.

## Requirements

Chrome/Chromium 153 or newer. Whole-domain settings require the publicSuffix permission.

## Install

Extract the release ZIP, then load the extracted folder through chrome://extensions in Developer mode.
