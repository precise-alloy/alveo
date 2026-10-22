# Test Coverage

## Policy and Commands

Logic changes must preserve or improve the highest feasible coverage and include regression tests for new branches, failures, paths, and output contracts.

```bash
bun run typecheck
bun run test -- src/<affected>.test.ts
bun run test:ci
```

`typecheck` uses `bun check --noEmit`; package emission still requires `tsc`. `test:ci` runs type checking and the complete Vitest/V8 coverage gate. Repository installation configures the checked-in `.git-hooks/pre-push` hook to run `bun run typecheck`. Packed consumer installs do not install repository hooks.

Per-file thresholds remain **100% statements, lines, and functions; >=95% branches**. Do not lower thresholds, remove gated modules, or weaken CI/hook gates without explicit approval. New testable logic modules belong in `coverage.include` in the same change as their tests.

## Enforced Scope

The authoritative list is in [vitest.config.ts](../vitest.config.ts). The gate currently covers these 35 modules:

| Area | Modules |
| --- | --- |
| Package/configuration | `config.ts`, `package-build.ts`, `scaffold.ts`, `helpers.tsx` |
| Resolution/output | `alias.ts`, `asset-hash.ts`, `cryptography.ts`, `filename.ts`, `manual-chunk.ts`, `paths`-dependent virtual module behavior in `virtual-modules.ts` |
| Server/processes | `dev-supervisor.ts`, `create-server.ts`, `create-vite-dev-server.ts`, `server.ts`, `entry-server.tsx`, `renderer.ts` |
| Vite hooks | `hooks/inject-functions.ts`, `hooks/inject-functions-core.ts`, `hooks/options.ts`, `hooks/transform.ts`, `hooks/transform-index-html.ts` |
| Build cores | `integration-core.ts`, `prerender-core.ts`, `scripts-core.ts`, `states-core.ts`, `styles-core.ts`, `precompile-styles.ts`, `text-normalization.ts` |
| Browser runtime | `react-loader-core.tsx`, `scripts/functions.ts`, `scripts/state-markup.ts` |
| Catalog | `root/catalog.ts`, `root/svg-symbols.ts`, `root/active-item-options.tsx`, `root/frame-controls.tsx` |

All paths above are relative to `src/`. Type-only models do not contain executable logic. This is a scoped per-file gate, **not** a claim of 100% coverage of the entire repository.

Additional suites exercise CLI sequencing, real Sass orchestration, prerender file writes, the loader entry, icon-dialog behavior, and package distribution. Those tests protect side-effect boundaries even where the entire orchestration module is not yet in the hard-threshold set.

## Critical Regression Contracts

### Package Distribution

`package.test.ts` builds a fresh temporary checkout, then uses the **npm packer** used by publication. Bun packing alone cannot detect npm's nested `.gitignore` exclusion. The neutral template filename must survive packing and become `.gitignore` during scaffolding. The package test seeds harmless private-file/artifact decoys and asserts they are not packed. Source-checkout scaffolding filters the same local-only categories.

The tarball is installed with production dependencies using Bun's isolated linker and a separate empty cache. Registry access is required; the test must not link the maintainer's development dependencies or assume warmed metadata.

The test verifies:

- Exported files, copied ambient declarations, and packaged framework icons.
- Shared React/router peers and absence of TypeScript/test/lint tools in the initial production-only installation.
- Scaffold names, the running CLI's version, and consumer-safe hook preparation.
- Real standalone entry bundling and linked sourcemaps.
- The consumer's own TypeScript compiler in Bundler, Node16, and NodeNext modes with `skipLibCheck: false`, including helpers, models, globals, and virtual types.
- Custom-mode `generate` and `inte` without consumer helper/icon/mock files.
- Actual nonempty rendered HTML, literal dollar patterns, and Vite base overrides.
- The static import closure of the client entry excludes YAML; the parser remains in a deferred chunk. No browser chunk includes Cheerio or lodash.
- A repeated integration build from CRLF source produces no generated content diff.

### Build, Rendering and Safety

