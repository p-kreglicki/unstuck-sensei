import { CLARIFYING_ANSWER_MAX_LENGTH } from "../../lib/session-input-limits";

type ClarifyingQuestionProps = {
  answer: string;
  isSubmitting: boolean;
  onAnswerChange(value: string): void;
  onSubmit(): void;
  question: string;
};

export function ClarifyingQuestion({
  answer,
  isSubmitting,
  onAnswerChange,
  onSubmit,
  question,
}: ClarifyingQuestionProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
        Clarify once
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-white">
        One quick question before we break it down
      </h2>
      <p className="mt-4 rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-4 text-base leading-7 text-slate-100">
        {question}
      </p>

      <label className="mt-5 block">
        <span className="mb-2 block text-sm text-slate-300">Your answer</span>
        <textarea
          className="min-h-28 w-full rounded-3xl border border-white/10 bg-slate-950/70 px-4 py-4 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300"
          disabled={isSubmitting}
          maxLength={CLARIFYING_ANSWER_MAX_LENGTH}
          onChange={(event) => onAnswerChange(event.currentTarget.value)}
          placeholder="The real snag is..."
          value={answer}
        />
      </label>

      <button
        className="mt-5 w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || answer.trim().length === 0}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Refining…" : "Give me the steps"}
      </button>
    </section>
  );
}
