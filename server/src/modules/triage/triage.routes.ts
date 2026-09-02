import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { assessSchema, triageIdParamSchema } from './triage.schema.js';
import * as controller from './triage.controller.js';

/**
 * Symptom triage, mounted at /api/triage.
 *
 * Signed-in patients only. It could have been open to anyone — the rules engine
 * needs no account — but every assessment is stored against a person and linked
 * from an appointment, and an anonymous pile of symptom text with nobody to
 * own it is a liability rather than a feature.
 *
 * Guards sit on the router rather than route by route, so a route added later
 * cannot be left open by forgetting to repeat them.
 */
export const triageRouter = Router();

triageRouter.use(requireAuth, requireRole('patient'));

triageRouter.post('/', validate({ body: assessSchema }), controller.assess);

triageRouter.get('/:id', validate({ params: triageIdParamSchema }), controller.getOne);
