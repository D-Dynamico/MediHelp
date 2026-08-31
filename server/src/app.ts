import express from 'express';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import { SPECIALITIES } from '@shared/types.js';
import type { HealthResponse } from '@shared/types.js';
import { getSettings } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { apiLimiter } from './middleware/rateLimit.js';

/**
 * Builds the Express app. Kept separate from the server bootstrap so tests and
 * the Socket.IO server (phase 9) can wrap the same app.
 *
 * Express 5 forwards rejected promises from handlers to the error middleware on
 * its own, so route handlers can be plain `async` with no wrapper.
 */
export function createApp(): Express {
  const app = express();

  // Behind a proxy (Render), the forwarded address is the real caller's, which
  // rate limiting and `secure` cookies both depend on.
  if (getSettings().isProduction) app.set('trust proxy', 1);

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', uptime: process.uptime() };
    res.json(body);
  });

  app.get('/api/specialities', (_req, res) => {
    res.json({ specialities: SPECIALITIES });
  });

  app.use('/api/auth', authRouter);
  // Further feature routers mount here, above the two handlers below.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
