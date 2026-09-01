import type { Request, RequestHandler } from 'express';
import * as doctorService from './doctor.service.js';
import type { PublicDoctorQuery } from './doctor.schema.js';

/** The HTTP layer for the doctor catalogue. Rules live in the service. */

/** Express 5 types a route parameter as `string | string[]`; the schema narrowed it. */
function idParam(req: Request): string {
  return String(req.params.id);
}

export const list: RequestHandler = async (req, res) => {
  const doctors = await doctorService.listPublic(req.query as unknown as PublicDoctorQuery);
  res.json({ doctors });
};

export const detail: RequestHandler = async (req, res) => {
  res.json({ doctor: await doctorService.getPublic(idParam(req)) });
};
