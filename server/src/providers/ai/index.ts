import { getSettings } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { assessWithRules, type TriageInput, type TriageResult } from './rules.js';
import { assessWithModel } from './llm.js';

/**
 * Which engine assesses symptoms.
 *
 * The rules are the default and need no account, so triage works from a fresh
 * clone with only `MONGODB_URI` set. The model (gpt-oss-120b on Groq) takes over
 * when `GROQ_API_KEY` is present — and hands straight back the moment it fails.
 *
 * The asymmetry with the payment provider is deliberate. A payment provider
 * that is chosen but unconfigured is shouted about at startup, because falling
 * back silently would take real money. Here the fallback *is* the design: the
 * rules give a usable answer for every input, so a failure costs quality rather
 * than correctness, and the booking flow is never blocked on a network call.
 */

export interface Assessment extends TriageResult {
  source: 'rules' | 'llm';
  modelUsed?: string;
}

/** Whether the model is configured at all. Read once; `.env` needs a restart anyway. */
export function usingModel(): boolean {
  return Boolean(getSettings().GROQ_API_KEY);
}

/**
 * Assesses symptoms with the best engine available.
 *
 * Never throws. Every failure of the model path — timeout, rate limit, refusal,
 * JSON that does not fit the schema, a key that has been revoked — is logged and
 * answered from the rules with `source: 'rules'`, which is exactly what the
 * patient would have got with no key set at all.
 */
export async function assessSymptoms(input: TriageInput): Promise<Assessment> {
  if (usingModel()) {
    try {
      const { modelUsed, ...result } = await assessWithModel(input);
      return { ...result, source: 'llm', modelUsed };
    } catch (caught) {
      // Warn, not error: the patient still gets an answer, and a clinic whose
      // key has expired should see this in the logs without being paged.
      logger.warn('Triage fell back to the rules engine', {
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  return { ...assessWithRules(input), source: 'rules' };
}
