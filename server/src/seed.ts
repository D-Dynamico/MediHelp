/**
 * Fills an empty database with something worth looking at: an admin, eight
 * doctors across the specialities, a few patients, and appointments spread over
 * the past and the next few days.
 *
 * Run with: npm run seed
 *
 * Refuses to touch a database that already has accounts unless `--force` is
 * passed, so seeding production is a deliberate act and a stray run cannot wipe
 * real data.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { SPECIALITIES } from '@shared/types.js';
import type { AppointmentStatus, Speciality } from '@shared/types.js';
import { getSettings } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';
import { logger } from './config/logger.js';
import { hashPassword } from './utils/password.js';
import {
  AppointmentModel,
  AuditLogModel,
  DoctorModel,
  PaymentModel,
  QueueSessionModel,
  RefreshTokenModel,
  TriageAssessmentModel,
  UserModel,
  WaitlistModel,
} from './models/index.js';

/**
 * The fallback password for seeded accounts. Fine for a demo, and never used in
 * production: `resolvePasswords()` refuses to fall back to it there.
 */
const DEMO_PASSWORD = 'Password123!';

/**
 * Works out what the seeded accounts should be signed in with.
 *
 * In development the well-known demo password keeps the project one command away
 * from something you can click through. In production it would be a way in — the
 * seed creates an admin and eight doctor accounts, and a published password on
 * any of them is a published password on all of them — so there both keys must
 * be set explicitly, and neither may be the demo one.
 */
function resolvePasswords(settings: ReturnType<typeof getSettings>): {
  admin: string;
  demo: string;
} {
  const { SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD, isProduction } = settings;

  if (!isProduction) {
    return {
      admin: SEED_ADMIN_PASSWORD ?? DEMO_PASSWORD,
      demo: SEED_DEMO_PASSWORD ?? DEMO_PASSWORD,
    };
  }

  const missing = [
    SEED_ADMIN_PASSWORD ? null : 'SEED_ADMIN_PASSWORD',
    SEED_DEMO_PASSWORD ? null : 'SEED_DEMO_PASSWORD',
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `Refusing to seed production without ${missing.join(' and ')}.\n` +
        'Without them every seeded account would share a password published in this repo.\n' +
        'Set them to strong, distinct values in the environment and run the seed again.',
    );
  }

  const reused = [
    SEED_ADMIN_PASSWORD === DEMO_PASSWORD ? 'SEED_ADMIN_PASSWORD' : null,
    SEED_DEMO_PASSWORD === DEMO_PASSWORD ? 'SEED_DEMO_PASSWORD' : null,
  ].filter(Boolean);

  if (reused.length > 0) {
    throw new Error(
      `Refusing to seed production: ${reused.join(' and ')} is set to the demo password from this repo.\n` +
        'Choose something else.',
    );
  }

  return { admin: SEED_ADMIN_PASSWORD!, demo: SEED_DEMO_PASSWORD! };
}

type DoctorSeed = {
  name: string;
  speciality: Speciality;
  degree: string;
  experience: number;
  fees: number;
  about: string;
  line1: string;
  line2?: string;
};

const DOCTORS: DoctorSeed[] = [
  {
    name: 'Dr. Anita Rao',
    speciality: 'General physician',
    degree: 'MBBS',
    experience: 8,
    fees: 500,
    about: 'Everyday illness, check-ups and referrals. Sees patients of all ages.',
    line1: '14 Residency Road',
    line2: 'Bengaluru 560025',
  },
  {
    name: 'Dr. Meera Nair',
    speciality: 'Gynecologist',
    degree: 'MBBS, MS',
    experience: 12,
    fees: 800,
    about: "Women's health, pregnancy care and routine screening.",
    line1: '3 Lake View Complex',
    line2: 'Bengaluru 560034',
  },
  {
    name: 'Dr. Ravi Menon',
    speciality: 'Dermatologist',
    degree: 'MBBS, MD',
    experience: 6,
    fees: 700,
    about: 'Skin, hair and nail conditions, from acne to chronic eczema.',
    line1: '22 Church Street',
    line2: 'Bengaluru 560001',
  },
  {
    name: 'Dr. Sunita Iyer',
    speciality: 'Pediatrician',
    degree: 'MBBS, DCH',
    experience: 15,
    fees: 600,
    about: 'Newborn to teenage care, vaccinations and growth concerns.',
    line1: '7 Garden Layout',
    line2: 'Bengaluru 560011',
  },
  {
    name: 'Dr. Arjun Desai',
    speciality: 'Neurologist',
    degree: 'MBBS, DM',
    experience: 18,
    fees: 1200,
    about: 'Headache, seizures, stroke follow-up and nerve conditions.',
    line1: '48 Hospital Road',
    line2: 'Bengaluru 560002',
  },
  {
    name: 'Dr. Kavya Reddy',
    speciality: 'Gastroenterologist',
    degree: 'MBBS, DM',
    experience: 10,
    fees: 900,
    about: 'Digestive problems, liver conditions and endoscopy.',
    line1: '9 MG Road',
    line2: 'Bengaluru 560001',
  },
  {
    name: 'Dr. Imran Sheikh',
    speciality: 'Cardiologist',
    degree: 'MBBS, MD, DM',
    experience: 20,
    fees: 1500,
    about: 'Heart health, blood pressure and post-procedure follow-up.',
    line1: '61 Cunningham Road',
    line2: 'Bengaluru 560052',
  },
  {
    name: 'Dr. Priya Sharma',
    speciality: 'Orthopedist',
    degree: 'MBBS, MS',
    experience: 9,
    fees: 850,
    about: 'Bone and joint injuries, back pain and sports rehabilitation.',
    line1: '18 Brigade Terrace',
    line2: 'Bengaluru 560095',
  },
];

