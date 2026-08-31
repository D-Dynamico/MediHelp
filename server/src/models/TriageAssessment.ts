import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SPECIALITIES, URGENCIES } from '@shared/types.js';

/**
 * One symptom assessment. Persisted rather than computed on the fly for two
 * reasons: the doctor reads the intake note before the consult, and an urgency
 * call that led to a booking should still be readable afterwards.
 */
const triageAssessmentSchema = new Schema(
  {
    patientId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    symptomsText: { type: String, required: true, maxlength: 4000 },

    structured: {
      durationText: { type: String },
      severity: { type: String, enum: ['mild', 'moderate', 'severe'] },
      /** Matched emergency indicators, e.g. "chest pain with breathlessness". */
      redFlags: { type: [String], default: [] },
    },

    urgency: { type: String, enum: URGENCIES, required: true, index: true },
    /** Absent for an emergency: the answer there is not an appointment. */
    recommendedSpeciality: { type: String, enum: SPECIALITIES },
    /** Plain-language summary the doctor sees on the appointment row. */
    intakeNote: { type: String, required: true, maxlength: 2000 },
    questionsToAsk: { type: [String], default: [] },

    /** Which engine produced this. `rules` is the offline default and the fallback. */
    source: { type: String, enum: ['rules', 'llm'], required: true },
    modelUsed: { type: String },
  },
  { timestamps: true },
);

export type TriageAssessment = InferSchemaType<typeof triageAssessmentSchema>;
export type TriageAssessmentDocument = HydratedDocument<TriageAssessment>;

export const TriageAssessmentModel = model<TriageAssessment>(
  'TriageAssessment',
  triageAssessmentSchema,
);
