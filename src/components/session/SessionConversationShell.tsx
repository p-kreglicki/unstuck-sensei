import type { ReactNode } from "react";
import type {
  SessionThreadControlItem,
  SessionThreadItem,
} from "../../lib/session-thread";

type SessionConversationShellProps = {
  composer?: ReactNode;
  items: SessionThreadItem[];
  renderControl?(control: SessionThreadControlItem["control"]): ReactNode | null;
};

const roleLabels = {
  assistant: "Sensei",
  user: "You",
} as const;

export function SessionConversationShell({
  composer,
  items,
  renderControl,
}: SessionConversationShellProps) {
  return (
    <section
      aria-labelledby="conversation-heading"
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-white/[0.04] shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur"
    >
      <div className="border-b border-white/10 bg-white/[0.03] px-4 py-4">
        <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
          Session chat
        </p>
        <h2 id="conversation-heading" className="mt-2 text-lg font-semibold text-white">
          Conversation
        </h2>
      </div>

      <div
        aria-labelledby="conversation-heading"
        aria-relevant="additions text"
        className="min-h-0 flex-1 overflow-y-auto px-4 py-5"
        role="log"
      >
        <div className="space-y-4">
          {items.map((item) => {
            if (item.kind === "control") {
              const renderedControl = renderControl?.(item.control) ?? null;

              return renderedControl ? (
                <div key={item.id} className="pt-2">
                  {renderedControl}
                </div>
              ) : null;
            }

            const isUser = item.role === "user";
            const isPrompt = item.kind === "prompt";
            const isStreaming = item.kind === "message" && item.status === "streaming";

            return (
              <article
                key={item.id}
                className={isUser ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={[
                    "max-w-[86%] rounded-[28px] border px-4 py-4 shadow-sm",
                    isUser
                      ? "border-white/10 bg-slate-950/80 text-slate-100"
                      : isPrompt
                        ? "border-white/10 bg-white/[0.05] text-slate-100"
                        : "border-teal-300/20 bg-teal-300/10 text-teal-50",
                  ].join(" ")}
                >
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.24em] text-slate-400">
                      {roleLabels[item.role]}
                    </span>
                    {isStreaming ? (
                      <span className="text-[11px] uppercase tracking-[0.24em] text-teal-100/70">
                        Streaming
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-6">{item.content}</p>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {composer ? (
        <div className="border-t border-white/10 bg-slate-950/80 px-4 py-4 backdrop-blur">
          {composer}
        </div>
      ) : null}
    </section>
  );
}
