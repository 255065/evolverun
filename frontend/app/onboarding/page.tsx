import Image from "next/image";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
import { startCheckoutAction } from "@/app/dashboard/account/actions";
import {
  connectProviderAction,
  getConnectionStatus,
} from "@/app/dashboard/connections/actions";
import { createClient } from "@/lib/supabase/server";
import { formatSpan } from "./history-span";

export const dynamic = "force-dynamic";

// The onboarding funnel: connect Strava (before payment, as the sunk-cost hook)
// → see the *quantity* of your synced history (no analysis given away) → hard
// paywall → dashboard. A user who already subscribed is sent straight to the
// product; a user who connected but hasn't paid keeps landing here (dormant).

type SearchParams = { status?: string; provider?: string };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Already paying? Skip the funnel.
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();
  const sub = profile?.subscription_status;
  if (sub === "active" || sub === "trialing") redirect("/dashboard");

  const conn = await getConnectionStatus("strava");
  const connected = conn?.connected ?? false;

  // When connected, pull only the *shape* of the value — how much is waiting —
  // never the analysis itself. That stays behind the paywall.
  let activityCount = 0;
  let oldestISO: string | null = null;
  if (connected) {
    const { count } = await supabase
      .from("workouts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("source", "strava");
    activityCount = count ?? 0;

    const { data: oldest } = await supabase
      .from("workouts")
      .select("started_at")
      .eq("user_id", user.id)
      .eq("source", "strava")
      .order("started_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    oldestISO = oldest?.started_at ?? null;
  }

  const syncFailed = params.status === "connected_no_sync";
  const denied = params.status?.startsWith("denied") ?? false;
  const span = formatSpan(oldestISO);

  return (
    <div className="flex min-h-screen flex-col bg-[#fbfaf7] text-neutral-950">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <Image src="/evr-logo.png" alt="" width={20} height={20} className="h-5 w-5" />
          EvolveRun
        </span>
        <form action={logoutAction}>
          <button type="submit" className="text-[13px] text-neutral-500 hover:text-neutral-950">
            Sign out
          </button>
        </form>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-md">
          {connected ? (
            /* ─── Connected: sell the quantity, then the hard paywall ─── */
            <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#dc6b3f]">
                ● Ready
              </div>

              {activityCount > 0 ? (
                <div className="mt-4 rounded-xl border border-neutral-200 bg-[#fbfaf7] px-5 py-4">
                  <div className="flex items-baseline gap-2">
                    <span className="evr-headline text-[40px] leading-none tracking-[-0.03em]">
                      {activityCount.toLocaleString("en-GB")}
                    </span>
                    <span className="text-[15px] font-medium text-neutral-600">activities</span>
                  </div>
                  {span && <p className="mt-1 text-[13px] text-neutral-500">{span}, synced ✓</p>}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-neutral-200 bg-[#fbfaf7] px-5 py-4 text-[14px] text-neutral-600">
                  Strava connected — importing your history now.
                </div>
              )}

              <h1 className="evr-headline mt-6 text-[30px] tracking-[-0.03em]">
                Your coach is ready.
              </h1>
              <p className="mt-2 text-[14.5px] text-neutral-600">
                It&apos;s all loaded and waiting. Unlock EvolveRun to start asking your coach
                anything about your training.
              </p>

              {syncFailed && (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  Your first sync hit a snag — you can retry it from Connections once you&apos;re in.
                  You can still subscribe now.
                </p>
              )}

              <form action={startCheckoutAction.bind(null, "monthly")} className="mt-6">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md bg-neutral-950 px-5 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-neutral-800"
                >
                  Unlock your coach — €7.99/mo
                </button>
              </form>
              <form action={startCheckoutAction.bind(null, "yearly")} className="mt-2">
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-[13px] font-medium text-neutral-950 transition hover:bg-neutral-50"
                >
                  or €69 / year — save ~28%
                </button>
              </form>
              <p className="mt-4 text-center text-[12px] text-neutral-400">
                Cancel anytime · secured by Stripe
              </p>
            </div>
          ) : (
            /* ─── Not connected: promise the value, connect Strava ─── */
            <div className="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#dc6b3f]">
                ● Setting up
              </div>
              <h1 className="evr-headline mt-4 text-[30px] tracking-[-0.03em]">
                Connect Strava to meet your coach.
              </h1>
              <p className="mt-3 text-[14.5px] text-neutral-600">
                We&apos;ll load your full training history — every run, split, pace and heart-rate —
                so your AI coach answers from your real data, not a generic plan.
              </p>

              {denied && (
                <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  You declined access on Strava. Connect to continue.
                </p>
              )}

              <form action={connectProviderAction} className="mt-6">
                <input type="hidden" name="provider" value="strava" />
                <input type="hidden" name="next" value="/onboarding" />
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#fc4c02] px-5 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#e34500]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                    <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                  </svg>
                  Connect Strava
                </button>
              </form>
              <p className="mt-4 text-center text-[12px] text-neutral-400">
                Encrypted with Fernet · read-only · disconnect anytime
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
