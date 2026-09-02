import { SPECIALITIES, type Speciality, type Urgency } from '@shared/types.js';

/**
 * The offline triage engine.
 *
 * Deliberately boring: a keyword map, a red-flag list and some string
 * assembly, with no network call and no dependencies. It is the default engine
 * *and* the fallback for the Claude one, which means every failure mode of the
 * clever path lands here — so this file has to be something a clinic could read
 * and argue with, not a black box.
 *
 * What it is not: a diagnosis. It routes a patient to the right kind of doctor
 * and shouts when the answer is not an appointment at all. Every surface that
 * shows its output says so.
 */

export interface TriageInput {
  symptomsText: string;
  /** Optional context the patient gave separately, folded into the note. */
  durationText?: string;
}

export interface TriageResult {
  urgency: Urgency;
  /** Absent for an emergency: the answer there is not an appointment. */
  recommendedSpeciality?: Speciality;
  intakeNote: string;
  questionsToAsk: string[];
  structured: {
    durationText?: string;
    severity?: 'mild' | 'moderate' | 'severe';
    redFlags: string[];
  };
}

/* ------------------------------------------------------------ matching --- */

/**
 * Whether any of these phrases appears as whole words.
 *
 * Whole words rather than substrings, because the short entries below would
 * otherwise fire on the inside of longer ones — "rash" inside "harsh", "ear"
 * inside "heard", "flu" inside "fluid". A phrase may contain spaces; the
 * boundary is applied to the ends of the phrase, not to each word.
 */
function mentions(text: string, phrases: readonly string[]): string[] {
  return phrases.filter((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
  });
}

/* ---------------------------------------------------------- red flags --- */

/**
 * The things that mean "stop, this is not a booking".
 *
 * Each entry needs every one of its groups to match, and any one phrase within
 * a group will do. That is what lets "chest pain with breathlessness" be an
 * emergency while chest pain on its own is merely urgent — the combination is
 * the signal, and treating either half alone as an emergency would cry wolf
 * often enough that people learn to ignore the banner. A flag whose signal
 * needs no second half simply has one group.
 */
interface RedFlag {
  label: string;
  groups: readonly (readonly string[])[];
  /** What the patient is told to do. Shown on the emergency banner. */
  advice: string;
}

const CHEST = ['chest pain', 'chest pains', 'chest tightness', 'pain in my chest', 'crushing chest'];
const BREATHLESS = [
  'short of breath',
  'shortness of breath',
  'breathless',
  'breathlessness',
  'cannot breathe',
  "can't breathe",
  'trouble breathing',
  'difficulty breathing',
  'gasping',
];

