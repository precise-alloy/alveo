# alveo

Opinionated React SSR framework built on Vite. Compiles components, renders pages server-side, and integrates with
backend CMS projects.

## Quick Start

```bash
npx alveo create my-app
cd my-app
bun install
bun run dev
```

## CLI Commands

| Command                | Description                                       |
|------------------------|---------------------------------------------------|
| `alveo dev`            | Start dev server with HMR, style watcher, and SSR |
| `alveo build`          | Production build (static + SSR bundles)           |
| `alveo generate`       | Full pipeline: states, styles, build, prerender   |
| `alveo inte`           | Integration build for backend consumption         |
| `alveo styles`         | Compile SCSS stylesheets                          |
| `alveo styles --watch` | Watch and recompile SCSS on changes               |
| `alveo states`         | Aggregate component state JSON files              |
| `alveo create <name>`  | Scaffold a new project from the starter template  |

All commands accept `--root <path>` to specify the project root (defaults to `cwd`).

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
    _helpers/            Utility components (RequireJs, RequireCss, ReactSection)
    _data/               Static data
    _api/                API client modules
    mocks/               MSW mock handlers
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
    "paths": {
      "@atoms/*": [
        "./src/atoms/*"
      ],
      "@molecules/*": [
        "./src/molecules/*"
      ],
      "@organisms/*": [
        "./src/organisms/*"
      ],
      "@templates/*": [
        "./src/templates/*"
      ],
      "@pages/*": [
        "./src/pages/*"
      ],
      "@helpers/*": [
        "./src/_helpers/*"
      ],
      "@data/*": [
        "./src/_data/*"
      ],
      "@mocks/*": [
        "./src/mocks/*"
      ]
    }
  }
}
```

## Path Aliases

| Alias          | Resolves to             |
|----------------|-------------------------|
| `@atoms/*`     | `src/atoms/*`           |
| `@molecules/*` | `src/molecules/*`       |
| `@organisms/*` | `src/organisms/*`       |
| `@templates/*` | `src/templates/*`       |
| `@pages/*`     | `src/pages/*`           |
| `@helpers/*`   | `src/_helpers/*`        |
| `@data/*`      | `src/_data/*`           |
| `@mocks/*`     | `src/mocks/*`           |
| `@alveo/*`     | alveo package internals |

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

## SCSS Conventions

- `src/assets/styles/style-base.scss` — main stylesheet entry point
- `src/organisms/{name}/index.scss` — per-organism styles, compiled to `b-{name}.css`
- `src/templates/{name}/index.scss` — per-template styles, compiled to `p-{name}.css`
- Abstracts, functions, and mixins barrels are auto-injected as `@use` preludes

## Build Outputs

| Command          | Output                                                                      |
|------------------|-----------------------------------------------------------------------------|
| `alveo build`    | `dist/static/` (client), `dist/server/entry-server.js` (SSR)                |
| `alveo generate` | Pre-rendered HTML pages in `dist/static/pages/`                             |
| `alveo inte`     | Copies assets to `VITE_INTE_ASSET_DIR`, patterns to `VITE_INTE_PATTERN_DIR` |
| `alveo styles`   | CSS files in `public/assets/css/`                                           |

## Development

### Setup

```bash
bun install
```

### Build

```bash
bun run build
```

The package build uses `tsc` to emit JavaScript and type declarations into `dist`.
Do not replace it with `bun check`: that command checks types without emitting the
files required by the package exports and CLI.

### Test

```bash
bun run test
bun run test:coverage
bun run test:ci
```

The package regression test builds and packs a clean temporary checkout, installs
the tarball with production dependencies in an isolated consumer, and verifies
entry points, shared peers, CLI script compilation, and TypeScript imports.
It starts with a separate empty Bun cache and fetches missing registry metadata
and packages, so this check requires registry access. It never links the
maintainer's development dependencies into the consumer. This runs in the
prepublish test gate so stale output, hoisted development tools, or a warmed
developer cache cannot hide a broken release.

### Typecheck

```bash
bun run typecheck
```

### Dependency Ownership

Alveo ships unbundled JavaScript, so tools its CLI invokes in consumer projects
belong in `dependencies`, even when Alveo itself is installed as a dev dependency.
This includes Vite, Sass, Lightning CSS, esbuild, and the server utilities.
Vite 8 makes esbuild optional, but Alveo's standalone script compiler still needs
it for minified ESM output and its existing sourcemap behavior. MSW is also a
runtime dependency because non-production builds include Alveo's mock entry.

React, React DOM, and React Router are peer dependencies so the application and
framework share component and routing contexts. Development copies support
Alveo's own build and tests. TypeScript is an optional peer: TypeScript consumers
install it and their React/Node typings as dev dependencies, while JavaScript
consumers do not need a compiler at runtime.

The starter keeps Alveo in `devDependencies` for static and prerendered deployment.
Install development dependencies during the build, then deploy the generated
assets. If a deployed Node server uses `alveo server`, keep Alveo in that
application's `dependencies` instead so production-only installs retain it.

## Requirements

- Node.js >= 22.12.0; the starter project requires Node.js >= 24
- Bun for repository and starter install/test scripts
- React >= 19.2.8 within version 19, and React Router >= 7.18.2 within version 7
- TypeScript 6 for TypeScript consumers; optional for JavaScript consumers

## License

MIT
