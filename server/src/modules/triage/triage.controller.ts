import type { RequestHandler } from 'express';
import { audit } from '../../middleware/auth.js';
import * as service from './triage.service.js';
import type { AssessInput } from './triage.schema.js';

/** The HTTP layer for symptom triage. Rules live in the service. */

export const assess: RequestHandler = async (req, res) => {
  const triage = await service.assess(req.body as AssessInput, req.auth!.userId);

  // Audited without the symptom text: the audit log is read by admins, and what
  // a patient wrote about their own body is not theirs to browse. The id points
  // at the record for anyone with a reason to open it.
  await audit(req, 'triage.assess', { type: 'TriageAssessment', id: triage.id }, {
    urgency: triage.urgency,
    source: triage.source,
  });

  res.status(201).json({ triage });
};

export const getOne: RequestHandler = async (req, res) => {
  res.json({ triage: await service.getOwn(String(req.params.id), req.auth!.userId) });
};
