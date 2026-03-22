import { privacyBoundary, privacyBoundaryIntro } from "../../lib/privacy-boundary";

const listStyles = "mt-3 space-y-2 text-sm leading-6 text-slate-400";

export function PrivacyDashboard() {
  return (
    <section className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
      <p className="text-xs uppercase tracking-[0.3em] text-teal-300/80">Privacy</p>
      <p className="mt-3 text-sm leading-6 text-slate-300">{privacyBoundaryIntro}</p>

      <div className="mt-5 grid gap-5">
        <div>
          <h2 className="text-sm font-medium text-white">Tracked locally</h2>
          <ul className={listStyles}>
            {privacyBoundary.trackedLocally.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-white">Sent to the server</h2>
          <ul className={listStyles}>
            {privacyBoundary.sentToServer.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-sm font-medium text-white">Never collected</h2>
          <ul className={listStyles}>
            {privacyBoundary.neverCollected.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
