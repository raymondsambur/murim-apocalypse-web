/** Entry point. `?mock=1` swaps the network for the in-memory dev MockServer (loaded lazily, never in production flows). */
import './styles.css';
import { setHttpTransport } from './net/api';
import { App } from './ui/app';
import { initToasts } from './ui/widgets/toast';

async function main(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app missing');
  initToasts();
  const params = new URLSearchParams(location.search);
  let socketFactory;
  const mock = params.has('mock');
  if (mock) {
    const { installMock } = await import('./net/mock');
    const server = installMock({ seed: Number(params.get('seed')) || undefined, fast: params.has('fast') });
    setHttpTransport(server.transport);
    socketFactory = server.socketFactory;
    console.info('[mock] MockServer active (?mock=1). Accounts live in localStorage.');
  }
  const app = new App({ root, socketFactory, debug: mock || import.meta.env.DEV });
  if (mock || import.meta.env.DEV) (window as unknown as { __app?: App }).__app = app;
  await app.start();
}

main().catch((e) => {
  console.error(e);
  const root = document.getElementById('app');
  if (root) root.textContent = 'Failed to start: ' + (e instanceof Error ? e.message : String(e));
});
