# Release notes — 0.9.5

## Site settings redesign

- Browse saved websites in collapsible language groups, with search and pagination for larger lists. The manager can still be shown or hidden.
- Add and edit websites in a dialog. Change the language or switch between This hostname and Whole domain for an existing setting.
- Adding an existing website opens its setting for editing. Conflicting scope changes prevent accidental overwrites.

## Current-page popup

- Simplified the current-site language selector and hid font-correction details when no correction is active.

## Domain settings

- Apply a language setting to a whole domain and its subdomains. Settings for an exact hostname take priority.
- Simultaneous edits in the popup and Settings preserve unrelated website settings.

## Requirements

Chrome/Chromium 153 or newer. Whole-domain settings require the publicSuffix permission.

## Install

Extract the release ZIP, then load the extracted folder through chrome://extensions in Developer mode.
