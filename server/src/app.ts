import express from 'express';
import cookieParser from 'cookie-parser';
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
import { UPLOAD_DIR, UPLOAD_URL_PREFIX } from './providers/storage/local.js';
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
  app.use('/api/doctor', doctorRouter);
  // Plural and public: the catalogue a patient browses before signing up.
  app.use('/api/doctors', publicDoctorRouter);
  app.use('/api/appointments', appointmentRouter);
  app.use('/api/patient', patientRouter);
  app.use('/api/payments', paymentRouter);
  // Further feature routers mount here, above the two handlers below.

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
