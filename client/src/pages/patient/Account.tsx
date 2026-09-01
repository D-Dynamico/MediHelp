import { useEffect, useState } from 'react';
import { GENDERS } from '@shared/types';
import type { Gender, PatientProfileDto } from '@shared/types';
import { fieldErrorsFrom, messageFrom } from '../../api/client';
import { fetchMyProfile, updateMyProfile } from '../../api/patient';
import { Button, Card, ErrorNote, Loading } from '../../components/ui';

/**
 * A patient's own details.
 *
 * The email is shown but not editable, matching the server: it is the account
 * identifier, and changing it safely means proving the new address first. Saying
 * so on the field is better than leaving a patient to discover it from a 422.
 */

const GENDER_LABELS: Record<Gender, string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
  prefer_not_to_say: 'Prefer not to say',
};

interface Draft {
  name: string;
  phone: string;
  dob: string;
  gender: Gender | '';
}

function draftFrom(profile: PatientProfileDto): Draft {
  return {
    name: profile.name,
    phone: profile.phone ?? '',
    dob: profile.dob ?? '',
    gender: profile.gender ?? '',
  };
}

export function Account() {
  const [profile, setProfile] = useState<PatientProfileDto | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loaded = await fetchMyProfile();
        setProfile(loaded);
        setDraft(draftFrom(loaded));
      } catch (caught) {
        setError(messageFrom(caught, 'Could not load your details.'));
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

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    setError(null);
    setFieldErrors({});
    setSaved(false);
    setBusy(true);

    try {
      const updated = await updateMyProfile({ ...draft, ...(image ? { image } : {}) });
      // Reset from the response, not the draft: the server trims and may have
      // stored a different photo URL than the one just uploaded.
      setProfile(updated);
      setDraft(draftFrom(updated));
      setImage(null);
      setSaved(true);
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(messageFrom(caught, 'Could not save your details.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !profile) return <ErrorNote message={error} />;
  if (!profile || !draft) return <Loading />;

  const photo = preview ?? profile.image;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">Your details</h1>

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
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-xl font-semibold text-brand-700">
                {profile.name.charAt(0)}
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="image" className="block text-sm font-medium">
                Photo
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
              id="dob"
              label="Date of birth"
              type="date"
              value={draft.dob}
              onChange={(value) => set('dob', value)}
              error={fieldErrors.dob}
              hint="Your doctor sees your age from this."
            />

            <div className="space-y-1">
              <label htmlFor="gender" className="block text-sm font-medium">
                Gender
              </label>
              <select
                id="gender"
                value={draft.gender}
                onChange={(event) => set('gender', event.target.value as Gender | '')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                <option value="">Not said</option>
                {GENDERS.map((option) => (
                  <option key={option} value={option}>
                    {GENDER_LABELS[option]}
                  </option>
                ))}
              </select>
              {fieldErrors.gender && <p className="text-xs text-red-700">{fieldErrors.gender}</p>}
            </div>

            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium">
                Email
              </label>
              <input
                id="email"
                value={profile.email}
                readOnly
                className="w-full rounded-md border border-slate-200 bg-surface-sunken px-3 py-2 text-ink-muted"
              />
              <p className="text-xs text-ink-muted">
                This is how you sign in. Ask the clinic if it needs changing.
              </p>
            </div>
          </div>

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