const PATIENTS = [
  { name: 'Rahul Verma', email: 'rahul@medihelp.test', dob: '1994-04-12', gender: 'male' },
  { name: 'Sneha Kulkarni', email: 'sneha@medihelp.test', dob: '1988-11-30', gender: 'female' },
  { name: 'Tarun Bose', email: 'tarun@medihelp.test', dob: '2001-07-08', gender: 'male' },
  { name: 'Fatima Ali', email: 'fatima@medihelp.test', dob: '1976-01-22', gender: 'female' },
  { name: 'Joseph Mathew', email: 'joseph@medihelp.test', dob: '1969-09-15', gender: 'male' },
] as const;

/** Weekdays, 09:00–13:00 and 16:00–19:00 — a clinic's usual two sittings. */
const WORKING_HOURS = [1, 2, 3, 4, 5].flatMap((day) => [
  { day, start: '09:00', end: '13:00' },
  { day, start: '16:00', end: '19:00' },
]);

/** Midnight UTC on the day `offsetDays` from today. */
function dayAt(offsetDays: number): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date;
}

function slotOn(offsetDays: number, hour: number, minute = 0): Date {
  const date = dayAt(offsetDays);
  date.setUTCHours(hour, minute, 0, 0);
  return date;
}

export type SeedResult = {
  admin: number;
  doctors: number;
  patients: number;
  appointments: number;
  credentials: {
    admin: string;
    doctor: string;
    patient: string;
    password: string;
    adminPassword: string;
  };
};

/**
 * Seeds an already-connected database. Exported so it can be called directly —
 * from the CLI below, and from the checks — rather than only as a subprocess.
 */
