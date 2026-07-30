# Test Conventions

> Project-specific test conventions. Filled by repo-scan, refined by the team.
> The `testing-policy` skill references this file for project-specific patterns.

## Framework and assertion style

Vitest with `expect()` assertions and `describe` / `it` blocks (globals enabled). Default environment is
jsdom; Node-only suites opt out with a `// @vitest-environment node` file header. Coverage uses the v8
provider with an explicit `coverage.include` allowlist in vitest.config.ts.

## Test naming

Co-located `<module>.test.ts(x)` next to the source file. Describe blocks mirror the module path
(`describe('alveo/asset-hash.ts', ...)`), nested by exported symbol, with `it('<behavior phrase>')`
spelling out the expected behavior.

## Mocking strategy

Dependency injection first: core modules expose a `create*Dependencies` factory and tests pass fakes
through a local `buildDeps({ ...overrides })` helper using `vi.fn()`, rather than globally mocking fs.
`vi.mock()` is used where a whole module boundary must be replaced. MSW (`msw`) handles HTTP mocking.

## Fixtures and test data

Builder helpers (e.g. `buildDeps`) are defined inline per test file. Real filesystem work uses temp
directories (`os.tmpdir()` / `test/temp/`). Shared global setup lives in `test/setup.ts`
(`@testing-library/jest-dom` matchers).

## Async patterns

`async` / `await` inside `it` callbacks; no `done()` callbacks. Assertions on rejected promises use
`await expect(...).rejects` / `toThrow`.

## Framework-specific testing skills

If a framework-specific testing skill is installed for your stack (e.g., Flutter integration testing, React test
patterns), load it alongside the `testing-policy` skill for concrete patterns, APIs, and code examples.
