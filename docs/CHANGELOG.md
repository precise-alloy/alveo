# <Project> - Changelog

Log completed EPICs and significant changes here. Delete memory file after logging.

## Format

```text
### YYYY-MM-DD - <feature name>
Tasks: <task IDs>
Summary: <what was built>
```

<!-- Add entries below -->

### 2026-10-20 - Package and runtime review corrections

- Made packed declarations self-contained, added `alveo/helpers` and `alveo/types`, fixed scaffold naming/versioning/ignore files, cleaned package output, and guarded Git hook installation without swallowing setup errors.
- Standardized on Node 24+ and Bun-first tooling. The Express server is now explicitly development-only; static generation/integration remain the production deployment paths.
- Removed SSR window pollution and success-shaped empty error renders. Pipelines await styles, generate integration state data, fail before later stages, and carry the resolved Vite base into prerendering.
- Corrected real asset extensions, unified content versions, preserved literal dollar patterns, deep-merged configuration, and protected external integration destinations against project overlap and symlink aliases.
- Fixed Sass module ownership and sourcemaps, deferred minification to LightningCSS, applied consumer browser targets to framework CSS, eliminated one-shot sleeps and duplicate watch startup work, and bundled script entries with usable maps.
- Isolated component payload failures, escaped embedded JSON/state markup, deferred YAML and icon loading, removed browser Cheerio/lodash dependencies, repaired catalog fallback, and stabilized settings refs and print-safe timers.
- Expanded critical-module coverage and installed-package regression tests, including strict TypeScript modes, actual generated HTML, client bundle graph checks, and LF/CRLF integration byte comparisons. Cross-platform package tests now gate publishing.
- PR review follow-up: explicit inline/CLI bases now outrank `defineAlveoConfig({ base })` and `VITE_BASE_URL`; Vite entry discovery shares the script build's test/fixture exclusions and own-property duplicate checks; asynchronous React mount failures restore the original payload; the Sass-leak check ignores strings, URLs, comments and longer identifiers; state watching keys paths consistently across Windows/POSIX; and `alveo inte` copies root-level emitted assets (e.g. `.mp4`) and unlisted asset folders instead of silently dropping them, and replaces destination symlinks rather than writing through them.

See the README migration notes before upgrading consumers with copied helpers, old standalone script filenames, production server usage, or cached hash values.
