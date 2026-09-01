import type { PipelineStage } from 'mongoose';
import { Types } from 'mongoose';
import type { DoctorEarningsDto, DoctorProfileDto, PublicDoctorDto } from '@shared/types.js';
import { AppointmentModel, DoctorModel, UserModel } from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { endOfDayUtc, startOfDayUtc, startOfMonthUtc } from '../../utils/dates.js';
import {
  cancelAppointment,
  completeAppointment,
  listAppointments as listAll,
  startConsult,
  type AppointmentPage,
  type Page,
} from '../appointments/appointment.service.js';
import { toDoctorProfileDto } from './doctor.mapper.js';
import type {
  AppointmentWhen,
  PublicDoctorQuery,
  UpdateProfileInput,
} from './doctor.schema.js';

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

/* -------------------------------------------------------- appointments --- */

/**
 * The signed-in doctor's own appointments.
 *
 * The `doctorId` in the filter is their own, read from their record rather than
 * from anything in the request, so there is no id to tamper with. The scope is
 * a named slice rather than a free date range because those are the three
 * questions a doctor actually asks: what is left today, what is coming, and what
 * has been.
 */
export async function listOwnAppointments(
  userId: string,
  when: AppointmentWhen,
  page: Page,
): Promise<AppointmentPage> {
  const doctor = await DoctorModel.findOne({ userId }).select('_id');
  if (!doctor) throw ApiError.notFound('Your doctor profile is missing.');

  const now = new Date();
  const filter = { doctorId: String(doctor._id) };

  if (when === 'today') {
    return listAll(
      { ...filter, from: startOfDayUtc(now), to: endOfDayUtc(now) },
      { ...page, order: 'soonest' },
    );
  }

  if (when === 'upcoming') {
    // From the start of today, not from this instant: a doctor running late
    // still needs to see the ten o'clock patient at ten past ten.
    return listAll({ ...filter, from: startOfDayUtc(now) }, { ...page, order: 'soonest' });
  }

  if (when === 'past') {
    return listAll({ ...filter, to: startOfDayUtc(now) }, page);
  }

  return listAll(filter, page);
}

/**
 * A doctor's three actions on an appointment.
 *
 * Re-exported rather than reimplemented: who may cancel what, and what
 * completing does to a cash payment, are the same rules the admin panel obeys
 * and they live in the shared appointment service. The doctor's `Actor` says
 * `role: 'doctor'`, and that service looks up their own `Doctor` id and compares
 * it — so a doctor putting another doctor's appointment id in the URL is refused
 * there, not here.
 */
export { cancelAppointment, completeAppointment, startConsult };

/* ------------------------------------------------------------ earnings --- */

/** The raw shape the earnings aggregation returns, before it is tidied up. */
interface EarningsFacets {
  overall: { total: number; appointments: number }[];
  month: { total: number }[];
  patients: { n: number }[];
}

/**
 * What this doctor has earned.
 *
 * Completed *and* paid, both. Completed alone would count a consult the patient
 * walked out of without paying; paid alone would count a card payment for a
 * booking that was later cancelled and refunded. Neither is money the doctor has
 * earned.
 *
 * The amount comes from the appointment's own `amount`, frozen at booking time,
 * not from the doctor's current fee — otherwise raising the fee today would
 * silently rewrite what every past consult was worth.
 */
export async function earnings(userId: string): Promise<DoctorEarningsDto> {
  const doctor = await DoctorModel.findOne({ userId }).select('_id');
  if (!doctor) throw ApiError.notFound('Your doctor profile is missing.');

  const [facets] = await AppointmentModel.aggregate<EarningsFacets>([
    { $match: { doctorId: doctor._id, status: 'completed', 'payment.status': 'paid' } },
    {
      $facet: {
        overall: [
          { $group: { _id: null, total: { $sum: '$amount' }, appointments: { $sum: 1 } } },
        ],
        month: [
          { $match: { slotStart: { $gte: startOfMonthUtc() } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],
        // Distinct people, not consults: someone seen monthly all year is one
        // patient. Grouping by id first is what makes that true.
        patients: [{ $group: { _id: '$patientId' } }, { $count: 'n' }],
      },
    },
  ]);

  return {
    total: facets?.overall[0]?.total ?? 0,
    thisMonth: facets?.month[0]?.total ?? 0,
    appointments: facets?.overall[0]?.appointments ?? 0,
    patients: facets?.patients[0]?.n ?? 0,
  };
}

/* ------------------------------------------------------ public catalogue --- */

/**
 * The stages that turn a `Doctor` into what a visitor may see.
 *
 * Written once and shared by the list and the detail page. Two copies of a
 * projection is how a field ends up public on one route and not the other —
 * which for `email` would be exactly the leak this projection exists to
 * prevent.
 */
function publicStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'account',
        pipeline: [{ $project: { name: 1, image: 1, isActive: 1 } }],
      },
    },
    { $unwind: '$account' },
    // A deactivated doctor keeps their history but must never be bookable.
    { $match: { 'account.isActive': true } },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: '$account.name',
        image: '$account.image',
        speciality: 1,
        degree: 1,
        experience: 1,
        about: 1,
        fees: 1,
        address: 1,
        available: 1,
        slotDurationMins: 1,
      },
    },
  ];
}

/**
 * The doctors a visitor can browse and book.
 *
 * The email address is never projected: it is a doctor's login, and a public
 * list of staff logins is the first half of a password-stuffing run. A patient
 * choosing a dermatologist has no use for it.
 *
 * `available: false` is *not* filtered out. A doctor not currently taking
 * bookings still has a page worth reading, and their slot list simply comes back
 * empty. Hiding them entirely would make a patient think the clinic had lost
 * their doctor.
 */
export async function listPublic(query: PublicDoctorQuery): Promise<PublicDoctorDto[]> {
  const search = query.search
    ? // Escaped, so punctuation in the term stays literal, and unanchored so it
      // matches anywhere. Deliberately not searched over email, unlike the
      // admin's list: the field is not returned, and searching it would leak it
      // by inference.
      [
        {
          $match: {
            $or: [
              { name: new RegExp(escapeRegExp(query.search), 'i') },
              { speciality: new RegExp(escapeRegExp(query.search), 'i') },
              { degree: new RegExp(escapeRegExp(query.search), 'i') },
            ],
          },
        },
      ]
    : [];

  return DoctorModel.aggregate<PublicDoctorDto>([
    ...(query.speciality ? [{ $match: { speciality: query.speciality } }] : []),
    ...publicStages(),
    // After the projection, so `name` is the account's name rather than a field
    // the doctor document does not have.
    ...search,
    // Available first, then by name: a patient scanning the list should meet the
    // bookable doctors before the ones who are not taking anyone.
    { $sort: { available: -1, name: 1 } },
  ]);
}

/**
 * One doctor's public page.
 *
 * A deactivated doctor is a 404 rather than a 403: answering "that doctor exists
 * but you may not see them" tells an anonymous visitor which ids are real, and
 * there is nothing here to be granted access to anyway.
 */
export async function getPublic(id: string): Promise<PublicDoctorDto> {
  const [doctor] = await DoctorModel.aggregate<PublicDoctorDto>([
    { $match: { _id: new Types.ObjectId(id) } },
    ...publicStages(),
  ]);

  if (!doctor) throw ApiError.notFound('No doctor with that id.');
  return doctor;
}

/** Regex-escapes a search term so punctuation in it stays literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
