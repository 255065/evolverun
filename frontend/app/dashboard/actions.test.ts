import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the Supabase server client. createClient() returns an object exposing
// auth.getUser() and from(table) → a chainable query builder. loadActivitySummary
// issues two queries against `workouts`:
//   1. latest: …order().limit().maybeSingle()  → resolves via maybeSingle()
//   2. week:   …gte()                            → the builder is awaited directly
// So the builder is both chainable AND thenable; maybeSingle() returns its own result.
const mockGetUser = vi.fn();
const fromImpl = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mockGetUser },
    from: fromImpl,
  }),
}));

import { loadActivitySummary, loadCurrentPlan } from "./actions";

type Row = Record<string, unknown>;

/** A chainable builder: every method returns `this`; it resolves to `weekResult`
 *  when awaited, and maybeSingle() resolves to `latestResult`. */
function makeBuilder(latestResult: { data: Row | null }, weekResult: { data: Row[] | null }) {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "gte"]) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => latestResult);
  // Thenable so `await supabase.from(...).…gte(...)` yields weekResult.
  builder.then = (resolve: (v: { data: Row[] | null }) => unknown) => resolve(weekResult);
  return builder;
}

beforeEach(() => {
  mockGetUser.mockReset();
  fromImpl.mockReset();
});

describe("loadActivitySummary", () => {
  it("returns null when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await loadActivitySummary()).toBeNull();
  });

  it("maps the latest row (lifting Strava fields from raw_payload) and computes week totals", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const latestRow = {
      started_at: "2026-05-30T06:00:00Z",
      sport: "run",
      distance_m: 10000,
      duration_seconds: 3000,
      avg_pace_s_per_km: 300,
      elevation_gain_m: 92,
      notes: "Afternoon Run",
      source_id: "12345678",
      raw_payload: {
        name: "Afternoon Run",
        map: { summary_polyline: "abc123" },
        achievement_count: 3,
        device_name: "Garmin Instinct 2S Solar",
        location_city: "Ballerup",
        location_country: "Denmark",
      },
    };
    const weekRows = [
      { distance_m: 10000, duration_seconds: 3000 },
      { distance_m: 5000, duration_seconds: 1800 },
      { distance_m: null, duration_seconds: null },
    ];
    fromImpl.mockReturnValue(makeBuilder({ data: latestRow }, { data: weekRows }));

    const result = await loadActivitySummary();
    expect(result).not.toBeNull();
    expect(result!.latest).toEqual({
      started_at: "2026-05-30T06:00:00Z",
      sport: "run",
      distance_m: 10000,
      duration_seconds: 3000,
      avg_pace_s_per_km: 300,
      elevation_gain_m: 92,
      notes: "Afternoon Run",
      name: "Afternoon Run",
      summary_polyline: "abc123",
      achievement_count: 3,
      device_name: "Garmin Instinct 2S Solar",
      location: "Ballerup, Denmark",
      source_id: "12345678",
    });
    expect(result!.week.activities).toBe(3);
    expect(result!.week.km).toBeCloseTo(15, 5); // (10000 + 5000) / 1000
    expect(result!.week.hours).toBeCloseTo((3000 + 1800) / 3600, 5);
  });

  it("returns latest=null and zeroed week when there are no workouts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    fromImpl.mockReturnValue(makeBuilder({ data: null }, { data: [] }));

    const result = await loadActivitySummary();
    expect(result).toEqual({
      latest: null,
      week: { activities: 0, km: 0, hours: 0 },
    });
  });

  // Criterion A3: Strava not connected is the SAME code path as "no workouts"
  // — the workouts table is simply empty, the loader returns latest:null. There
  // is no connection-status branch in loadActivitySummary, so the empty-state
  // test above already covers it. Asserting it explicitly for documentation.
  it("treats a never-synced (Strava not connected) account like no workouts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    fromImpl.mockReturnValue(makeBuilder({ data: null }, { data: null }));

    const result = await loadActivitySummary();
    expect(result).toEqual({
      latest: null,
      week: { activities: 0, km: 0, hours: 0 },
    });
  });

  // Criterion A5 (code half): the loader must scope every query to the
  // authenticated user via .eq("user_id", user.id). The RLS owner-read policy
  // on `workouts` lives in Postgres, not this code, so it is NOT COVERABLE in a
  // unit test — this asserts the application-level scoping only.
  it("scopes every workouts query to .eq('user_id', user.id)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "tenant-A" } } });

    const eqCalls: Array<[string, unknown]> = [];
    const fromTables: string[] = [];
    function trackingBuilder() {
      const builder: Record<string, unknown> = {};
      for (const m of ["select", "order", "limit", "gte"]) {
        builder[m] = vi.fn(() => builder);
      }
      builder.eq = vi.fn((col: string, val: unknown) => {
        eqCalls.push([col, val]);
        return builder;
      });
      builder.maybeSingle = vi.fn(async () => ({ data: null }));
      builder.then = (resolve: (v: { data: Row[] | null }) => unknown) => resolve({ data: [] });
      return builder;
    }
    fromImpl.mockImplementation((table: string) => {
      fromTables.push(table);
      return trackingBuilder();
    });

    await loadActivitySummary();

    // Both the latest-query and the trailing-7-day query scope to the user.
    expect(eqCalls.length).toBe(2);
    for (const [col, val] of eqCalls) {
      expect(col).toBe("user_id");
      expect(val).toBe("tenant-A");
    }
  });

  // Criterion A6: loadActivitySummary reads Supabase directly — it must NOT
  // make a network fetch to a new backend endpoint.
  it("does not call fetch (direct-Supabase, no new backend endpoint)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    fromImpl.mockReturnValue(makeBuilder({ data: null }, { data: [] }));

    await loadActivitySummary();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

// loadCurrentPlan issues up to three reads:
//   1. planned_workouts (forward window, awaited directly)
//   2. training_plans   (…maybeSingle())
//   3. planned_workouts (fallback by plan_id, awaited directly) — only if (1) empty
// The builder is thenable (for the direct-awaited planned_workouts reads) and also
// exposes maybeSingle() (for training_plans). `pwResults` feeds the two
// planned_workouts reads in order.
function installPlanMock(pwResults: Array<Row[]>, planRow: Row | null) {
  let pwCall = 0;
  const counters = { pw: 0 };
  fromImpl.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "order", "limit"]) {
      builder[m] = vi.fn(() => builder);
    }
    if (table === "training_plans") {
      builder.maybeSingle = vi.fn(async () => ({ data: planRow }));
    }
    builder.then = (resolve: (v: { data: Row[] | null }) => unknown) => {
      if (table === "planned_workouts") {
        const data = pwResults[pwCall] ?? [];
        pwCall += 1;
        counters.pw += 1;
        return resolve({ data });
      }
      return resolve({ data: null });
    };
    return builder;
  });
  return counters;
}

