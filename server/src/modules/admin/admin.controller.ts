import type { RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as adminService from './admin.service.js';
import type { CreateDoctorInput } from './admin.schema.js';

/** The HTTP layer for the admin panel. Rules live in the service. */

export const dashboard: RequestHandler = async (_req, res) => {
  res.json(await adminService.dashboard());
};

export const createDoctor: RequestHandler = async (req, res) => {
  const doctor = await adminService.createDoctor(
    req.body as CreateDoctorInput,
    req.uploadedImage?.url,
  );

  // The image now belongs to a doctor, so the error handler must not reclaim it
  // if anything later in this request goes wrong.
  delete req.uploadedImage;

  await audit(req, 'doctor.create', { type: 'Doctor', id: doctor.id }, { email: doctor.email });
  res.status(201).json({ doctor });
};
