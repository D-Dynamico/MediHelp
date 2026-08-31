import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  APPOINTMENT_STATUSES,
  PAYMENT_MODES,
  PAYMENT_STATUSES,
  ROLES,
  SPECIALITIES,
} from '@shared/types.js';

/**
 * A booked consult. This is the busiest collection and the one where a race can
 * actually hurt, so the "one active appointment per doctor per slot" rule is
 * enforced by a unique index rather than by an availability check in code.
 */

const appointmentSchema = new Schema(
  {
    patientId: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    doctorId: { type: Types.ObjectId, ref: 'Doctor', required: true, index: true },

    slotStart: { type: Date, required: true },
    slotEnd: { type: Date, required: true },

    /** Sequential per doctor per day. Allocated with the appointment itself. */
    tokenNumber: { type: Number, required: true, min: 1 },

    status: {
      type: String,
      enum: APPOINTMENT_STATUSES,
      default: 'booked',
      required: true,
      index: true,
    },
    cancelledBy: { type: String, enum: ROLES },
    cancelledAt: { type: Date },

    /** Charged amount in rupees, copied from the doctor at booking time. */
    amount: { type: Number, required: true, min: 0 },

    payment: {
      mode: { type: String, enum: PAYMENT_MODES, required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', required: true },
      orderId: { type: String },
      paymentId: { type: String },
    },

    triageId: { type: Types.ObjectId, ref: 'TriageAssessment' },

    /**
     * Fee and speciality frozen at booking time. Without this, a doctor raising
     * their fee would rewrite the price of every past appointment in any view
     * that reads the fee through a populate.
     */
    docSnapshot: {
      name: { type: String, required: true },
      speciality: { type: String, enum: SPECIALITIES, required: true },
      fees: { type: Number, required: true, min: 0 },
      image: { type: String },
    },

    consultStartedAt: { type: Date },
    consultEndedAt: { type: Date },
  },
  { timestamps: true },
);

/**
 * The rule that prevents double booking. Partial, so cancelled and no-show
 * appointments release the slot instead of blocking it forever — two concurrent
 * bookings for one slot means one write fails with a duplicate key error, which
 * the booking service turns into a 409.
 *
 * `$in` inside a partialFilterExpression needs MongoDB 6.0 or later; Atlas free
 * clusters are well past that.
 */
appointmentSchema.index(
  { doctorId: 1, slotStart: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [...ACTIVE_APPOINTMENT_STATUSES] } },
    name: 'one_active_appointment_per_slot',
  },
);

// The patient's own list, newest first.
appointmentSchema.index({ patientId: 1, slotStart: -1 });
// A doctor's day, and the queue's ordering within it.
appointmentSchema.index({ doctorId: 1, slotStart: 1, status: 1 });

export type Appointment = InferSchemaType<typeof appointmentSchema>;
export type AppointmentDocument = HydratedDocument<Appointment>;

export const AppointmentModel = model<Appointment>('Appointment', appointmentSchema);
