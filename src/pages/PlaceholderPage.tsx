type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Coming in later phases
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
        </div>
        <div className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
          Placeholder
        </div>
      </div>
      <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
        {description}
      </p>
    </section>
  );
}
