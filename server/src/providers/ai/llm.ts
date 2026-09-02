import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { SPECIALITIES, URGENCIES } from '@shared/types.js';
import { getSettings } from '../../config/env.js';
import type { TriageInput, TriageResult } from './rules.js';

/**
 * The Claude triage engine.
 *
 * An upgrade on the rules, never a dependency of them. It reads what the
 * patient actually wrote rather than looking for keywords, so it catches the
 * ways people describe things that no keyword list anticipates. Everything here
 * is written on the assumption that it will sometimes fail — timeout, rate
 * limit, a refusal, JSON that does not fit — and that the caller will quietly
 * use the rules instead. Nothing in the booking flow waits on a network call it
 * cannot do without.
 */

/* --------------------------------------------------------- the contract --- */

/**
 * What the model must return.
 *
 * Sent as a structured-output schema so the API constrains generation, *and*
 * checked again with zod on the way back. The schema is the request; the parse
 * is the trust boundary. A model that returns a speciality this clinic does not
 * employ, or an urgency outside the three we know, has to fall to the rules
 * rather than reach the database.
 */
const responseSchema = z.object({
  urgency: z.enum(URGENCIES),
  recommendedSpeciality: z.enum(SPECIALITIES).nullable(),
  intakeNote: z.string().min(1).max(2000),
  questionsToAsk: z.array(z.string().min(1).max(300)).max(6),
  durationText: z.string().max(80).nullable(),
  severity: z.enum(['mild', 'moderate', 'severe']).nullable(),
  redFlags: z.array(z.string().min(1).max(120)).max(6),
});

/** The same shape as JSON Schema, for `output_config.format`. */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    urgency: { type: 'string', enum: [...URGENCIES] },
    recommendedSpeciality: { type: ['string', 'null'], enum: [...SPECIALITIES, null] },
    intakeNote: { type: 'string' },
    questionsToAsk: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    durationText: { type: ['string', 'null'] },
    severity: { type: ['string', 'null'], enum: ['mild', 'moderate', 'severe', null] },
    redFlags: { type: 'array', items: { type: 'string' }, maxItems: 6 },
  },
  required: [
    'urgency',
    'recommendedSpeciality',
    'intakeNote',
    'questionsToAsk',
    'durationText',
    'severity',
    'redFlags',
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are triaging symptoms for a hospital's booking system.

Your job is routing, not diagnosis. You decide how soon someone should be seen
and which kind of doctor fits. You never name a condition, never suggest a
treatment, and never reassure someone that something is nothing.

Set urgency to "emergency" only for things that need care now rather than an
appointment: chest pain with breathlessness or pain spreading to the arm or jaw,
the sudden signs of a stroke, bleeding that will not stop, a severe allergic
reaction with swelling or difficulty breathing, an unresponsive person, a
seizure that has not stopped, coughing or vomiting blood, or any mention of
self-harm. For an emergency, set recommendedSpeciality to null: the answer is
not an appointment.

Set "urgent" when it should be seen within a day or two, and "routine"
otherwise. When in doubt between two levels, choose the more cautious one.

recommendedSpeciality must be exactly one of the clinic's specialities. If
nothing fits, use "General physician".

intakeNote is for the doctor to read before the consult: a few plain sentences
summarising what the patient said, how long it has been going on, and anything
that stands out. Quote the patient where it helps. Do not speculate about causes.

questionsToAsk are two to four questions the doctor should ask, in plain
language addressed to the patient.

redFlags lists any emergency indicators you matched, in short plain phrases.
Leave it empty when there are none.`;

/* ------------------------------------------------------------- the call --- */

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  const { ANTHROPIC_API_KEY } = getSettings();
  // maxRetries 0: the caller has a hard deadline and falls back to the rules.
  // A retry inside the SDK would multiply the wall clock by the retry count and
  // spend the patient's wait on a call we are willing to abandon.
  client ??= new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 0 });
  return client;
}

/** Forgets the cached client. For scripts and tests only. */
export function resetAiClient(): void {
  client = null;
}

/**
 * Assesses symptoms with Claude.
 *
 * Throws on anything at all — that is the interface. The caller catches and
 * uses the rules, so every failure mode here is a degradation rather than an
 * outage.
 */
export async function assessWithClaude(
  input: TriageInput,
): Promise<TriageResult & { modelUsed: string }> {
  const { TRIAGE_MODEL, TRIAGE_TIMEOUT_MS } = getSettings();

  const said = input.durationText
    ? `${input.symptomsText}\n\nHow long: ${input.durationText}`
    : input.symptomsText;

  const response = await anthropic().messages.create(
    {
      model: TRIAGE_MODEL,
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      // Low effort on purpose: this is a short classification behind a hard
      // deadline, and a patient waiting on a form is the wrong place to spend
      // thinking time. Thinking itself is left at the model's default.
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [{ role: 'user', content: said }],
    },
    { timeout: TRIAGE_TIMEOUT_MS },
  );

  // A safety decline is a failure like any other here: fall to the rules rather
  // than show the patient nothing.
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to answer this one.');
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Parsed, not trusted. Structured outputs constrain generation; they are not
  // a promise, and a bad shape must land on the rules rather than in the
  // database.
  const parsed = responseSchema.parse(JSON.parse(text));

  const urgency = parsed.urgency;

  return {
    urgency,
    // An emergency never carries a speciality, whatever the model said — the
    // banner replaces the booking form, and offering a department alongside
    // "call an ambulance" is a mixed message. Enforced here rather than trusted.
    recommendedSpeciality:
      urgency === 'emergency' ? undefined : (parsed.recommendedSpeciality ?? 'General physician'),
    intakeNote: `${parsed.intakeNote.trim()} Assessed by an AI assistant, not a clinician. Not a diagnosis.`,
    questionsToAsk: parsed.questionsToAsk,
    structured: {
      durationText: parsed.durationText ?? undefined,
      severity: parsed.severity ?? undefined,
      redFlags: parsed.redFlags,
    },
    modelUsed: response.model,
  };
}
