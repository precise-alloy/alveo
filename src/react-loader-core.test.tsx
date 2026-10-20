import { lazy } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createComponentRenderer, defaultReactLoaderDependencies } from './react-loader-core.tsx';

const components = { card: lazy(async () => ({ default: () => null })) };
const payload = (data = '{}', type = 'application/json') => {
  const script = document.createElement('script');

  script.setAttribute('data-rct', 'card');
  script.type = type;
  script.textContent = data;
  document.body.append(script);

  return script;
};
const fixture = () => {
  const render = vi.fn();
  const unmount = vi.fn();
  const dependencies = {
    createRoot: vi.fn().mockReturnValue({ render, unmount }),
    loadYaml: vi.fn().mockResolvedValue({ load: vi.fn().mockReturnValue({ title: 'yaml' }) }),
    reportError: vi.fn(),
  };

  return { render, unmount, dependencies, mount: createComponentRenderer(components, dependencies) };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('isolated component mounting', () => {
  it.each(['div', 'section', ' DIV ', 'iframe', ''])('uses safe container tag %j and does not load YAML for JSON', async (tag) => {
    const { mount, render, dependencies } = fixture();
    const script = payload('{"title":"hello"}');

    script.dataset.tag = tag;
    script.dataset.class = 'card';
    await mount(script);
    expect(document.querySelector('.card')?.tagName).toBe(tag.trim().toLowerCase() === 'div' ? 'DIV' : 'SECTION');
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ props: { title: 'hello' } }));
    expect(dependencies.loadYaml).not.toHaveBeenCalled();
    const error = new Error('React render failure');

    dependencies.createRoot.mock.calls[0]![1].onUncaughtError(error);
    expect(dependencies.reportError).toHaveBeenCalledWith('card', error);
  });

  it('supports empty payloads, absent type/tag, and null props', async () => {
    const { mount, render } = fixture();
    const script = payload('');

    script.removeAttribute('type');
    await mount(script);
    await mount(payload('null'));
    expect(render).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('section')).toHaveLength(2);
  });

  it.each([
    ['{bad', 'application/json'],
    ['42', 'application/json'],
    ['{}', 'text/unsupported'],
  ])('reports %s without destroying the payload or stopping later mounts', async (data, type) => {
    const { mount, render, dependencies } = fixture();
    const bad = payload(data, type);
    const good = payload();

    await Promise.all([mount(bad), mount(good)]);
    expect(dependencies.reportError).toHaveBeenCalledWith('card', expect.any(Error));
    expect(bad.isConnected).toBe(true);
    expect(bad.textContent).toBe(data);
    expect(render).toHaveBeenCalledOnce();
    bad.textContent = '{}';
    bad.type = 'application/json';
    await mount(bad);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('reports missing registrations and missing component names', async () => {
    const { mount, dependencies } = fixture();
    const script = payload();

    script.removeAttribute('data-rct');
    await mount(script);
    script.dataset.rct = 'unknown';
    await mount(script);
    script.dataset.rct = 'constructor';
    await mount(script);
    expect(dependencies.reportError).toHaveBeenCalledTimes(3);
  });

  it('loads YAML lazily and suppresses overlapping mounts', async () => {
    const { mount, dependencies, render } = fixture();
    let resolve!: (value: { load: () => object }) => void;

    dependencies.loadYaml.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const script = payload('title: yaml', 'application/yaml');
    const first = mount(script);

    await mount(script);
    expect(dependencies.loadYaml).toHaveBeenCalledOnce();
    resolve({ load: () => ({ title: 'yaml' }) });
    await first;
    expect(render).toHaveBeenCalledOnce();
  });

  it('does not resurrect content removed while YAML loads', async () => {
    const { mount, render } = fixture();
    const script = payload('title: yaml', 'application/yaml');
    const result = mount(script);

    script.remove();
    await result;
    await mount(script);
    expect(render).not.toHaveBeenCalled();
  });

  it('retains the payload and unmounts a root when synchronous mounting fails', async () => {
    const { mount, render, unmount, dependencies } = fixture();

    render.mockImplementationOnce(() => {
      throw new Error('mount');
    });
    const script = payload();

    await mount(script);
    expect(unmount).toHaveBeenCalledOnce();
    expect(script.isConnected).toBe(true);
    dependencies.createRoot.mockImplementationOnce(() => {
      throw new Error('root');
    });
    await mount(script);
    expect(dependencies.reportError).toHaveBeenCalledTimes(2);
  });

  it('uses the real YAML ESM loader and default error reporter', async () => {
    const createRoot = vi.fn().mockReturnValue({ render: vi.fn(), unmount: vi.fn() });
    const mount = createComponentRenderer(components, { ...defaultReactLoaderDependencies, createRoot });

    await mount(payload('title: yaml', 'application/yaml'));
    expect(createRoot).toHaveBeenCalledOnce();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await createComponentRenderer({})(payload());
    expect(error).toHaveBeenCalledWith(expect.stringContaining('card'), expect.any(Error));
  });
});
