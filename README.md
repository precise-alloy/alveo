# alveo

Opinionated React SSR framework built on Vite. Compiles components, renders pages server-side, and integrates with backend CMS projects.

## Quick Start

```bash
npx alveo create my-app
cd my-app
bun install
bun run dev
```

Node.js 24+ and Bun are required for development. `npx alveo create` can scaffold without Bun, but `--install` and the starter's scripts require it. The generated package name comes from the target directory's basename; its Alveo dependency tracks the version of the CLI that created it. Local environment files, installed dependencies, and generated output are excluded from both published templates and source-checkout scaffolding.

## CLI Commands

| Command                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `alveo dev`             | Start dev server with HMR, style watcher, and SSR       |
| `alveo build`           | Production build (static + SSR bundles)                 |
| `alveo generate`        | Full pipeline: states, styles, build, prerender         |
| `alveo inte`            | Integration build for backend consumption               |
| `alveo styles`          | Compile SCSS stylesheets                                |
| `alveo styles --watch`  | Watch and recompile SCSS on changes                     |
| `alveo scripts`         | Bundle asset script entries and write linked sourcemaps |
| `alveo scripts --watch` | Rebuild entries when their source/dependencies change   |
| `alveo states`          | Aggregate component state JSON files                    |
| `alveo server`          | Development-only Express SSR server                     |
| `alveo create <name>`   | Scaffold a new project from the starter template        |

Build, development, server, style, script, and state commands accept `--root <path>` (defaults to `cwd`). `create` takes a target directory instead.

`server` defaults to development mode and rejects `--mode production` or `NODE_ENV=production`. It is not a production hosting API: use `generate` and deploy the static output, or integrate the output with your own backend.

## Project Structure

A consumer project looks like this:

```
my-app/
  src/
    assets/styles/       SCSS stylesheets (abstracts, functions, mixins, base)
    atoms/               Atomic design: smallest UI elements
    molecules/           Composed atoms
    organisms/           Composed molecules (each gets its own CSS)
    templates/           Page layout templates
    pages/               Page components (auto-discovered for routing)
    _helpers/            Optional app helpers / re-exports from alveo/helpers
    _data/               Static data
    _api/                API client modules
    mocks/               Optional MSW mock handlers
    client-components.tsx  Registry of client-rendered React components
  public/
    assets/images/       SVG sprites, icons
    assets/fonts/        Web fonts
    assets/vendors/      Third-party libraries
  index.html             HTML template
  vite.config.ts         Vite config (calls defineAlveoConfig)
  tsconfig.json          TypeScript config
  .env                   Environment variables
```

## Configuration

### vite.config.ts

```ts
import { defineAlveoConfig } from 'alveo';

export default defineAlveoConfig({
  root: import.meta.dirname,
});
```

### .env

```env
VITE_BASE_URL=/
VITE_PORT=15889
VITE_PATH_EXTENSION='.html'
VITE_TITLE_SUFFIX='My App'

# Integration paths (for alveo inte)
VITE_INTE_ASSET_DIR=../MyProject.Web/wwwroot/assets
VITE_INTE_PATTERN_DIR=../MyProject.Patterns
```

Integration destinations must be outside the project and must not overlap each other or the project, including through symlinks. They must be exclusively owned generated-output directories: integration replaces their generated contents. Everything emitted under `dist/static/assets/` is copied, including assets Vite places at its root (for example a non-inlined `.mp4`) and extra `public/assets/` files or folders; binary bytes are copied unchanged. Both `generate` and `inte` run state aggregation and stylesheet compilation first and stop on a failed stage or SSR render.

Base URL precedence: an explicit inline/CLI base (`vite --base`, `createServer({ base })`) wins over `defineAlveoConfig({ base })`, which wins over `VITE_BASE_URL` for the active mode; `/` is the final fallback.

