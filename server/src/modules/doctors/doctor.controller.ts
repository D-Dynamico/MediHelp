import type { RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as doctorService from './doctor.service.js';
import type { AppointmentScope, UpdateProfileInput } from './doctor.schema.js';

/** The HTTP layer for the doctor's own dashboard. Rules live in the service. */

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