describe("loadCurrentPlan", () => {
  const planRow = {
    id: "plan-1",
    race_type: "military_selection",
    race_date: null,
    target_time_seconds: null,
    philosophy: "polarized",
    current_phase: null,
    weeks: 30,
    plan_json: {},
  };
  const past = [
    { scheduled_date: "2026-06-01", session_type: "easy", sport: "running", duration_min: 45, distance_m: null, description: null, intensity_zones: {}, rationale: null, status: "scheduled" },
    { scheduled_date: "2026-06-20", session_type: "long", sport: "running", duration_min: 100, distance_m: null, description: null, intensity_zones: {}, rationale: null, status: "scheduled" },
  ];

  it("returns null when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await loadCurrentPlan()).toBeNull();
  });

  it("falls back to the plan's own sessions when nothing is upcoming (past-dated plan)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    // Forward window empty; fallback returns the plan's (past) sessions.
    const counters = installPlanMock([[], past], planRow);

    const result = await loadCurrentPlan();

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.plan_id).toBe("plan-1");
    expect(result!.next_14_days).toHaveLength(2);
    expect(result!.next_14_days![0].scheduled_date).toBe("2026-06-01");
    // Both planned_workouts reads ran (window + fallback).
    expect(counters.pw).toBe(2);
  });

  it("does not run the fallback when sessions are already upcoming", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const counters = installPlanMock([past], planRow);

    const result = await loadCurrentPlan();

    expect(result!.active).toBe(true);
    expect(result!.next_14_days).toHaveLength(2);
    // Only the forward-window read ran — no fallback.
    expect(counters.pw).toBe(1);
  });

  it("returns active:false when there are neither sessions nor a plan", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    installPlanMock([[]], null);

    expect(await loadCurrentPlan()).toEqual({ active: false });
  });
});