Mocking remains automatic in **all non-production modes**, including custom modes, when `src/mocks/handlers` exists. Without handlers the mock entry and its starter HTML tag are omitted. Production never includes the mock entry.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["alveo/types"],
    "paths": {
      "@atoms/*": ["./src/atoms/*"],
      "@molecules/*": ["./src/molecules/*"],
      "@organisms/*": ["./src/organisms/*"],
      "@templates/*": ["./src/templates/*"],
      "@pages/*": ["./src/pages/*"],
      "@helpers/*": ["./src/_helpers/*"],
      "@data/*": ["./src/_data/*"],
      "@mocks/*": ["./src/mocks/*"]
    }
  }
}
```

## Path Aliases

| Alias          | Resolves to       |
| -------------- | ----------------- |
| `@atoms/*`     | `src/atoms/*`     |
| `@molecules/*` | `src/molecules/*` |
| `@organisms/*` | `src/organisms/*` |
| `@templates/*` | `src/templates/*` |
| `@pages/*`     | `src/pages/*`     |
| `@helpers/*`   | `src/_helpers/*`  |
| `@data/*`      | `src/_data/*`     |
| `@mocks/*`     | `src/mocks/*`     |

Package internals are not exposed through an `@alveo/*` alias. Use the documented `alveo`, `alveo/helpers`, and type-only `alveo/types` entry points.

`alveo/types` supplies virtual-module and global-helper declarations. The public package also exports `ClientComponents`, `RootModel`, `RootItemModel`, `SinglePageNode`, and `MultiplePageNode`. Strict declaration checking is tested with TypeScript 6 in Bundler, Node16, and NodeNext resolution modes.

## Client Components

Register React components for client-side hydration in `src/client-components.tsx`:

```tsx
import { lazy } from 'react';

export const clientComponents = {
  header: lazy(() => import('./organisms/header')),
  people: lazy(() => import('./organisms/people')),
};
```

These render in the browser from `<script data-rct="header">` tags in your HTML.

Use the packaged helpers rather than copying their implementation:

```tsx
import { ReactSection, RequireCss, RequireJs } from 'alveo/helpers';

<ReactSection type="header" data={{ title: 'Example' }} css="b-header" />;
```

`ReactSection` safely serializes JSON inside a script element. Pass serializable object props (or `null` for empty props); unserializable data is an error. Malformed payloads and mount failures are reported per component rather than blocking the rest of the page. Failed parsing preserves the payload for retry. YAML payloads remain supported, but their parser loads only when needed. `window.renderComponents()` returns a promise for parsing/mount scheduling; `react-loaded` still signals API readiness, not completed React commits.

The catalog selects a valid hash route, then `/pages/home`, the first page, or the first available component. An empty project gets an explicit empty state instead of recursively embedding the catalog.

## SCSS Conventions

- `src/assets/styles/style-base.scss` — main stylesheet entry point
- `src/organisms/{name}/index.scss` — per-organism styles, compiled to `b-{name}.css`
- `src/templates/{name}/index.scss` — per-template styles, compiled to `p-{name}.css`
- Abstracts, functions, and mixins barrels are auto-injected as `@use` preludes

Base styles, atoms, and molecules compile through one ordered Sass module graph. Sass stays expanded internally to preserve cross-file mappings; LightningCSS performs the final minification and browser-target lowering. Published framework styles also pass through the consumer's browser targets. One-shot builds do not debounce or sleep; watch mode performs one initial scan and coalesces edits.

## Standalone Scripts

`alveo scripts` bundles only `src/assets/scripts/**/*.entry.{js,jsx,ts,tsx}`. Imported helpers are bundled, while tests and non-entry files are not independent outputs. Entry names use the same lowercase-dashed normalization as Vite and produce `public/assets/js/<name>.js`, without `.entry` in the filename. Duplicate output names are errors.

Normal entries have linked external sourcemaps; names containing `critical` omit them. Watch mode follows imported files as well as entry discovery. This standalone esbuild command does not run Vite plugins or virtual modules; use `build`/`generate` for the complete Vite application pipeline.

## Build Outputs

| Command          | Output                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `alveo build`    | `dist/static/` (client), `dist/server/entry-server.js` (SSR)                |
| `alveo generate` | Pre-rendered HTML pages in `dist/static/pages/`                             |
| `alveo inte`     | Copies assets to `VITE_INTE_ASSET_DIR`, patterns to `VITE_INTE_PATTERN_DIR` |
| `alveo styles`   | CSS files in `public/assets/css/`                                           |
| `alveo scripts`  | Entry bundles in `public/assets/js/`                                        |

Vite-emitted assets retain their actual extension: CSS belongs under `assets/css`, images under `assets/images`, fonts under `assets/fonts`, and other assets under `assets`. Framework icons are owned and bundled by Alveo rather than required in the consumer's public directory.

### Migration Notes

- Node 24+ is now the shared framework/starter minimum.
- Production `alveo server` usage is no longer supported.
- Replace copied `ReactSection`, `RequireJs`, and `RequireCss` implementations with re-exports from `alveo/helpers` to receive the serialization fixes.
- Update standalone script references from `<name>.entry.js` to `<name>.js`, including lowercase-dashed entry names where applicable.
- Cache-busting values now consistently use 10-character SHA-384 base64url versions. HTML and `hashes.json` values change once from the old SHA-1 values.
- Rebuild both static and SSR output after upgrading; prerender uses the SSR bundle's resolved Vite base, not a potentially conflicting `.env` base.
- `AlveoPaths.viteSharedRoot` was removed; it pointed to a nonexistent directory.

## Development

### Setup

```bash
bun install
```

### Build

```bash
bun run build
```

The package build cleans `dist`, uses `tsc` to emit JavaScript and declarations, compiles framework CSS through Sass and LightningCSS, and copies ambient types and framework icons. Generated text and map sources are normalized to LF. Do not replace it with `bun check`: that command checks types without emitting the files required by the package exports and CLI.

### Test

```bash
bun run test
bun run test:coverage
bun run test:ci
```

The package regression test builds and **npm-packs** a clean temporary checkout, installs the tarball with production dependencies in an isolated consumer, and verifies entry points, shared peers, scaffolding, script bundling, strict consumer types, custom-mode generation, and integration. It checks the browser dependency graph for deferred YAML and absence of Cheerio/lodash, then rebuilds CRLF source and requires `git diff --quiet` for generated integration output. It starts with a separate empty Bun cache and fetches missing registry metadata and packages, so this check requires registry access. It never links the maintainer's development dependencies into the consumer. This runs in the prepublish test gate so stale output, hoisted development tools, or a warmed developer cache cannot hide a broken release.

### Typecheck

```bash
bun run typecheck
```

### Dependency Ownership

Alveo ships unbundled JavaScript, so tools its CLI invokes in consumer projects belong in `dependencies`, even when Alveo itself is installed as a dev dependency. This includes Vite, Sass, Lightning CSS, esbuild, and the server utilities. Vite 8 makes esbuild optional, but Alveo's standalone script compiler still needs it for minified ESM output and its existing sourcemap behavior. MSW is also a runtime dependency because non-production builds with handlers include Alveo's mock entry. Lodash remains server-side for Unicode-aware route naming; it is not imported by the catalog browser code.

React, React DOM, and React Router are peer dependencies so the application and framework share component and routing contexts. Development copies support Alveo's own build and tests. TypeScript is an optional peer: TypeScript consumers install it and their React/Node typings as dev dependencies, while JavaScript consumers do not need a compiler at runtime.

The starter keeps Alveo in `devDependencies` for static and prerendered deployment. Install development dependencies during the build, then deploy the generated assets. Alveo's server is for development only.

Repository installs configure the checked-in pre-commit and pre-push hooks. Published installations do not modify a consumer's Git configuration. The pre-push hook runs `bun run typecheck`; setup failures in a real maintainer checkout are reported instead of being hidden with `|| true`.

## Requirements

- Node.js >= 24
- Bun for repository and starter install/test scripts
- React >= 19.2.8 within version 19, and React Router >= 7.18.2 within version 7
- TypeScript 6 for TypeScript consumers; optional for JavaScript consumers

## License

MIT
