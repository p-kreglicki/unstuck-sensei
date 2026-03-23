import { STUCK_ON_MAX_LENGTH } from "../../../shared/session/session-input-limits.js";

type StuckInputProps = {
  helperText?: string | null;
  isSubmitting: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  reminder?: string | null;
  value: string;
};

export function StuckInput({
  helperText,
  isSubmitting,
  onChange,
  onSubmit,
  reminder,
  value,
}: StuckInputProps) {
  return (
    <div className="space-y-4">
      {reminder ? (
        <p className="rounded-2xl border border-amber-300/15 bg-amber-300/10 px-4 py-3 text-sm text-amber-100/90">
          {reminder}
        </p>
      ) : null}

      {helperText ? (
        <p className="rounded-2xl border border-teal-300/15 bg-teal-300/10 px-4 py-3 text-sm text-teal-100/90">
          {helperText}
        </p>
      ) : null}

      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Your reply</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Keep it concrete. Name the real thing you keep circling instead of doing.
        </p>
      </div>

      <label className="block">
        <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-400">
          The sticky task
        </span>
        <textarea
          className="min-h-32 w-full rounded-[28px] border border-white/10 bg-slate-950/80 px-4 py-4 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300"
          disabled={isSubmitting}
          maxLength={STUCK_ON_MAX_LENGTH}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="I keep bouncing between smaller tasks instead of shipping..."
          value={value}
        />
      </label>

      <button
        className="w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || value.trim().length === 0}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Saving…" : "Keep going"}
      </button>
    </div>
  );
}
