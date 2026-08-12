import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReactDOM from 'react-dom/client';

const { createRoot, render } = vi.hoisted(() => {
  const render = vi.fn();

  return {
    createRoot: vi.fn(() => ({ render })),
    render,
  };
});

vi.mock('react-dom/client', () => ({
  default: { createRoot },
}));

vi.mock('./scripts/functions.ts', () => ({}));

vi.mock('virtual:alveo/client-components', () => ({
  clientComponents: {},
}));

describe('react loader', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.mocked(ReactDOM.createRoot).mockClear();
    render.mockClear();
    document.body.innerHTML = '';
  });

  it("parses YAML component props through js-yaml's ESM load export", async () => {
    document.body.innerHTML = `
      <script data-rct="root" type="application/yaml">
        heading: Example
        enabled: true
      </script>
    `;

    await import('./react-loader.tsx');

    expect(ReactDOM.createRoot).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(
      expect.objectContaining({
        props: { heading: 'Example', enabled: true },
      })
    );
  });
});
