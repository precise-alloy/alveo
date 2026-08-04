# Frontend Test Coverage State

## Original Requirements

The repo coverage rollout was designed around these requirements:

- coverage should be as high as possible
- failing tests should clearly signal what logic changed
- parent-folder GitHub workflows should require tests before deploy and merge
- `docs/test-coverage.md` should document the policy and rollout
- planning and implementation should be detailed enough for mission-critical site use
- refactors are allowed when needed to make critical logic testable

## What We Decided

- The customization should be workspace-shared because the policy is repo-specific and team-facing.
- A skill is needed for discoverable, repeatable coverage workflow guidance.
- A matching workspace instruction is also needed because the requirement applies to ordinary code changes, not only to explicit skill use.
- The frontend test stack is `Vitest + jsdom + React Testing Library + user-event + V8 coverage`.
- Coverage is enforced per file for the gated critical-module set.
- The current enforced thresholds are:
  - statements: `>= 100%`
  - lines: `>= 100%`
  - functions: `>= 100%`
  - branches: `>= 95%`
- Workflow gates must run `bun run test:ci` on Ubuntu, Windows, and macOS before frontend CI, deploy, and integration-package steps continue.
- Side-effect-heavy `alveo` modules should be split into testable `*-core.ts` helpers before the logic is considered adequately protected.
- Generated asset determinism must be enforced inside `alveo` tooling, not through project-specific `.gitattributes` or Git EOL settings. Text inputs and generated text outputs should be LF-normalized for hashing, sourcemaps, prerendered HTML, and copied integration assets; binary assets must keep their original bytes.
- Thresholds, gated scope, or workflow gates must not be weakened without explicit approval.

## What Has Been Done

### Harness And Policy

- Added a standalone frontend Vitest harness in `package.json`, `vitest.config.ts`, and `test/setup.ts`.
- Added the repo coverage document in `docs/test-coverage.md`.
- Added workspace Copilot customization files for coverage governance.

### Core Coverage

- Covered `src/alias.ts`
- Covered `src/asset-hash.ts`
- Covered `src/cryptography.ts`
- Covered `src/dev-supervisor.ts`
- Covered `src/filename.ts`
- Covered `src/hooks/inject-functions.ts`
- Covered `src/hooks/inject-functions-core.ts`
- Covered `src/integration-core.ts`
- Covered `src/manual-chunk.ts`
- Covered `src/precompile-styles.ts`
- Covered `src/prerender-core.ts`
- Covered `src/scripts-core.ts`
- Covered `src/states-core.ts`
- Covered `src/styles-core.ts`
- Covered `src/text-normalization.ts`
- Covered `src/virtual-modules.ts`

### Stylesheet Build Reliability

- `src/styles.ts` runs Sass and lightningcss for many entry stylesheets; it must avoid unbounded Sass fan-out.
- The current implementation queues Sass/lightningcss jobs through `createStyleCompileQueue` in `src/styles-core.ts`.
- `STYLES_CONCURRENCY` controls the queue width and defaults to `5` when unset, blank, non-integer, or less than `1`.
- One-shot `bun run styles` builds wait for debounced compile entry points, then drain the queue so Sass/lightningcss failures can set a non-zero exit code before Bun exits.
- Keep queue parsing, bounded execution, drain behavior, and failed-task continuation covered in `src/styles-core.test.ts`.

### Workflow Gates

- Updated `.github/workflows/frontend-ci.yml`
- Updated `.github/workflows/frontend-deploy.yml`
- Updated `.github/workflows/frontend-integration.yml`
- All three now run `bun run test:ci` on `ubuntu-latest`, `windows-latest`, and `macos-latest` before continuing to build, deploy, or integration packaging.

## Current Validated State

Latest implemented validation target:

- `bun run test:ci`
- `bun inte` for the stylesheet compile-queue build-tooling change

Latest validated outcome at implementation time:

- `16` test files passed
- `314` tests passed
- enforced coverage scope passed with:
  - `100%` statements
  - `100%` lines
  - `99.67%` branches
  - `100%` functions

## Current Enforced Module Set

- `src/alias.ts`
- `src/asset-hash.ts`
- `src/cryptography.ts`
- `src/dev-supervisor.ts`
- `src/filename.ts`
- `src/hooks/inject-functions.ts`
- `src/hooks/inject-functions-core.ts`
- `src/integration-core.ts`
- `src/manual-chunk.ts`
- `src/precompile-styles.ts`
- `src/prerender-core.ts`
- `src/scripts-core.ts`
- `src/states-core.ts`
- `src/styles-core.ts`
- `src/text-normalization.ts`
- `src/virtual-modules.ts`

