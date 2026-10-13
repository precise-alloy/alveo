# Frontend Test Coverage

## Purpose

This repository now has a real automated test gate for the most failure-prone frontend build and integration logic that was previously unprotected. The current rollout focuses on modules where silent regressions are expensive:

- path, alias, filename, and hash behavior
- build-time script, stylesheet, prerender, and integration transforms
- generated asset normalization and virtual module contracts
- hook helpers that rewrite generated HTML and dynamic imports

The immediate goal is not a vanity repo-wide percentage. The immediate goal is a hard gate around the logic that breaks builds, runtime asset loading, or form submission when changed carelessly.

## Commands

Use these commands locally:

```bash
bun run typecheck
bun run test
bun run test:watch
bun run test:coverage
bun run test:ci
```

`typecheck` runs `bun check --noEmit` and catches interface drift like stale Rolldown or Vite fixture objects before runtime tests even start.

`test:ci` is the command used by GitHub Actions. It now runs type checking before the coverage run, runs on Ubuntu, Windows, and macOS in the parent frontend workflows, and must pass on every OS before the updated CI, deploy, and integration workflows can complete.

After `bun install`, the repo also installs a local `pre-push` hook through `simple-git-hooks` that runs `bun run typecheck` before Git pushes proceed.

## Enforced Coverage Scope

The current hard-threshold gate applies to the following modules:

| Area                  | File                                 | Why it is gated now                                                                                   |
| --------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Alias helper          | `src/alias.ts`                       | Protects alias normalization and Vite alias generation                                                |
| Asset hashing         | `src/asset-hash.ts`                  | Protects asset hash lookup and missing-file behavior                                                  |
| Cryptography          | `src/cryptography.ts`                | Protects stable hashing helpers                                                                       |
| Dev supervisor        | `src/dev-supervisor.ts`              | Protects argv-array dev process launch, validation, prefixed output, and kill-on-failure behavior     |
| Output naming         | `src/filename.ts`                    | Protects asset, entry, and chunk naming conventions                                                   |
| HTML hook             | `src/hooks/inject-functions.ts`      | Protects generated script injection wiring                                                            |
| HTML hook core        | `src/hooks/inject-functions-core.ts` | Protects generated function injection transforms                                                      |
| Integration core      | `src/integration-core.ts`            | Protects asset copying, hash manifest generation, pattern normalization, and required-file validation |
| Chunk naming          | `src/manual-chunk.ts`                | Protects internal entry chunk naming                                                                  |
| Stylesheet precompile | `src/precompile-styles.ts`           | Protects package stylesheet precompilation                                                            |
| Prerender core        | `src/prerender-core.ts`              | Protects prerender URL building, duplicate asset relocation, and cache-busting rules                  |
| Script build core     | `src/scripts-core.ts`                | Protects esbuild options, output writes, watch wiring, and one-shot failure signaling                 |
| State build core      | `src/states-core.ts`                 | Protects deterministic state aggregation, output writes, and one-shot parse failure signaling         |
| Styles core           | `src/styles-core.ts`                 | Protects injected SCSS prelude handling, sourcemap line shifting, and output naming                   |
| Text normalizer       | `src/text-normalization.ts`          | Protects platform-independent LF normalization for text assets, sourcemaps, and generated outputs     |
| Virtual modules       | `src/virtual-modules.ts`             | Protects virtual module IDs and resolution                                                            |

These files are intentionally enforced with hard thresholds now because they are already covered by explicit tests. The next rollout phases will expand this gate to additional alveo build modules after their side effects are split into testable cores.

## Coverage Thresholds

The enforced thresholds for the gated module set are:

- statements: `>= 100%`
- lines: `>= 100%`
- functions: `>= 100%`
- branches: `>= 95%`
- enforcement mode: per file

This means a single weakly tested critical module fails the build even if the aggregate percentage looks acceptable.

The branches threshold sits at 95% because a single defensive `||` operand in `removeDuplicateAssets` (`attr('defer') === ''`) reports as a partial branch under V8 depending on cheerio's attribute normalization, even though the matching unit test exercises the bare-defer path explicitly. All other gated modules are at 100% across every metric.

## Implemented Test Contracts

### Package Distribution

`src/package.test.ts` builds a clean temporary checkout and packs the result,
then installs the tarball with `bun install --prefer-offline --production
--ignore-scripts --linker isolated` using a separate empty cache. Registry access
is required: the workflow's frozen-lockfile install can cache package archives
without the registry manifests needed to resolve this new consumer's ranges.
Both consumer installs fetch missing metadata rather than assuming an offline
cache is complete. The consumer does not link to the maintainer's `node_modules`,
so missing runtime dependencies cannot be hidden by development tools.

The test checks exported files, runtime imports, installed esbuild and MSW,
shared React/router peers, and actual CLI script compilation. It first proves
that TypeScript and test/lint tools are absent, then adds TypeScript and typings
to verify the consumer's `ClientComponents` import. Manifest checks also preserve
the static starter's dependency ownership and load its lint config without
Next.js packages.

`src/scripts-core.test.ts` exercises the installed compiler as well as injected
mocks, covering minified TypeScript, JSX/TSX, ESM exports, and critical-script
sourcemap suppression. These checks run inside the existing `test:ci` and
prepublish gates without weakening coverage thresholds.

### Build Helpers

Current tests protect these rules:

