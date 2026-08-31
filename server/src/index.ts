import { getSettings } from './config/env.js';
import { connectDb } from './config/db.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';

async function main(): Promise<void> {
  const settings = getSettings();
  await connectDb();

  // 0.0.0.0 rather than localhost so the host's health check can reach us.
  createApp().listen(settings.PORT, '0.0.0.0', () => {
    logger.info(`API listening on http://localhost:${settings.PORT}`, {
      env: settings.NODE_ENV,
    });
  });
}

main().catch((error: unknown) => {
  // Startup failures are for a human to read, so print the message, not a stack.
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
