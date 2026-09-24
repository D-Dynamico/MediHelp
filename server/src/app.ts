import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import type { Express } from 'express';
import { SPECIALITIES } from '@shared/types.js';
import type { HealthResponse } from '@shared/types.js';
import { getSettings } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { doctorRouter } from './modules/doctors/doctor.routes.js';
import { publicDoctorRouter } from './modules/doctors/public.routes.js';
import { appointmentRouter } from './modules/appointments/appointment.routes.js';
import { patientRouter } from './modules/patients/patient.routes.js';
import { paymentRouter } from './modules/payments/payment.routes.js';
import { triageRouter } from './modules/triage/triage.routes.js';
import { boardRouter, queueRouter } from './modules/queue/queue.routes.js';
import { waitlistRouter } from './modules/waitlist/waitlist.routes.js';
import { UPLOAD_DIR, UPLOAD_URL_PREFIX } from './providers/storage/local.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { sanitizeRequest } from './middleware/sanitize.js';

/**
 * The content security policy is written for the built client, which this app
 * serves in production (phase 13.2). In development Vite serves the pages, so
 * the policy only lands on API responses and uploads, where it costs nothing.
 * Each outside origin is here for one reason:
 *
 * - Google Fonts: the stylesheet and the font files `index.html` loads;
 * - Razorpay: its checkout script, the frames it opens and the calls it makes;
 * - Cloudinary: doctor photos, once uploads go there instead of to disk.
 *
 * `'unsafe-inline'` for styles covers React's `style={...}` attributes. Scripts
 * get no such allowance.
 */
const contentSecurityPolicy = {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
    connectSrc: ["'self'", 'https://*.razorpay.com'],
    frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    // Render only serves HTTPS, and HSTS already covers it. Upgrading here would
    // break the production build run locally over plain http.
    upgradeInsecureRequests: null,
  },
};

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

  app.use(
    helmet({
      contentSecurityPolicy,
      // Helmet's default, `same-origin`, cuts the link between the page and any
      // popup it opens. Razorpay's checkout opens one for netbanking and wallets,
      // and reports back through that link. Without it, the money could be taken
      // while the booking stays unpaid.
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    }),
  );

  // Off unless CORS_ORIGINS lists somewhere, since the client normally shares
  // the API's origin. This is the same list Socket.IO uses. The refresh cookie
  // is `sameSite: 'strict'`, so a listed origin only keeps users signed in if
  // it is on the same site (a subdomain), not merely allowed by CORS.
  const { CORS_ORIGINS } = getSettings();
  if (CORS_ORIGINS.length > 0) app.use(cors({ origin: CORS_ORIGINS, credentials: true }));

  app.use(
    express.json({
      limit: '100kb',
      // Keeps the raw bytes for the payment webhook, which is signed over the
      // payload exactly as sent. Re-serialising the parsed object would break
      // that signature the first time a key came back in a different order.
      verify: (req, _res, buffer) => {
        (req as express.Request).rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(cookieParser());
  app.use(sanitizeRequest);

  // Locally stored uploads are served by us; on Cloudinary they are served by
  // Cloudinary and this route would only ever 404.
  if (!getSettings().useCloudinary) {
    app.use(
      UPLOAD_URL_PREFIX,
      express.static(UPLOAD_DIR, {
        // These are files strangers uploaded. `nosniff` stops a browser deciding
        // one of them is really HTML and running it on our own origin.
        setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
      }),
    );
  }
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = { status: 'ok', uptime: process.uptime() };
    res.json(body);
  });

  app.get('/api/specialities', (_req, res) => {
    res.json({ specialities: SPECIALITIES });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  // Above the doctor's own router, so the more specific prefix wins outright
  // rather than falling through it.
  app.use('/api/doctor/queue', queueRouter);
  app.use('/api/doctor', doctorRouter);
  // Plural and public: the catalogue a patient browses before signing up.
  app.use('/api/doctors', publicDoctorRouter);
  app.use('/api/appointments', appointmentRouter);
  app.use('/api/patient', patientRouter);
  app.use('/api/payments', paymentRouter);
  app.use('/api/triage', triageRouter);
  app.use('/api/waitlist', waitlistRouter);
  // The one route with no login behind it: a screen on a waiting-room wall,
  // holding a signed link and nothing else.
  app.use('/api/board', boardRouter);
  // Further feature routers mount here, above the two handlers below.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