export const RED_FLAGS: readonly RedFlag[] = [
  {
    label: 'chest pain with breathlessness',
    groups: [CHEST, BREATHLESS],
    advice: 'Call emergency services now. Chest pain with breathlessness needs immediate care.',
  },
  {
    label: 'chest pain spreading to the arm or jaw',
    groups: [CHEST, ['left arm', 'jaw', 'radiating', 'spreading to my arm']],
    advice: 'Call emergency services now. This pattern of chest pain needs immediate care.',
  },
  {
    label: 'stroke signs (face, arm, speech)',
    groups: [
      ['face drooping', 'face is drooping', 'drooping', 'slurred speech', 'slurring', 'cannot speak', 'sudden weakness', 'one side', 'numb on one side'],
      ['sudden', 'suddenly', 'all of a sudden'],
    ],
    advice: 'Call emergency services now. These can be signs of a stroke, where minutes matter.',
  },
  {
    label: 'heavy bleeding that will not stop',
    groups: [
      ['bleeding', 'blood loss', 'haemorrhage', 'hemorrhage'],
      ['heavy', 'heavily', 'will not stop', "won't stop", 'cannot stop', 'soaking', 'pouring', 'a lot of blood'],
    ],
    advice: 'Call emergency services now. Bleeding that will not stop needs immediate care.',
  },
  {
    label: 'signs of a severe allergic reaction',
    groups: [
      ['allergic', 'allergy', 'anaphylaxis', 'anaphylactic', 'bee sting', 'wasp sting', 'peanut'],
      ['swelling', 'swollen', 'throat', 'tongue', 'cannot breathe', "can't breathe", 'wheezing', 'hives all over'],
    ],
    advice: 'Call emergency services now. A throat or tongue swelling after an allergy is an emergency.',
  },
  {
    label: 'unresponsive or fainting',
    groups: [['unconscious', 'unresponsive', 'passed out', 'blacked out', 'fainted', 'collapsed']],
    advice: 'Call emergency services now.',
  },
  {
    label: 'thoughts of self-harm',
    groups: [['suicidal', 'kill myself', 'end my life', 'harm myself', 'hurt myself']],
    advice:
      'Please contact emergency services or a crisis helpline now. You deserve help from a person, straight away.',
  },
  {
    label: 'a seizure that has not stopped',
    groups: [['seizure', 'seizures', 'fitting', 'convulsing', 'convulsions'], ['not stopping', 'will not stop', "won't stop", 'still going', 'continuous', 'back to back']],
    advice: 'Call emergency services now. A seizure that does not stop needs immediate care.',
  },
  {
    label: 'coughing or vomiting blood',
    groups: [['coughing up', 'vomiting', 'throwing up', 'spitting up'], ['blood']],
    advice: 'Call emergency services now.',
  },
];

/** Every red flag the text matches, by label. */
function redFlagsIn(text: string): RedFlag[] {
  return RED_FLAGS.filter((flag) =>
    flag.groups.every((group) => mentions(text, group).length > 0),
  );
}

/* -------------------------------------------------------- specialities --- */

/**
 * What each kind of doctor is for, in the words a patient would actually use.
 *
 * Ordered most specific first at the point of scoring, not here: a phrase like
 * "period pain" should beat a generic "pain", so the scoring below weighs the
 * length of the matched phrase rather than counting hits.
 */
const SPECIALITY_KEYWORDS: Record<Speciality, readonly string[]> = {
  Cardiologist: [
    'chest pain', 'chest tightness', 'palpitations', 'heart', 'heartbeat', 'blood pressure',
    'bp', 'racing heart', 'irregular heartbeat', 'cholesterol', 'angina',
  ],
  Dermatologist: [
    'rash', 'rashes', 'skin', 'itchy', 'itching', 'acne', 'pimples', 'eczema', 'psoriasis',
    'hair loss', 'hair fall', 'dandruff', 'mole', 'hives', 'boil', 'nail', 'nails', 'blister',
  ],
  Gastroenterologist: [
    'stomach', 'stomach ache', 'tummy', 'abdominal', 'abdomen', 'nausea', 'vomiting',
    'diarrhoea', 'diarrhea', 'constipation', 'acidity', 'heartburn', 'indigestion', 'bloating',
    'gas', 'liver', 'jaundice', 'ulcer', 'loose motions',
  ],
  Gynecologist: [
    'period', 'periods', 'menstrual', 'menstruation', 'pregnant', 'pregnancy', 'pcos',
    'vaginal', 'ovary', 'ovarian', 'uterus', 'menopause', 'contraception', 'smear',
  ],
  Neurologist: [
    'headache', 'headaches', 'migraine', 'seizure', 'seizures', 'fits', 'dizziness', 'dizzy',
    'vertigo', 'numbness', 'tingling', 'memory loss', 'tremor', 'tremors', 'fainting',
    'nerve', 'nerves',
  ],
  Orthopedist: [
    'back pain', 'backache', 'joint', 'joints', 'knee', 'shoulder', 'hip', 'ankle', 'wrist',
    'elbow', 'fracture', 'sprain', 'sprained', 'bone', 'bones', 'arthritis', 'neck pain',
    'slipped disc', 'muscle pain',
  ],
  Pediatrician: [
    'my child', 'my son', 'my daughter', 'my baby', 'toddler', 'infant', 'newborn',
    'vaccination', 'vaccine', 'immunisation', 'immunization', 'child has', 'kid has',
  ],
  'General physician': [
    'fever', 'cold', 'cough', 'flu', 'sore throat', 'tired', 'tiredness', 'fatigue',
    'weakness', 'body ache', 'check up', 'checkup', 'general', 'not feeling well', 'unwell',
  ],
};

