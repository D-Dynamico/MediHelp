import type { Types } from 'mongoose';
import type { AppointmentDto, AppointmentStatus, PaymentMode, PaymentStatus, Speciality, Urgency } from '@shared/types.js';
import { ageFrom } from '../../utils/dates.js';

/**
 * Turning an appointment into the shape the client reads.
 *
 * Every list in the app — the admin's table, the doctor's day, the patient's
 * history — shows the same card, so they all come through here. The doctor's
 * name and speciality are read from `docSnapshot`, never from a join: the
 * snapshot is what the appointment was actually booked at, and joining would
 * quietly rewrite history the next time a doctor edits their profile.
 *
 * The patient is the one side that does need a join, because a name is not
 * worth freezing — people correct their spelling and expect to see the fix.
 */

/** Attaches the patient to each appointment row. Use inside an aggregation. */
export const patientLookupStages = [
  {
    $lookup: {
      from: 'users',
      localField: 'patientId',
      foreignField: '_id',
      as: 'patient',
      pipeline: [{ $project: { name: 1, image: 1, dob: 1 } }],
    },
  },
  // A deleted patient must not make their appointment vanish from the admin's
  // table — the row is still part of the clinic's history.
  { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
];

/** An appointment as it comes back from an aggregation with the stages above. */
export interface AppointmentRow {
  _id: Types.ObjectId;
  doctorId: Types.ObjectId;
  slotStart: Date;
  slotEnd: Date;
  tokenNumber: number;
  status: AppointmentStatus;
  amount: number;
  payment: { mode: PaymentMode; status: PaymentStatus };
  docSnapshot: { name: string; speciality: Speciality; fees: number; image?: string };
  patient?: { _id: Types.ObjectId; name: string; image?: string; dob?: Date } | undefined;
  urgency?: Urgency | undefined;
}

export function toAppointmentDto(row: AppointmentRow): AppointmentDto {
  const age = ageFrom(row.patient?.dob);

  return {
    id: String(row._id),
    patient: {
      // A removed patient still leaves a readable row rather than a blank one.
      id: row.patient ? String(row.patient._id) : '',
      name: row.patient?.name ?? 'Deleted patient',
      ...(row.patient?.image ? { image: row.patient.image } : {}),
      ...(age === undefined ? {} : { age }),
    },
    doctor: {
      id: String(row.doctorId),
      name: row.docSnapshot.name,
      speciality: row.docSnapshot.speciality,
      ...(row.docSnapshot.image ? { image: row.docSnapshot.image } : {}),
    },
    slotStart: row.slotStart.toISOString(),
    slotEnd: row.slotEnd.toISOString(),
    tokenNumber: row.tokenNumber,
    status: row.status,
    amount: row.amount,
    payment: { mode: row.payment.mode, status: row.payment.status },
    ...(row.urgency ? { urgency: row.urgency } : {}),
  };
}
