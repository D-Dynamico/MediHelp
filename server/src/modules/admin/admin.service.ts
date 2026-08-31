import mongoose from 'mongoose';
import { ACTIVE_APPOINTMENT_STATUSES } from '@shared/types.js';
import type { AdminDashboardDto, AdminDoctorDto, DoctorDto } from '@shared/types.js';
import {
  AppointmentModel,
  DoctorModel,
  UserModel,
  type DoctorDocument,
  type UserDocument,
} from '../../models/index.js';
import { ApiError } from '../../utils/apiError.js';
import { hashPassword } from '../../utils/password.js';
import { endOfDayUtc, startOfDayUtc } from '../../utils/dates.js';
import {
  patientLookupStages,
  toAppointmentDto,
  type AppointmentRow,
} from '../appointments/appointment.mapper.js';
import { toDoctorDto } from '../doctors/doctor.mapper.js';
import { logoutEverywhere } from '../auth/auth.service.js';
import type { CreateDoctorInput, DoctorListQuery, UpdateDoctorInput } from './admin.schema.js';

/** What the admin panel runs on. No HTTP in here. */

/** Still-to-happen statuses: active, minus the ones already finished. */
export const UPCOMING_STATUSES = ACTIVE_APPOINTMENT_STATUSES.filter(
  (status) => status !== 'completed',
);

/** The raw shape the dashboard aggregation returns, before it is tidied up. */
interface DashboardFacets {
  appointments: { n: number }[];
  revenue: { total: number }[];
  todayUpcoming: { n: number }[];
  latest: AppointmentRow[];
  userCounts: { _id: 'doctor' | 'patient'; n: number }[];
}

/**
 * Every number on the dashboard, in one round trip.
 *
 * `$facet` runs the four appointment questions over a single pass of the
 * collection, and the `$lookup` afterwards adds the head-count from `users` —
 * the facet has already collapsed the stream to one document by then, so the
 * lookup runs exactly once rather than per row.
 *
 * The alternative, five separate queries, is five round trips to Atlas for a
 * screen that is loaded on every admin page view.
 */
export async function dashboard(): Promise<AdminDashboardDto> {
  const today = startOfDayUtc();
  const tomorrow = endOfDayUtc();

  const [facets] = await AppointmentModel.aggregate<DashboardFacets>([
    {
      $facet: {
        appointments: [{ $count: 'n' }],

        // Money actually collected. A booked-but-unpaid consult is not revenue.
        revenue: [
          { $match: { 'payment.status': 'paid' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ],

        // Still to happen today: in the day, not cancelled, not already done.
        todayUpcoming: [
          {
            $match: {
              slotStart: { $gte: today, $lt: tomorrow },
              status: { $in: UPCOMING_STATUSES },
            },
          },
          { $count: 'n' },
        ],

        // Newest bookings by when they were made, not by when they are due.
        latest: [{ $sort: { createdAt: -1 } }, { $limit: 5 }, ...patientLookupStages],
      },
    },
    {
      $lookup: {
        from: 'users',
        as: 'userCounts',
        pipeline: [
          // Soft-deleted accounts are excluded: the tiles say how many people
          // the clinic has now, not how many it has ever had.
          { $match: { role: { $in: ['doctor', 'patient'] }, isActive: true } },
          { $group: { _id: '$role', n: { $sum: 1 } } },
        ],
      },
    },
  ]);

  const countOf = (role: 'doctor' | 'patient') =>
    facets?.userCounts.find((entry) => entry._id === role)?.n ?? 0;

  return {
    counts: {
      doctors: countOf('doctor'),
      patients: countOf('patient'),
      appointments: facets?.appointments[0]?.n ?? 0,
    },
    revenue: facets?.revenue[0]?.total ?? 0,
    todayUpcoming: facets?.todayUpcoming[0]?.n ?? 0,
    latestBookings: (facets?.latest ?? []).map(toAppointmentDto),
  };
}

/* ------------------------------------------------------------- doctors --- */

/**
 * Creating a doctor writes two documents: the `User` they log in with and the
 * `Doctor` profile the clinic shows. Either both land or neither does.
 *
 * Without a transaction the failure is not theoretical: a duplicate speciality
 * or a bad fee would leave behind a `User` with the role "doctor" and no
 * profile — an account that can log in, reaches the doctor dashboard, and
 * crashes it, and that also blocks the email from being used to try again.
 */
export async function createDoctor(
  input: CreateDoctorInput,
  image?: string,
): Promise<DoctorDto> {
  // Checked up front so the common mistake gets a clear message rather than a
  // duplicate-key error surfacing from inside an aborted transaction.
  if (await UserModel.exists({ email: input.email })) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  const passwordHash = await hashPassword(input.password);
  const session = await mongoose.startSession();

  try {
    let created: { user: UserDocument; doctor: DoctorDocument } | null = null;

    await session.withTransaction(async () => {
      const [user] = await UserModel.create(
        [
          {
            name: input.name,
            email: input.email,
            passwordHash,
            role: 'doctor',
            ...(input.phone ? { phone: input.phone } : {}),
            ...(image ? { image } : {}),
          },
        ],
        { session },
      );

      const [doctor] = await DoctorModel.create(
        [
          {
            userId: user!._id,
            speciality: input.speciality,
            degree: input.degree,
            experience: input.experience,
            about: input.about,
            fees: input.fees,
            address: {
              line1: input.addressLine1,
              ...(input.addressLine2 ? { line2: input.addressLine2 } : {}),
            },
            available: input.available ?? true,
            ...(input.slotDurationMins ? { slotDurationMins: input.slotDurationMins } : {}),
          },
        ],
        { session },
      );

      created = { user: user!, doctor: doctor! };
    });

    const { user, doctor } = created!;
    return toDoctorDto(doctor, user);
  } finally {
    await session.endSession();
  }
}

/**
 * The admin's doctor list.
 *
 * Driven from `Doctor` with the account joined on, because speciality and
 * availability live here while the name, email and photo live on `User` — and
 * the admin searches by name.
 *
 * Note what this does *not* do: it never puts a client-supplied object into a
 * filter. Every branch below is built from a field the schema already parsed
 * and typed (see docs/SYSTEM_DESIGN.md §3 on why `sanitizeFilter` is off).
 */
export async function listDoctors(query: DoctorListQuery): Promise<AdminDoctorDto[]> {
  const accountMatch: Record<string, unknown> = {};
  if (!query.includeInactive) accountMatch['account.isActive'] = true;

  if (query.search) {
    // Escaped, so a search for "a.b" cannot become a pattern, and anchored at
    // no end so it matches anywhere in the name or address.
    const pattern = new RegExp(escapeRegExp(query.search), 'i');
    accountMatch.$or = [{ 'account.name': pattern }, { 'account.email': pattern }];
  }

  return DoctorModel.aggregate<AdminDoctorDto>([
    ...(query.speciality ? [{ $match: { speciality: query.speciality } }] : []),
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'account',
        pipeline: [{ $project: { name: 1, email: 1, image: 1, isActive: 1, phone: 1 } }],
      },
    },
    { $unwind: '$account' },
    ...(Object.keys(accountMatch).length > 0 ? [{ $match: accountMatch }] : []),
    { $sort: { 'account.name': 1 } },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        name: '$account.name',
        email: '$account.email',
        image: '$account.image',
        phone: '$account.phone',
        isActive: '$account.isActive',
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
  ]);
}

