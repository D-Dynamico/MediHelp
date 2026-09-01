import { useEffect, useState } from 'react';
import type { DoctorProfileDto, WorkingHoursDto } from '@shared/types';
import { fieldErrorsFrom, messageFrom } from '../../api/client';
import { fetchProfile, updateProfile } from '../../api/doctor';
import { Button, Card, ErrorNote, Loading } from '../../components/ui';
import { AvailabilityGrid } from './AvailabilityGrid';

/**
 * What a doctor may change about themselves.
 *
 * Narrower than the admin's form, and that is deliberate: speciality, degree
 * and years of experience are the clinic's claims about a doctor's credentials,
 * so they are shown here but not editable. Fee, hours and description are the
 * doctor's own.
 */

interface Draft {
  name: string;
  phone: string;
  about: string;
  fees: string;
  addressLine1: string;
  addressLine2: string;
  available: boolean;
  slotDurationMins: string;
  workingHours: WorkingHoursDto[];
}

function draftFrom(profile: DoctorProfileDto): Draft {
  return {
    name: profile.name,
    phone: profile.phone ?? '',
    about: profile.about,
    fees: String(profile.fees),
    addressLine1: profile.address.line1,
    addressLine2: profile.address.line2 ?? '',
    available: profile.available,
    slotDurationMins: String(profile.slotDurationMins),
    workingHours: profile.workingHours,
  };
}

export function DoctorProfile() {
  const [profile, setProfile] = useState<DoctorProfileDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await fetchProfile();
        setProfile(loaded);
        setDraft(draftFrom(loaded));
      } catch (caught) {
        setError(messageFrom(caught, 'Could not load your profile.'));
      }
    })();
  }, []);

  // An object URL is a live handle into the page's memory, not a string — it has
  // to be released, or picking a few photos in a row leaks each one.
  useEffect(() => {
    if (!image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setSaved(false);
  }

  /**
   * Changing the sittings drops every message about them.
   *
   * The server addresses those messages by row position, so deleting the first
   * sitting would slide "Tuesday has two sittings that overlap" onto whichever
   * row happened to land in that slot — marking a row the server never
   * complained about while the broken one renders clean.
   */
  function setWorkingHours(next: WorkingHoursDto[]) {
    set('workingHours', next);
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([key]) => !key.startsWith('workingHours')),
      ),
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setError(null);
    setFieldErrors({});
    setSaved(false);
    setBusy(true);

    try {
      const updated = await updateProfile({ ...draft, ...(image ? { image } : {}) });
      // Reset from what came back, not from the draft: the server trims, coerces
      // and may have stored a different photo URL than the one just uploaded.
      setProfile(updated);
      setDraft(draftFrom(updated));
      setImage(null);
      setSaved(true);
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(messageFrom(caught, 'Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !profile) return <ErrorNote message={error} />;
  if (!profile || !draft) return <Loading />;

  // The photo just picked, or the one already stored, or neither.
  const photo = preview ?? profile.image;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Profile</h1>

      <Card>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <ErrorNote message={error} />}
          {saved && (
            <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
              Saved.
            </p>
          )}

          <div className="flex items-center gap-4">
            {photo ? (
              <img
                src={photo}
                alt=""
                className="h-20 w-20 rounded-full border border-brand-100 object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-ink-muted">
                Photo
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="image" className="block text-sm font-medium">
                Profile photo
              </label>
              <input
                id="image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setImage(event.target.files?.[0] ?? null)}
                className="text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-700"
              />
              <p className="text-xs text-ink-muted">JPEG, PNG or WebP, up to 2 MB.</p>
            </div>
          </div>

          {/* Set by the clinic, shown so a doctor can see what patients see and
              ask the admin to fix it if it is wrong. */}
          <div className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            {profile.speciality} · {profile.degree} · {profile.experience} years&rsquo;
            experience. Ask an admin to change these.
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="name"
              label="Name"
              value={draft.name}
              onChange={(value) => set('name', value)}
              error={fieldErrors.name}
            />
            <Field
              id="phone"
              label="Phone"
              value={draft.phone}
              onChange={(value) => set('phone', value)}
              error={fieldErrors.phone}
            />
            <Field
              id="fees"
              label="Consultation fee (₹)"
              type="number"
              value={draft.fees}
              onChange={(value) => set('fees', value)}
              error={fieldErrors.fees}
              hint="What a patient is charged to book you."
            />
            <Field
              id="slotDurationMins"
              label="Appointment length (minutes)"
              type="number"
              value={draft.slotDurationMins}
              onChange={(value) => set('slotDurationMins', value)}
              error={fieldErrors.slotDurationMins}
              hint={`Your consults have been running ${profile.medianConsultMins} minutes.`}
            />
            <Field
              id="addressLine1"
              label="Clinic address"
              value={draft.addressLine1}
              onChange={(value) => set('addressLine1', value)}
              error={fieldErrors.addressLine1}
            />
            <Field
              id="addressLine2"
              label="Address line 2"
              value={draft.addressLine2}
              onChange={(value) => set('addressLine2', value)}
              error={fieldErrors.addressLine2}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="about" className="block text-sm font-medium">
              About
            </label>
            <textarea
              id="about"
              rows={3}
              value={draft.about}
              aria-invalid={fieldErrors.about ? true : undefined}
              onChange={(event) => set('about', event.target.value)}
              className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-100 ${
                fieldErrors.about ? 'border-red-300' : 'border-slate-300 focus:border-brand-500'
              }`}
            />
            <p className={`text-xs ${fieldErrors.about ? 'text-red-700' : 'text-ink-muted'}`}>
              {fieldErrors.about ?? 'What you treat, in a sentence or two. Patients read this.'}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={draft.available}
              onChange={(event) => set('available', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Taking bookings
          </label>

          <AvailabilityGrid
            value={draft.workingHours}
            errors={fieldErrors}
            onChange={setWorkingHours}
          />

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => {
                setDraft(draftFrom(profile));
                setImage(null);
                setFieldErrors({});
                setSaved(false);
              }}
            >
              Undo changes
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-100 ${
          error ? 'border-red-300' : 'border-slate-300 focus:border-brand-500'
        }`}
      />
      {(error ?? hint) && (
        <p className={`text-xs ${error ? 'text-red-700' : 'text-ink-muted'}`}>{error ?? hint}</p>
      )}
    </div>
  );
}
