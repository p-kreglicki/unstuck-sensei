import { RefreshCw } from "lucide-react";
import type { SessionStep } from "../../../shared/session/session-protocol.js";

type StepsListProps = {
  isConfirming: boolean;
  isRetrying: boolean;
  onConfirm(): void;
  onRetry(): void;
  steps: SessionStep[];
};

export function StepsList({
  isConfirming,
  isRetrying,
  onConfirm,
  onRetry,
  steps,
}: StepsListProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
            Your first moves
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Start with the first one that feels concrete enough to do now.
          </h3>
        </div>
        <button
          aria-label={isRetrying ? "Retrying" : "Try again"}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/10 p-0 text-slate-200 transition hover:border-white/20 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isRetrying}
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden="true" color="white" size={16} />
        </button>
      </div>

      <ol className="mt-4 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-[24px] border border-white/10 bg-slate-950/70 px-4 py-4"
          >
            <div className="flex items-start gap-4">
              <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-300 text-sm font-semibold text-slate-950">
                {index + 1}
              </div>
              <div className="flex-1">
                <p className="text-sm leading-6 text-slate-100">{step.text}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <button
        className="mt-4 w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isConfirming}
        onClick={onConfirm}
        type="button"
      >
        {isConfirming ? "Starting timer…" : "Start 25-minute timer"}
      </button>
    </section>
  );
}
