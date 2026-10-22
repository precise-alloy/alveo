# Alveo Test Coverage State

## Agreed Policy

- Keep the highest feasible coverage and add matching tests for changed logic.
- Enforce 100% statements, lines, and functions and >=95% branches per gated file.
- Never lower thresholds, remove gated modules, or weaken CI/pre-push gates without explicit approval.
- Add new testable `src/**` helpers to `coverage.include` immediately.
- Run narrow affected suites, then `bun run test:ci`.
- Preserve LF-normalized text, sourcemap sources, hashes, and HTML independently of Git checkout settings; binary content must remain byte-identical.

The original policy came from the parent frontend workspace. This repository is now the standalone Alveo package: its current CI is `test.yml` and `publish.yml`, not the historical parent `frontend-*.yml` workflows.

## Current Enforced Modules

The 35-file gate in `vitest.config.ts` includes:

- `src/alias.ts`
- `src/asset-hash.ts`
- `src/config.ts`
- `src/create-server.ts`
- `src/create-vite-dev-server.ts`
- `src/cryptography.ts`
- `src/dev-supervisor.ts`
- `src/entry-server.tsx`
- `src/filename.ts`
- `src/helpers.tsx`
- `src/hooks/inject-functions.ts`
- `src/hooks/inject-functions-core.ts`
- `src/hooks/options.ts`
- `src/hooks/transform.ts`
- `src/hooks/transform-index-html.ts`
- `src/integration-core.ts`
- `src/manual-chunk.ts`
- `src/package-build.ts`
- `src/precompile-styles.ts`
- `src/prerender-core.ts`
- `src/react-loader-core.tsx`
- `src/renderer.ts`
- `src/root/active-item-options.tsx`
- `src/root/catalog.ts`
- `src/root/frame-controls.tsx`
- `src/root/svg-symbols.ts`
- `src/scaffold.ts`
- `src/scripts-core.ts`
- `src/scripts/functions.ts`
- `src/scripts/state-markup.ts`
- `src/server.ts`
- `src/states-core.ts`
- `src/styles-core.ts`
- `src/text-normalization.ts`
- `src/virtual-modules.ts`

Additional tests cover CLI sequencing, real stylesheet orchestration, prerender output, loader entry wiring, icon-dialog interactions, and package installation. The scoped gate is not a repo-wide 100% coverage claim.

## Important Contracts

### Package and Consumer Validation

- Use the npm packer to match publication; Bun packing does not reproduce npm's `.gitignore` handling. Store the starter ignore file as `_gitignore`.
- Build a clean temporary package and install its tarball using Bun's isolated linker and an empty cache, without linking maintainer development dependencies.
- Cold installs need registry access. Do not replace them with warmed/offline installs that could hide missing runtime dependencies.
- Verify consumer types using the installed compiler with Bundler, Node16, and NodeNext resolution and `skipLibCheck: false`. Explicit type libraries must resolve from the consumer's working directory.
- Verify actual generated HTML and integration output, including Vite base overrides and projects without consumer helper/icon/mock files.
- Verify deferred YAML through the eager client import graph; assert browser chunks contain neither Cheerio nor lodash.

### Styles

- `STYLES_CONCURRENCY` still defaults to 5. The queue bounds work and provides a drain contract; synchronous Sass is not CPU-parallel.
- One-shot builds run immediately, await the queue, and throw on failure. Debouncing is watch-only; startup performs one scan with `ignoreInitial: true`.
- A synthetic entry loads base, atoms, then molecules through real Sass modules. Relative imports avoid interpreting Windows drive letters as URL schemes.
- Keep Sass intermediate output expanded. Compressed Sass can lose cross-file mapping locations even when `sourcesContent` includes the original files.
- LightningCSS performs final minification and browser-target lowering for both source and published framework CSS. Use real mapping-coordinate tests.

### Runtime and Safety

- Never synthesize `globalThis.window` during SSR. Errors must fail the command rather than returning successful empty HTML.
- The server is development-only. Pass mode/port explicitly and await startup.
- Verify real HTTP responses after Vite strips the base from `req.url`: stable script URLs must serve JavaScript, and fresh public files must precede stale watch-build copies.
- Generation and integration run states/styles first and stop on failed stages.
- Share literal HTML replacement, asset relocation, hash versions, and URL rules.
- Integration destinations must be external and non-overlapping, including physical symlink aliases; diagnose resolution failures before deletion.
- Malformed component payloads are isolated/reported and retained for retry. YAML imports are lazy and overlapping renders must not mount twice.
- Preserve keyboard/ARIA behavior, both text directions, print stability, and timer cleanup when changing catalog controls.
- Let responsive CSS distinguish collapsed mobile/top-panel menus from the always-visible desktop sidebar; do not unconditionally apply `inert` from a toggle state. Check compiled print-selector scope and browser-computed styles.
- Skip public-asset hashing for Vite-managed `?url` modules; their filesystem paths can contain `/assets/` without referring to a consumer public file.

## Repeatable Techniques

- SSR guards: sibling `*.node-env.test.ts` with a real Node environment.
- Watchers: capture callbacks from mock calls and invoke them explicitly.
- Filesystem/compiler boundaries: typed dependencies plus real fixture tests.
- Sourcemaps: assert `SourceMapConsumer.originalPositionFor`, not just filenames.
- Generated text: CRLF/LF fixtures, escaped map content, and binary pass-through.
- Integration: stage temporary output, rebuild CRLF input, and require `git diff --quiet` for asset/pattern destinations without creating a commit.
- Avoid casts that invent impossible branches; remove truly unreachable code with a short explanation instead.

## CI and Local Hooks

- `test.yml` runs the full gate on Ubuntu, Windows, and macOS for PRs/master.
- `publish.yml` depends on that matrix before its clean build and publication.
- Local `prepublishOnly` still runs tests/build. CI publication uses `--ignore-scripts` only after the explicit prerequisite gates.
- Guarded `bin/prepare.js` installs `.git-hooks` only in maintainer checkouts. Keep `.git-hooks/pre-push` running `bun run typecheck`; consumer installs must not change their parent repository configuration.

## External Requirement

GitHub branch protection must separately require the cross-platform package checks. Workflow files alone cannot enforce merge protection; do not claim that repository settings were changed without authenticated verification.

See `docs/test-coverage.md` for the current contract matrix. Use actual command results for test counts and percentages rather than carrying historical rollout numbers forward as if they were current.
