import fs from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express from 'express';
import type { Express, RequestHandler } from 'express';
import { CLIENT_DIST } from '../config/paths.js';
import { logger } from '../config/logger.js';

/**
 * Paths that belong to the server. A miss under one of these is a real 404,
 * never the client's page: a mistyped API call must get JSON back, not HTML
 * with a 200. Socket.IO answers its own path before Express sees it, and is
 * listed so that stays true if that ever changes.
 */
const SERVER_PREFIXES = ['/api', '/socket.io', '/uploads'];

/** Vite fingerprints everything under `/assets/`, so a file there never changes. */
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** `public/` files (favicon, doctor photos) keep their names across builds. */
const SHORT = 'public, max-age=3600';
/** The page itself is always rechecked, so a deploy reaches people on their next load. */
const REVALIDATE = 'no-cache';

/**
 * Serves the built client from `client/dist`, in production only. Mounted after
 * every API router so `/api` and `/socket.io` are matched first.
 *
 * Any other GET that is not a file gets `index.html`, and React Router takes it
 * from there. That is what makes a hard refresh on `/doctor/appointments` work.
 */
export function serveClient(app: Express): void {
  const indexHtml = path.join(CLIENT_DIST, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    // The API still works without it, so warn rather than refuse to start.
    logger.warn('No built client to serve. Run `npm run build` first.', { looked: CLIENT_DIST });
    return;
  }

  app.use(compression());
  app.use(
    express.static(CLIENT_DIST, {
      // `/` goes through the fallback below, which sets the page's headers.
      index: false,
      setHeaders: (res, file) => {
        const inAssets = path.relative(CLIENT_DIST, file).split(path.sep)[0] === 'assets';
        res.setHeader('Cache-Control', inAssets ? IMMUTABLE : SHORT);
      },
    }),
  );

  const fallback: RequestHandler = (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (SERVER_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
    // A missing `/logo.png` should 404, not quietly become the page.
    if (path.extname(req.path) !== '') return next();

    res.setHeader('Cache-Control', REVALIDATE);
    res.sendFile(indexHtml);
  };
  app.use(fallback);
}
