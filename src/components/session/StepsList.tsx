import type { SessionStep } from "../../lib/session-flow";

type StepsListProps = {
  isRetrying: boolean;
  onConfirm(): void;
  onMoveDown(index: number): void;
  onMoveUp(index: number): void;
  onRetry(): void;
  steps: SessionStep[];
};

export function StepsList({
  isRetrying,
  onConfirm,
  onMoveDown,
  onMoveUp,
  onRetry,
  steps,
}: StepsListProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
            Your first moves
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">
            Tight enough to start right now
          </h2>
        </div>
        <button
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRetrying}
          onClick={onRetry}
          type="button"
        >
          {isRetrying ? "Retrying…" : "Try again"}
        </button>
      </div>

      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4"
          >
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-300 text-sm font-semibold text-slate-950">
                {index + 1}
              </div>
              <div className="flex-1">
                <p className="text-base leading-7 text-slate-100">{step.text}</p>
                <div className="mt-4 flex gap-2">
                  <button
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:border-white/20 hover:bg-white/5 disabled:opacity-40"
                    disabled={index === 0}
                    onClick={() => onMoveUp(index)}
                    type="button"
                  >
                    Up
                  </button>
                  <button
                    className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:border-white/20 hover:bg-white/5 disabled:opacity-40"
                    disabled={index === steps.length - 1}
                    onClick={() => onMoveDown(index)}
                    type="button"
                  >
                    Down
                  </button>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <button
        className="mt-5 w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300"
        onClick={onConfirm}
        type="button"
      >
        I know my first step
      </button>
    </section>
  );
}
