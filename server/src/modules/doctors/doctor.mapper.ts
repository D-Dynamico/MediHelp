import type { DoctorDto, DoctorProfileDto, Speciality } from '@shared/types.js';
import type { DoctorDocument, UserDocument } from '../../models/index.js';

/**
 * A doctor as the client reads them: the professional profile and the identity
 * fields joined back together.
 *
 * `id` is the `Doctor`'s id, not the `User`'s. That is what an appointment
 * points at and what the public doctor page is addressed by; the `User` id is
 * an implementation detail of logging in and never leaves the server.
 */
export function toDoctorDto(doctor: DoctorDocument, user: UserDocument): DoctorDto {
  // Mongoose infers a nested object as optional even when its fields are
  // required, so the compiler cannot see that the schema already guarantees
  // this. The fallback is unreachable, not a real case to handle.
  const address = doctor.address ?? { line1: '' };

  return {
    id: String(doctor._id),
    name: user.name,
    email: user.email,
    ...(user.image ? { image: user.image } : {}),
    speciality: doctor.speciality as Speciality,
    degree: doctor.degree,
    experience: doctor.experience,
    about: doctor.about,
    fees: doctor.fees,
    address: {
      line1: address.line1,
      ...(address.line2 ? { line2: address.line2 } : {}),
    },
    available: doctor.available,
    slotDurationMins: doctor.slotDurationMins,
  };
}

/**
 * The same doctor, plus the parts only they need to see: their phone number,
 * the hours they work, and the consult length the queue's estimate is built
 * from. None of these belong on the public listing.
 */
export function toDoctorProfileDto(
  doctor: DoctorDocument,
  user: UserDocument,
): DoctorProfileDto {
  return {
    ...toDoctorDto(doctor, user),
    ...(user.phone ? { phone: user.phone } : {}),
    workingHours: (doctor.workingHours ?? []).map((entry) => ({
      day: entry.day,
      start: entry.start,
      end: entry.end,
    })),
    medianConsultMins: doctor.medianConsultMins,
  };
}
