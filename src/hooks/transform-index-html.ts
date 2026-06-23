import type { PluginOption } from 'vite';

const transformIndexHtml = (baseUrl: string): PluginOption => {
  return {
    name: 'alveo-transform-index-html',
    enforce: 'post',

    transformIndexHtml(html) {
      return html.replaceAll('#__BASE_URL__/', baseUrl);
    },
  };
};

export default transformIndexHtml;
