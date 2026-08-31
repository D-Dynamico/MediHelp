import express from 'express';
import type { Express } from 'express';
import { SPECIALITIES } from '@shared/types.js';
import type { HealthResponse } from '@shared/types.js';

/**
 * Builds the Express app. Kept separate from the server bootstrap so tests and
 * the Socket.IO server (phase 9) can wrap the same app.
 */
export function createApp(): Express {
  const app = express();

  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', uptime: process.uptime() };
    res.json(body);
  });

  app.get('/api/specialities', (_req, res) => {
    res.json({ specialities: SPECIALITIES });
  });

  return app;
}
