/**
 * Drives the doctor dashboard over HTTP against a seeded throwaway database.
 *
 * Run with: npm run check:doctor --workspace server
 *
 * The assertions that matter most are the ownership ones: a doctor holding a
 * perfectly valid token must not be able to reach another doctor's appointment
 * by putting its id in the URL.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import type { AddressInfo } from 'node:net';

const mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'f'.repeat(48);
process.env.LOG_LEVEL = 'error';

const { assertThrowawayDatabase } = await import('./_guard.js');
assertThrowawayDatabase();

const { createApp } = await import('../src/app.js');
const { connectDb } = await import('../src/config/db.js');
const { seedDatabase } = await import('../src/seed.js');

await connectDb();
await mongoose.connection.syncIndexes();
await seedDatabase();

const app = createApp();
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string; form?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;

  let body: FormData | string | undefined;
  if (options.form) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.form)) form.append(key, value);
    body = form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(body === undefined ? {} : { body }),
  });

  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
}

async function tokenFor(email: string, password = 'Password123!') {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

const anitaToken = await tokenFor('rao@medihelp.test');
const meeraToken = await tokenFor('nair@medihelp.test');
const adminToken = await tokenFor('admin@medihelp.test');
const patientToken = await tokenFor('rahul@medihelp.test');

type Profile = {
  id: string;
  name: string;
  email: string;
  speciality: string;
  degree: string;
  experience: number;
  fees: number;
  about: string;
  address: { line1: string; line2?: string };
  available: boolean;
  slotDurationMins: number;
  workingHours: { day: number; start: string; end: string }[];
  medianConsultMins: number;
};
const profileOf = (body: unknown) => (body as { profile: Profile }).profile;

/* ------------------------------------------------------------ 5.1 profile --- */

check('the profile needs a token', (await call('/api/doctor/profile')).status === 401);
check(
  'a patient cannot read a doctor profile',
  (await call('/api/doctor/profile', { token: patientToken })).status === 403,
);
check(
  'an admin is not treated as a doctor here',
  (await call('/api/doctor/profile', { token: adminToken })).status === 403,
);

const mine = await call('/api/doctor/profile', { token: anitaToken });
check('a doctor reads their own profile', mine.status === 200, mine.status);
check('it is their own record', profileOf(mine.body).email === 'rao@medihelp.test', profileOf(mine.body).email);
check('the profile carries the working hours', profileOf(mine.body).workingHours.length === 10);
check(
  'the profile carries the learned consult length',
  typeof profileOf(mine.body).medianConsultMins === 'number',
);

const edited = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: anitaToken,
  form: { fees: '650', about: 'General practice, chronic illness reviews and travel vaccinations.' },
});
check('a doctor edits their own profile', edited.status === 200, edited.body);
check('the fee changed', profileOf(edited.body).fees === 650, profileOf(edited.body).fees);
check(
  'a field the edit did not name is untouched',
  profileOf(edited.body).address.line1 === profileOf(mine.body).address.line1,
);
check(
  'the speciality is not editable by the doctor',
  profileOf(edited.body).speciality === profileOf(mine.body).speciality,
);

// The credentials belong to the clinic, not to the account holder. An attempt to
// change them is stripped by the schema rather than refused, because the field
// simply is not part of the contract.
const credentials = await call('/api/doctor/profile', {
  method: 'PATCH',
  token: anitaToken,
  form: { speciality: 'Neurologist', degree: 'PhD', experience: '40', fees: '650' },
});
check('smuggled credential fields are ignored', credentials.status === 200, credentials.body);
const afterSmuggle = profileOf(credentials.body);
check('the speciality did not change', afterSmuggle.speciality === profileOf(mine.body).speciality);
check('the degree did not change', afterSmuggle.degree === profileOf(mine.body).degree);
check('the experience did not change', afterSmuggle.experience === profileOf(mine.body).experience);

check(
  'an edit that changes nothing is refused',
  (await call('/api/doctor/profile', { method: 'PATCH', token: anitaToken, form: {} })).status === 422,
);
check(
  'a negative fee is refused',
  (await call('/api/doctor/profile', { method: 'PATCH', token: anitaToken, form: { fees: '-1' } }))
    .status === 422,
);

// One doctor's edit must not touch another's record.
const meeraBefore = profileOf((await call('/api/doctor/profile', { token: meeraToken })).body);
check('a second doctor sees a different record', meeraBefore.email === 'nair@medihelp.test');
check('the first doctor\'s edit left the second alone', meeraBefore.fees !== 650, meeraBefore.fees);

console.log(`\n${results.join('\n')}\n`);

server.close();
await mongoose.disconnect();
await mongod.stop();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
