# Publishing a GitHub Release

1. Update the version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Update `docs/releases/release-notes.md` for that version. The workflow uses this text as the Release description; it does not generate a changelog.
3. Commit the version and notes to `main`.
4. Run **Build and release** from the GitHub Actions tab on `main`, or push the matching `v<version>` tag. Do not create a Release manually first.

The workflow first calls **Checks**, which installs dependencies and Chromium, runs unit tests, and builds/typechecks the extension before running `npm run test:local`. A failed check prevents the release job from running. The release job installs from the same lockfile, rebuilds, checks version consistency, and attaches a ZIP containing only `dist`. On a manual run, it creates the tag and Release after the checks and build pass; a tag push uses the existing tag. Live-site, optional corpus, and font-dependent rendered-font tests remain separate. See [testing](testing.md) for the local gate and evidence boundaries.
