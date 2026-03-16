import type { EnergyLevel } from "../../lib/session-flow";

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
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
        Step 2
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        What kind of energy do you have right now?
      </h2>
      <div className="mt-5 space-y-3">
        {options.map((option) => {
          const active = value === option.value;

          return (
            <button
              key={option.value}
              className={[
                "w-full rounded-3xl border px-4 py-4 text-left transition",
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
        className="mt-5 w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || !value}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Thinking…" : "Break it down"}
      </button>
    </section>
  );
}
