import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import { WAITLIST_STATES } from '@shared/types.js';

/**
 * Someone waiting for a slot on a full day. When an appointment is cancelled the
 * freed slot is offered to the first `waiting` entry, with a claim window.
 */

/** How long an offered slot is held before it passes to the next person. */
export const OFFER_WINDOW_MS = 10 * 60 * 1000;

const waitlistSchema = new Schema(
  {
    doctorId: { type: Types.ObjectId, ref: 'Doctor', required: true },
    patientId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    /** The day being waited for, at midnight UTC. */
    date: { type: Date, required: true },
    /** Optional "mornings only" style preference: "HH:mm" bounds. */
    preferredWindow: {
      from: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      to: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },

    position: { type: Number, required: true, min: 1 },
    state: { type: String, enum: WAITLIST_STATES, default: 'waiting', required: true },

    offeredAt: { type: Date },
    /**
     * When the offer lapses. Checked against the clock at claim time, so an
     * expired offer is refused even if the sweeper has not run yet — which
     * matters on a host that sleeps.
     */
    offerExpiresAt: { type: Date },
    offeredSlot: {
      start: { type: Date },
      end: { type: Date },
    },
  },
  { timestamps: true },
);

// Ordered offers: the first waiting entry for a doctor on a day.
waitlistSchema.index({ doctorId: 1, date: 1, position: 1 });
// The sweeper's query: offers that have lapsed.
waitlistSchema.index({ state: 1, offerExpiresAt: 1 });
// One active entry per patient per doctor per day.
waitlistSchema.index(
  { doctorId: 1, date: 1, patientId: 1 },
  {
    unique: true,
    partialFilterExpression: { state: { $in: ['waiting', 'offered'] } },
    name: 'one_active_waitlist_entry_per_patient',
  },
);

export type Waitlist = InferSchemaType<typeof waitlistSchema>;
export type WaitlistDocument = HydratedDocument<Waitlist>;

export const WaitlistModel = model<Waitlist>('Waitlist', waitlistSchema);
