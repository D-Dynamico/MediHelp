/**
 * The triage engine, checked as a pure function before anything HTTP touches it.
 *
 * Run with: npm run check:triage --workspace server
 *
 * The assertions that matter most are the two the phase names: "crushing chest
 * pain and short of breath" must be an emergency with no speciality to book,
 * and "itchy rash for three days" must be routine and Dermatology. The rest
 * guard the ways a keyword matcher goes wrong — firing on the inside of a
 * longer word, and crying wolf on half a red flag.
 */
import { assessWithRules, emergencyAdviceFor, RED_FLAGS } from '../src/providers/ai/rules.js';

const results: string[] = [];
const check = (label: string, ok: boolean, got?: unknown) =>
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (got ${JSON.stringify(got)})`}`);

const assess = (symptomsText: string) => assessWithRules({ symptomsText });

/* ------------------------------------------------ the phase's own exit --- */

const emergency = assess('crushing chest pain and short of breath');
check('chest pain with breathlessness is an emergency', emergency.urgency === 'emergency', emergency.urgency);
check(
  'an emergency offers no speciality to book',
  emergency.recommendedSpeciality === undefined,
  emergency.recommendedSpeciality,
);
check(
  'and names the red flag it matched',
  emergency.structured.redFlags.includes('chest pain with breathlessness'),
  emergency.structured.redFlags,
);
check(
  'there is advice to show instead of a booking form',
  (emergencyAdviceFor(emergency.structured.redFlags) ?? '').includes('emergency services'),
  emergencyAdviceFor(emergency.structured.redFlags),
);

const rash = assess('itchy rash for three days');
check('an itchy rash is routine', rash.urgency === 'routine', rash.urgency);
check('and goes to the dermatologist', rash.recommendedSpeciality === 'Dermatologist', rash.recommendedSpeciality);
check('the duration is read back in words', rash.structured.durationText === '3 days', rash.structured.durationText);

/* ------------------------------------------------- half a red flag is not --- */

// The whole reason red flags take combinations: chest pain alone is a reason to
// be seen soon, not a reason to call an ambulance. Crying wolf here would teach
// people to ignore the banner.
const chestOnly = assess('chest pain when I climb stairs, for two weeks');
check('chest pain alone is not an emergency', chestOnly.urgency !== 'emergency', chestOnly.urgency);
check('and still routes to the cardiologist', chestOnly.recommendedSpeciality === 'Cardiologist', chestOnly.recommendedSpeciality);

const breathOnly = assess('a bit short of breath after running');
check('breathlessness alone is not an emergency', breathOnly.urgency !== 'emergency', breathOnly.urgency);

/* ----------------------------------------------- the other emergencies --- */

const stroke = assess('her face is suddenly drooping and her speech is slurred');
check('stroke signs are an emergency', stroke.urgency === 'emergency', stroke.urgency);

const bleeding = assess('heavy bleeding that will not stop after a fall');
check('bleeding that will not stop is an emergency', bleeding.urgency === 'emergency', bleeding.urgency);

const allergy = assess('allergic to peanuts, throat is swelling and I am wheezing');
check('a throat swelling after an allergy is an emergency', allergy.urgency === 'emergency', allergy.urgency);

const selfHarm = assess('I have been feeling suicidal');
check('thoughts of self-harm are an emergency', selfHarm.urgency === 'emergency', selfHarm.urgency);
check(
  'and the advice points at a person, not a booking',
  (emergencyAdviceFor(selfHarm.structured.redFlags) ?? '').includes('helpline'),
  emergencyAdviceFor(selfHarm.structured.redFlags),
);

check('every red flag carries advice to show', RED_FLAGS.every((flag) => flag.advice.length > 20));

/* ------------------------------------------------------ whole words only --- */

// The failure a substring matcher makes: "rash" inside "harsh", "ear" inside
// "heard", "fits" inside "benefits".
const harsh = assess('my cough sounds harsh and I have a fever');
check(
  'a keyword inside a longer word does not match',
  harsh.recommendedSpeciality === 'General physician',
  harsh.recommendedSpeciality,
);

