import mongoose from 'mongoose';
import { ACTIVE_APPOINTMENT_STATUSES } from '@shared/types.js';
import type { AdminDashboardDto, DoctorDto } from '@shared/types.js';
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
import type { CreateDoctorInput } from './admin.schema.js';

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
