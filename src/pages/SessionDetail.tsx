import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { parseSessionSteps } from "../../shared/session/session-protocol.js";
import { toDisplayError } from "../lib/errors";
import {
  loadConversationMessages,
  loadSessionDetail,
  loadSessionRecord,
  loadTimerBlocks,
  type SessionDetailResult,
  type SessionRow,
} from "../lib/session-records";

const badgeClassName =
  "rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium";

const feedbackLabels: Record<string, string> = {
  no: "Still stuck",
  somewhat: "Partly unstuck",
  yes: "Unstuck",
};

const sourceLabels: Record<string, string> = {
  detection: "Detection",
  email: "Email",
  manual: "Manual",
};

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not recorded";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

function SessionSummaryCard({ session }: { session: SessionRow }) {
  const steps = parseSessionSteps(session.steps);

  return (
    <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">Session detail</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">
        {session.stuck_on?.trim() || "Untitled session"}
      </h1>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={badgeClassName}>
          {session.source ? sourceLabels[session.source] : "Unknown source"}
        </span>
        <span className={badgeClassName}>
          {session.feedback ? feedbackLabels[session.feedback] : "No feedback"}
        </span>
        {session.status === "incomplete" ? (
          <span className={`${badgeClassName} border-amber-300/20 bg-amber-300/10 text-amber-100`}>
            Incomplete
          </span>
        ) : null}
      </div>

      <dl className="mt-5 grid gap-3 text-sm text-slate-300">
        <div>
          <dt className="text-slate-500">Started</dt>
          <dd>{formatDateTime(session.created_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Timer started</dt>
          <dd>{formatDateTime(session.timer_started_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Timer ended</dt>
          <dd>{formatDateTime(session.timer_ended_at)}</dd>
        </div>
      </dl>

      <div className="mt-5">
        <h2 className="text-sm font-medium text-white">Stored steps</h2>
        {steps.length > 0 ? (
          <ol className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            {steps.map((step, index) => (
              <li key={step.id} className="rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3">
                <span className="mr-3 text-slate-500">{index + 1}.</span>
                {step.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No structured steps were stored.</p>
        )}
      </div>
    </section>
  );
}

export function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [detail, setDetail] = useState<SessionDetailResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryingSection, setRetryingSection] = useState<
    "messages" | "session" | "timerBlocks" | null
  >(null);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!sessionId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);

      try {
        const nextDetail = await loadSessionDetail(sessionId);

        if (!active) {
          return;
        }

        setDetail(nextDetail);
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void run();

    return () => {
      active = false;
    };
  }, [sessionId]);

  async function retrySection(section: "messages" | "session" | "timerBlocks") {
    if (!sessionId) {
      return;
    }

    setRetryingSection(section);

    try {
      if (section === "session") {
        const session = await loadSessionRecord(sessionId);

        setDetail((current) =>
          current
            ? {
                ...current,
                session: session
                  ? {
                      data: session,
                      error: null,
                    }
                  : {
                      data: null,
                      error: "Unable to load this session summary.",
                    },
              }
            : current,
        );
        return;
      }

      if (section === "messages") {
        const messages = await loadConversationMessages(sessionId);

        setDetail((current) =>
          current
            ? {
                ...current,
                messages: {
                  data: messages,
                  error: null,
                },
              }
            : current,
        );
        return;
      }

      const timerBlocks = await loadTimerBlocks(sessionId);

      setDetail((current) =>
        current
          ? {
              ...current,
              timerBlocks: {
                data: timerBlocks,
                error: null,
              },
            }
          : current,
      );
    } catch (error) {
      const message = toDisplayError(error, "Unable to reload that section right now.");

      setDetail((current) =>
        current
          ? {
              ...current,
              [section]: {
                data: current[section].data,
                error: message,
              },
            }
          : current,
      );
    } finally {
      setRetryingSection(null);
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">History</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">Read-only review</h1>
        </div>
        <Link
          className="rounded-full border border-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/10"
          to="/history"
        >
          Back to history
        </Link>
      </div>

      {isLoading ? (
        <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-6 text-sm text-slate-300">
          Loading session detail…
        </div>
      ) : null}

      {!isLoading && detail?.session.data ? (
        <SessionSummaryCard session={detail.session.data} />
      ) : null}

      {!isLoading && detail?.session.error && !detail.session.data ? (
        <div className="rounded-[24px] border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100">
          <p>{detail.session.error}</p>
          <button
            className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
            disabled={retryingSection === "session"}
            onClick={() => void retrySection("session")}
            type="button"
          >
            {retryingSection === "session" ? "Retrying…" : "Retry summary"}
          </button>
        </div>
      ) : null}

      <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
        <h2 className="text-lg font-semibold text-white">Timer timeline</h2>
        {detail?.timerBlocks.error ? (
          <div className="mt-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <p>{detail.timerBlocks.error}</p>
            <button
              className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
              disabled={retryingSection === "timerBlocks"}
              onClick={() => void retrySection("timerBlocks")}
              type="button"
            >
              {retryingSection === "timerBlocks" ? "Retrying…" : "Retry timeline"}
            </button>
          </div>
        ) : detail?.timerBlocks.data && detail.timerBlocks.data.length > 0 ? (
          <ol className="mt-4 space-y-3">
            {detail.timerBlocks.data.map((block) => (
              <li
                key={block.id}
                className="rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm text-slate-300"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium capitalize text-white">{block.kind}</span>
                  <span>{formatDuration(block.duration_seconds)}</span>
                </div>
                <p className="mt-2 text-slate-400">
                  {formatDateTime(block.started_at)} to {formatDateTime(block.ended_at)}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No timer blocks were stored.</p>
        )}
      </section>

      <section className="rounded-[24px] border border-white/10 bg-white/5 p-5">
        <h2 className="text-lg font-semibold text-white">Transcript</h2>
        {detail?.messages.error ? (
          <div className="mt-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            <p>{detail.messages.error}</p>
            <button
              className="mt-3 rounded-full border border-white/10 px-4 py-2 text-white transition hover:bg-white/10"
              disabled={retryingSection === "messages"}
              onClick={() => void retrySection("messages")}
              type="button"
            >
              {retryingSection === "messages" ? "Retrying…" : "Retry transcript"}
            </button>
          </div>
        ) : detail?.messages.data && detail.messages.data.length > 0 ? (
          <div className="mt-4 space-y-3">
            {detail.messages.data.map((message) => (
              <div
                key={message.id}
                className="rounded-[18px] border border-white/10 bg-slate-950/40 px-4 py-3 text-sm leading-6 text-slate-300"
              >
                <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
                  {message.role}
                </p>
                <p className="mt-2 whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No transcript was captured for this session.</p>
        )}
      </section>
    </section>
  );
}
