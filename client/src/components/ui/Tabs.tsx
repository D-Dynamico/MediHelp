/**
 * A segmented control.
 *
 * Used for the doctor's appointment scopes. Arrow keys move between segments,
 * because a control that only responds to a mouse is a control some people
 * cannot use.
 */
export function Tabs<Value extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
  label: string;
}) {
  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();

    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="inline-flex h-9 items-center gap-1 rounded-sm bg-surface-sunken p-1"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`rounded-sm px-3 text-sm font-medium transition ${
              active ? 'bg-surface text-ink shadow-none ring-1 ring-line' : 'text-ink-muted'
            } h-7`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
