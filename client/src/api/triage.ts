import type { TriageDto } from '@shared/types';
import { api } from './client';

/**
 * Symptom triage.
 *
 * Signed-in patients only, like the server. The assessment id it returns is what
 * a booking carries so the doctor sees the note — see `bookAppointment`.
 */

export async function assessSymptoms(input: {
  symptomsText: string;
  durationText?: string;
}): Promise<TriageDto> {
  const { data } = await api.post<{ triage: TriageDto }>('/triage', input);
  return data.triage;
}
