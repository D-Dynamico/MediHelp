/**
 * Adds any demo patients missing from a database that was seeded before they
 * existed.
 *
 * Run with: npm run add:patients --workspace server
 *
 * Re-seeding would do the same, but re-seeding refuses a database that has
 * accounts in it, and forcing it wipes everything. This touches only what it
 * must:
 *
 * - it inserts the patients from the seed's list whose email isn't taken yet;
 * - it never edits or deletes an account, so a demo patient whose password or
 *   profile someone has changed stays as it is;
 * - it uses the same password rules as the seed, so it refuses production
 *   unless `SEED_DEMO_PASSWORD` is set to something that isn't the published
 *   demo password.
 *
 * Running it twice adds nothing the second time.
 */
import mongoose from 'mongoose';
import { getSettings } from '../src/config/env.js';
import { connectDb } from '../src/config/db.js';
import { UserModel } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { PATIENTS, demoPhone, resolvePasswords } from '../src/seed.js';

// Checked before connecting, so a refused run touches nothing.
const passwords = resolvePasswords(getSettings());

await connectDb();

const taken = new Set(
  (await UserModel.find({ email: { $in: PATIENTS.map((p) => p.email) } }).select('email')).map(
    (user) => user.email,
  ),
);
const missing = PATIENTS.filter((patient) => !taken.has(patient.email));

if (missing.length > 0) {
  const passwordHash = await hashPassword(passwords.demo);
  await UserModel.insertMany(
    missing.map((patient) => ({
      name: patient.name,
      email: patient.email,
      passwordHash,
      role: 'patient' as const,
      dob: new Date(patient.dob),
      gender: patient.gender,
      phone: demoPhone(PATIENTS.indexOf(patient)),
    })),
  );
}

console.log(`
  Added ${missing.length} demo patient${missing.length === 1 ? '' : 's'}; ${taken.size} already existed.
${missing.map((patient) => `    ${patient.email}`).join('\n')}
  ${missing.length > 0 ? 'They sign in with the demo password the seed prints.' : ''}
`);

await mongoose.disconnect();
process.exit(0);
