import type { DoctorProfileDto } from '@shared/types.js';
import { DoctorModel, UserModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { toDoctorProfileDto } from './doctor.mapper.js';
import type { UpdateProfileInput } from './doctor.schema.js';

/**
 * What a doctor may do to their own record.
 *
 * Note there is no id anywhere in this module's routes. The doctor being acted
 * on is always the one the verified token belongs to, looked up by `userId`, so
 * there is no id for anyone to swap for someone else's — ownership is a property
 * of the query rather than a check bolted on after it.
 */

/** The signed-in doctor's own record, with the account it belongs to. */
async function own(userId: string) {
  const doctor = await DoctorModel.findOne({ userId });
  if (!doctor) {
    // A doctor account with no profile should be impossible — they are written
    // together in one transaction (see the admin service). If it happens, it is
    // a bug worth a clear message rather than a null dereference downstream.
    throw ApiError.notFound('Your doctor profile is missing. Ask an admin to check the account.');
  }

  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();

  return { doctor, user };
}

export async function getProfile(userId: string): Promise<DoctorProfileDto> {
  const { doctor, user } = await own(userId);
  return toDoctorProfileDto(doctor, user);
}

/**
 * Updates the signed-in doctor's profile. Only the fields the request names are
 * touched, so changing a fee cannot blank an address by omission.
 */
export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
  image?: string,
): Promise<DoctorProfileDto> {
  const { doctor, user } = await own(userId);

  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone;
  if (image) user.image = image;

  if (input.about !== undefined) doctor.about = input.about;
  if (input.fees !== undefined) doctor.fees = input.fees;
  if (input.available !== undefined) doctor.available = input.available;
  if (input.slotDurationMins !== undefined) doctor.slotDurationMins = input.slotDurationMins;

  if (input.addressLine1 !== undefined || input.addressLine2 !== undefined) {
    doctor.address = {
      line1: input.addressLine1 ?? doctor.address?.line1 ?? '',
      line2: input.addressLine2 ?? doctor.address?.line2,
    };
  }

  if (input.workingHours !== undefined) {
    // `set()` rather than assignment: the field is a Mongoose document array,
    // not a plain one, and handing it plain objects is what the path form is for.
    doctor.set('workingHours', input.workingHours);
  }

  await Promise.all([user.save(), doctor.save()]);
  return toDoctorProfileDto(doctor, user);
}