- `alias.ts` must normalize path aliases into Vite-compatible entries.
- `asset-hash.ts` must resolve asset hash records, preserve `/assets/...` URLs, and log missing files consistently.
- `cryptography.ts` must produce stable content hashes.
- `dev-supervisor.ts` must validate dev CLI mode/port values, build argv-array process specs, and terminate sibling watchers when one fails.
- `filename.ts` must preserve the current hashed and unhashed filename conventions.
- `manual-chunk.ts` must keep the current internal entry chunk naming convention.
- `precompile-styles.ts` must normalize generated CSS and source-map content to LF and preserve source-map fallback behavior.
- `virtual-modules.ts` must keep virtual module IDs and resolution behavior stable.
- `scripts-core.ts` must disable sourcemaps for `critical` script filenames and use external sourcemaps otherwise
- `scripts-core.ts` must write output into `public/assets/js/<name>.js`
- `scripts-core.ts` must create the output directory when missing
- `scripts-core.ts` must compile every discovered script in batch mode
- `scripts-core.ts` must wire `add`, `change`, and `unlink` handlers in watch mode
- `scripts-core.ts` must log transform errors instead of throwing and stopping the process abruptly
- `states-core.ts` must sort state files deterministically, fail one-shot builds on parse errors, and keep debounced watch output behavior
- `prerender-core.ts` must preserve the current hashed-filename detection rule, `VITE_DOMAIN` prefixing, cache-busting eligibility, and duplicate asset relocation behavior
- `prerender-core.ts` must keep `style-base` removal on the root route logic intact
- `integration-core.ts` must preserve destination validation, asset copy behavior, hash manifest generation, pattern output normalization, and required-file validation without relying on `process.exit`
- `styles-core.ts` must preserve shared `@use` prelude injection, sourcemap prelude stripping, and CSS output naming
- `text-normalization.ts` must normalize text to LF, normalize source-map `sourcesContent`, detect text-like extensionless content, and leave binary bytes unchanged
- `hooks/inject-functions.ts` and `hooks/inject-functions-core.ts` must preserve generated function injection behavior.

Generated integration output must not depend on `.gitattributes`, `core.autocrlf`, or the local OS checkout style. When this area changes, run `bun inte` and confirm there is no content diff under `../PreciseAlloy.Patterns` and `../PreciseAlloy.Web/wwwroot/assets` with `git diff --quiet -- ../PreciseAlloy.Patterns ../PreciseAlloy.Web/wwwroot/assets`. On Windows, `git status` can still list LF-normalized generated text files when the paths are `text=auto`; the content diff check is the source of truth.

If build output naming changes, these tests fail before the change reaches deploy or the backend integration package.

## GitHub Workflow Gate

The parent workflows now run `bun run test:ci` on `ubuntu-latest`, `windows-latest`, and `macos-latest` before continuing:

- `.github/workflows/frontend-ci.yml`
- `.github/workflows/frontend-deploy.yml`
- `.github/workflows/frontend-integration.yml`

This gives four separate protections:

- PR validation fails before merge when the CI workflow runs.
- OS-specific path behavior is checked on Linux, Windows, and macOS before later workflow steps run.
- Static-site deployment cannot continue if tests or coverage fail.
- Integration-package generation cannot continue if tests or coverage fail.

The CI workflow also uploads the `coverage/` folder as a GitHub Actions artifact per OS.

## Required GitHub Setting

Workflow files alone cannot force GitHub branch protection. In repository settings, require the checks from the `Frontend CI` workflow before merging into `master`.

In the GitHub Checks UI these include the cross-platform `Test (ubuntu-latest)`, `Test (windows-latest)`, and `Test (macos-latest)` jobs, plus the Ubuntu `build` job.

Without that repository setting, the PR workflow still fails correctly, but GitHub will not treat it as a mandatory merge gate.

## Copilot Coverage Policy

The repository now also includes workspace Copilot customization for this coverage policy:

- `.github/skills/test-coverage/SKILL.md`
- `.github/instructions/test-coverage.instructions.md`

The skill captures the repo-specific requirements, decisions, completed rollout, and current enforced coverage scope.

The instruction file makes the policy effectively always-on for frontend code, `alveo` tooling, Vitest coverage config, and the parent frontend workflow files, so ordinary code changes are expected to preserve or improve the highest feasible coverage and keep `bun run test:ci` passing.

## Local Review Checklist

Before pushing a change that touches any gated module:

1. Run `bun run test:ci`.
2. Keep the local `pre-push` hook active so `bun run typecheck` blocks stale type drift before the push leaves the machine.
3. If the change touches build tooling, also run the narrow alveo suite first for faster failure feedback.
4. If the change touches the contact form or runtime browser helpers, rerun the specific affected suite before the full coverage run.
5. If the change alters asset naming, paths, or resource URL behavior, verify the failing test names still describe the new contract clearly.

## Next Expansion Phases

The next recommended phases for this rollout are:

1. Finish the remaining `alveo/styles.ts` orchestration surface around Sass importer behavior, PostCSS emission, and watch-mode routing.
2. Extract and test the remaining `alveo/prerender.ts` render-loop and file-write orchestration surface.
3. Extract and test the remaining `alveo/renderer.ts` request-time HTML transform surface.
4. Expand the component-behavior suites across the remaining high-value organisms that own conditional rendering or API-backed behavior.
5. After those phases land, raise thresholds further and widen the enforced module set.

## Why the Gate Is Scoped This Way

A repo-wide global threshold would currently punish untouched template and content files that do not yet have isolated tests, while still failing to tell developers which mission-critical contract actually broke.

The current strategy is stricter where it matters:

- high per-file thresholds
- explicit critical-module list
- tests named after the protected rule
- workflow enforcement at PR, deploy, and integration-package stages

That makes failures actionable now, while leaving a clear path to widen the gate as the remaining alveo modules are refactored into testable units.
