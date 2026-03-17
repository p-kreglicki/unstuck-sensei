import { memo } from "react";
import type { TranscriptRow } from "../../hooks/useSessionFlow";

export function TranscriptCard({
  rows,
  streamingRow,
}: {
  rows: TranscriptRow[];
  streamingRow: TranscriptRow | null;
}) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
        Conversation
      </p>
      <div className="mt-4 space-y-3">
        <HistoricalTranscriptRows rows={rows} />
        {streamingRow ? <TranscriptBubble row={streamingRow} transient /> : null}
      </div>
    </section>
  );
}

const HistoricalTranscriptRows = memo(function HistoricalTranscriptRows({
  rows,
}: {
  rows: TranscriptRow[];
}) {
  return (
    <>
      {rows.map((row) => (
        <TranscriptBubble key={row.id} row={row} transient={false} />
      ))}
    </>
  );
});

function TranscriptBubble({
  row,
  transient,
}: {
  row: TranscriptRow;
  transient: boolean;
}) {
  return (
    <div
      className={[
        "rounded-3xl px-4 py-4 text-sm leading-6",
        row.role === "assistant"
          ? "border border-teal-300/15 bg-teal-300/10 text-teal-50"
          : "border border-white/10 bg-slate-950/70 text-slate-100",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
          {row.role === "assistant" ? "Sensei" : "You"}
        </span>
        {transient ? (
          <span className="text-[11px] uppercase tracking-[0.24em] text-teal-200/70">
            Streaming
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap">{row.content}</p>
    </div>
  );
}
