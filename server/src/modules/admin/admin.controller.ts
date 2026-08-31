import type { Request, RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as adminService from './admin.service.js';
import type {
  AppointmentListQuery,
  CreateDoctorInput,
  DoctorListQuery,
  UpdateDoctorInput,
} from './admin.schema.js';

/** The HTTP layer for the admin panel. Rules live in the service. */

/**
 * Express 5 types a route parameter as `string | string[]`, because a pattern
 * can capture one more than once. `objectIdParamSchema` has already checked this
 * one is a single 24-character string by the time a handler runs.
 */
function idParam(req: Request): string {
  return String(req.params.id);
}

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

export const listDoctors: RequestHandler = async (req, res) => {
  res.json({ doctors: await adminService.listDoctors(req.query as DoctorListQuery) });
};

export const getDoctor: RequestHandler = async (req, res) => {
  res.json({ doctor: await adminService.getDoctor(idParam(req)) });
};

export const updateDoctor: RequestHandler = async (req, res) => {
  const doctor = await adminService.updateDoctor(
    idParam(req),
    req.body as UpdateDoctorInput,
    req.uploadedImage?.url,
  );
  delete req.uploadedImage;

  await audit(req, 'doctor.update', { type: 'Doctor', id: doctor.id }, {
    fields: Object.keys(req.body as object),
  });
  res.json({ doctor });
};

export const deactivateDoctor: RequestHandler = async (req, res) => {
  const doctor = await adminService.deactivateDoctor(idParam(req));
  await audit(req, 'doctor.deactivate', { type: 'Doctor', id: doctor.id });
  res.json({ doctor });
};

export const listAppointments: RequestHandler = async (req, res) => {
  const { page, pageSize, ...filter } = req.query as unknown as AppointmentListQuery;
  res.json(await adminService.listAppointments(filter, { page, pageSize }));
};

export const cancelAppointment: RequestHandler = async (req, res) => {
  const appointment = await adminService.cancelAppointment(idParam(req), req.auth!);
  await audit(req, 'appointment.cancel', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};

export const completeAppointment: RequestHandler = async (req, res) => {
  const appointment = await adminService.completeAppointment(idParam(req), req.auth!);
  await audit(req, 'appointment.complete', { type: 'Appointment', id: appointment.id });
  res.json({ appointment });
};
