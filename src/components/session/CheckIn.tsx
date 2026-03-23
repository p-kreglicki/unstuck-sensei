import type { SessionRow } from "../../lib/session-records";

type CheckInProps = {
  canExtend: boolean;
  firstStepText: string | null;
  isSubmitting: boolean;
  onExtend(): void;
  onFeedback(feedback: NonNullable<SessionRow["feedback"]>): void;
};

const feedbackOptions: Array<{
  feedback: NonNullable<SessionRow["feedback"]>;
  label: string;
}> = [
  { feedback: "yes", label: "Yes, I got started" },
  { feedback: "somewhat", label: "Somewhat" },
  { feedback: "no", label: "Not really" },
];

export function CheckIn({
  canExtend,
  firstStepText,
  isSubmitting,
  onExtend,
  onFeedback,
}: CheckInProps) {
  return (
    <section className="rounded-[28px] border border-amber-300/20 bg-amber-300/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">
            Check-in
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Time&apos;s up. How did it go?
          </h3>
        </div>
        <span className="rounded-full border border-amber-200/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-amber-100/80">
          {canExtend ? "1 extension left" : "Extension used"}
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-amber-50/80">
        The point was to begin. Give the honest version and keep moving.
      </p>

      <div className="mt-4 rounded-[24px] border border-white/10 bg-slate-950/60 px-4 py-4 text-slate-100">
        <p className="text-xs uppercase tracking-[0.2em] text-amber-200/80">
          First step
        </p>
        <p className="mt-2 text-base leading-7">
          {firstStepText ?? "The first step you chose is still the anchor."}
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {feedbackOptions.map((option) => (
          <button
            key={option.feedback}
            className="w-full rounded-[22px] border border-white/10 bg-slate-950/65 px-4 py-3 text-left font-medium text-white transition hover:border-amber-200/20 hover:bg-slate-950/80 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
            onClick={() => onFeedback(option.feedback)}
            type="button"
          >
            {option.label}
          </button>
        ))}
      </div>

      {canExtend ? (
        <button
          className="mt-4 w-full rounded-2xl border border-white/15 px-4 py-3 font-medium text-white transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSubmitting}
          onClick={onExtend}
          type="button"
        >
          {isSubmitting ? "Saving…" : "Keep going (+25 min)"}
        </button>
      ) : null}
    </section>
  );
}
