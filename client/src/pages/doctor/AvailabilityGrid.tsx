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
 * and answers with a message per row — this component's job is to put those
 * messages back on the rows, and the fields, they came from.
 */

/**
 * Everything the server said about one row.
 *
 * Two different keys arrive for the same row. `superRefine` reports a clash
 * between sittings as `workingHours.<index>`, while a field that failed on its
 * own — a time box left empty is the common one — comes back as
 * `workingHours.<index>.start`. Reading only the first would leave a doctor
 * staring at "Some fields need fixing" with no row marked at all.
 */
function problemsIn(errors: Record<string, string>, index: number) {
  const at = `workingHours.${index}`;
  const row = errors[at];
  const day = errors[`${at}.day`];
  const start = errors[`${at}.start`];
  const end = errors[`${at}.end`];
  return { row: row ?? day ?? start ?? end, day, start, end };
}

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
          const problems = problemsIn(errors, index);
          const rowError = problems.row;

          return (
            <div
              // Index as the key, deliberately: these rows have no id of their
              // own, and the server's messages address them by position too.
              // Which is also why the form drops those messages whenever this
              // list changes — positions shift, the messages do not follow.
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
                  invalid={problems.start !== undefined}
                  onChange={(start) => edit(index, { start })}
                />
                <TimeField
                  label="To"
                  value={row.end}
                  ariaLabel={`End of sitting ${index + 1}`}
                  invalid={problems.end !== undefined}
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
  invalid,
  onChange,
}: {
  label: string;
  value: string;
  ariaLabel: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      <input
        type="time"
        value={value}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 ${
          invalid ? 'border-red-400' : 'border-slate-300 focus:border-brand-500'
        }`}
      />
    </label>
  );
}
