import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SPECIALITIES } from '@shared/types';
import type { Speciality } from '@shared/types';
import { fieldErrorsFrom, messageFrom } from '../../api/client';
import { createDoctor } from '../../api/admin';
import { Button, Card, ErrorNote } from '../../components/ui';

/**
 * The add-doctor form.
 *
 * The server is what validates this — every field here is checked again there,
 * and the fee in particular is only ever read from the doctor record afterwards.
 * What the form adds is telling the admin which field is wrong before they have
 * to guess, which is what the per-field messages from a 422 are for.
 */

const EMPTY = {
  name: '',
  email: '',
  password: '',
  phone: '',
  speciality: SPECIALITIES[0] as Speciality,
  degree: '',
  experience: '1',
  about: '',
  fees: '500',
  addressLine1: '',
  addressLine2: '',
};

export function AddDoctor() {
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

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

  function set(field: keyof typeof EMPTY, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setBusy(true);

    try {
      const doctor = await createDoctor({ ...form, ...(image ? { image } : {}) });
      navigate(`/admin/doctors?search=${encodeURIComponent(doctor.email)}`);
    } catch (caught) {
      setFieldErrors(fieldErrorsFrom(caught));
      setError(messageFrom(caught, 'Could not add that doctor.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-ink">Add a doctor</h1>

      <Card>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          {error && <ErrorNote message={error} />}

          <div className="flex items-center gap-4">
            {preview ? (
              <img
                src={preview}
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
              <p className="text-xs text-ink-muted">JPEG, PNG or WebP, up to 2 MB. Optional.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label="Name" value={form.name} onChange={set} error={fieldErrors.name} />
            <Field
              id="email"
              label="Email"
              type="email"
              value={form.email}
              onChange={set}
              error={fieldErrors.email}
            />
            <Field
              id="password"
              label="First password"
              type="password"
              value={form.password}
              onChange={set}
              error={fieldErrors.password}
              hint="Pass this on. The doctor can change it after signing in."
            />
            <Field id="phone" label="Phone" value={form.phone} onChange={set} error={fieldErrors.phone} />

            <div className="space-y-1">
              <label htmlFor="speciality" className="block text-sm font-medium">
                Speciality
              </label>
              <select
                id="speciality"
                value={form.speciality}
                onChange={(event) => set('speciality', event.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
              >
                {SPECIALITIES.map((speciality) => (
                  <option key={speciality} value={speciality}>
                    {speciality}
                  </option>
                ))}
              </select>
              {fieldErrors.speciality && (
                <p className="text-xs text-red-700">{fieldErrors.speciality}</p>
              )}
            </div>

            <Field
              id="degree"
              label="Qualification"
              value={form.degree}
              onChange={set}
              error={fieldErrors.degree}
              hint="For example: MBBS, MD"
            />
            <Field
              id="experience"
              label="Years of experience"
              type="number"
              value={form.experience}
              onChange={set}
              error={fieldErrors.experience}
            />
            <Field
              id="fees"
              label="Consultation fee (₹)"
              type="number"
              value={form.fees}
              onChange={set}
              error={fieldErrors.fees}
            />
            <Field
              id="addressLine1"
              label="Clinic address"
              value={form.addressLine1}
              onChange={set}
              error={fieldErrors.addressLine1}
            />
            <Field
              id="addressLine2"
              label="Address line 2"
              value={form.addressLine2}
              onChange={set}
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
              value={form.about}
              aria-invalid={fieldErrors.about ? true : undefined}
              onChange={(event) => set('about', event.target.value)}
              className={`w-full rounded-md border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-100 ${
                fieldErrors.about ? 'border-red-300' : 'border-slate-300 focus:border-brand-500'
              }`}
            />
            <p className={`text-xs ${fieldErrors.about ? 'text-red-700' : 'text-ink-muted'}`}>
              {fieldErrors.about ?? 'What they treat, in a sentence or two. Patients read this.'}
            </p>
          </div>

          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Adding…' : 'Add doctor'}
            </Button>
            <Button variant="quiet" onClick={() => setForm(EMPTY)} disabled={busy}>
              Clear
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
  id: keyof typeof EMPTY;
  label: string;
  value: string;
  onChange: (field: keyof typeof EMPTY, value: string) => void;
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
        onChange={(event) => onChange(id, event.target.value)}
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
