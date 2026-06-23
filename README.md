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

### Test

```bash
bun run test
bun run test:coverage
```

### Typecheck

```bash
bun run typecheck
```

## Requirements

- Node.js >= 20 or Bun
- React 19
- TypeScript 5+

## License

MIT
