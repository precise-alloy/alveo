## TASK

Address PR review feedback (round 1): 15 actionable comments from https://github.com/precise-alloy/alveo/pull/1

These are unresolved bot review threads (Copilot / CodeRabbit) that the author deferred with "Inherited from
xpack/, skip for now". The current `chore/tech-debt` branch pays down that deferred debt. Each item below was
re-verified against the current code before being kept.

## CONTEXT

files:
  - src/scripts-core.ts          # mkdirSync recursive (COVERED module - keep tests green)
  - src/integration-core.ts      # mkdirSync recursive (COVERED module - keep tests green)
  - src/styles/_theme.scss        # light mixin targets wrong selector
  - src/routes.ts                 # duplicate "/" route
  - src/renderer.ts               # VITE_DOMAIN read from process.env (loadEnv never populates it)
  - src/create-server.ts          # plumb VITE_DOMAIN into _useRenderer from bootstrap
  - src/root/root-nav.tsx         # button-in-anchor a11y + useOnClickOutside stable deps
  - vitest.config.ts              # coverage.include missing tested modules
  - src/manual-chunk.ts           # slash-normalize id before includes() (COVERED module)
  - src/create-vite-dev-server.ts # usePolling forced always; gate behind isTest
  - src/hooks/transform.ts        # generateMap() runs even when map is discarded
  - src/scripts/pl-states.entry.ts # click listener accumulates across rebuilds (dev-only tool)
  - src/server.ts                 # import-time side effects + parseInt without radix
  - src/root/index.tsx            # dead ternary (both branches undefined)
  - src/react-loader.tsx          # discarded return in side-effect-only function

Coverage note: `src/scripts-core.ts`, `src/integration-core.ts`, and `src/manual-chunk.ts` are in
`coverage.include`; `src/alias.ts`, `src/cryptography.ts`, `src/text-normalization.ts`, and
`src/virtual-modules.ts` are added to it in step 7. Every logic change in an included module must keep its tests
green and its coverage at policy (100% statements/lines/functions, >= 95% branches). `src/styles/**`,
`src/root/**`, and `src/scripts/*.entry.ts` are excluded from coverage, so items 3, 6, 9, 12, 14 need no coverage
tests but must still typecheck/lint/compile.

## STEPS

1. **[src/scripts-core.ts:65]** Add `{ recursive: true }` to `mkdirSync(saveDir)` so a missing `public/assets`
   parent no longer throws. Update/extend the scripts-core test to cover the recursive-create path.
   _"@Copilot: mkdirSync will throw if the parent directory doesn't exist; use { recursive: true }"_

2. **[src/integration-core.ts:78]** Add `{ recursive: true }` to the `mkdirSync` call on the asset-copy path, same
   reasoning. Keep the integration-core tests green and cover the new branch.
   _"@Copilot: mkdirSync without recursive throws when the destination parent is missing"_