/* ----------------------------------------------------------- routing --- */

const cases: [string, string][] = [
  ['my period is late and very painful', 'Gynecologist'],
  ['stomach ache and loose motions since yesterday', 'Gastroenterologist'],
  ['my knee is swollen after a fall playing football', 'Orthopedist'],
  ['my daughter has a fever and is due her vaccination', 'Pediatrician'],
  ['migraine headaches three times a week', 'Neurologist'],
  ['sore throat and a cold', 'General physician'],
];
for (const [text, expected] of cases) {
  const result = assess(text);
  check(`"${text.slice(0, 34)}…" routes to ${expected}`, result.recommendedSpeciality === expected, result.recommendedSpeciality);
}

// Nothing recognisable at all still has to produce something bookable rather
// than an empty result the UI cannot render.
const nonsense = assess('I just do not feel like myself lately');
check('an unrecognised complaint falls back to a general physician', nonsense.recommendedSpeciality === 'General physician', nonsense.recommendedSpeciality);
check('and still produces a note', nonsense.intakeNote.length > 20);
check('and still produces questions', nonsense.questionsToAsk.length >= 2, nonsense.questionsToAsk.length);

/* -------------------------------------------------- severity and urgency --- */

const severe = assess('severe back pain, I cannot stand up');
check('a severe description is urgent', severe.urgency === 'urgent', severe.urgency);
check('and the severity is recorded', severe.structured.severity === 'severe', severe.structured.severity);

const mild = assess('mild headache for a couple of days');
check('a mild description stays routine', mild.urgency === 'routine', mild.urgency);
check('and reads the duration written as a word', mild.structured.durationText === '2 days', mild.structured.durationText);

/* ------------------------------------------------------------- the note --- */

const note = assess('itchy rash on my arm for 5 days, getting worse');
check('the note quotes the patient', note.intakeNote.includes('itchy rash on my arm'), note.intakeNote);
check('the note says which engine wrote it', note.intakeNote.includes('not by a clinician'), note.intakeNote);
check('the note names the suggested speciality', note.intakeNote.includes('Dermatologist'), note.intakeNote);
check('a worsening complaint is urgent', note.urgency === 'urgent', note.urgency);

const long = assess('x'.repeat(1500));
check('a very long complaint is trimmed in the note', long.intakeNote.length < 900, long.intakeNote.length);

// The same input must always give the same answer — it is what makes this
// usable as the fallback for a model that is allowed to fail.
const twice = [assess('itchy rash for three days'), assess('itchy rash for three days')];
check('the engine is deterministic', JSON.stringify(twice[0]) === JSON.stringify(twice[1]));

/* =========================================================== over HTTP === */

// The pure checks above need no database. Everything below drives the real
// route against a throwaway one, because persistence and ownership are the two
// things the engine itself cannot be asked about.

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoose = (await import('mongoose')).default;

const mongod = await MongoMemoryServer.create();
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
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;

async function call(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, never> };
}

async function tokenFor(email: string, password = 'Password123!') {
  const response = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  return (response.body as { accessToken?: string }).accessToken!;
}

const rahulToken = await tokenFor('rahul@medihelp.test');
const snehaToken = await tokenFor('sneha@medihelp.test');
const anitaToken = await tokenFor('rao@medihelp.test');
const adminToken = await tokenFor('admin@medihelp.test');

interface Triage {
  id: string;
  urgency: string;
  recommendedSpeciality?: string;
  intakeNote: string;
  questionsToAsk: string[];
  emergencyAdvice?: string;
  structured: { durationText?: string; severity?: string; redFlags: string[] };
  source: string;
  createdAt: string;
}
const triageOf = (body: unknown) => (body as { triage: Triage }).triage;

/* ------------------------------------------------------------- guards --- */

