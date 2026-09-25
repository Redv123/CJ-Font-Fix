# Publishing a GitHub Release

1. Update the version in `manifest.json`, `package.json`, and `package-lock.json`.
2. Write `docs/releases/v<version>.md` for that version. The workflow uses this text as the Release description; it does not generate a changelog.
3. Commit the version and notes to `main`.
4. Run **Build and release** from the GitHub Actions tab on `main`, or push the matching `v<version>` tag. Do not create a Release manually first.

The workflow checks version consistency, installs dependencies with `npm ci`, runs unit tests and TypeScript checks, builds the extension, and attaches a ZIP containing only `dist`. On a manual run, it creates the tag and Release after the build passes; a tag push uses the existing tag. Live-site and optional corpus tests are not part of this workflow.
