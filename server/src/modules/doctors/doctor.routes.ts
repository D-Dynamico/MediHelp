import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { uploadImage } from '../../middleware/upload.js';
import { validate } from '../../middleware/validate.js';
import {
  appointmentScopeSchema,
  objectIdParamSchema,
  updateProfileSchema,
} from './doctor.schema.js';
import * as controller from './doctor.controller.js';

/**
 * The signed-in doctor's own dashboard, mounted at /api/doctor.
 *
 * Guards on the router rather than route by route, so a route added later
 * cannot be left open by forgetting to repeat them. An admin is not allowed
 * through: these routes act on "whoever is signed in", and an admin signed in
 * here has no doctor profile of their own to act on. Admins manage doctors
 * through /api/admin/doctors, where the target is named explicitly.
 */
export const doctorRouter = Router();

doctorRouter.use(requireAuth, requireRole('doctor'));

doctorRouter.get('/profile', controller.getProfile);
doctorRouter.get('/earnings', controller.earnings);

// Upload before validation: the body is multipart, so until multer has read it
// there are no fields for the schema to look at.
doctorRouter.patch(
  '/profile',
  ...uploadImage('image'),
  validate({ body: updateProfileSchema }),
  controller.updateProfile,
);

doctorRouter.get(
  '/appointments',
  validate({ query: appointmentScopeSchema }),
  controller.listAppointments,
);

// Ownership is not checked here. It is checked inside the shared appointment
// service, which loads the signed-in doctor's own id and compares it with the
// appointment's — a role guard alone would happily let one doctor complete
// another's consult by changing the id in this URL.
doctorRouter.patch(
  '/appointments/:id/start',
  validate({ params: objectIdParamSchema }),
  controller.startConsult,
);

doctorRouter.patch(
  '/appointments/:id/complete',
  validate({ params: objectIdParamSchema }),
  controller.completeAppointment,
);

doctorRouter.patch(
  '/appointments/:id/cancel',
  validate({ params: objectIdParamSchema }),
  controller.cancelAppointment,
);