check(
  'triage needs a token',
  (await call('/api/triage', { method: 'POST', body: { symptomsText: 'itchy rash for three days' } }))
    .status === 401,
);
check(
  'a doctor cannot use the patient triage endpoint',
  (await call('/api/triage', {
    method: 'POST',
    token: anitaToken,
    body: { symptomsText: 'itchy rash for three days' },
  })).status === 403,
);
check(
  'nor can an admin',
  (await call('/api/triage', {
    method: 'POST',
    token: adminToken,
    body: { symptomsText: 'itchy rash for three days' },
  })).status === 403,
);

/* --------------------------------------------------------- validation --- */

check(
  'an empty description is refused',
  (await call('/api/triage', { method: 'POST', token: rahulToken, body: { symptomsText: '' } }))
    .status === 422,
);
check(
  'two characters is refused',
  (await call('/api/triage', { method: 'POST', token: rahulToken, body: { symptomsText: 'hm' } }))
    .status === 422,
);
check(
  'an essay past the model limit is refused rather than truncated',
  (await call('/api/triage', {
    method: 'POST',
    token: rahulToken,
    body: { symptomsText: 'x'.repeat(4001) },
  })).status === 422,
);

/* ------------------------------------------------------- the happy path --- */

const assessed = await call('/api/triage', {
  method: 'POST',
  token: rahulToken,
  body: { symptomsText: 'itchy rash on my arm for three days' },
});
check('a patient can be assessed', assessed.status === 201, assessed.body);
check('the assessment comes back with an id', Boolean(triageOf(assessed.body).id), triageOf(assessed.body));
check('routine, as the rules said', triageOf(assessed.body).urgency === 'routine', triageOf(assessed.body).urgency);
check(
  'and carries the suggested speciality',
  triageOf(assessed.body).recommendedSpeciality === 'Dermatologist',
  triageOf(assessed.body).recommendedSpeciality,
);
check('with the source named', triageOf(assessed.body).source === 'rules', triageOf(assessed.body).source);
check('and questions for the consult', triageOf(assessed.body).questionsToAsk.length >= 2);
check(
  'a routine assessment carries no emergency advice',
  triageOf(assessed.body).emergencyAdvice === undefined,
  triageOf(assessed.body).emergencyAdvice,
);

const triageId = triageOf(assessed.body).id;

/* ---------------------------------------------------------- persistence --- */

const Assessments = mongoose.connection.collection('triageassessments');
const stored = await Assessments.findOne({ _id: new mongoose.Types.ObjectId(triageId) });
check('the assessment is written down', Boolean(stored), stored);
check('it is stored against the patient who asked', Boolean(stored?.patientId), stored?.patientId);
check(
  'the symptom text is kept for the doctor to read',
  stored?.symptomsText === 'itchy rash on my arm for three days',
  stored?.symptomsText,
);

const readBack = await call(`/api/triage/${triageId}`, { token: rahulToken });
check('a patient can read their own assessment back', readBack.status === 200, readBack.status);
check('and it is the same one', triageOf(readBack.body).id === triageId);

/* ------------------------------------------------------------ ownership --- */

// The most personal thing this app stores. A 404 rather than a 403, so the
// endpoint does not confirm the record exists to somebody who cannot see it.
const nosey = await call(`/api/triage/${triageId}`, { token: snehaToken });
check("another patient cannot read someone else's assessment", nosey.status === 404, nosey.status);
check(
  'a well-formed but unknown id is a 404 too',
  (await call(`/api/triage/${'0'.repeat(24)}`, { token: rahulToken })).status === 404,
);
check(
  'a malformed id is refused before any lookup',
  (await call('/api/triage/not-an-id', { token: rahulToken })).status === 422,
);

/* ------------------------------------------------------- the emergency --- */

const emergencyOverHttp = await call('/api/triage', {
  method: 'POST',
  token: rahulToken,
  body: { symptomsText: 'crushing chest pain and short of breath' },
});
check('an emergency comes back as one', triageOf(emergencyOverHttp.body).urgency === 'emergency');
check(
  'with advice instead of a speciality to book',
  triageOf(emergencyOverHttp.body).recommendedSpeciality === undefined &&
    (triageOf(emergencyOverHttp.body).emergencyAdvice ?? '').includes('emergency services'),
  triageOf(emergencyOverHttp.body),
);

