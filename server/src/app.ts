import express from 'express';
import type { Express } from 'express';

/**
 * Builds the Express app. Kept separate from the server bootstrap so tests and
 * the Socket.IO server (phase 9) can wrap the same app.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  return app;
}
