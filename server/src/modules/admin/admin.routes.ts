import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { uploadImage } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { createDoctorSchema } from './admin.schema.js';
import * as controller from './admin.controller.js';

/**
 * Admin-only endpoints, mounted at /api/admin.
 *
 * The two guards are applied to the router rather than route by route, so a
 * route added later cannot be left unprotected by forgetting to repeat them.
 */
export const adminRouter = Router();

adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/dashboard', controller.dashboard);

// The upload runs before validation because the body is multipart: until multer
// has read it, there are no fields for the schema to look at.
adminRouter.post(
  '/doctors',
  ...uploadImage('image'),
  validate({ body: createDoctorSchema }),
  controller.createDoctor,
);
