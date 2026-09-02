import type { Gender, PatientProfileDto, Role } from '@shared/types.js';
import { UserModel, type UserDocument } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import type { UpdatePatientInput } from './patient.schema.js';

/**
 * A patient's own account details.
 *
 * Like the doctor's module, no id appears anywhere here. The account acted on is
 * always the one the verified token belongs to, so ownership is a property of
 * the query rather than a check that could be forgotten.
 */

function toPatientProfileDto(user: UserDocument): PatientProfileDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role as Role,
    ...(user.phone ? { phone: user.phone } : {}),
    ...(user.image ? { image: user.image } : {}),
    // Date only. The time is midnight UTC because none was ever given, and
    // sending it would invite a client to render a birthday an hour out.
    ...(user.dob ? { dob: user.dob.toISOString().slice(0, 10) } : {}),
    ...(user.gender ? { gender: user.gender as Gender } : {}),
  };
}

export async function getProfile(userId: string): Promise<PatientProfileDto> {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();
  return toPatientProfileDto(user);
}

/**
 * Updates the signed-in patient's own details. Only the fields the request
 * names are touched, so changing a phone number cannot blank a date of birth by
 * omission.
 */
export async function updateProfile(
  userId: string,
  input: UpdatePatientInput,
  image?: string,
): Promise<PatientProfileDto> {
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.unauthorized();

  if (input.name !== undefined) user.name = input.name;

  // The optional fields take an empty string as "clear it", and unset rather
  // than store a blank — an absent field and a field holding '' would otherwise
  // read differently everywhere downstream for no reason.
  if (input.phone !== undefined) user.set('phone', input.phone === '' ? undefined : input.phone);
  if (input.gender !== undefined) user.set('gender', input.gender === '' ? undefined : input.gender);
  // Parsed as midnight UTC, matching how every other date in the system is read.
  if (input.dob !== undefined) {
    user.set('dob', input.dob === '' ? undefined : new Date(`${input.dob}T00:00:00.000Z`));
  }
  if (image) user.image = image;

  await user.save();
  return toPatientProfileDto(user);
}
