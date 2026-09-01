import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { uploadImage } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import { updatePatientSchema } from './patient.schema.js';
import * as controller from './patient.controller.js';

/**
 * The signed-in patient's own account, mounted at /api/patient.
 *
 * Singular, like `/api/doctor`, and for the same reason: these routes act on
 * whoever is signed in and carry no id at all. Guards sit on the router rather
 * than route by route, so a route added later cannot be left open by forgetting
 * to repeat them.
 */
export const patientRouter = Router();

patientRouter.use(requireAuth, requireRole('patient'));

patientRouter.get('/profile', controller.getProfile);

// Upload before validation: the body is multipart, so until multer has read it
// there are no fields for the schema to look at.
patientRouter.patch(
  '/profile',
  ...uploadImage('image'),
  validate({ body: updatePatientSchema }),
  controller.updateProfile,
);
