import { CLARIFYING_ANSWER_MAX_LENGTH } from "../../../shared/session/session-input-limits.js";

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
    <div className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Your reply</p>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          Answer briefly so the next steps stay tight and usable.
        </p>
      </div>

      <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm leading-6 text-slate-300">
        Replying to: {question}
      </p>

      <label className="block">
        <span className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-400">
          Clarifying reply
        </span>
        <textarea
          className="min-h-28 w-full rounded-[28px] border border-white/10 bg-slate-950/80 px-4 py-4 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300"
          disabled={isSubmitting}
          maxLength={CLARIFYING_ANSWER_MAX_LENGTH}
          onChange={(event) => onAnswerChange(event.currentTarget.value)}
          placeholder="The real snag is..."
          value={answer}
        />
      </label>

      <button
        className="w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitting || answer.trim().length === 0}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Refining…" : "Give me the steps"}
      </button>
    </div>
  );
}
