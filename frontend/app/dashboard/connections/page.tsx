import Link from "next/link";
import { fmtRelative } from "@/lib/format";
import { disconnectProviderAction, getConnectionStatus } from "./actions";

type Provider = {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
  authMode: "oauth" | "credentials";
  warning?: string;
};

// V1: Strava is the only live integration. Garmin / Oura / Whoop / Polar all
// auto-sync to Strava, so we "inherit" them without paying Terra. Garmin's
// unofficial API has been pulled from the UI to avoid setting an expectation
// we can't keep stable — the code path still exists in the backend for V2.
const PROVIDERS: Provider[] = [
  {
    id: "strava",
    name: "Strava",
    desc: "Activities, splits, pace, HR, power, elevation. Auto-syncs from Garmin, Apple Watch, Polar, COROS, Suunto, Wahoo and 9 more.",
    enabled: true,
    authMode: "oauth",
  },
  {
    id: "oura",
    name: "Oura Ring",
    desc: "Sleep, HRV, readiness, body temperature.",
    enabled: false,
    authMode: "oauth",
  },
  {
    id: "whoop",
    name: "Whoop",
    desc: "Recovery, strain, sleep, workouts.",
    enabled: false,
    authMode: "oauth",
  },
];

type SearchParams = {
  provider?: string;
  status?: string;
};

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const banner = buildBanner(params);

  // Fetch status for each enabled provider in parallel.
  const statuses = await Promise.all(
    PROVIDERS.filter((p) => p.enabled).map(async (p) => ({
      id: p.id,
      status: await getConnectionStatus(p.id),
    })),
  );
  const statusById = Object.fromEntries(statuses.map((s) => [s.id, s.status]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="evr-headline text-[clamp(34px,4.5vw,48px)] tracking-[-0.03em]">Connections</h1>
        <p className="mt-2 text-[15px] text-neutral-600">
          Connect your data sources. Tokens are encrypted with Fernet before they&apos;re stored.
        </p>
      </div>

      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            banner.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {banner.message}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {PROVIDERS.map((p) => {
          const status = statusById[p.id] ?? null;
          const isConnected = status?.connected ?? false;
          const lastSync = status?.last_sync_at ?? null;

          return (
            <div
              key={p.id}
              className={`rounded-2xl border border-neutral-200 bg-white p-4${
                p.enabled ? " evr-card-hover" : ""
              }`}
            >
              <div className="flex gap-4">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white text-[15px] font-semibold"
                  style={{ background: p.id === "strava" ? "#fc4c02" : "#c9bfb2" }}
                >
                  {p.id === "strava" ? (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                    </svg>
                  ) : (
                    p.name[0]
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-[-0.005em]">{p.name}</span>
                    {!p.enabled ? (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-[3px] text-[11px] font-medium text-neutral-500">
                        Coming soon
                      </span>
                    ) : isConnected ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-[3px] text-[11px] font-medium text-emerald-800">
                        <span className="evr-pulse h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Connected
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2.5 py-[3px] text-[11px] font-medium text-neutral-500">
                        Not connected
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-snug text-neutral-600">{p.desc}</p>
                  {isConnected && (
                    <p className="mt-1 text-[11.5px] text-neutral-500">
                      {lastSync ? `Last synced ${fmtRelative(lastSync)}` : "Not synced yet"}
                    </p>
                  )}
                  {p.warning && <p className="mt-2 text-[11.5px] text-amber-700">{p.warning}</p>}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {!p.enabled ? null : isConnected ? (
                  <form action={disconnectProviderAction}>
                    <input type="hidden" name="provider" value={p.id} />
                    <button
                      type="submit"
                      className="text-[13px] text-neutral-500 hover:text-neutral-950"
                    >
                      Disconnect
                    </button>
                  </form>
                ) : p.authMode === "credentials" ? (
                  <Link
                    href={`/dashboard/connections/${p.id}`}
                    className="inline-flex items-center justify-center rounded-md bg-neutral-950 px-4 py-2 text-[13px] font-medium text-white hover:bg-neutral-800"
                  >
                    Connect {p.name}
                  </Link>
                ) : (
                  <a
                    href={`/connect/${p.id}`}
                    className="inline-flex items-center justify-center rounded-md bg-neutral-950 px-4 py-2 text-[13px] font-medium text-white hover:bg-neutral-800"
                  >
                    Connect {p.name}
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildBanner(
  params: SearchParams,
): { tone: "ok" | "warn"; message: string } | null {
  const { provider, status } = params;
  if (!provider || !status) return null;

  if (status === "connected") {
    return { tone: "ok", message: `${capitalize(provider)} connected — initial sync complete 🎉` };
  }
  if (status === "connected_no_sync") {
    return {
      tone: "warn",
      message: `${capitalize(provider)} connected, but the first sync failed. Try "Sync last 30 days" manually.`,
    };
  }
  if (status === "synced") {
    return { tone: "ok", message: `Sync complete for ${capitalize(provider)}.` };
  }
  if (status === "sync_started") {
    return {
      tone: "ok",
      message: `Backfill started for ${capitalize(provider)} — it runs in the background and typically takes 3–5 minutes. Reload the page in a couple of minutes to see the updated date range.`,
    };
  }
  if (status === "disconnected") {
    return { tone: "ok", message: `${capitalize(provider)} disconnected.` };
  }
  if (status.startsWith("denied")) {
    return { tone: "warn", message: `You declined access on ${capitalize(provider)}.` };
  }
  return { tone: "warn", message: `Status from ${capitalize(provider)}: ${status}` };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
