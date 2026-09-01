import type { Request, RequestHandler } from 'express';
import * as doctorService from './doctor.service.js';
import { startOfDayUtc } from '../../utils/dates.js';
import type { PublicDoctorQuery, SlotQuery } from './doctor.schema.js';

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

/**
 * The free slots on a day. Defaults to today when no date is given, which is
 * what a patient opening a doctor's page is asking about.
 *
 * The date is read as a plain calendar day in UTC — `new Date('2026-09-15')`
 * parses as midnight UTC, which is exactly the day boundary the rest of the
 * system uses.
 */
export const slots: RequestHandler = async (req, res) => {
  const { date } = req.query as unknown as SlotQuery;
  const day = date ? new Date(`${date}T00:00:00.000Z`) : startOfDayUtc();

  res.json({ date: day.toISOString().slice(0, 10), slots: await doctorService.slotsOn(idParam(req), day) });
};