/* ------------------------------------------------------------- the log --- */

// What a patient wrote about their own body has no business in a log admins
// browse. The id is there for anyone with a reason to open the record itself.
const Audit = mongoose.connection.collection('auditlogs');
// `targetId` is an ObjectId on the schema, so a string will not match here.
const logged = await Audit.findOne({
  action: 'triage.assess',
  targetId: new mongoose.Types.ObjectId(triageId),
});
check('the assessment is audited', Boolean(logged), logged);
check(
  'but the symptom text is not copied into the audit log',
  !JSON.stringify(logged ?? {}).includes('itchy rash'),
  logged,
);

/* ============================================ carried into a booking === */

// 8.4: an assessment can be attached to a booking, and the doctor sees the
// urgency and the note on the row. The attachment is the interesting part —
// an id alone must not be enough to staple somebody else's symptoms to your
// appointment.

const anita = ((await call('/api/doctors')).body as unknown as {
  doctors: { id: string; name: string }[];
}).doctors.find((doctor) => doctor.name.includes('Rao'))!;

interface Slot {
  start: string;
  available: boolean;
}

/** The next time this doctor has free. Scanned, because they sit weekdays only. */
async function freeSlot(): Promise<string> {
  for (let ahead = 1; ahead <= 21; ahead += 1) {
    const day = new Date();
    day.setUTCDate(day.getUTCDate() + ahead);
    const body = (
      await call(`/api/doctors/${anita.id}/slots?date=${day.toISOString().slice(0, 10)}`)
    ).body as unknown as { slots: Slot[] };
    const free = body.slots.find((slot) => slot.available);
    if (free) return free.start;
  }
  throw new Error('No free slot in the next three weeks — the seed or the hours changed.');
}

const urgentTriage = triageOf(
  (await call('/api/triage', {
    method: 'POST',
    token: rahulToken,
    body: { symptomsText: 'severe back pain, I cannot stand up, for two days' },
  })).body,
);
check('the assessment to attach is urgent', urgentTriage.urgency === 'urgent', urgentTriage.urgency);

const booked = await call('/api/appointments', {
  method: 'POST',
  token: rahulToken,
  body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash', triageId: urgentTriage.id },
});
check('a booking may carry an assessment', booked.status === 201, booked.body);

interface BookedAppointment {
  id: string;
  urgency?: string;
  intakeNote?: string;
}
const bookedAppt = (booked.body as unknown as { appointment: BookedAppointment }).appointment;

/* ------------------------------------------- what the doctor now sees --- */

const doctorsDay = (await call('/api/doctor/appointments?when=all&pageSize=100', {
  token: anitaToken,
})).body as unknown as { items: BookedAppointment[] };
const onTheDoctorsRow = doctorsDay.items.find((row) => row.id === bookedAppt.id);

check('the doctor sees the appointment', Boolean(onTheDoctorsRow), doctorsDay.items.length);
check(
  'the row carries the urgency for the chip',
  onTheDoctorsRow?.urgency === 'urgent',
  onTheDoctorsRow?.urgency,
);
check(
  'and the note written for them to read first',
  (onTheDoctorsRow?.intakeNote ?? '').includes('severe back pain'),
  onTheDoctorsRow?.intakeNote,
);
check(
  'the note says it was not written by a clinician',
  (onTheDoctorsRow?.intakeNote ?? '').includes('not by a clinician'),
  onTheDoctorsRow?.intakeNote,
);

// The raw symptom text is not what travels: the doctor reads the summary that
// was written for them, and the row must not become a second copy of the
// patient's own words beyond what the note quotes.
check(
  'the appointment row carries no separate symptom field',
  !Object.keys(onTheDoctorsRow ?? {}).includes('symptomsText'),
  Object.keys(onTheDoctorsRow ?? {}),
);

