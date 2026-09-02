import type { TriageDto } from '@shared/types.js';
import { TriageAssessmentModel, type TriageAssessmentDocument } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { assessWithRules, emergencyAdviceFor } from '../../providers/ai/rules.js';
import type { AssessInput } from './triage.schema.js';

/**
 * Symptom triage.
 *
 * Two things happen here and the order matters: the assessment is produced, and
 * then it is written down. It is persisted rather than computed on demand
 * because the doctor reads the note before the consult, and because an urgency
 * call that led to a booking should still be readable afterwards — including
 * when the engine that made it has since been changed.
 */

/** The shape every surface sees. Never the raw document. */
export function toTriageDto(assessment: TriageAssessmentDocument): TriageDto {
  return {
    id: String(assessment._id),
    urgency: assessment.urgency,
    recommendedSpeciality: assessment.recommendedSpeciality ?? undefined,
    intakeNote: assessment.intakeNote,
    questionsToAsk: assessment.questionsToAsk ?? [],
    emergencyAdvice:
      assessment.urgency === 'emergency'
        ? emergencyAdviceFor(assessment.structured?.redFlags ?? [])
        : undefined,
    structured: {
      durationText: assessment.structured?.durationText ?? undefined,
      severity: assessment.structured?.severity ?? undefined,
      redFlags: assessment.structured?.redFlags ?? [],
    },
    source: assessment.source,
    createdAt: assessment.createdAt.toISOString(),
  };
}

/** Assesses what the patient wrote and keeps the result. */
export async function assess(input: AssessInput, patientId: string): Promise<TriageDto> {
  const result = assessWithRules(input);

  const assessment = await TriageAssessmentModel.create({
    patientId,
    symptomsText: input.symptomsText,
    structured: result.structured,
    urgency: result.urgency,
    recommendedSpeciality: result.recommendedSpeciality,
    intakeNote: result.intakeNote,
    questionsToAsk: result.questionsToAsk,
    source: 'rules',
  });

  return toTriageDto(assessment);
}

/**
 * One of the patient's own assessments.
 *
 * Ownership, not just the role: an assessment is the most personal thing this
 * app stores, and a patient id in the URL must never be enough to read someone
 * else's. A stranger's id is a 404 rather than a 403, so the endpoint does not
 * confirm that an assessment exists to someone who cannot see it.
 */
export async function getOwn(id: string, patientId: string): Promise<TriageDto> {
  const assessment = await TriageAssessmentModel.findById(id);
  if (!assessment || String(assessment.patientId) !== patientId) {
    throw ApiError.notFound('That assessment could not be found.');
  }
  return toTriageDto(assessment);
}
