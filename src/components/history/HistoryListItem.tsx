import { Link } from "react-router";
import type { SessionHistoryItem } from "../../lib/session-records";

const badgeClassName =
  "rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium";
const statusToneClassName: Record<string, string> = {
  default: "bg-white/5 text-slate-300",
  incomplete: "border-amber-300/20 bg-amber-300/10 text-amber-100",
};

const energyLabels: Record<string, string> = {
  high: "High energy",
  low: "Low energy",
  medium: "Medium energy",
};

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function HistoryListItem({ session }: { session: SessionHistoryItem }) {
  return (
    <Link
      className="block rounded-[24px] border border-white/10 bg-white/5 p-4 transition hover:border-white/20 hover:bg-white/10"
      to={`/history/${session.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            {formatDateTime(session.created_at)}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {session.stuck_on?.trim() || "Untitled session"}
          </h2>
        </div>
        {session.status === "incomplete" ? (
          <span className={`${badgeClassName} ${statusToneClassName.incomplete}`}>
            Incomplete
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className={`${badgeClassName} ${statusToneClassName.default}`}>
          {session.energy_level ? energyLabels[session.energy_level] : "Energy not set"}
        </span>
        <span className={`${badgeClassName} ${statusToneClassName.default}`}>
          {session.feedback ? feedbackLabels[session.feedback] : "No feedback"}
        </span>
        <span className={`${badgeClassName} ${statusToneClassName.default}`}>
          {session.source ? sourceLabels[session.source] : "Unknown source"}
        </span>
      </div>
    </Link>
  );
}
