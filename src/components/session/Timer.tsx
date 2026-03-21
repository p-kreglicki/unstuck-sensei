import { useTimerCountdown } from "../../hooks/useTimer";

type TimerProps = {
  firstStepText: string | null;
  isStopping: boolean;
  onStop(): void;
};

function formatRemaining(remainingSecs: number | null) {
  const total = Math.max(remainingSecs ?? 0, 0);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

export function Timer({
  firstStepText,
  isStopping,
  onStop,
}: TimerProps) {
  const remainingSecs = useTimerCountdown();

  return (
    <section className="rounded-[28px] border border-teal-300/20 bg-teal-300/10 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-200/80">Work block</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Stay with the next small move.</h2>
      <div className="mt-5 rounded-[28px] border border-white/10 bg-slate-950/70 px-6 py-8 text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Remaining</p>
        <p className="mt-3 text-6xl font-semibold tracking-[0.08em] text-white">
          {formatRemaining(remainingSecs)}
        </p>
      </div>

      <div className="mt-5 rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-slate-100">
        <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
          You&apos;re working on
        </p>
        <p className="mt-2 text-base leading-7">
          {firstStepText ?? "Stay with the first step you picked."}
        </p>
      </div>

      <p className="mt-4 text-sm leading-6 text-teal-50/80">
        Keep it narrow. You only need to get started, not finish everything.
      </p>

      <button
        className="mt-5 w-full rounded-2xl border border-white/15 px-4 py-3 font-medium text-white transition hover:border-white/30 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isStopping}
        onClick={onStop}
        type="button"
      >
        {isStopping ? "Stopping…" : "Stop timer"}
      </button>
    </section>
  );
}
