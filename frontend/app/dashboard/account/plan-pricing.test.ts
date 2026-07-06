import { describe, expect, it } from "vitest";
import {
  derivePlanDisplay,
  formatAmount,
  monthlyEquivalentCents,
  savingsPercent,
} from "./plan-pricing";

describe("formatAmount", () => {
  it("keeps cents but drops a trailing .00", () => {
    expect(formatAmount(799, "eur")).toBe("€7.99");
    expect(formatAmount(6900, "eur")).toBe("€69");
    expect(formatAmount(575, "eur")).toBe("€5.75");
  });

  it("falls back to an uppercase code for non-eur currencies", () => {
    expect(formatAmount(1000, "usd")).toBe("USD 10");
  });
});

describe("monthlyEquivalentCents", () => {
  it("rounds €69/yr to €5.75/mo", () => {
    expect(monthlyEquivalentCents(6900)).toBe(575);
  });
});

describe("savingsPercent", () => {
  it("computes ~28% for €7.99/mo vs €69/yr", () => {
    expect(savingsPercent(799, 6900)).toBe(28);
  });
});

describe("derivePlanDisplay", () => {
  it("derives all strings from live prices", () => {
    const d = derivePlanDisplay({
      monthly: { unit_amount: 799, currency: "eur", interval: "month" },
      yearly: { unit_amount: 6900, currency: "eur", interval: "year" },
    });
    expect(d).toEqual({
      monthly: "€7.99",
      yearlyPerMonth: "€5.75",
      yearlyTotal: "€69",
      savingsPercent: 28,
    });
  });

  it("falls back to static defaults when prices are null", () => {
    expect(derivePlanDisplay(null)).toEqual({
      monthly: "€7.99",
      yearlyPerMonth: "€5.75",
      yearlyTotal: "€69",
      savingsPercent: 28,
    });
  });

  it("falls back per-field when only one plan is present", () => {
    const d = derivePlanDisplay({
      monthly: { unit_amount: 999, currency: "eur", interval: "month" },
      yearly: null,
    });
    expect(d.monthly).toBe("€9.99");
    expect(d.yearlyTotal).toBe("€69");
    expect(d.savingsPercent).toBe(28);
  });
});
