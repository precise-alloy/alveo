import type { PluginOption } from 'vite';

const handleHotUpdate = (): PluginOption => {
  return {
    name: 'alveo-hot-update',
    enforce: 'post',

    handleHotUpdate({ file, server }) {
      if (file.endsWith('.js') || file.endsWith('.css') || file.endsWith('.json'))
        server.ws.send({
          type: 'full-reload',
          path: '*',
        });
    },
  };
};

export default handleHotUpdate;
