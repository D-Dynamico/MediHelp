/**
 * Swaps the seeded demo doctors' cartoon avatars for the photographs in
 * `client/public/doctors/`, in a database that was seeded before the photos
 * existed.
 *
 * Run with: npm run refresh:photos --workspace server
 *
 * Re-seeding would do the same, but re-seeding refuses a database that has
 * accounts in it, and forcing it wipes everything. This touches only what it
 * must, and only what is still demo data:
 *
 * - accounts ending `@medihelp.test` with the role `doctor`,
 * - whose image is still the generated DiceBear cartoon — a photo a doctor
 *   uploaded themselves is never replaced,
 * - and only when a photograph for that surname actually ships.
 *
 * Appointments carry a frozen copy of the doctor's image in `docSnapshot`, so
 * those are updated too, for the same accounts only. Running it twice changes
 * nothing the second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { AppointmentModel, DoctorModel, UserModel } from '../src/models/index.js';

const photos = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/public/doctors',
);
const GENERATED = /^https:\/\/api\.dicebear\.com\//;

await connectDb();

const doctors = await UserModel.find({
  role: 'doctor',
  email: /@medihelp\.test$/,
  image: GENERATED,
}).select('email image');

let accounts = 0;
let snapshots = 0;

for (const user of doctors) {
  const surname = user.email.split('@')[0]!;
  if (!fs.existsSync(path.join(photos, `${surname}.jpg`))) {
    console.log(`  skip ${user.email}: no photograph for "${surname}"`);
    continue;
  }

  const image = `/doctors/${surname}.jpg`;
  const previous = user.image;
  user.image = image;
  await user.save();
  accounts += 1;

  const profile = await DoctorModel.findOne({ userId: user._id }).select('_id');
  if (profile) {
    const result = await AppointmentModel.updateMany(
      { doctorId: profile._id, 'docSnapshot.image': previous },
      { $set: { 'docSnapshot.image': image } },
    );
    snapshots += result.modifiedCount;
  }
  console.log(`  ${user.email} -> ${image}`);
}

console.log(`\n  ${accounts} doctor photos replaced, ${snapshots} appointment snapshots updated.\n`);
await mongoose.disconnect();
