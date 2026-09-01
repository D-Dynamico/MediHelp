import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { objectIdParamSchema, publicDoctorQuerySchema, slotQuerySchema } from './doctor.schema.js';
import * as controller from './public.controller.js';

/**
 * The doctor catalogue, mounted at /api/doctors.
 *
 * Deliberately unauthenticated. A patient deciding whether this clinic has a
 * dermatologist should not have to sign up first — that is a page they will land
 * on from a search engine, and putting a login in front of it is how a clinic
 * site loses the person before it has said anything.
 *
 * Note the plural, against `/api/doctor` singular for the signed-in doctor's own
 * dashboard. Different audiences, different projections: this one never returns
 * an email address.
 */
export const publicDoctorRouter = Router();

publicDoctorRouter.get(
  '/',
  validate({ query: publicDoctorQuerySchema }),
  controller.list,
);

publicDoctorRouter.get(
  '/:id',
  validate({ params: objectIdParamSchema }),
  controller.detail,
);

publicDoctorRouter.get(
  '/:id/slots',
  validate({ params: objectIdParamSchema, query: slotQuerySchema }),
  controller.slots,
);
