import type { Request, RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import { startOfDayUtc } from '../../utils/dates.js';
import * as service from './appointment.service.js';
import type { BookingInput, MyAppointmentsQuery } from './appointment.schema.js';

/** The HTTP layer for a patient's own appointments. Rules live in the service. */

/** Express 5 types a route parameter as `string | string[]`; the schema narrowed it. */
function idParam(req: Request): string {
  return String(req.params.id);
}

export const book: RequestHandler = async (req, res) => {
  const input = req.body as BookingInput;

  const appointment = await service.bookAppointment(req.auth!.userId, {
    doctorId: input.doctorId,
    slotStart: input.slotStart,
    mode: input.mode,
    triageId: input.triageId,
  });

  await audit(req, 'appointment.book', { type: 'Appointment', id: appointment.id }, {
    doctorId: input.doctorId,
    slotStart: appointment.slotStart,
  });

  // 201, with the appointment as booked — the token number and the fee in it are
  // the server's, which is the answer the confirmation screen needs.
  res.status(201).json({ appointment });
};

/**
 * The signed-in patient's own appointments.
 *
 * Scoped by their own id from the token, so there is no id in the request for
 * anyone to swap for someone else's.
 */
export const mine: RequestHandler = async (req, res) => {
  const { when, page, pageSize } = req.query as unknown as MyAppointmentsQuery;
  const patientId = req.auth!.userId;
  const today = startOfDayUtc();

  const filter =
    when === 'upcoming'
      ? { patientId, from: today }
      : when === 'past'
        ? { patientId, to: today }
        : { patientId };

  res.json(
    await service.listAppointments(filter, {
      page,
      pageSize,
      // What is still to come reads soonest-first; history reads newest-first.
      order: when === 'upcoming' ? 'soonest' : 'newest',
    }),
  );
};

export const cancel: RequestHandler = async (req, res) => {
  const appointment = await service.cancelAppointment(idParam(req), req.auth!);
  await audit(req, 'appointment.cancel', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};
