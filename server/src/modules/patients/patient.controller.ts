import type { RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as service from './patient.service.js';
import type { UpdatePatientInput } from './patient.schema.js';

/** The HTTP layer for a patient's own account. Rules live in the service. */

export const getProfile: RequestHandler = async (req, res) => {
  res.json({ profile: await service.getProfile(req.auth!.userId) });
};

export const updateProfile: RequestHandler = async (req, res) => {
  const profile = await service.updateProfile(
    req.auth!.userId,
    req.body as UpdatePatientInput,
    req.uploadedImage?.url,
  );

  // The image belongs to the account now; the error handler must not reclaim it.
  delete req.uploadedImage;

  await audit(req, 'patient.profile.update', { type: 'User', id: profile.id }, {
    fields: Object.keys(req.body as object),
  });
  res.json({ profile });
};