## Working Rule For Future Changes

For any frontend change covered by the workspace instruction:

- preserve or improve coverage for the affected modules
- add tests for every logic, branch, path, error-handling, or workflow behavior change
- keep generated integration assets byte-stable across Windows, WSL, and Ubuntu by normalizing text to LF in code rather than depending on `.gitattributes`
- run narrow impacted suites first, then run `bun run test:ci`
- for `src/styles.ts` or `src/styles-core.ts`, preserve the bounded compile queue contract and run `bun run styles` or `bun inte` after focused tests
- for `bun inte` determinism changes, confirm `git diff --quiet -- {VITE_INTE_PATTERN_DIR} {VITE_INTE_ASSET_DIR}`; Windows `git status` may still show LF/text-auto warnings when content diff is empty
- update `docs/test-coverage.md` when the enforced scope, thresholds, or workflow policy changes
- widen the gated module set when new critical code becomes testable

## Repeatable Testing Techniques Proven In This Rollout

These patterns were used to keep coverage at 100% statements / 100% lines / 100% functions / 98.4% branches and should be reused for similar gaps:

- **SSR guard branches** (`typeof window === 'undefined'`, `typeof document === 'undefined'`, `typeof location === 'undefined'`): create a dedicated `*.node-env.test.ts` sibling with `// @vitest-environment node` at the top, clear cached `globalThis` keys with `delete (globalThis as Record<string, unknown>).window` (and `appApi`, `viteAbsoluteUrl`, etc.) inside `beforeEach`/`afterEach`, then `vi.resetModules()` and dynamic `await import('./module')` so each guard branch runs against a clean global. Do not try to mock `typeof window` in jsdom.
- **chokidar/event-emitter watcher callbacks** registered through `watcher.on('add' | 'change' | 'unlink', cb)`: keep the watcher mock chainable (`vi.fn(function (this: FSWatcher) { return this; })`), then capture the registered callbacks from `vi.mocked(watcher.on).mock.calls[i]?.[1]` and invoke them directly inside the test so the inline arrow bodies execute and count toward function coverage.
- **`fs`/`path` orchestration helpers** in `src/*-core.ts`: model every external dependency as a typed `Dependencies` interface and pass it as the last argument with a `defaultDependencies` fallback. Tests then build a single `createDependencies()` factory of `vi.fn()` mocks per file and override per case with `mockReturnValueOnce` / `mockImplementation`.
- **Conditional-branch defensive returns** (`if (!resourcePath) return;`, `if (!href) return;`, `if (!target) return;`): trigger them by either widening the cheerio selector (e.g. `script[data-pl-require]` instead of `script[data-pl-require][src]`) or by feeding the helper an input the upstream classifier rejects (e.g. `'dist/static/readme.txt'` for `getPatternCopyTarget`).
- **Cheerio attribute normalization edge cases** (`defer`, `defer="defer"`, `defer="true"`, bare `defer`): cover each comparator in the `||` chain with a separate test case so the per-file branch threshold stays meaningful even though V8 may still report one micro-branch as partial.
- **Source-map prelude stripping**: build minimal fixtures with `SourceMapGenerator` (`setSourceContent`, `addMapping`) and read results back through `SourceMapConsumer` rather than asserting on raw VLQ output.
- **Stylesheet compile queue**: cover default `STYLES_CONCURRENCY` parsing, bounded queue execution, drain completion, invalid concurrency normalization, and rejected task continuation in `src/styles-core.test.ts`; keep `src/styles.ts` as the side-effect shell that wires the queue into Sass/lightningcss.
- **Generated asset line endings**: normalize text to LF before embedding source-map `sourcesContent`, hashing SVG/CSS/JS/text assets, writing prerendered HTML, or copying integration assets. Test CRLF inputs, source-map JSON with escaped `\r\n`, extensionless text files, and binary buffers so output is deterministic without relying on Git checkout settings.
- **Truly unreachable code** (e.g. an `else { return <></> }` after exhaustive `string | string[] | undefined` narrowing): remove the dead branch instead of forcing a test through `as never` casts. Document the narrowing in a short comment so the next reader does not re-add the guard.

## Remaining External Step

Repository files cannot enforce GitHub branch protection by themselves.

The remaining manual or authenticated API step is to require the frontend checks on `master` in GitHub branch protection.

At minimum, require the `Frontend CI` workflow's cross-platform test jobs for `ubuntu-latest`, `windows-latest`, and `macos-latest`, plus the Ubuntu `build` job that depends on them.

At the time this coverage rollout was implemented, the local environment was not authenticated with `gh`, so that GitHub-side setting could not be applied from the session.
