import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { claimSchema, entryParamSchema, joinWaitlistSchema } from './waitlist.schema.js';
import * as controller from './waitlist.controller.js';

/**
 * A patient's waitlist, mounted at /api/waitlist.
 *
 * Patients only, guarded on the router so a route added later cannot be left
 * open. Ownership of an entry is checked in the service, which answers 404 for
 * anyone else's — a role guard alone would let one patient claim another's
 * offered slot by changing the id in the URL.
 */
export const waitlistRouter = Router();

waitlistRouter.use(requireAuth, requireRole('patient'));

waitlistRouter.get('/', controller.listMine);
waitlistRouter.post('/', validate({ body: joinWaitlistSchema }), controller.join);
waitlistRouter.delete('/:id', validate({ params: entryParamSchema }), controller.withdraw);
waitlistRouter.post(
  '/:id/claim',
  validate({ params: entryParamSchema, body: claimSchema }),
  controller.claim,
);