/**
 * The best-fitting speciality, or none when nothing matched.
 *
 * Scored by the length of the matched phrases rather than by how many matched,
 * so "period pain" routes to the gynecologist rather than tying with a generic
 * mention. Ties fall to whichever comes first in `SPECIALITIES`, which puts the
 * general physician ahead of the specialists — the right way for a tie to break
 * when the clinic is guessing.
 */
function bestSpeciality(text: string): { speciality?: Speciality; matched: string[] } {
  let best: { speciality?: Speciality; score: number; matched: string[] } = {
    score: 0,
    matched: [],
  };

  for (const speciality of SPECIALITIES) {
    const matched = mentions(text, SPECIALITY_KEYWORDS[speciality]);
    const score = matched.reduce((total, phrase) => total + phrase.length, 0);
    if (score > best.score) best = { speciality, score, matched };
  }

  return { speciality: best.speciality, matched: best.matched };
}

/* ------------------------------------------------- severity and timing --- */

const SEVERE = ['severe', 'severely', 'unbearable', 'excruciating', 'worst', 'agony', 'intense', 'crushing'];
const MILD = ['mild', 'mildly', 'slight', 'slightly', 'a bit', 'a little', 'minor'];

function severityIn(text: string): 'mild' | 'moderate' | 'severe' | undefined {
  if (mentions(text, SEVERE).length > 0) return 'severe';
  if (mentions(text, MILD).length > 0) return 'mild';
  if (mentions(text, ['moderate', 'moderately']).length > 0) return 'moderate';
  return undefined;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, few: 3, couple: 2,
};

/**
 * How long it has been going on, in the patient's own words.
 *
 * Read back as text rather than parsed into a number of days: "a few weeks" and
 * "three days" are both useful to the doctor exactly as said, and turning them
 * into a figure would invent a precision the patient did not give.
 */
function durationIn(text: string): string | undefined {
  const match = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|few|couple)\s*(?:of\s+)?(hour|day|week|month|year)s?\b/i.exec(
    text,
  );
  if (!match) return undefined;

  const [, rawCount, unit] = match;
  const count = Number.isNaN(Number(rawCount))
    ? NUMBER_WORDS[rawCount!.toLowerCase()]
    : Number(rawCount);
  if (!count) return undefined;

  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/* ------------------------------------------------------------ urgency --- */

const URGENT_SIGNS = [
  'high fever', 'very high fever', 'cannot keep anything down', 'dehydrated',
  'getting worse', 'worsening', 'rapidly', 'spreading fast', 'cannot walk',
  'cannot stand', 'cannot sleep', 'passing blood', 'blood in',
];

/* ------------------------------------------------------------ questions --- */

const QUESTIONS_BY_SPECIALITY: Record<Speciality, readonly string[]> = {
  Cardiologist: [
    'Does the discomfort come on with exertion and ease with rest?',
    'Do you have known blood pressure, cholesterol or diabetes?',
  ],
  Dermatologist: [
    'Is the affected area spreading, and does anything make it worse?',
    'Have you started any new medicine, soap or food recently?',
  ],
  Gastroenterologist: [
    'Is it linked to eating, and has your appetite or weight changed?',
    'Have your bowel habits changed, and have you seen any blood?',
  ],
  Gynecologist: [
    'When was your last period, and has the pattern changed?',
    'Is there any chance you are pregnant?',
  ],
  Neurologist: [
    'Is this the worst headache you have had, and did it start suddenly?',
    'Any change to your vision, balance, speech or strength?',
  ],
  Orthopedist: [
    'Was there an injury or fall, and can you put weight on it?',
    'Is there swelling, and is the pain worse at night or on movement?',
  ],
  Pediatrician: [
    'Is the child feeding and drinking normally, and passing urine as usual?',
    'What is their temperature, and are their vaccinations up to date?',
  ],
  'General physician': [
    'How high has the temperature been, and has anything brought it down?',
    'Has anyone at home had the same thing recently?',
  ],
};

