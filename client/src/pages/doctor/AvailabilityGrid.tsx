import type { WorkingHoursDto } from '@shared/types';
import { Button } from '../../components/ui';

/**
 * The hours a doctor sits, as a list of sittings rather than a week-long grid
 * of checkboxes.
 *
 * A doctor's week is not one block a day — a morning clinic and an evening one
 * with a gap between them is the normal case, and that is exactly what slot
 * generation walks. A row per sitting says that directly; a grid of half-hour
 * cells would say it in forty-eight clicks.
 *
 * Nothing is validated here. The server checks overlaps and backwards windows
 * and answers with a message per row, keyed `workingHours.<index>` — this
 * component's job is to put those messages back on the rows they came from.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** What a new row starts as: a normal morning clinic on a weekday. */
const NEW_ROW: WorkingHoursDto = { day: 1, start: '09:00', end: '13:00' };

export function AvailabilityGrid({
  value,
  errors,
  onChange,
}: {
  value: WorkingHoursDto[];
  /** Every field error from the last save, keyed by path. */
  errors: Record<string, string>;
  onChange: (next: WorkingHoursDto[]) => void;
}) {
  function edit(index: number, patch: Partial<WorkingHoursDto>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Clinic hours</legend>

      {/* A problem with the list as a whole — unreadable, or too many rows —
          rather than with any one sitting. */}
      {errors.workingHours && <p className="text-xs text-red-700">{errors.workingHours}</p>}

      {value.length === 0 && (
        <p className="text-xs text-ink-muted">
          No hours set, so no one can book you. Add a sitting below.
        </p>
      )}

      <div className="space-y-2">
        {value.map((row, index) => {
          const rowError = errors[`workingHours.${index}`];

          return (
            <div
              // Index as the key, deliberately: these rows have no id of their
              // own, and the server's error messages address them by position
              // too. Editing a row is what happens here; reordering is not.
              key={index}
              className={`rounded-md border p-3 ${
                rowError ? 'border-red-300 bg-red-50' : 'border-slate-200'
              }`}
            >
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-sm">
                  <span className="block font-medium">Day</span>
                  <select
                    value={row.day}
                    aria-label={`Day of sitting ${index + 1}`}
                    onChange={(event) => edit(index, { day: Number(event.target.value) })}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                  >
                    {DAYS.map((name, day) => (
                      <option key={name} value={day}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <TimeField
                  label="From"
                  value={row.start}
                  ariaLabel={`Start of sitting ${index + 1}`}
                  onChange={(start) => edit(index, { start })}
                />
                <TimeField
                  label="To"
                  value={row.end}
                  ariaLabel={`End of sitting ${index + 1}`}
                  onChange={(end) => edit(index, { end })}
                />

                <div className="ml-auto">
                  <Button variant="danger" onClick={() => remove(index)}>
                    Remove
                  </Button>
                </div>
              </div>

              {rowError && <p className="mt-2 text-xs text-red-700">{rowError}</p>}
            </div>
          );
        })}
      </div>

      <Button variant="quiet" onClick={() => onChange([...value, { ...NEW_ROW }])}>
        Add a sitting
      </Button>
    </fieldset>
  );
}

function TimeField({
  label,
  value,
  ariaLabel,
  onChange,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      <input
        type="time"
        value={value}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
      />
    </label>
  );
}