// A booking with no triage still renders — most of them have none.
const plain = await call('/api/appointments', {
  method: 'POST',
  token: rahulToken,
  body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash' },
});
const plainAppt = (plain.body as unknown as { appointment: BookedAppointment }).appointment;
check('a booking without an assessment still works', plain.status === 201, plain.body);
check('and carries no urgency', plainAppt.urgency === undefined, plainAppt.urgency);
check('and no note', plainAppt.intakeNote === undefined, plainAppt.intakeNote);

/* ------------------------------------------ somebody else's assessment --- */

// The hole this substep closed: booking stored whatever triageId it was given
// without checking whose it was, so a patient could have attached another
// patient's symptoms to their own appointment and the doctor would have read
// them as theirs.
const stolen = await call('/api/appointments', {
  method: 'POST',
  token: snehaToken,
  body: {
    doctorId: anita.id,
    slotStart: await freeSlot(),
    mode: 'cash',
    triageId: urgentTriage.id,
  },
});
check("another patient's assessment cannot be attached", stolen.status === 404, stolen.status);

check(
  'an unknown assessment id is refused too',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash', triageId: '0'.repeat(24) },
  })).status === 404,
);

check(
  'a same-length non-hex assessment id is a 422, not a 500',
  (await call('/api/appointments', {
    method: 'POST',
    token: rahulToken,
    body: { doctorId: anita.id, slotStart: await freeSlot(), mode: 'cash', triageId: 'z'.repeat(24) },
  })).status === 422,
);

// Nothing was booked by any of the three refused attempts.
const sneha = (await call('/api/appointments/mine?when=all&pageSize=100', { token: snehaToken }))
  .body as unknown as { items: BookedAppointment[] };
check(
  'a refused attachment books nothing',
  sneha.items.every((row) => row.urgency === undefined),
  sneha.items.map((row) => row.urgency),
);


server.close();
await mongoose.disconnect();
await mongod.stop();


/* ================================================== choosing an engine === */

// The phase's other exit criterion: with no key set the behaviour is identical
// to the rules engine and `source` is `rules`. And when a key *is* set but the
// call fails, the patient must not be able to tell the difference.

const { reloadSettings } = await import('../src/config/env.js');
const ai = await import('../src/providers/ai/index.js');
const { GROQ_CHAT_URL } = await import('../src/providers/ai/llm.js');

async function withEnv<T>(
  env: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) saved[key] = process.env[key];

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  reloadSettings();

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    reloadSettings();
  }
}

// The developer's own .env must not decide what this check sees.
delete process.env.GROQ_API_KEY;
reloadSettings();

const noKey = await withEnv({ GROQ_API_KEY: undefined }, async () => {
  check('with no key, the model is not in play', !ai.usingModel());
  return ai.assessSymptoms({ symptomsText: 'itchy rash for three days' });
});
check('with no key the source is rules', noKey.source === 'rules', noKey.source);
check('and no model is recorded', noKey.modelUsed === undefined, noKey.modelUsed);

const direct = assess('itchy rash for three days');
check(
  'with no key the answer is identical to the rules engine',
  JSON.stringify({ ...noKey, source: undefined, modelUsed: undefined }) ===
    JSON.stringify({ ...direct, source: undefined, modelUsed: undefined }),
  { noKey, direct },
);

// A key that cannot work: the call fails — 401, or a timeout if the network is
// not reachable at all — and the patient still gets the rules answer. This is
// the fallback proven end to end, without needing a real account.
const badKey = await withEnv(
  { GROQ_API_KEY: 'gsk_not_a_real_key', TRIAGE_TIMEOUT_MS: '2000' },
  async () => {
    check('with a key set, the model is in play', ai.usingModel());
    return ai.assessSymptoms({ symptomsText: 'itchy rash for three days' });
  },
);
check('a failing model call falls back rather than throwing', badKey.source === 'rules', badKey.source);
check(
  'and the fallback answer is the rules answer',
  badKey.urgency === direct.urgency && badKey.recommendedSpeciality === direct.recommendedSpeciality,
  badKey,
);

