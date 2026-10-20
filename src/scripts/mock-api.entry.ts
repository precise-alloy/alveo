import { worker } from './mock-browser.ts';

worker.start({
  serviceWorker: {
    url: `${import.meta.env.BASE_URL}mockServiceWorker.js`,
    options: {
      scope: import.meta.env.BASE_URL,
    },
  },
  onUnhandledRequest: 'bypass',
});
