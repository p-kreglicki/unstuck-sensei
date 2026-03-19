import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

type AuthFeedback = {
  message: string;
  tone: "error" | "success";
};

const authFieldClassName =
  "w-full rounded-[18px] border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300";
const authSubmitClassName =
  "w-full rounded-[18px] bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60";
const authFeedbackStyles: Record<AuthFeedback["tone"], string> = {
  error: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  success: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
};

export function Login() {
  const { isLoading, session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);

  if (session) {
    return <Navigate replace to="/" />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const action = mode === "sign-in" ? signIn : signUp;
    const { error } = await action(email.trim(), password);

    if (error) {
      setFeedback({
        message: error.message,
        tone: "error",
      });
      return;
    }

    setFeedback({
      message:
        mode === "sign-in"
          ? "Signed in. Redirecting into Unstuck Sensei."
          : "Account created. Sign in with your new credentials to enter the app.",
      tone: "success",
    });
  }

  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col justify-between rounded-[32px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">Unstuck Sensei</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
            Show up. Break it down. Start.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            Sign in to the desktop coach that notices friction, captures what is blocking you, and helps you start.
          </p>
        </div>

        <div className="mt-8 rounded-[28px] border border-white/10 bg-white/5 p-5">
          <div className="mb-5 inline-flex rounded-full border border-white/10 bg-slate-900/60 p-1">
            {(["sign-in", "sign-up"] as const).map((nextMode) => (
              <button
                key={nextMode}
                className={[
                  "rounded-full px-4 py-2 text-sm font-medium capitalize transition",
                  mode === nextMode
                    ? "bg-teal-400 text-slate-950"
                    : "text-slate-300 hover:text-white",
                ].join(" ")}
                onClick={() => setMode(nextMode)}
                type="button"
              >
                {nextMode.replace("-", " ")}
              </button>
            ))}
          </div>

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Email</span>
              <input
                autoComplete="email"
                className={authFieldClassName}
                onChange={(event) => setEmail(event.currentTarget.value)}
                placeholder="founder@example.com"
                type="email"
                value={email}
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Password</span>
              <input
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                className={authFieldClassName}
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="••••••••"
                type="password"
                value={password}
              />
            </label>

            <button
              className={authSubmitClassName}
              disabled={isLoading}
              type="submit"
            >
              {isLoading
                ? "Working…"
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          {feedback ? (
            <p
              aria-live={feedback.tone === "error" ? "assertive" : "polite"}
              className={`mt-4 rounded-[18px] border px-4 py-3 text-sm ${authFeedbackStyles[feedback.tone]}`}
              role={feedback.tone === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
