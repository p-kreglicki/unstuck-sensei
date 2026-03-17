export function LoadingCard() {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
        Loading session
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-400">
        Pulling your current draft and recent sessions into place.
      </p>
    </section>
  );
}