export async function seedDatabase({ force = false } = {}): Promise<SeedResult> {
  const settings = getSettings();
  // Resolved before anything is read or deleted, so a production seed with no
  // passwords set fails without having touched the database.
  const passwords = resolvePasswords(settings);

  const existing = await UserModel.countDocuments();
  if (existing > 0 && !force) {
    throw new Error(
      `This database already has ${existing} account(s). Seeding would replace them.\n` +
        'Re-run with --force if that is what you want:  npm run seed -- --force',
    );
  }

  if (existing > 0) {
    logger.warn(`--force given: clearing ${existing} existing account(s) and their data`);
  }

  await Promise.all([
    UserModel.deleteMany({}),
    DoctorModel.deleteMany({}),
    AppointmentModel.deleteMany({}),
    PaymentModel.deleteMany({}),
    RefreshTokenModel.deleteMany({}),
    AuditLogModel.deleteMany({}),
    TriageAssessmentModel.deleteMany({}),
    QueueSessionModel.deleteMany({}),
    WaitlistModel.deleteMany({}),
  ]);

  const adminPassword = passwords.admin;
  const passwordHash = await hashPassword(passwords.demo);

  // --- admin ---------------------------------------------------------------
  const admin = await UserModel.create({
    name: 'Clinic Admin',
    email: settings.SEED_ADMIN_EMAIL,
    passwordHash: await hashPassword(adminPassword),
    role: 'admin',
  });

  // --- doctors -------------------------------------------------------------
  const doctors = [];
  for (const seed of DOCTORS) {
    const user = await UserModel.create({
      name: seed.name,
      email: `${seed.name.split(' ').at(-1)?.toLowerCase()}@medihelp.test`,
      passwordHash,
      role: 'doctor',
      image: `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed.name)}`,
    });

    const doctor = await DoctorModel.create({
      userId: user._id,
      speciality: seed.speciality,
      degree: seed.degree,
      experience: seed.experience,
      about: seed.about,
      fees: seed.fees,
      address: { line1: seed.line1, line2: seed.line2 },
      available: true,
      slotDurationMins: 30,
      workingHours: WORKING_HOURS,
      medianConsultMins: 12 + (seed.experience % 8),
    });

    doctors.push({ doctor, user, seed });
  }

  // --- patients ------------------------------------------------------------
  const patients = await UserModel.insertMany(
    PATIENTS.map((patient) => ({
      name: patient.name,
      email: patient.email,
      passwordHash,
      role: 'patient' as const,
      dob: new Date(patient.dob),
      gender: patient.gender,
      phone: '+91 90000 0000' + PATIENTS.indexOf(patient),
    })),
  );

  // --- appointments --------------------------------------------------------
  // A mix of finished, today's, and upcoming, so every dashboard has something
  // real to show the moment you log in.
  const plan: {
    patient: number;
    doctor: number;
    day: number;
    hour: number;
    status: AppointmentStatus;
  }[] = [
    { patient: 0, doctor: 0, day: -9, hour: 10, status: 'completed' },
    { patient: 1, doctor: 1, day: -7, hour: 11, status: 'completed' },
    { patient: 2, doctor: 2, day: -5, hour: 17, status: 'completed' },
    { patient: 3, doctor: 6, day: -4, hour: 9, status: 'completed' },
    { patient: 4, doctor: 4, day: -3, hour: 16, status: 'cancelled' },
    { patient: 0, doctor: 3, day: -2, hour: 12, status: 'no_show' },
    { patient: 1, doctor: 0, day: 0, hour: 10, status: 'booked' },
    { patient: 2, doctor: 5, day: 0, hour: 17, status: 'booked' },
    { patient: 3, doctor: 7, day: 1, hour: 9, status: 'booked' },
    { patient: 4, doctor: 1, day: 1, hour: 11, status: 'booked' },
    { patient: 0, doctor: 6, day: 2, hour: 16, status: 'booked' },
    { patient: 1, doctor: 4, day: 3, hour: 10, status: 'booked' },
  ];

  const tokensPerDoctorDay = new Map<string, number>();
  let appointmentCount = 0;

  for (const entry of plan) {
    const { doctor, seed } = doctors[entry.doctor]!;
    const patient = patients[entry.patient]!;
    const slotStart = slotOn(entry.day, entry.hour);
    const key = `${String(doctor._id)}:${slotStart.toISOString().slice(0, 10)}`;
    const tokenNumber = (tokensPerDoctorDay.get(key) ?? 0) + 1;
    tokensPerDoctorDay.set(key, tokenNumber);

    const paid = entry.status === 'completed';
    await AppointmentModel.create({
      patientId: patient._id,
      doctorId: doctor._id,
      slotStart,
      slotEnd: new Date(slotStart.getTime() + 30 * 60_000),
      tokenNumber,
      status: entry.status,
      amount: seed.fees,
      payment: {
        mode: appointmentCount % 3 === 0 ? 'razorpay' : 'cash',
        status: paid ? 'paid' : entry.status === 'cancelled' ? 'refunded' : 'pending_at_desk',
      },
      docSnapshot: {
        name: seed.name,
        speciality: seed.speciality,
        fees: seed.fees,
        image: doctors[entry.doctor]!.user.image,
      },
      ...(paid
        ? {
            consultStartedAt: slotStart,
            consultEndedAt: new Date(slotStart.getTime() + 14 * 60_000),
          }
        : {}),
      ...(entry.status === 'cancelled' ? { cancelledBy: 'patient', cancelledAt: slotStart } : {}),
    });
    appointmentCount += 1;
  }

  logger.info('Seed complete', {
    doctors: doctors.length,
    patients: patients.length,
    appointments: appointmentCount,
    specialities: SPECIALITIES.length,
  });

  return {
    admin: 1,
    doctors: doctors.length,
    patients: patients.length,
    appointments: appointmentCount,
    credentials: {
      admin: admin.email,
      doctor: doctors[0]!.user.email,
      patient: PATIENTS[0].email,
      password: passwords.demo,
      adminPassword,
    },
  };
}

/** CLI entry point: connect, seed, print what to sign in with, disconnect. */
async function main(): Promise<void> {
  await connectDb();
  const { credentials, ...counts } = await seedDatabase({
    force: process.argv.includes('--force'),
  });

  console.log(`
  Seeded ${counts.doctors} doctors, ${counts.patients} patients and ${counts.appointments} appointments.

  Sign in with:
    admin    ${credentials.admin}  /  ${credentials.adminPassword}
    doctor   ${credentials.doctor}  /  ${credentials.password}
    patient  ${credentials.patient}  /  ${credentials.password}

  Every seeded doctor and patient uses the same password.
`);
}

// Run only when this file is the entry point, so importing it (from the checks)
// does not kick off a seed.
const isDirectRun =
  Boolean(process.argv[1]) && pathToFileURL(process.argv[1]!).href === import.meta.url;

if (isDirectRun) {
  main()
    .then(async () => {
      await disconnectDb();
      process.exit(0);
    })
    .catch(async (error: unknown) => {
      console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
      await mongoose.disconnect().catch(() => undefined);
      process.exit(1);
    });
}
