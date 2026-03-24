import type { EnergyLevel } from "../../../shared/session/session-protocol.js";

type EnergySelectorProps = {
  isSubmitting: boolean;
  onSelect(value: EnergyLevel): void;
  onSubmit(): void;
  value: EnergyLevel | null;
};

const options: Array<{
  description: string;
  label: string;
  value: EnergyLevel;
}> = [
  {
    description: "Give me the smallest possible first move.",
    label: "Low",
    value: "low",
  },
  {
    description: "I can handle a few solid steps.",
    label: "Medium",
    value: "medium",
  },
  {
    description: "Push me a little. I can handle harder steps.",
    label: "High",
    value: "high",
  },
];

export function EnergySelector({
  isSubmitting,
  onSelect,
  onSubmit,
  value,
}: EnergySelectorProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
            Choose your energy
          </p>
          <h3 className="mt-2 text-lg font-semibold text-white">
            Pick the amount of push that matches what you can actually do.
          </h3>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-400">
          Step 2
        </span>
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-400">
        Honest beats ambitious here. The smaller right move is better than the
        perfect one you won&apos;t start.
      </p>

      <div className="mt-4 space-y-3">
        {options.map((option) => {
          const active = value === option.value;

          return (
            <button
              key={option.value}
              className={[
                "w-full rounded-[24px] border px-4 py-4 text-left transition",
                active
                  ? "border-teal-300 bg-teal-300/15 text-white"
                  : "border-white/10 bg-slate-950/60 text-slate-200 hover:border-white/20 hover:bg-slate-950/80",
              ].join(" ")}
              disabled={isSubmitting}
              onClick={() => onSelect(option.value)}
              type="button"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-lg font-medium">{option.label}</span>
                <span className="rounded-full border border-white/10 px-3 py-1 text-xs uppercase tracking-[0.2em]">
                  {option.value}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {option.description}
              </p>
            </button>
          );
        })}
      </div>

      <button
        className="mt-4 w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || !value}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Thinking…" : "Break it down"}
      </button>
    </section>
  );
}
