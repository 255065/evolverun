import { describe, expect, it } from "vitest";
import { formatSpan } from "./history-span";

const NOW = new Date("2026-07-06T00:00:00Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("formatSpan", () => {
  it("returns null with no synced activity", () => {
    expect(formatSpan(null, NOW)).toBeNull();
  });

  it("returns null for an unparseable date", () => {
    expect(formatSpan("not-a-date", NOW)).toBeNull();
  });

  it("pluralises years past the 1-year mark", () => {
    expect(formatSpan(daysAgo(400), NOW)).toBe("1 year of history");
    expect(formatSpan(daysAgo(1200), NOW)).toBe("3 years of history");
  });

  it("uses months between 60 days and a year", () => {
    expect(formatSpan(daysAgo(90), NOW)).toBe("3 months of history");
  });

  it("falls back to 'recent history' under 60 days", () => {
    expect(formatSpan(daysAgo(10), NOW)).toBe("recent history");
  });
});
