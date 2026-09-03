import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  appointmentParamSchema,
  boardParamSchema,
  boardQuerySchema,
  queueDaySchema,
} from './queue.schema.js';
import * as controller from './queue.controller.js';

/**
 * Two routers, because the queue has two audiences with nothing in common.
 *
 * The doctor's controls sit under the signed-in doctor's own dashboard and are
 * guarded on the router, like the rest of /api/doctor. The board is deliberately
 * open: it is a screen on a wall with no keyboard, and its only credential is
 * the signed link in its own URL.
 */

export const queueRouter = Router();

queueRouter.use(requireAuth, requireRole('doctor'));

queueRouter.get('/', validate({ query: queueDaySchema }), controller.getQueue);
queueRouter.get('/board-link', controller.boardLink);

queueRouter.post('/call-next', validate({ query: queueDaySchema }), controller.callNext);

// Ownership is not checked by these guards. It is checked in the service, which
// compares the appointment's own doctor with the signed-in one — a role guard
// alone would let one doctor call another's patient in by changing this id.
queueRouter.post(
  '/:id/check-in',
  validate({ params: appointmentParamSchema }),
  controller.checkIn,
);
queueRouter.post(
  '/:id/complete',
  validate({ params: appointmentParamSchema }),
  controller.complete,
);
queueRouter.post('/:id/no-show', validate({ params: appointmentParamSchema }), controller.noShow);

/** The public waiting-room board, mounted at /api/board. */
export const boardRouter = Router();

boardRouter.get(
  '/:doctorId',
  validate({ params: boardParamSchema, query: boardQuerySchema }),
  controller.board,
);
