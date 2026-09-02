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

console.log(`\n${results.join('\n')}\n`);
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
