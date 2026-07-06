import type { Prices } from "./actions";

// Turns the live Stripe amounts into the strings the pricing UI renders. Pure
// and framework-free so it's trivially testable and reused by every price tag
// (picker, account page, /pricing). When Stripe data is missing, every getter
// falls back to today's static values so a page never shows a broken price.

const FALLBACK = {
  monthly: "€7.99",
  yearlyPerMonth: "€5.75",
  yearlyTotal: "€69",
  savingsPercent: 28,
};

/** "€7.99" / "€69" — drops a trailing ".00", maps eur → €. */
export function formatAmount(cents: number, currency: string): string {
  const symbol = currency.toLowerCase() === "eur" ? "€" : currency.toUpperCase() + " ";
  const value = (cents / 100).toFixed(2).replace(/\.00$/, "");
  return `${symbol}${value}`;
}

export function monthlyEquivalentCents(yearlyCents: number): number {
  return Math.round(yearlyCents / 12);
}

export function savingsPercent(monthlyCents: number, yearlyCents: number): number {
  return Math.round((1 - yearlyCents / (monthlyCents * 12)) * 100);
}

export type PlanDisplay = {
  monthly: string; // "€7.99"
  yearlyPerMonth: string; // "€5.75"
  yearlyTotal: string; // "€69"
  savingsPercent: number; // 28
};

/** Derive all display strings from live prices, falling back per-field. */
export function derivePlanDisplay(prices: Prices | null): PlanDisplay {
  const monthly = prices?.monthly ?? null;
  const yearly = prices?.yearly ?? null;

  const monthlyStr = monthly ? formatAmount(monthly.unit_amount, monthly.currency) : FALLBACK.monthly;
  const yearlyPerMonth = yearly
    ? formatAmount(monthlyEquivalentCents(yearly.unit_amount), yearly.currency)
    : FALLBACK.yearlyPerMonth;
  const yearlyTotal = yearly ? formatAmount(yearly.unit_amount, yearly.currency) : FALLBACK.yearlyTotal;
  const savings =
    monthly && yearly ? savingsPercent(monthly.unit_amount, yearly.unit_amount) : FALLBACK.savingsPercent;

  return { monthly: monthlyStr, yearlyPerMonth, yearlyTotal, savingsPercent: savings };
}
