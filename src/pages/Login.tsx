import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

export function Login() {
  const { isLoading, session, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  if (session) {
    return <Navigate replace to="/" />;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatusMessage(null);

    const action = mode === "sign-in" ? signIn : signUp;
    const { error } = await action(email.trim(), password);

    if (error) {
      setStatusMessage(error.message);
      return;
    }

    setStatusMessage(
      mode === "sign-in"
        ? "Signed in. Redirecting into the app shell."
        : "Account created. If email confirmation is enabled later, Supabase will prompt for verification.",
    );
  }

  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col justify-between rounded-[32px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-teal-300/80">
            Desktop Foundation
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
            Show up. Break it down. Start.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            This Phase 1 screen validates the desktop auth path before the coaching flow lands. Email and password are the must-have path; magic links come next.
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
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300"
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
                className="w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-teal-300"
                onChange={(event) => setPassword(event.currentTarget.value)}
                placeholder="••••••••"
                type="password"
                value={password}
              />
            </label>

            <button
              className="w-full rounded-2xl bg-teal-400 px-4 py-3 font-medium text-slate-950 transition hover:bg-teal-300 disabled:cursor-not-allowed disabled:opacity-60"
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

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Magic links are a stretch goal for this phase.</span>
            <span>PKCE + deep links next.</span>
          </div>

          {statusMessage ? (
            <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-slate-200">
              {statusMessage}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