3. **[src/styles/_theme.scss:20]** The `light` mixin currently scopes its declarations under `[data-theme='dark']`,
   identical to the `dark` mixin, so light overrides can never match. Retarget the `light` mixin to the light
   selector (`[data-theme='light']` / `:root`, matching the file's existing theming convention). Verify the two
   mixins no longer emit the same selector.
   _"@CodeRabbit: the light theme mixin selects [data-theme='dark'], so it duplicates dark and never applies"_

4. **[src/routes.ts:25]** A consumer page (`src/pages/Root.tsx`) maps to `/` and the framework also pushes a `/`
   route, producing duplicate `/` entries. De-duplicate so a single `/` route is emitted (skip the framework-pushed
   `/` when a consumer route already owns it, or dedupe by path). Preserve ordering of the remaining routes.
   _"@CodeRabbit: root path can be registered twice, creating duplicate '/' routes"_

5. **[src/renderer.ts:54] + [src/create-server.ts]** `updateResourcePath` reads `process.env.VITE_DOMAIN`, but the
   codebase reads env via `loadEnv(mode, root)` which returns values without populating `process.env`, so
   `.env`-only `VITE_DOMAIN` never applies. Plumb it through instead of relying on `process.env`:
   - `renderer.ts`: add `domain?: string` to `Props`, thread it into `updateResourcePath` (add a `domain`
     parameter) and use that parameter in place of `process.env.VITE_DOMAIN`.
   - `create-server.ts`: inside `createServer`, load `const alveoEnv = loadEnv(mode, root);` (module-scope `mode`
     already exists) and pass `domain: alveoEnv.VITE_DOMAIN` into the `_useRenderer({ ... })` call.
   _"@CodeRabbit: loadEnv() does not populate process.env, so VITE_DOMAIN from .env is never applied here"_

6. **[src/root/root-nav.tsx:81]** A `<button>` is nested inside an `<a>` (invalid HTML) with the a11y lint rule
   disabled. Restructure to valid, accessible markup (a single interactive element - e.g. a `<button>` styled as the
   toggle, or move the button out of the anchor) and remove the a11y `eslint-disable` comment. Preserve keyboard
   focus, ARIA state, and the existing toggle behavior.
   _"@Copilot: interactive <button> nested inside <a> is invalid and inaccessible; a11y rule was disabled"_

7. **[vitest.config.ts:23]** Add the tested-but-unlisted modules to `coverage.include`:
   `src/alias.ts`, `src/cryptography.ts`, `src/text-normalization.ts`, `src/virtual-modules.ts` (each already has a
   `*.test.ts`). Run coverage; if any of the four falls below policy (100% statements/lines/functions, >= 95%
   branches), extend its existing test to close the gap in this change - do not add a file to the list while leaving
   it under-covered.
   _"@Copilot: these modules have tests but are absent from coverage.include, so enforcement ignores them"_

8. **[src/manual-chunk.ts:49]** Normalize the module id with `slash(id)` before `.includes('node_modules/')`, so a
   backslash path on Windows still matches - consistent with the rest of the file's `slash()` usage. Cover the
   normalized-path branch in the manual-chunk test.
   _"@Copilot: id.includes('node_modules/') can miss on Windows backslash paths; normalize with slash()"_

9. **[src/root/root-nav.tsx:28]** `useOnClickOutside(..., [buttonRef])` passes a freshly-allocated array each render,
   and the hook's effect deps include it, re-registering the document listener every render. Give the ref array a
   stable identity (memoize with `useMemo`, hoist a stable array, or pass the ref directly per the hook's API) so the
   effect only re-runs when it actually should.
   _"@Copilot: new array literal each render forces the click-outside effect to re-subscribe every render"_

10. **[src/create-vite-dev-server.ts:22]** `usePolling` is forced on unconditionally, but the adjacent comment says it
    is only needed under test. Gate it behind the existing `isTest` flag (`usePolling: isTest`) so normal dev watch
    does not pay the polling cost.
    _"@Copilot: usePolling is always true though the comment says it is only for tests"_

11. **[src/hooks/transform.ts:35]** `generateMap()` runs on every module even when the transform is a no-op and the
    map is discarded (`newCode === code`). Only compute/return the map when `newCode !== code`; otherwise return early
    without generating it.
    _"@Copilot: generateMap() is computed even when the result is thrown away for unchanged modules"_

12. **[src/scripts/pl-states.entry.ts:180]** A new `document` click listener is added per state group on every rebuild
    and never removed, so listeners accumulate. Stop the accumulation: remove the previously-registered listener
    before re-adding, or register a single delegated handler once. Dev-only tool; keep its behavior identical.
    _"@Copilot: click listeners are added on every rebuild and never cleaned up, so they pile up"_

13. **[src/server.ts:5,7-11,22]** Avoid import-time side effects in this library entry: move
    `console.log('[INIT] server')` and the `--mode` / `mode` parsing into `initServer()` (compute `mode` where it is
    used), and add an explicit radix to `parseInt(alveoEnv.VITE_PORT!, 10)`.
    _"@CodeRabbit: import-time console.log + argv parsing are side effects for a library entry; parseInt needs a radix"_

14. **[src/root/index.tsx:13]** Remove the dead `typeof window !== 'undefined' ? undefined : undefined` ternary - both
    branches evaluate to `undefined`. Replace with the plain `useState(undefined)` (or `useState()`), preserving the
    state type.
    _"@Copilot: both ternary branches are undefined, so the condition is dead code"_

15. **[src/react-loader.tsx:44]** The function is called only for its side effects, but an `else { return <></>; }`
    returns a value that is always discarded. Remove the dead `else`/return branch.
    _"@Copilot: this return value is never consumed; the else branch is dead"_

## DONE WHEN

- [ ] src/scripts-core.ts:65 - `mkdirSync(saveDir, { recursive: true })`; test covers recursive create
- [ ] src/integration-core.ts:78 - `mkdirSync(..., { recursive: true })`; test covers the branch
- [ ] src/styles/_theme.scss:20 - `light` mixin targets the light selector, no longer duplicating `dark`
- [ ] src/routes.ts:25 - only one `/` route is emitted; other routes/order unchanged
- [ ] src/renderer.ts + src/create-server.ts - `VITE_DOMAIN` is plumbed from `loadEnv` into `_useRenderer`; no `process.env.VITE_DOMAIN` read in the renderer
- [ ] src/root/root-nav.tsx:81 - no `<button>` inside `<a>`; a11y `eslint-disable` removed; toggle + keyboard/ARIA behavior preserved
- [ ] vitest.config.ts:23 - `alias.ts`, `cryptography.ts`, `text-normalization.ts`, `virtual-modules.ts` added to `coverage.include`; each meets policy coverage (tests extended if needed)
- [ ] src/manual-chunk.ts:49 - `slash(id)` normalized before `includes('node_modules/')`; branch covered
- [ ] src/root/root-nav.tsx:28 - click-outside ref deps are stable; no per-render re-subscription
- [ ] src/create-vite-dev-server.ts:22 - `usePolling` gated behind `isTest`
- [ ] src/hooks/transform.ts:35 - `generateMap()` only runs when `newCode !== code`
- [ ] src/scripts/pl-states.entry.ts:180 - click listeners no longer accumulate across rebuilds
- [ ] src/server.ts - `console.log`/mode parsing moved into `initServer()`; `parseInt(..., 10)`
- [ ] src/root/index.tsx:13 - dead ternary removed
- [ ] src/react-loader.tsx:44 - discarded `else`/return removed
- [ ] `bun run typecheck` passes
- [ ] `bun run test:coverage` passes; coverage for included modules (incl. the 4 newly added) stays at policy
- [ ] `bun run build:styles` compiles (validates the `_theme.scss` change)
- [ ] `bun run lint` passes
- [ ] No files outside the referenced paths (and their tests) modified

## VERIFY

Verified fresh by a verify-task subagent. Validation commands: `bun run typecheck`, `bun run test:coverage`,
`bun run build:styles`, `bun run lint`.
