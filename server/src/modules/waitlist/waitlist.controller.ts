import type { Request, RequestHandler } from 'express';
import * as waitlistService from './waitlist.service.js';
import type { ClaimInput, JoinWaitlistInput } from './waitlist.schema.js';

/** The HTTP layer for the waitlist. Rules live in the service. */

/** Express 5 types a route parameter as `string | string[]`; the schema narrowed it. */
function idParam(req: Request): string {
  return String(req.params.id);
}

export const join: RequestHandler = async (req, res) => {
  const { doctorId, date } = req.body as JoinWaitlistInput;
  res.status(201).json({ entry: await waitlistService.joinWaitlist(req.auth!.userId, doctorId, date) });
};

export const listMine: RequestHandler = async (req, res) => {
  res.json({ entries: await waitlistService.listMine(req.auth!.userId) });
};

export const withdraw: RequestHandler = async (req, res) => {
  res.json({ entry: await waitlistService.withdraw(req.auth!.userId, idParam(req)) });
};

export const claim: RequestHandler = async (req, res) => {
  const { mode } = req.body as ClaimInput;
  res.status(201).json(await waitlistService.claim(req.auth!.userId, idParam(req), mode));
};
