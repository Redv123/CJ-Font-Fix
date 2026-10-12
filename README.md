# CJ Font Fallback Fix

[English](README.md) | [简体中文](README.zh-CN.md)

**CJ stands for Chinese and Japanese; Chinese includes both Simplified and Traditional Chinese.** CJ Font Fallback Fix is a Chrome/Chromium extension that helps the browser choose the right regional font for CJK text.

On Linux, a page that neither identifies its language with `lang` nor calls an appropriate font in CSS may render CJK text requested in bold using a Regular face. The extension helps Chrome use the correct bold face and can select a Chinese font even when a Chinese page is marked `lang="en-US"`. This problem is more common on Chinese sites; Japanese sites are more likely to declare `lang="ja"`.

For users on systems other than Linux, CJ Font Fallback Fix selects character fonts according to the page language, so Chinese and Japanese pages display character forms appropriate to each language. It is suited to readers who regularly browse websites in different languages, study Japanese while also reading Chinese content, or care about regional differences in character forms.

![Chinese page in Linux Chrome: the extension selects the appropriate Chinese font and bold weight on the left; the original rendering is on the right](docs/images/bold-chinese-before-after.png)

The Chinese page in this example identifies itself as English. With the extension enabled (left), Chrome uses the appropriate Chinese font and bold weight. Without it (right), the text loses its intended bold appearance.

## Fonts and detection

The extension handles **Simplified Chinese, Traditional Chinese, and Japanese**. It checks the page language and helps the browser use a suitable font. If the result is wrong, choose a language for that website from the toolbar popup.

Under **Settings → Font choices**, choose and preview installed Sans and Serif fonts for each language. **Same as Sans** uses that language's Sans font for both styles. The extension selects defaults from suitable installed fonts, preferring Noto Sans CJK for Sans and Noto Serif CJK for Serif. Other default candidates include common Windows and macOS fonts, for example:

| System | Sans candidates | Serif candidates |
| --- | --- | --- |
| Windows | Microsoft YaHei, Microsoft JhengHei, Yu Gothic | SimSun, PMingLiU, Yu Mincho |
| macOS | PingFang SC/TC, Hiragino Sans | Songti SC/TC, Hiragino Mincho ProN |

The actual choice depends on installed fonts. Suitable Noto fonts take priority on Windows and macOS too, when available.

### Modes

- **Advanced mode** is the default. It uses your chosen fonts where correction is needed and keeps the website's Latin fonts. By default, it also checks content added later and corrects its fonts, so you generally do not need to switch to Simple mode.
- **Simple mode** changes the page's language declaration so the browser can choose a font. Your font choices in Settings do not apply in this mode. It checks content appearing during startup, then stops watching later changes.

### Detection settings

- **Trust specific Chinese and Japanese language declarations** leaves content to the browser when the website clearly identifies its language. Your manual website choice takes priority.
- **Keep Chinese and Japanese fonts chosen by websites** preserves a suitable font supplied or named by the website. Fonts for the wrong language can still be corrected.
- **Watch dynamic pages** corrects text added later and checks the language after navigation within the page, including Back/Forward. Expanding a comment or loading more items at the same address normally keeps the existing page language.
- **Default Chinese variant** chooses Simplified or Traditional Chinese when the text does not provide enough clues.

The first three options are on by default. **Detect clearly separated Chinese and Japanese text blocks (experimental)** is off by default. It can use different fonts for separate Chinese and Japanese passages on automatically detected pages containing substantial amounts of both languages. A manual website choice keeps it off. It can misclassify short passages or affect page appearance; uncertain text keeps the page's language choice.

For font ordering and detection algorithms, see the [architecture guide](docs/architecture.md).

## Website language settings

By default, the extension detects the page language automatically. You can use the toolbar popup to choose which language’s fonts to use for a specific website, or disable the extension on that website.

Use **Settings → Manage site language settings** to manage website languages and their scope.

### Apply to

| Choice | Example |
| --- | --- |
| **Exact match** | `news.example.com` affects only that address, not `example.com` or `shop.example.com`. |
| **Include subdomains** | Entering `news.example.com` creates a setting for `example.com` and all its subdomains. |

These choices apply to website names, not individual pages or URL paths. **Exact match** takes priority over **Include subdomains**. Popup changes apply only to the current website name.

The interface follows the browser's language: English, Japanese, Simplified Chinese, or Traditional Chinese, with English as the fallback.

## Checking the current page

Click the toolbar icon to see the page's language and whether correction is active. **HTML lang** is the language declared by the website, which may differ from the detected language.

The book opens when the extension applies font correction or sets the page language in Simple mode. Both the toolbar and popup book stay closed when neither is active. By default, the extension trusts explicit Chinese or Japanese `lang` declarations and preserves suitable Chinese and Japanese fonts already used by the website.

During font correction, **Applied fonts**, **CSS intervention**, and **Managed elements** show the extension's font changes and how many page elements it handles. These details are hidden when inactive. In Simple mode, **Applied lang** shows the language set by the extension. These are activity indicators, not proof of which font the browser used to draw every character.

Chrome internal pages, the Chrome Web Store, and other protected pages cannot run the extension.

## Installation

1. Extract the release ZIP.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the extracted folder.
4. Open the extension's **Settings** to check or adjust the font choices.

To build from source, run `npm ci` and `npm run build`, then load the generated `dist` directory.

## Development and limits

The source uses TypeScript, Vite, and Manifest V3, with no third-party runtime dependencies. See the [architecture guide](docs/architecture.md) for the modules and runtime flow, [design decisions](docs/decisions.md) for intentional constraints, and [testing notes](docs/testing.md) for browser checks.

```sh
npm ci
npm test
npm run test:sites
npm run build
```

`npm test` runs local unit tests. `npm run test:sites` checks a local SPA fixture and several live sites in Chromium; the full site suite needs internet access and can be affected by site changes. The optional `npm run test:corpus` uses a locally supplied FLORES-200 archive via `CJ_FLORES_DIR`; its text is not committed or bundled. See the [testing notes](docs/testing.md) for setup and limits. `npm run build` checks TypeScript and produces a loadable extension in `dist`.

The extension cannot ask Chromium which physical font rendered **each glyph**. It relies on the page's CSS, font metadata, and local availability instead. A few shared Han characters cannot reliably identify a region, and the experimental mixed-language option does not cover every inline layout. Discovered open shadow roots can be handled; closed shadow roots cannot be inspected.

## License

The source code, original icon artwork, and documentation text are licensed under [GNU GPLv3](LICENSE) (`GPL-3.0-only`). The [comparison screenshot](docs/images/bold-chinese-before-after.png) depicts a third-party website and is **not** covered by that license; this project does not grant rights to reuse the website content shown in it.

The built extension in `dist` contains the files needed to run it and a copy of the license, but not the READMEs, development docs, or comparison screenshot. The release workflow tags the exact source revision used for its ZIP.