// The emergency path must survive the fallback too — it is the one answer that
// matters most, and it is the rules engine that produces it either way.
const badKeyEmergency = await withEnv(
  { GROQ_API_KEY: 'gsk_not_a_real_key', TRIAGE_TIMEOUT_MS: '2000' },
  () => ai.assessSymptoms({ symptomsText: 'crushing chest pain and short of breath' }),
);
check(
  'an emergency still reads as one when the model is unreachable',
  badKeyEmergency.urgency === 'emergency' && badKeyEmergency.source === 'rules',
  badKeyEmergency,
);


/* ============================================ the model, with fetch stubbed === */

// No real key is needed to prove the two halves that matter: that the request
// is what Groq expects, and that every kind of answer is handled. `fetch` is
// swapped for one that records the request and replies with a canned body.

const realFetch = globalThis.fetch;
type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
let sent: Sent | null = null;

function replyWith(status: number, body: unknown) {
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    sent = {
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const completion = (content: unknown, finish = 'stop') => ({
  model: 'openai/gpt-oss-120b',
  choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finish }],
});

const goodAnswer = {
  urgency: 'routine',
  recommendedSpeciality: 'Dermatologist',
  intakeNote: 'Itchy rash on both arms for three days.',
  questionsToAsk: ['Has anything new touched your skin?'],
  durationText: 'three days',
  severity: 'mild',
  redFlags: [],
};

const stubbed = (body: unknown, status = 200) =>
  // TRIAGE_MODEL unset, so the default is under test rather than whatever .env says.
  withEnv({ GROQ_API_KEY: 'gsk_stub', TRIAGE_MODEL: undefined, TRIAGE_TIMEOUT_MS: '2000' }, () => {
    replyWith(status, body);
    return ai.assessSymptoms({ symptomsText: 'itchy rash on both arms for three days' });
  });

try {
  const good = await stubbed(completion(goodAnswer));
  check('a good model answer is used, with source llm', good.source === 'llm', good);
  check('the model that answered is recorded', good.modelUsed === 'openai/gpt-oss-120b', good.modelUsed);
  check(
    'the model answer is used as given',
    good.urgency === 'routine' && good.recommendedSpeciality === 'Dermatologist',
    good,
  );
  check('the note says an AI wrote it', good.intakeNote.includes('not a clinician'), good.intakeNote);

  const request = sent as Sent | null;
  check('the request goes to Groq', request?.url === 'https://api.groq.com/openai/v1/chat/completions', request?.url);
  check('the key goes as a bearer token', request?.headers.authorization === 'Bearer gsk_stub');
  check('the model asked for is gpt-oss-120b', request?.body.model === 'openai/gpt-oss-120b', request?.body.model);
  const format = request?.body.response_format as { type?: string; json_schema?: { strict?: boolean } } | undefined;
  check(
    'the answer is constrained by a strict JSON schema',
    format?.type === 'json_schema' && format.json_schema?.strict === true,
    format,
  );
  check('reasoning is kept short and left out of the reply', request?.body.reasoning_effort === 'low' && request?.body.include_reasoning === false);
  check('the URL the check expects is the one the code uses', GROQ_CHAT_URL === request?.url);

  const emergency = await stubbed(
    completion({ ...goodAnswer, urgency: 'emergency', recommendedSpeciality: 'Cardiologist', redFlags: ['chest pain'] }),
  );
  check(
    'an emergency from the model never carries a speciality',
    emergency.source === 'llm' && emergency.urgency === 'emergency' && emergency.recommendedSpeciality === undefined,
    emergency,
  );

  const wrongShape = await stubbed(completion({ ...goodAnswer, recommendedSpeciality: 'Astrologer' }));
  check('a speciality the clinic does not have falls to the rules', wrongShape.source === 'rules', wrongShape.source);

  const cutOff = await stubbed(completion('{"urgency":"rout', 'length'));
  check('an answer cut off mid-way falls to the rules', cutOff.source === 'rules', cutOff.source);

  const refused = await stubbed({ error: { message: 'Invalid API Key' } }, 401);
  check('an error from Groq falls to the rules', refused.source === 'rules', refused.source);
} finally {
  globalThis.fetch = realFetch;
}


console.log(`\n${results.join('\n')}\n`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
