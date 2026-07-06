import { loadPrices, startCheckoutAction } from "./actions";
import { derivePlanDisplay } from "./plan-pricing";

// Shown on the paywall right after signup so a new user picks a plan before the
// dashboard. Each card binds the plan into the checkout server action, so the
// Stripe Checkout uses the matching price.

const MONTHLY_FEATS = [
  "Claude & ChatGPT MCP access",
  "Full Strava history, auto-synced",
  "Load, recovery & trend analysis",
  "Adaptive week & race plans",
  "Cancel anytime",
];

const ANNUAL_FEATS = [
  "Everything in Pro Monthly",
  "Unlimited AI coach conversations",
  "Year-round training context",
  "Cancel anytime",
];

function Check() {
  return (
    <svg viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-950" fill="none">
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DARK_BTN =
  "inline-flex w-full items-center justify-center rounded-md bg-neutral-950 px-5 py-2.5 text-[13px] font-medium text-white shadow-sm transition hover:bg-neutral-800";
const OUTLINE_BTN =
  "inline-flex w-full items-center justify-center rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-[13px] font-medium text-neutral-950 transition hover:bg-neutral-50";

export async function PlanPicker() {
  const price = derivePlanDisplay(await loadPrices());
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Pro Annual */}
      <div className="relative flex flex-col rounded-2xl border-2 border-neutral-950 bg-white p-6">
        <span className="absolute -top-2.5 left-6 rounded-full bg-neutral-950 px-2.5 py-0.5 text-[10.5px] font-medium text-white">
          Best value
        </span>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          Pro Annual
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-[32px] font-semibold tracking-[-0.02em]">{price.yearlyPerMonth}</span>
          <span className="text-[14px] text-neutral-500">/ month</span>
        </div>
        <p className="mt-1 text-[13px] font-medium text-emerald-700">
          {price.yearlyTotal} billed yearly · save ~{price.savingsPercent}%
        </p>
        <p className="mt-2 text-[13.5px] text-neutral-600">Best for year-round training.</p>
        <ul className="mt-4 space-y-2 text-[13.5px] text-neutral-700">
          {ANNUAL_FEATS.map((f) => (
            <li key={f} className="flex gap-2">
              <Check />
              {f}
            </li>
          ))}
        </ul>
        <form action={startCheckoutAction.bind(null, "yearly")} className="mt-auto pt-5">
          <button type="submit" className={DARK_BTN}>
            Choose annual
          </button>
        </form>
      </div>

      {/* Pro Monthly */}
      <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-6">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">
          Pro Monthly
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-[32px] font-semibold tracking-[-0.02em]">{price.monthly}</span>
          <span className="text-[14px] text-neutral-500">/ month</span>
        </div>
        <p className="mt-2 text-[13.5px] text-neutral-600">Full Pro access. Cancel anytime.</p>
        <ul className="mt-4 space-y-2 text-[13.5px] text-neutral-700">
          {MONTHLY_FEATS.map((f) => (
            <li key={f} className="flex gap-2">
              <Check />
              {f}
            </li>
          ))}
        </ul>
        <form action={startCheckoutAction.bind(null, "monthly")} className="mt-auto pt-5">
          <button type="submit" className={OUTLINE_BTN}>
            Choose monthly
          </button>
        </form>
      </div>
    </div>
  );
}
