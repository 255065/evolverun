import { createClient } from "@/lib/supabase/server";
import { loadBillingStatus, loadPrices, openBillingPortalAction } from "./actions";
import { ChangePasswordForm } from "./change-password-form";
import { DeleteAccountButton } from "./delete-button";
import { PlanPicker } from "./plan-picker";
import { derivePlanDisplay } from "./plan-pricing";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

type SearchParams = { checkout?: string; paywall?: string };

/**
 * Account page — three sections: profile, plan, danger zone. Mirrors the
 * Chirona layout exactly so the user has one mental model across both.
 * No nested cards, no busy chrome — text + a single action per section.
 */
export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pull the stored full_name and split it into First / Last for the form.
  // Single-word names go into First and leave Last empty, which feels right
  // for athletes who only enter one name on signup.
  const { data: profile } = user
    ? await supabase.from("profiles").select("full_name").eq("id", user.id).single()
    : { data: null };
  const fullName = (profile?.full_name ?? "").trim();
  const firstSpace = fullName.indexOf(" ");
  const firstName = firstSpace === -1 ? fullName : fullName.slice(0, firstSpace);
  const lastName = firstSpace === -1 ? "" : fullName.slice(firstSpace + 1);

  const billing = await loadBillingStatus();
  const isActive = billing?.has_subscription ?? false;
  const price = derivePlanDisplay(await loadPrices());
  const periodEnd = billing?.current_period_end
    ? new Date(billing.current_period_end).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-xl space-y-10 pb-16">
      <div>
        <h1 className="evr-headline text-[clamp(34px,4.5vw,48px)] tracking-[-0.03em]">Account</h1>
        <p className="mt-2 text-[15px] text-neutral-600">
          Update your profile and plan settings.
        </p>
      </div>

      {params.paywall === "1" && (
        <Banner tone="warn">
          EvolveRun requires an active subscription. Start one below to unlock the dashboard and the chat connector.
        </Banner>
      )}
      {params.checkout === "success" && (
        <Banner tone="ok">
          Subscription active. You&apos;re all set — happy training.
        </Banner>
      )}
      {params.checkout === "cancelled" && (
        <Banner tone="warn">
          Checkout cancelled. No charge was made. You can start again below.
        </Banner>
      )}

      {/* ─── Choose a plan (shown until subscribed) ─────────── */}
      {!isActive && (
        <section>
          <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
            Choose your plan
          </div>
          <PlanPicker />
        </section>
      )}

      {/* ─── Profile ───────────────────────────────────────── */}
      <Section eyebrow="Profile">
        <ProfileForm
          firstName={firstName}
          lastName={lastName}
          email={user?.email ?? ""}
        />
      </Section>

      {/* ─── Change password (modal trigger, no section header) ── */}
      <div className="border-t border-neutral-200 pt-6">
        <ChangePasswordForm />
      </div>

      {/* ─── Plan ──────────────────────────────────────────── */}
      <Section eyebrow="Plan">
        <div className="flex items-baseline gap-3">
          <span className="text-[18px] font-semibold tracking-[-0.01em]">
            {planName(billing?.status)}
          </span>
          <StatusPill status={billing?.status ?? null} />
        </div>
        {periodEnd && (
          <p className="mt-1.5 text-[13.5px] text-neutral-600">
            {isActive ? `Renews on ${periodEnd}. ${price.monthly} per month.` : `Ended on ${periodEnd}.`}
          </p>
        )}
        {!periodEnd && !isActive && (
          <p className="mt-1.5 text-[13.5px] text-neutral-600">
            {price.monthly} per month. Cancel anytime.
          </p>
        )}

        {isActive ? (
          <div className="mt-4">
            <form action={openBillingPortalAction}>
              <button
                type="submit"
                className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-5 py-2 text-[13px] font-medium text-neutral-950 transition hover:bg-neutral-50"
              >
                View billing
              </button>
            </form>
          </div>
        ) : (
          <p className="mt-3 text-[12.5px] text-neutral-500">
            Choose a plan above to subscribe.
          </p>
        )}
        {billing === null && (
          <p className="mt-3 text-[12.5px] text-amber-800">
            Billing status unavailable — Stripe may not be configured yet.
          </p>
        )}
      </Section>

      {/* ─── Danger zone ───────────────────────────────────── */}
      <Section eyebrow="Danger zone" tone="danger">
        <p className="text-[13.5px] text-neutral-600">
          Permanently delete your account and all associated data. This cannot be undone.
        </p>
        <div className="mt-3">
          <DeleteAccountButton />
        </div>
      </Section>
    </div>
  );
}

function Section({
  eyebrow,
  tone = "default",
  children,
}: {
  eyebrow: string;
  tone?: "default" | "danger";
  children: React.ReactNode;
}) {
  const eyebrowCls = tone === "danger" ? "text-red-600" : "text-neutral-500";
  return (
    <section className="border-t border-neutral-200 pt-6">
      <div
        className={`mb-4 font-mono text-[11px] uppercase tracking-[0.18em] ${eyebrowCls}`}
      >
        {eyebrow}
      </div>
      {children}
    </section>
  );
}

function planName(status: string | null | undefined): string {
  if (status === "active" || status === "trialing") return "EvolveRun monthly";
  if (status === "past_due" || status === "unpaid") return "EvolveRun monthly";
  return "No plan";
}

function StatusPill({ status }: { status: string | null }) {
  const { label, cls } = pillStyle(status);
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-[2px] text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

function pillStyle(status: string | null): { label: string; cls: string } {
  switch (status) {
    case "active":
      return { label: "active", cls: "bg-emerald-100 text-emerald-800" };
    case "trialing":
      return { label: "trialing", cls: "bg-blue-100 text-blue-800" };
    case "past_due":
      return { label: "past due", cls: "bg-amber-100 text-amber-800" };
    case "canceled":
      return { label: "canceled", cls: "bg-neutral-200 text-neutral-700" };
    case "incomplete":
    case "incomplete_expired":
      return { label: "incomplete", cls: "bg-amber-100 text-amber-800" };
    case "unpaid":
      return { label: "unpaid", cls: "bg-red-100 text-red-800" };
    case "paused":
      return { label: "paused", cls: "bg-neutral-200 text-neutral-700" };
    default:
      return { label: "inactive", cls: "bg-neutral-200 text-neutral-700" };
  }
}

function Banner({ tone, children }: { tone: "ok" | "warn"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : "border-amber-200 bg-amber-50 text-amber-900";
  return <div className={`rounded-md border px-4 py-3 text-[13.5px] ${cls}`}>{children}</div>;
}
