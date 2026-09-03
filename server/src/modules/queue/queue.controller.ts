import type { Request, RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import { ApiError } from '../../utils/apiError.js';
import { verifyBoardToken } from '../../utils/tokens.js';
import * as queueService from './queue.service.js';
import type { BoardQuery, QueueDayQuery } from './queue.schema.js';

/** The HTTP layer for the live queue. Rules live in the service. */

/** Express 5 types a route parameter as `string | string[]`; the schema narrowed it. */
function idParam(req: Request): string {
  return String(req.params.id);
}

function dayQuery(req: Request): string | undefined {
  return (req.query as unknown as QueueDayQuery).date;
}

export const getQueue: RequestHandler = async (req, res) => {
  res.json(await queueService.doctorQueue(req.auth!.userId, dayQuery(req)));
};

export const checkIn: RequestHandler = async (req, res) => {
  const queue = await queueService.checkIn(req.auth!.userId, idParam(req));
  await audit(req, 'queue.check_in', { type: 'Appointment', id: idParam(req) });
  res.json(queue);
};

export const callNext: RequestHandler = async (req, res) => {
  const queue = await queueService.callNext(req.auth!.userId, dayQuery(req));
  await audit(req, 'queue.call_next', { type: 'Doctor', id: queue.snapshot.doctorId }, {
    token: queue.snapshot.currentToken,
  });
  res.json(queue);
};

export const complete: RequestHandler = async (req, res) => {
  const result = await queueService.complete(req.auth!.userId, idParam(req));
  await audit(req, 'appointment.complete', { type: 'Appointment', id: result.appointment.id });
  res.json(result);
};

export const noShow: RequestHandler = async (req, res) => {
  const result = await queueService.noShow(req.auth!.userId, idParam(req));
  await audit(req, 'appointment.no_show', { type: 'Appointment', id: result.appointment.id });
  res.json(result);
};

export const boardLink: RequestHandler = async (req, res) => {
  res.json({ link: await queueService.boardLink(req.auth!.userId) });
};

/**
 * The waiting-room board's read. No session, no cookie — a signed link and
 * nothing else.
 *
 * The doctor id the snapshot is built from comes out of the **token**, and the
 * one in the path is only checked against it. Reading the path instead would
 * turn a single valid link into a key to every doctor's queue.
 */
export const board: RequestHandler = async (req, res) => {
  const { t } = req.query as unknown as BoardQuery;
  const { doctorId } = verifyBoardToken(t);

  if (doctorId !== String(req.params.doctorId)) {
    throw ApiError.unauthorized('That board link is not valid any more.');
  }

  res.json({ snapshot: await queueService.boardSnapshot(doctorId) });
};
