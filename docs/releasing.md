# Publishing a GitHub Release

1. Update the version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Update `docs/releases/release-notes.md` for that version. The workflow uses this text as the Release description; it does not generate a changelog.
3. Commit the version and notes to `main`.
4. Run **Build and release** from the GitHub Actions tab on `main`, or push the matching `v<version>` tag. Do not create a Release manually first.

The workflow first calls **Checks**, which installs dependencies, runs unit tests, checks browser-test TypeScript, and builds/typechecks the extension. GitHub Actions does not install Chromium or execute browser tests; run relevant browser checks locally before release. A failed automated check prevents the release job from running. The release job installs from the same lockfile, rebuilds, checks version consistency, and attaches a ZIP containing only `dist`. On a manual run, it creates the tag and Release after the checks and build pass; a tag push uses the existing tag. See [testing](testing.md) for local browser commands and evidence boundaries.
