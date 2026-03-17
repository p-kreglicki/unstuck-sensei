import type { SessionStep } from "../../../shared/session/session-protocol.js";

export function ConfirmedCard({ steps }: { steps: SessionStep[] }) {
  return (
    <section className="rounded-[28px] border border-emerald-300/15 bg-emerald-300/10 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-emerald-200/80">
        Locked in
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        Good. You know your first step.
      </h2>
      <p className="mt-3 text-sm leading-6 text-emerald-50/80">
        Phase 4 will turn this into the real timer start. For now the plan is saved and your first move is clear.
      </p>
      <ol className="mt-5 space-y-3">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="rounded-3xl border border-white/10 bg-slate-950/60 px-4 py-4 text-slate-100"
          >
            <span className="mr-3 text-sm text-teal-300">{index + 1}.</span>
            {step.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