/** Regex-escapes a search term so punctuation in it stays literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Loads a doctor and their account together, or 404s. */
async function loadDoctor(id: string) {
  const doctor = await DoctorModel.findById(id);
  if (!doctor) throw ApiError.notFound('No doctor with that id.');

  const user = await UserModel.findById(doctor.userId);
  if (!user) throw ApiError.notFound('That doctor has no account.');

  return { doctor, user };
}

export async function getDoctor(id: string): Promise<DoctorDto> {
  const { doctor, user } = await loadDoctor(id);
  return toDoctorDto(doctor, user);
}

/**
 * Edits a doctor. Only the fields the request actually named are touched, so
 * changing a fee cannot blank out an address by omission.
 *
 * The fee is deliberately editable here and nowhere else on the client's side of
 * the wire: booking reads it from this record, never from the request.
 */
export async function updateDoctor(
  id: string,
  input: UpdateDoctorInput,
  image?: string,
): Promise<DoctorDto> {
  const { doctor, user } = await loadDoctor(id);

  if (input.name !== undefined) user.name = input.name;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  if (image) user.image = image;

  if (input.speciality !== undefined) doctor.speciality = input.speciality;
  if (input.degree !== undefined) doctor.degree = input.degree;
  if (input.experience !== undefined) doctor.experience = input.experience;
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

  await Promise.all([user.save(), doctor.save()]);
  return toDoctorDto(doctor, user);
}

/**
 * Removes a doctor by deactivating their account, never by deleting the row.
 *
 * Their appointments must survive: patients have a visit history, the revenue
 * figures include consults this doctor did, and an audit trail that points at a
 * missing document is not a trail. Deactivating stops the login and takes them
 * off the public list while leaving all of that intact.
 *
 * `available` is left alone on purpose — that is the doctor's own switch for
 * taking bookings, and overwriting it here would mean a reinstated doctor came
 * back with a setting the admin silently changed.
 */
export async function deactivateDoctor(id: string): Promise<DoctorDto> {
  const { doctor, user } = await loadDoctor(id);

  if (user.isActive) {
    user.isActive = false;
    await user.save();

    // They cannot log in again, and their refresh token stops working on its
    // next use. The access token they already hold stays valid until it expires
    // — at most fifteen minutes, which is the price of not checking the database
    // on every single request.
    await logoutEverywhere(String(user._id));
  }

  return toDoctorDto(doctor, user);
}
