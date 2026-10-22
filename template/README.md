# alveo Sample Project

A minimal project demonstrating how to use `alveo` as a framework dependency.

## Prerequisites

- Node.js >= 24 and [Bun](https://bun.sh/) for the supplied scripts
- `alveo` installed (linked via monorepo or published to npm)

## Install

```bash
bun install
```

Alveo is a dev dependency because this starter builds static and prerendered assets. Install development dependencies in your build environment, then deploy the generated output. The compatible Alveo version range avoids automatically adopting a new minor release of the pre-1.0 framework.

`alveo server` is development-only and rejects production mode. Deploy generated static output or use your backend's integration. Keep React, React DOM, and React Router as application dependencies to share their runtime instances with Alveo. TypeScript and lint/test tools remain development dependencies.

## Development

Start the dev server with hot reload:

```bash
bun run dev
```

## Build

Build for production:

```bash
bun run build
```

Generate pre-rendered static pages:

```bash
bun run generate
```

## Integration

Output assets and patterns to integration directories (configured in `.env`):

```bash
bun run inte
```

Both destinations must be external to the project and non-overlapping, including through symlinks. Use only generated-output directories: integration can replace their contents. State generation, CSS compilation and SSR errors stop the pipeline.

## Styles

Compile SCSS styles independently:

```bash
bun run styles
```

## Testing

Run unit tests:

```bash
bun run test
```

## Linting and Formatting

```bash
bun run lint
bun run typecheck
```

## Project Structure

```text
src/
  _api/          API client modules
  _data/         Static data and content
  _helpers/      Utility functions
  _types/        TypeScript type definitions
  assets/        Static assets (images, fonts, scripts, styles)
  atoms/         Atomic design: smallest UI elements
  molecules/     Atomic design: composed atoms
  organisms/     Atomic design: composed molecules
  templates/     Page layout templates
  pages/         Full page components
  mocks/         MSW mock handlers for API testing
  client-components.tsx   Registry of client-rendered React components
```

The mocks directory is optional. Handlers enable mocking in every non-production mode, including custom modes; production excludes it.

The helpers in `_helpers/` re-export `alveo/helpers` so they receive framework fixes, including safe JSON script serialization. Framework icons are packaged with Alveo and do not need copies in `public/`. The `types.d.ts` reference to `alveo/types` supplies framework globals and virtual-module types.

Standalone asset scripts should be named `*.entry.ts` (or `.js`, `.jsx`, `.tsx`). `alveo scripts` bundles them to `public/assets/js/<name>.js` with linked maps, except for critical entries. Tests and ordinary helpers are not standalone entries.

## Adding Components

1. Create a new component directory under the appropriate atomic level (`atoms/`, `molecules/`, etc.)
2. Add an `index.tsx` barrel file in the directory
3. Use alias imports: `@atoms/*`, `@molecules/*`, `@organisms/*`, `@templates/*`, `@pages/*`

## Adding Pages

1. Create a new page component under `src/pages/`
2. Pages are pre-rendered during the `generate` step
3. Each page should have a default export

## Configuration

- `vite.config.ts` - Vite configuration (uses `defineAlveoConfig` from alveo)
- `vitest.config.ts` - Test configuration
- `tsconfig.json` - TypeScript configuration
- `.env` - Environment variables (base URL, API endpoints, integration paths)
