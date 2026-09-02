import { useState } from 'react';
import { Phone, TriangleAlert } from 'lucide-react';
import type { TriageDto } from '@shared/types';
import { messageFrom } from '../../api/client';
import { assessSymptoms } from '../../api/triage';
import {
  Button,
  Card,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Textarea,
  TriageDisclaimer,
  UrgencyChip,
} from '../../components/ui';

/**
 * Describe what is wrong, and get pointed at the right kind of doctor.
 *
 * The alternative this replaces is a grid of eight specialities and a patient
 * guessing which one owns their symptom. Two things make it safe to offer: an
 * emergency replaces the booking route entirely rather than sitting alongside
 * it, and the suggestion is a filter the patient can ignore.
 *
 * Two phases on one URL. Once a result arrives the form collapses to a summary
 * with an Edit, so the answer is not competing with the box that produced it.
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
      // The old result is cleared rather than left on screen: an assessment
      // beside an error about a newer one invites reading the stale answer as
      // the answer to what was just typed.
      setResult(null);
      setError(messageFrom(caught, 'Could not assess that just now.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title="Check your symptoms"
        description="Describe what you are feeling in your own words, and we will suggest which kind of doctor to see."
      />

      {result ? (
        <Card padding="sm" className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-ink-muted">Your symptoms</p>
              <p className="truncate text-body text-ink">{symptomsText}</p>
            </div>
            <Button variant="quiet" size="sm" onClick={() => setResult(null)}>
              Edit
            </Button>
          </div>
        </Card>
      ) : (
        <Card>
          <form className="space-y-6" onSubmit={(event) => void onSubmit(event)}>
            <Field label="Symptoms" hint="For example: an itchy rash on my arm that has been spreading.">
              {(props) => (
                <Textarea
                  {...props}
                  rows={4}
                  value={symptomsText}
                  onChange={(event) => setSymptomsText(event.target.value)}
                />
              )}
            </Field>

            <Field label="How long has this been going on?" optional>
              {(props) => (
                <Input
                  {...props}
                  placeholder="three days"
                  value={durationText}
                  onChange={(event) => setDurationText(event.target.value)}
                />
              )}
            </Field>

            <TriageDisclaimer />

            <div className="flex justify-end">
              <Button type="submit" loading={busy} disabled={symptomsText.trim().length < 10}>
                Get a suggestion
              </Button>
            </div>
          </form>
        </Card>
      )}

      {error && <ErrorNote message={error} />}

      {result && <TriageResult result={result} />}
    </div>
  );
}

/**
 * The one place this product spends its boldness.
 *
 * When the answer is an emergency the entire result is this card: a heading, the
 * advice, what was matched, and a way to call. There is no doctor list, no
 * booking link, no fee and no urgency chip — the heading already says it. The
 * call button is the only red filled button outside a confirmation dialog, and
 * nothing on the screen competes with it. No pulsing, no animation: this does
 * not need decoration to be taken seriously.
 */
function EmergencyCard({ result }: { result: TriageDto }) {
  return (
    <Card tone="danger" padding="lg" className="space-y-4">
      <div className="flex items-start gap-3">
        <TriangleAlert aria-hidden size={24} className="mt-1 shrink-0 text-danger-solid" />
        <div className="space-y-2">
          <h2 className="text-h1 font-semibold text-danger-fg">Get emergency help now</h2>
          <p className="max-w-prose text-body text-danger-fg">
            {result.emergencyAdvice ??
              'Your symptoms match signs that need urgent medical attention.'}
          </p>
        </div>
      </div>

      {result.structured.redFlags.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-h3 font-semibold text-danger-fg">Matched signs</h3>
          <ul className="list-disc space-y-1 pl-5 text-body text-danger-fg">
            {result.structured.redFlags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}

      <Button as="link" href="tel:108" variant="danger" filled size="lg" fullWidth>
        <Phone aria-hidden size={20} />
        Call 108
      </Button>

      <p className="text-sm text-danger-fg">
        If you are with someone, ask them to stay with you.
      </p>

      <TriageDisclaimer tone="quiet" />
    </Card>
  );
}

function TriageResult({ result }: { result: TriageDto }) {
  if (result.urgency === 'emergency') return <EmergencyCard result={result} />;

  const speciality = result.recommendedSpeciality ?? 'General physician';

  return (
    <div className="space-y-3">
      <Card className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-h2 font-semibold text-ink">{speciality}</h2>
          <UrgencyChip urgency={result.urgency} />
        </div>

        <p className="max-w-prose text-body text-ink-muted">
          {result.urgency === 'urgent'
            ? `Your symptoms suggest seeing a ${speciality.toLowerCase()} within the next day or two.`
            : `Your symptoms suggest seeing a ${speciality.toLowerCase()}. This does not look urgent, so book when it suits you.`}
        </p>

        {result.questionsToAsk.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-h3 font-semibold text-ink">A doctor may ask you</h3>
            <ul className="list-disc space-y-1 pl-5 text-body text-ink-muted">
              {result.questionsToAsk.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          </div>
        )}

        {/* The assessment id travels in the URL so that whichever doctor the
            patient ends up choosing, the booking carries it and the doctor gets
            the note — including when they ignore the suggestion entirely. */}
        <div className="flex flex-wrap gap-2">
          <Button
            as="link"
            to={`/?speciality=${encodeURIComponent(speciality)}&triage=${result.id}`}
          >
            See {speciality.toLowerCase()}s
          </Button>
          <Button as="link" to={`/?triage=${result.id}`} variant="secondary">
            Book any doctor
          </Button>
        </div>
      </Card>

      <TriageDisclaimer tone="quiet" />
    </div>
  );
}