const ALWAYS_ASK = [
  'Are you taking any medicines, and do you have any allergies?',
  'Have you had this before, and what helped last time?',
];

/* --------------------------------------------------------------- note --- */

function intakeNoteFor(input: {
  symptomsText: string;
  urgency: Urgency;
  speciality?: Speciality;
  duration?: string;
  severity?: string;
  redFlags: RedFlag[];
  matched: string[];
}): string {
  const parts: string[] = [];

  if (input.redFlags.length > 0) {
    parts.push(
      `Emergency indicators reported: ${input.redFlags.map((flag) => flag.label).join('; ')}.`,
    );
  }

  const said = input.symptomsText.trim().replace(/\s+/g, ' ');
  parts.push(`Patient reports: "${said.length > 600 ? `${said.slice(0, 600)}…` : said}"`);

  const facts: string[] = [];
  if (input.duration) facts.push(`going on for ${input.duration}`);
  if (input.severity) facts.push(`described as ${input.severity}`);
  if (input.matched.length > 0) facts.push(`mentions ${input.matched.slice(0, 5).join(', ')}`);
  if (facts.length > 0) parts.push(`${facts.join('; ')}.`);

  parts.push(
    input.urgency === 'emergency'
      ? 'Routed to emergency advice rather than a booking.'
      : `Suggested ${input.speciality ?? 'General physician'}, urgency ${input.urgency}.`,
  );

  parts.push('Matched by keyword rules, not by a clinician. Not a diagnosis.');

  return parts.join(' ');
}

/* ---------------------------------------------------------------- run --- */

/** The advice shown instead of a booking form. Empty unless this is an emergency. */
export function emergencyAdviceFor(redFlagLabels: readonly string[]): string | undefined {
  const first = RED_FLAGS.find((flag) => redFlagLabels.includes(flag.label));
  return first?.advice;
}

/**
 * Assesses free-text symptoms. Pure, synchronous and offline — the same input
 * always gives the same answer, which is what makes it usable as a fallback.
 */
export function assessWithRules(input: TriageInput): TriageResult {
  const text = input.symptomsText.toLowerCase();

  const redFlags = redFlagsIn(text);
  const severity = severityIn(text);
  const duration = input.durationText?.trim() || durationIn(text);
  const { speciality, matched } = bestSpeciality(text);

  const urgency: Urgency =
    redFlags.length > 0
      ? 'emergency'
      : severity === 'severe' || mentions(text, URGENT_SIGNS).length > 0
        ? 'urgent'
        : 'routine';

  // No speciality on an emergency: offering a department to book alongside
  // "call an ambulance" is a mixed message, and the banner replaces the form.
  const recommended = urgency === 'emergency' ? undefined : (speciality ?? 'General physician');

  return {
    urgency,
    recommendedSpeciality: recommended,
    intakeNote: intakeNoteFor({
      symptomsText: input.symptomsText,
      urgency,
      speciality: recommended,
      duration,
      severity,
      redFlags,
      matched,
    }),
    questionsToAsk: [...(recommended ? QUESTIONS_BY_SPECIALITY[recommended] : []), ...ALWAYS_ASK],
    structured: {
      durationText: duration,
      severity,
      redFlags: redFlags.map((flag) => flag.label),
    },
  };
}
