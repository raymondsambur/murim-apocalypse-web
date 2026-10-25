/**
 * Process entry point. Boots the server (see server.ts) and handles signals and last-resort errors.
 *
 *   npm run dev:server        development (tsx watch)
 *   npm run build && npm start   production bundle
 */
import { startServer, type RunningServer } from './server';

const SHUTDOWN_TIMEOUT_MS = 10000;

async function main(): Promise<void> {
  let server: RunningServer;
  try {
    server = await startServer();
  } catch (err) {
    console.error('Failed to start the server:', err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  }
  const { log } = server;

  let stopping = false;
  const stop = (signal: string, code = 0): void => {
    if (stopping) return;
    stopping = true;
    log.info(`received ${signal}`);
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();
    server.close().then(
      () => process.exit(code),
      (err) => {
        log.error('error during shutdown', err);
        process.exit(1);
      },
    );
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGBREAK', () => stop('SIGBREAK'));

  // A stray rejection is logged, not fatal: one bad handler must not take the world down.
  process.on('unhandledRejection', (reason) => log.error('unhandled promise rejection', reason));
  // After an uncaught exception state is suspect: save what we can and exit so a supervisor restarts us.
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err);
    stop('uncaughtException', 1);
  });
}

void main();