- CLI suites assert that state, style, or prerender failure prevents later stages. Both generation and integration run states first.
- SSR never creates a fake `window`; render errors retain the route/cause and fail. The development server awaits rendering and returns HTTP 500 on errors.
- Server mode is passed explicitly; production serving is rejected.
- A real Vite/Express HTTP test verifies that watched JavaScript under a non-root base is served as JavaScript, not passed to SSR after Vite strips the URL base. Fresh public files must also win over stale watch-output copies when a file watcher event is missed.
- HTML payload substitution is literal, and dev/prerender share asset relocation and URL rules while retaining dev refresh versus deterministic content versions.
- Integration destinations reject ancestors, descendants, equal/nested outputs, and symlink aliases before destructive copying. Missing future directories are resolved through their existing ancestors; filesystem errors are diagnostic.
- Every non-production mode may use mocks, but missing handlers are optional and must not pull an unresolved mock module into the build.
- Vite-managed `?url` modules must not be mistaken for consumer public-file references merely because their filesystem path contains `/assets/`.
- Script compilation discovers entries only, bundles imports, excludes tests, detects output collisions, writes maps, and watches real directories/dependencies.
- Sass aggregation must preserve base/atom/molecule cascade and real source ownership. Tests use `SourceMapConsumer` to verify final original file/line positions, not only the presence of filenames or `sourcesContent`.
- Sass intermediate output stays expanded; compressed Sass output can collapse cross-module mappings. LightningCSS performs final minification/target lowering for both source and precompiled framework CSS.
- One-shot styles do not debounce/sleep, failed styles reject the pipeline, and watch startup compiles each entry once with `ignoreInitial: true`.
- Streamed child output buffers incomplete lines and UTF-8 sequences separately for stdout/stderr and flushes after stdio completion.

### Browser, Accessibility and Print

- JSON script payloads escape `<` without corrupting decoded props; state markup escapes text/attributes and preserves decoded state values.
- JSON pages do not load YAML. Bad payloads cannot prevent subsequent mounts; pending YAML work cannot mount twice or resurrect removed content.
- Settings refs/callbacks remain stable, menu state is exposed through ARIA, and Escape restores focus. Package-owned icons work under a non-root Vite base.
- Responsive CSS controls visibility: collapsed mobile/top-panel menus must not disable the persistent desktop sidebar.
- Disco mode stops/restarts correctly, stops for printing, and releases timers on unmount. Width behavior is exercised in LTR and RTL.
- Compiled print rules target state controls globally, not descendants of a close button; a real browser verifies their computed `display: none`.
- Catalog fallback excludes its own root to prevent recursive iframes and shows an explicit empty state without assuming `/pages/home`.
- Icon parsing uses native XML parsing, reports malformed sprites, and defers fetching until the dialog opens.

## Determinism Validation

Normalize text to LF before hashing, writing prerendered HTML, embedding map sources, or copying integration output. Preserve binary bytes unchanged. Do not depend on `.gitattributes`, `core.autocrlf`, or the checkout platform.

For an actual consumer, run its integration command and:

```bash
git diff --quiet -- <VITE_INTE_PATTERN_DIR> <VITE_INTE_ASSET_DIR>
```

The package fixture stages generated output in a temporary Git index, rebuilds from CRLF input, and runs this content-diff check without creating commits. Intentional migrations (such as the SHA-1 to SHA-384 version change) have a one-time output difference; repeated equivalent inputs must then be byte-stable. On Windows, status/EOL warnings alone are not a content difference.

## CI and Merge Gates

[test.yml](../.github/workflows/test.yml) runs `bun run test:ci` on Ubuntu, Windows, and macOS for pull requests and `master`, and is reusable by [publish.yml](../.github/workflows/publish.yml). Publication depends on this full matrix and version validation, then performs one clean release build. `npm publish --ignore-scripts` avoids repeating the already-enforced lifecycle gate; local publication retains `prepublishOnly`.

GitHub repository settings must separately require these cross-platform checks before merge. Repository files do not configure branch protection.

## Working Techniques

- Use sibling `*.node-env.test.ts` files for SSR guard branches.
- Invoke captured watcher/listener callbacks so their bodies are measured.
- Use typed dependency injection at filesystem/compiler boundaries, plus real compiler/installed-package tests to detect failures mocks cannot reveal.
- Test actual output shapes and sourcemap positions rather than broad snapshots.
- Do not force unreachable code with `as never`; remove truly unreachable branches with a concise explanation or retain realistic defensive tests.
- Keep this document and the coverage skill reference aligned when scope grows.
