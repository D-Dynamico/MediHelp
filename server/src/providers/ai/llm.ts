import { z } from 'zod';
import { SPECIALITIES, URGENCIES } from '@shared/types.js';
import { getSettings } from '../../config/env.js';
import type { TriageInput, TriageResult } from './rules.js';

/**
 * The model triage engine: `openai/gpt-oss-120b` on Groq, which has a free tier.
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

/**
 * The same shape as JSON Schema, sent as a strict `response_format`. Groq's
 * strict mode requires every field in `required` and `additionalProperties:
 * false`. Nullable fields are type unions, which this already is.
 */
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

/** Groq's OpenAI-compatible endpoint. Plain `fetch`: one call needs no SDK. */
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

/** The parts of a Groq chat completion this reads. */
interface GroqCompletion {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

/**
 * Assesses symptoms with the model.
 *
 * Throws on anything at all — that is the interface. The caller catches and
 * uses the rules, so every failure mode here is a degradation rather than an
 * outage.
 */
export async function assessWithModel(
  input: TriageInput,
): Promise<TriageResult & { modelUsed: string }> {
  const { GROQ_API_KEY, TRIAGE_MODEL, TRIAGE_TIMEOUT_MS } = getSettings();

  const said = input.durationText
    ? `${input.symptomsText}\n\nHow long: ${input.durationText}`
    : input.symptomsText;

  // No retry: the caller has a hard deadline and falls back to the rules. A
  // retry here would spend the patient's wait on a call we are willing to
  // abandon.
  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${GROQ_API_KEY}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
    body: JSON.stringify({
      model: TRIAGE_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: said },
      ],
      // Low effort on purpose: a short classification behind a hard deadline.
      // Reasoning tokens count against `max_completion_tokens`, hence the room.
      reasoning_effort: 'low',
      include_reasoning: false,
      max_completion_tokens: 4000,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'triage', strict: true, schema: OUTPUT_SCHEMA },
      },
    }),
  });

  if (!response.ok) {
    // The status only. The body can echo the request, and the request is a
    // patient's symptoms, which have no business in a log line.
    throw new Error(`The model call failed with ${response.status}.`);
  }

  const completion = (await response.json()) as GroqCompletion;
  const choice = completion.choices?.[0];

  // Cut off mid-answer is a failure like any other: fall to the rules rather
  // than parse half a JSON object.
  if (choice?.finish_reason && choice.finish_reason !== 'stop') {
    throw new Error(`The model stopped early (${choice.finish_reason}).`);
  }

  // Parsed, not trusted. Strict mode constrains generation; it is not a
  // promise, and a bad shape must land on the rules rather than in the database.
  const parsed = responseSchema.parse(JSON.parse(choice?.message?.content ?? ''));

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
    modelUsed: completion.model ?? TRIAGE_MODEL,
  };
}
