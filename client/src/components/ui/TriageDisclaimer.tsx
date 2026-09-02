/**
 * What symptom triage is, and what it is not.
 *
 * On every surface where an assessment is read, in the same words each time.
 * Someone reading a machine's opinion about their own body needs to know what
 * it is worth before they act on it; a doctor reading a note needs to know it
 * was not written by a clinician. Repeating it is the point, which is why it is
 * one component rather than five paragraphs that drift apart.
 *
 * `quiet` is for screens where the assessment is incidental — a booking, a
 * table row — and the full paragraph would shout and be skipped.
 */
export function TriageDisclaimer({ tone = 'full' }: { tone?: 'full' | 'quiet' }) {
  if (tone === 'quiet') {
    return (
      <p className="text-xs text-ink-faint">
        Routing help, not a diagnosis. Not written by a clinician.
      </p>
    );
  }

  return (
    <p className="max-w-prose rounded-sm bg-surface-sunken p-3 text-sm text-ink-muted">
      This is routing help, not a diagnosis. It suggests which kind of doctor to
      see and how soon — it cannot tell you what is wrong, and it is not a
      substitute for a clinician. If you think this is an emergency, call
      emergency services rather than booking.
    </p>
  );
}
