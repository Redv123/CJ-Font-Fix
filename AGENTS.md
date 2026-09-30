# Agent guidance

Read the project document that matches the work:

- `docs/architecture.md` for module ownership and runtime flow.
- `docs/code-map.md` to locate the class or function that owns a specific behavior before searching the tree.
- `docs/decisions.md` for established product constraints and tradeoffs.
- `docs/testing.md` for test boundaries, real-browser checks, and Flatpak Chromium use.
- `docs/releasing.md` for version and release work.

## Skill scope

Use Chrome extension guidance when the answer or implementation depends on extension-specific behavior: Manifest V3, Chrome APIs, permissions, service workers, content-script lifecycle, extension messaging, packaging, or browser-store publication.

Treat ordinary TypeScript, algorithms, font-stack ordering, string processing, unit-test interpretation, documentation, and general CSS as normal repository work. For test-coverage questions, inspect the test cases and the branches they actually assert before choosing any platform skill. The repository being a Chrome extension is not by itself a reason to load Chrome extension guidance.

Choose skills from the actual question and the code involved. For a local explanation, inspect the relevant source first; reach for broader platform guidance only when the conclusion depends on that platform.

## Local data boundary

Search the repository and task-created temporary directories by default. Ask the user before searching any personal directory outside the repository, including read-only recursive searches. Keep downloaded corpora and exploratory tests local; add them to GitHub only with explicit approval.
