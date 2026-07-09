import Image from "next/image";
import { redirect } from "next/navigation";
import { logoutAction } from "@/app/(auth)/actions";
import { PlanPicker } from "@/app/dashboard/account/plan-picker";
import { getConnectionStatus } from "@/app/dashboard/connections/actions";
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
        {connected ? (
          /* ─── Connected: Strava logo + synced count, then the two-card paywall ─── */
          <div className="w-full max-w-2xl">
            <div className="text-center">
              {/* Strava logo + connection status */}
              <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[12px] font-medium text-neutral-700 shadow-sm">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-[#fc4c02]" fill="currentColor">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
                Strava connected
              </div>

              {/* Synced activity count */}
              {activityCount > 0 ? (
                <div className="mt-5">
                  <div className="flex items-baseline justify-center gap-2">
                    <span className="evr-headline text-[52px] leading-none tracking-[-0.03em]">
                      {activityCount.toLocaleString("en-GB")}
                    </span>
                    <span className="text-[17px] font-medium text-neutral-600">
                      activities synced
                    </span>
                  </div>
                  {span && <p className="mt-1.5 text-[13.5px] text-neutral-500">{span} ✓</p>}
                </div>
              ) : (
                <p className="mt-5 text-[15px] text-neutral-600">
                  Strava connected — importing your history now.
                </p>
              )}

              <h1 className="evr-headline mt-6 text-[30px] tracking-[-0.03em]">
                Your AI coach is ready.
              </h1>
              <p className="mx-auto mt-2 max-w-md text-[14.5px] text-neutral-600">
                It&apos;s all loaded and waiting. Choose a plan to start asking your coach
                anything about your training.
              </p>

              {syncFailed && (
                <p className="mx-auto mt-4 max-w-md rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
                  Your first sync hit a snag — you can retry it from Connections once you&apos;re in.
                  You can still subscribe now.
                </p>
              )}
            </div>

            {/* Two-card monthly / yearly paywall */}
            <div className="mt-8">
              <PlanPicker />
            </div>
            <p className="mt-4 text-center text-[12px] text-neutral-400">
              Cancel anytime · secured by Stripe
            </p>
          </div>
        ) : (
          /* ─── Not connected: promise the value, connect Strava ─── */
          <div className="w-full max-w-md">
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

              {/* Plain <a>, not <Link>: /connect/[provider] is a route handler
                  (not a page). We need a full top-level navigation so its
                  redirect to Strava's external authorize URL fires, and we must
                  avoid <Link> prefetch invoking the OAuth-start handler early. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/connect/strava?next=/onboarding"
                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#fc4c02] px-5 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#e34500]"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
                </svg>
                Connect Strava
              </a>
              <p className="mt-4 text-center text-[12px] text-neutral-400">
                Encrypted with Fernet · read-only · disconnect anytime
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
