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
      className="inline-flex h-11 items-center gap-1 rounded-full border border-line bg-surface p-1 shadow-card"
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
            className={`h-9 rounded-full px-4 text-sm font-semibold transition ${
              active ? 'bg-brand-600 text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
