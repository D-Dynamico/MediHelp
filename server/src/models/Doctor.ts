import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { SPECIALITIES } from '@shared/types.js';

/**
 * A doctor's professional profile. Identity and login live on the linked `User`,
 * so this holds only what makes them a doctor: speciality, fees, availability.
 */

/** Consult length used for a doctor who has not set one. */
export const DEFAULT_SLOT_MINUTES = 30;
/** Starting estimate before a doctor has completed any consults. */
export const DEFAULT_MEDIAN_CONSULT_MINUTES = 15;

/** 0 = Sunday, matching JavaScript's `Date.getDay()`. */
const workingHoursSchema = new Schema(
  {
    day: { type: Number, required: true, min: 0, max: 6 },
    /** "HH:mm", 24-hour, in the clinic's local time. */
    start: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    end: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
  },
  { _id: false },
);

const doctorSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: 'User', required: true, unique: true },

    speciality: { type: String, enum: SPECIALITIES, required: true, index: true },
    degree: { type: String, required: true, trim: true },
    experience: { type: Number, required: true, min: 0, max: 70 },
    about: { type: String, required: true, maxlength: 2000 },

    /** In rupees. The booking service reads the fee from here, never from the client. */
    fees: { type: Number, required: true, min: 0 },

    address: {
      line1: { type: String, required: true, trim: true },
      line2: { type: String, trim: true },
    },

    /** The doctor's own switch for taking new bookings. */
    available: { type: Boolean, default: true, index: true },
    slotDurationMins: { type: Number, default: DEFAULT_SLOT_MINUTES, min: 5, max: 120 },
    workingHours: { type: [workingHoursSchema], default: [] },

    rating: { type: Number, min: 0, max: 5 },

    /**
     * Rolling median of the last completed consults, kept up to date on each
     * completion. Drives the queue's wait estimate, so it is stored rather than
     * recomputed on every socket update.
     */
    medianConsultMins: { type: Number, default: DEFAULT_MEDIAN_CONSULT_MINUTES, min: 1 },
  },
  { timestamps: true },
);

// The public doctor list filters on speciality and availability together.
doctorSchema.index({ speciality: 1, available: 1 });

export type WorkingHours = InferSchemaType<typeof workingHoursSchema>;
export type Doctor = InferSchemaType<typeof doctorSchema>;
export type DoctorDocument = HydratedDocument<Doctor>;

export const DoctorModel = model<Doctor>('Doctor', doctorSchema);
