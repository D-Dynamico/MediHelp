import type { Request, RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as doctorService from './doctor.service.js';
import type { AppointmentScope, UpdateProfileInput } from './doctor.schema.js';

/** The HTTP layer for the doctor's own dashboard. Rules live in the service. */

/** Express 5 types a route parameter as `string | string[]`; the schema has already narrowed it. */
function idParam(req: Request): string {
  return String(req.params.id);
}

export const getProfile: RequestHandler = async (req, res) => {
  res.json({ profile: await doctorService.getProfile(req.auth!.userId) });
};

export const updateProfile: RequestHandler = async (req, res) => {
  const profile = await doctorService.updateProfile(
    req.auth!.userId,
    req.body as UpdateProfileInput,
    req.uploadedImage?.url,
  );

  // The image belongs to the profile now; the error handler must not reclaim it.
  delete req.uploadedImage;

  await audit(req, 'doctor.profile.update', { type: 'Doctor', id: profile.id }, {
    fields: Object.keys(req.body as object),
  });
  res.json({ profile });
};

export const listAppointments: RequestHandler = async (req, res) => {
  const { when, page, pageSize } = req.query as unknown as AppointmentScope;
  res.json(await doctorService.listOwnAppointments(req.auth!.userId, when, { page, pageSize }));
};

export const startConsult: RequestHandler = async (req, res) => {
  const appointment = await doctorService.startConsult(idParam(req), req.auth!);
  await audit(req, 'appointment.start', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};

export const completeAppointment: RequestHandler = async (req, res) => {
  const appointment = await doctorService.completeAppointment(idParam(req), req.auth!);
  await audit(req, 'appointment.complete', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};

export const cancelAppointment: RequestHandler = async (req, res) => {
  const appointment = await doctorService.cancelAppointment(idParam(req), req.auth!);
  await audit(req, 'appointment.cancel', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};

export const earnings: RequestHandler = async (req, res) => {
  res.json(await doctorService.earnings(req.auth!.userId));
};
