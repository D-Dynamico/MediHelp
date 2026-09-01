import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  appointmentIdParamSchema,
  bookingSchema,
  myAppointmentsSchema,
} from './appointment.schema.js';
import * as controller from './appointment.controller.js';

/**
 * A patient's own appointments, mounted at /api/appointments.
 *
 * Booking is restricted to the patient role rather than to anyone signed in.
 * A doctor or an admin booking themselves in as a patient would produce an
 * appointment whose `patientId` points at a doctor account, which every list in
 * the app would then have to know how to render. If staff need an appointment,
 * they get a patient account like anyone else.
 */
export const appointmentRouter = Router();

appointmentRouter.use(requireAuth);

appointmentRouter.post(
  '/',
  requireRole('patient'),
  validate({ body: bookingSchema }),
  controller.book,
);

appointmentRouter.get(
  '/mine',
  requireRole('patient'),
  validate({ query: myAppointmentsSchema }),
  controller.mine,
);

/**
 * Cancelling is open to any signed-in role, because the shared appointment
 * service is what decides: a patient may cancel their own, a doctor theirs, an
 * admin anyone's. Ownership is checked there against the verified token, so
 * putting someone else's id in this URL gets nowhere.
 */
appointmentRouter.patch(
  '/:id/cancel',
  validate({ params: appointmentIdParamSchema }),
  controller.cancel,
);
