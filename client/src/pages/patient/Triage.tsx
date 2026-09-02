import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TriageDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { assessSymptoms } from '../../api/triage';
import { Button, Card, ErrorNote, UrgencyChip } from '../../components/ui';

/**
 * Describe what is wrong, and get pointed at the right kind of doctor.
 *
 * The alternative this replaces is a grid of eight specialities and a patient
 * guessing which one owns their symptom. Two things make it safe to offer:
 * an emergency replaces the booking route entirely rather than sitting
 * alongside it, and the suggestion is a filter the patient can ignore — every
 * doctor is still one click away.
 */
export function Triage() {
  const [symptomsText, setSymptomsText] = useState('');
  const [durationText, setDurationText] = useState('');
  const [result, setResult] = useState<TriageDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      setResult(
        await assessSymptoms({
          symptomsText,
          ...(durationText.trim() ? { durationText: durationText.trim() } : {}),
        }),
      );
    } catch (caught) {
      // The old result is cleared rather than left on screen: showing an
      // assessment beside an error about a newer one invites reading the stale
      // answer as the answer to what was just typed.
      setResult(null);
      setError(messageFrom(caught, 'Could not assess that just now.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-ink">What is troubling you?</h1>
        <p className="text-sm text-ink-muted">
          Describe it in your own words and we will point you at the right kind of doctor.
        </p>
      </header>

      <Card className="space-y-4">
        <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
          <div className="space-y-1">
            <label className="text-sm font-medium text-ink" htmlFor="symptoms">
              Your symptoms
            </label>
            <textarea
              id="symptoms"
              rows={5}
              className="w-full rounded-lg border border-slate-200 p-3 text-sm"
              placeholder="For example: an itchy rash on my arm that has been spreading for three days"
              value={symptomsText}
              onChange={(event) => setSymptomsText(event.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium text-ink" htmlFor="duration">
              How long has it been going on? <span className="text-ink-muted">(optional)</span>
            </label>
            <input
              id="duration"
              className="w-full rounded-lg border border-slate-200 p-2 text-sm"
              placeholder="three days"
              value={durationText}
              onChange={(event) => setDurationText(event.target.value)}
            />
          </div>

          <Button type="submit" variant="primary" disabled={busy || symptomsText.trim().length < 10}>
            {busy ? 'Reading…' : 'Check my symptoms'}
          </Button>
        </form>

        <TriageDisclaimer />
      </Card>

      {error && <ErrorNote message={error} />}

      {result && <TriageResult result={result} />}
    </div>
  );
}

/**
 * What triage is and is not.
 *
 * On every surface that shows an assessment, in the same words. A patient
 * reading a machine's opinion about their body needs to know what it is worth
 * before they act on it, not after.
 */
export function TriageDisclaimer() {
  return (
    <p className="rounded-lg bg-slate-50 p-3 text-xs text-ink-muted">
      This is routing help, not a diagnosis. It suggests which kind of doctor to
      see and how soon — it cannot tell you what is wrong, and it is not a
      substitute for a clinician. If you feel this is an emergency, call
      emergency services rather than booking.
    </p>
  );
}

function TriageResult({ result }: { result: TriageDto }) {
  // An emergency is not a result with a booking link attached — it is a
  // different screen. The whole point is that the answer here is not an
  // appointment, so nothing on it should look like one.
  if (result.urgency === 'emergency') {
    return (
      <Card className="space-y-3 border-red-200 bg-red-50">
        <div className="flex items-center gap-2">
          <UrgencyChip urgency="emergency" />
          <h2 className="text-lg font-semibold text-red-900">Do not wait for an appointment</h2>
        </div>

        <p className="text-sm text-red-900">
          {result.emergencyAdvice ?? 'Call emergency services now.'}
        </p>

        {result.structured.redFlags.length > 0 && (
          <p className="text-sm text-red-900">
            What we noticed: {result.structured.redFlags.join('; ')}.
          </p>
        )}

        <TriageDisclaimer />
      </Card>
    );
  }

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-ink">
          {result.recommendedSpeciality ?? 'General physician'}
        </h2>
        <UrgencyChip urgency={result.urgency} />
      </div>

      <p className="text-sm text-ink-muted">
        {result.urgency === 'urgent'
          ? 'This sounds like it should be seen in the next day or two.'
          : 'This does not look urgent. Book when it suits you.'}
      </p>

      {result.questionsToAsk.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Worth thinking about before you go</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {result.questionsToAsk.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {/* The assessment id travels in the URL so that whichever doctor the
            patient ends up choosing, the booking can carry it and the doctor
            gets the note. */}
        <Link
          to={`/?speciality=${encodeURIComponent(result.recommendedSpeciality ?? 'General physician')}&triage=${result.id}`}
          className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"
        >
          See {result.recommendedSpeciality ?? 'General physician'}s
        </Link>

        {/* A suggestion, not a lock. Someone who knows their own history better
            than a paragraph of text can say must be able to ignore it without
            starting again. */}
        <Link
          to={`/?triage=${result.id}`}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-ink"
        >
          Browse all doctors instead
        </Link>
      </div>

      <TriageDisclaimer />
    </Card>
  );
}
