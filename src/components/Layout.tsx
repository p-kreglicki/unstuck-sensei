import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { useAuth } from "../hooks/useAuth";
import { type DetectionState, useDetection } from "../hooks/useDetection";
import { formatError } from "../lib/formatError";
import { DetectionNudgeBanner } from "./DetectionNudgeBanner";

const navItems = [
  { label: "Session", to: "/" },
  { label: "History", to: "/history" },
  { label: "Settings", to: "/settings" },
];

const debugActions: Array<{ command: DebugCommand; label: string }> = [
  { command: "get_detection_status", label: "Get status" },
  { command: "get_detection_debug", label: "Get debug" },
  { command: "pause_detection", label: "Pause" },
  { command: "resume_detection", label: "Resume" },
  { command: "dismiss_nudge", label: "Dismiss nudge" },
];

const interactivePanelClassName =
  "rounded-[18px] border border-white/10 bg-white/5 px-4 py-3";
const debugActionClassName =
  "rounded-[18px] border border-white/10 bg-white/5 px-3 py-2 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60";

type DetectionDebug = {
  appSwitchCount: number;
  idleSeconds: number;
  lastForegroundBundleId: string | null;
};

type DebugCommand =
  | "dismiss_nudge"
  | "get_detection_debug"
  | "get_detection_status"
  | "pause_detection"
  | "resume_detection";

function isDetectionStateResult(
  value: DetectionDebug | DetectionState | null,
): value is DetectionState {
  return !!value && "nudgeActive" in value;
}

function DetectionDebugPanel() {
  const { dismissNudge, pause, refreshStatus, resume, state } = useDetection();
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<DetectionDebug | DetectionState | null>(null);

  useEffect(() => {
    setResult((current) => (isDetectionStateResult(current) ? state : current));
  }, [state]);

  async function runCommand(command: DebugCommand) {
    setError(null);
    setIsRunning(true);

    try {
      switch (command) {
        case "get_detection_status": {
          const status = await refreshStatus();
          setResult(status);
          break;
        }
        case "get_detection_debug": {
          const debug = await invoke<DetectionDebug>("get_detection_debug");
          setResult(debug);
          break;
        }
        case "pause_detection":
          await pause();
          setResult(state);
          break;
        case "resume_detection":
          await resume();
          setResult(state);
          break;
        case "dismiss_nudge":
          await dismissNudge();
          setResult(state);
          break;
      }
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <section className="mt-6 rounded-[28px] border border-amber-400/20 bg-amber-400/10 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-amber-200/80">Debug</p>
          <h2 className="mt-2 text-lg font-semibold text-amber-50">Detection commands</h2>
        </div>
        <div className="rounded-full border border-amber-300/20 px-3 py-1 text-xs text-amber-100/80">
          Dev only
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {debugActions.map((action) => (
          <button
            key={action.command}
            className={debugActionClassName}
            disabled={isRunning}
            onClick={() => void runCommand(action.command)}
            type="button"
          >
            {action.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </p>
      ) : null}

      <pre className="mt-4 overflow-x-auto rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-xs leading-6 text-slate-200">
        {result ? JSON.stringify(result, null, 2) : "Run a command to inspect detection state."}
      </pre>
    </section>
  );
}

const detectionStatusLabels: Record<DetectionState["status"], string> = {
  active: "Detection active",
  cooldown: "Cooling down",
  disabled: "Detection off",
  notifying: "Notification live",
  paused: "Detection paused",
  suppressed: "Detection suppressed",
};

export function Layout() {
  const { isLoading, user, signOut } = useAuth();
  const { state } = useDetection();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col rounded-[32px] border border-white/10 bg-slate-950/70 p-5 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
              Unstuck Sensei
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-white">
              Foundation Shell
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              A lightweight desktop coach that notices friction and helps you get unstuck.
            </p>
          </div>
          <button
            className="rounded-full border border-white/10 px-3 py-1.5 text-sm text-slate-200 transition hover:border-white/30 hover:bg-white/5"
            disabled={isLoading}
            onClick={async () => {
              setStatusMessage(null);
              const { error } = await signOut();

              if (error) {
                setStatusMessage(error.message);
              }
            }}
            type="button"
          >
            Sign out
          </button>
        </div>

        <nav className="mt-6 grid grid-cols-3 gap-2 rounded-[18px] border border-white/10 bg-white/5 p-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "rounded-[18px] px-3 py-2 text-center text-sm font-medium transition",
                  isActive
                    ? "bg-teal-400 text-slate-950"
                    : "text-slate-300 hover:bg-white/5 hover:text-white",
                ].join(" ")
              }
              end={item.to === "/"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={`mt-6 flex items-center justify-between text-sm text-slate-300 ${interactivePanelClassName}`}>
          <span className="truncate">{user?.email ?? "Not signed in"}</span>
          <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
            {detectionStatusLabels[state.status]}
          </span>
        </div>

        {statusMessage ? (
          <p className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
            {statusMessage}
          </p>
        ) : null}

        <DetectionNudgeBanner />

        {import.meta.env.DEV && isTauri() ? <DetectionDebugPanel /> : null}

        <div className="mt-6 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
