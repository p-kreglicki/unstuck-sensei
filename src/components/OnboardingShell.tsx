import type { ReactNode } from "react";
import { TitleBarDragRegion } from "./TitleBarDragRegion";

type OnboardingShellProps = {
  children: ReactNode;
};

export function OnboardingShell({ children }: OnboardingShellProps) {
  return (
    <div className="min-h-screen bg-transparent px-4 py-5 text-slate-100">
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] w-full max-w-md flex-col justify-between rounded-[32px] border border-white/10 bg-slate-950/70 p-6 shadow-2xl shadow-slate-950/50 backdrop-blur">
        <TitleBarDragRegion />
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">
            Unstuck Sensei
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
            Finish setup before the next work block.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-slate-400">
            Pick the defaults we need for focus detection and daily check-ins, then
            drop straight into the session flow.
          </p>
        </div>

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
