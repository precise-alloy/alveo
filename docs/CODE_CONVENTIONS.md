# Code Conventions

> Project-specific coding conventions. Filled by repo-scan, refined by the team.
> The `code-conventions` skill references this file for project-specific rules.

## Type system

- Strict TypeScript everywhere (`strict: true`) plus `noUncheckedIndexedAccess`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, and `isolatedModules`.
- ESM-only (`"type": "module"`, `module: ESNext`). Relative imports carry explicit `.ts`/`.tsx`
  extensions (`rewriteRelativeImportExtensions`).
- Prefer named exports and `export type` for type-only exports; avoid default exports in library code.
- Favor factory functions and closures over classes (`no-new` is an error); model dependencies as
  explicit `*Dependencies` objects for testability.

## Naming

| Artifact | Convention |
|---|---|
| Files | kebab-case (`asset-hash.ts`, `inject-functions-core.ts`); entry scripts end `.entry.ts` |
| Classes / types | PascalCase (`AssetHashDependencies`); React components PascalCase |
| Functions / methods | camelCase; factory helpers prefixed `create*` |
| Variables | camelCase; unused args prefixed `_` |
| Constants | UPPER_SNAKE_CASE (`ASSET_HASH_REGEX`) |
| DB columns | n/a (no database) |
| URL paths | n/a (CLI / build tooling) |

## Module structure

- One domain per file; pure logic lives in `*-core.ts`, with a thin `*.ts` wrapper that wires real
  dependencies (fs, loggers) via a `create*Dependencies` factory.
- Dependency injection keeps core modules side-effect-free and unit-testable without touching disk.
- ESM relative imports include the file extension; `getPackageRoot` resolves bundled assets.
- Import order is enforced by eslint `import/order` (type, builtin, object, external, internal, parent,
  sibling, index) with a blank line between groups.

## Error handling

| Context | Rule |
|---|---|
| API handlers | n/a - no public API. The local dev/preview server (`create-server.ts`) is unauthenticated. |
| Background jobs | Pipeline steps return result objects (e.g. `{ missing: [] }`); the CLI sets `process.exitCode = 1` on failure instead of hard-exiting. |
| General | Don't throw across module boundaries; surface failures via injected loggers and result values. Wrap SSR render in try/catch and degrade gracefully. |

## Logging

- Unstructured `console.log` / `console.error`, with `[alveo]`-prefixed messages in the CLI.
- `chalk` for colorized dev-server output; per-command prefix colors via `concurrently`.
- Loggers are injected as dependencies (`log`, `logMissing`) so pure modules stay testable; no
  structured logger or correlation IDs.

## Stack-specific rules

- Vite plugin surface lives in `src/hooks/` (build-start, transform, transform-index-html,
  write-bundle, close-bundle, handle-hot-update, resolve-dynamic-import).
- React SSR via `entry-server.tsx` / `entry-client.tsx` with the automatic `react-jsx` runtime.
- ESLint (flat config) enforces Prettier (single quotes, `avoidEscape`), `complexity` <= 15,
  `max-depth` <= 4, `react/jsx-sort-props`, `padding-line-between-statements` (blank line before
  `return` and after declarations), and `unused-imports/no-unused-imports`.
- Deterministic output and LF normalization (`src/text-normalization.ts`) are mandatory before
  hashing, embedding sourcemap content, or writing generated text; binary bytes are preserved.
- Frontend/layout changes must support LTR and RTL (logical properties, `$rtl-sign`, `rtl()`).
