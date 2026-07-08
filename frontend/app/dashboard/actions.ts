"use server";

import { createClient } from "@/lib/supabase/server";

// ---- Types ---------------------------------------------------------------
export type LatestActivity = {
  started_at: string;
  sport: string;
  distance_m: number | null;
  duration_seconds: number;
  avg_pace_s_per_km: number | null;
  elevation_gain_m: number | null;
  notes: string | null;
  /** Strava summary fields lifted from raw_payload (may be absent for other sources). */
  name: string | null;
  summary_polyline: string | null;
  achievement_count: number | null;
  device_name: string | null;
  location: string | null;
  /** source_id is the Strava activity ID — used to build "View on Strava" links. */
  source_id: string | null;
};

export type ActivitySummary = {
  latest: LatestActivity | null;
  week: { activities: number; km: number; hours: number };
} | null;

export type PlannedSession = {
  scheduled_date: string;
  session_type: string;
  sport: string;
  duration_min: number | null;
  distance_m: number | null;
  description: string | null;
  intensity_zones: Record<string, unknown> | null;
  rationale: string | null;
  status: string;
};

export type PlanBlueprint = {
  total_weeks: number;
  phases: { name: string; week_count: number; weekly_volume_hours: number; weekly_intensity_focus: string; rationale: string }[];
  weekly_template: Record<string, string>;
  guiding_principles: string[];
  key_metrics_to_track: string[];
  auto_adapt_triggers?: string[];
};

export type CurrentPlan = {
  active: boolean;
  plan_id?: string;
  race_type?: string;
  race_date?: string;
  target_time_seconds?: number | null;
  philosophy?: string;
  current_phase?: string;
  weeks?: number;
  blueprint?: PlanBlueprint;
  next_14_days?: PlannedSession[];
};

export type Profile = {
  id: string;
  email: string | null;
  full_name: string | null;
  date_of_birth: string | null;
  sex: "male" | "female" | "other" | null;
  height_cm: number | null;
  weight_kg: number | null;
  primary_sport: string | null;
  experience_level: string | null;
  resting_hr: number | null;
  max_hr: number | null;
  preferred_philosophy: string | null;
};

// ---- Loaders -------------------------------------------------------------
/**
 * Current plan + upcoming sessions — read directly from Supabase (RLS).
 *
 * We read `planned_workouts` straight from the DB rather than hopping through
 * the backend, the same way `loadActivitySummary` reads `workouts`. This is
 * resilient: the plan renders whenever the user has upcoming sessions, even if
 * their `training_plans` row isn't flagged `status='active'` (the backend's
 * `/training/plan/current` requires that flag and otherwise reports no plan).
 */
export async function loadCurrentPlan(): Promise<CurrentPlan | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Pull from the start of the current week so today-is-mid-week still fills
  // Monday onward; cover a few weeks ahead for the schedule + summaries.
  const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const { data: sessionRows, error: sessionErr } = await supabase
    .from("planned_workouts")
    .select(
      "scheduled_date, session_type, sport, duration_min, distance_m, description, intensity_zones, rationale, status",
    )
    .eq("user_id", user.id)
    .gte("scheduled_date", since)
    .order("scheduled_date")
    .limit(200);
  if (sessionErr) throw new Error(`loadCurrentPlan: ${sessionErr.message}`);

  let upcoming = (sessionRows ?? []) as PlannedSession[];

  // Newest plan row (any status) for the header metadata + block focus.
  const { data: planRow, error: planErr } = await supabase
    .from("training_plans")
    .select("id, race_type, race_date, target_time_seconds, philosophy, current_phase, weeks, plan_json")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (planErr) throw new Error(`loadCurrentPlan plans: ${planErr.message}`);

  // If nothing is upcoming but a plan exists, its sessions may be entirely in the
  // past (e.g. a block whose dates drifted). Fall back to that plan's own sessions
  // — with no date floor — so the schedule still renders instead of looking empty.
  const planId = (planRow as { id?: string } | null)?.id;
  if (upcoming.length === 0 && planId) {
    const { data: planSessions, error: fallbackErr } = await supabase
      .from("planned_workouts")
      .select(
        "scheduled_date, session_type, sport, duration_min, distance_m, description, intensity_zones, rationale, status",
      )
      .eq("user_id", user.id)
      .eq("plan_id", planId)
      .order("scheduled_date")
      .limit(200);
    if (fallbackErr) throw new Error(`loadCurrentPlan fallback: ${fallbackErr.message}`);
    upcoming = (planSessions ?? []) as PlannedSession[];
  }

  if (upcoming.length === 0 && !planRow) return { active: false };

  const plan = (planRow ?? {}) as Record<string, unknown>;
  const planJson = (plan.plan_json ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

  return {
    active: true,
    plan_id: str(plan.id),
    race_type: str(plan.race_type),
    race_date: str(plan.race_date),
    target_time_seconds: num(plan.target_time_seconds) ?? null,
    philosophy: str(plan.philosophy),
    current_phase: str(plan.current_phase),
    weeks: num(plan.weeks),
    blueprint: (planJson.blueprint as PlanBlueprint | undefined) ?? undefined,
    next_14_days: upcoming,
  };
}

/** Profile is read straight from Supabase (RLS-protected) — no backend hop needed. */
export async function loadProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  return data as Profile | null;
}

/** Most recent daily wellness — pulled directly from Supabase. */
export async function loadLatestRecovery(): Promise<{
  metric_date: string;
  hrv_rmssd: number | null;
  resting_hr: number | null;
  sleep_minutes: number | null;
  sleep_score: number | null;
  readiness_score: number | null;
  body_battery: number | null;
  stress_avg: number | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("daily_metrics")
    .select(
      "metric_date, hrv_rmssd, resting_hr, sleep_minutes, sleep_score, readiness_score, body_battery, stress_avg",
    )
    .eq("user_id", user.id)
    .order("metric_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/** Latest workout + trailing-7-day totals — read directly from Supabase (RLS). */
export async function loadActivitySummary(): Promise<ActivitySummary> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: latestRow, error: latestErr } = await supabase
    .from("workouts")
    .select(
      "started_at, sport, distance_m, duration_seconds, avg_pace_s_per_km, elevation_gain_m, notes, source_id, raw_payload",
    )
    .eq("user_id", user.id)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr) throw new Error(`loadActivitySummary latest: ${latestErr.message}`);

  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: rows, error: weekErr } = await supabase
    .from("workouts")
    .select("distance_m, duration_seconds")
    .eq("user_id", user.id)
    .gte("started_at", since);
  if (weekErr) throw new Error(`loadActivitySummary week: ${weekErr.message}`);

  const weekRows = (rows ?? []) as { distance_m: number | null; duration_seconds: number | null }[];
  const meters = weekRows.reduce((sum, r) => sum + (r.distance_m ?? 0), 0);
  const seconds = weekRows.reduce((sum, r) => sum + (r.duration_seconds ?? 0), 0);

  return {
    latest: latestRow ? normalizeLatest(latestRow as Record<string, unknown>) : null,
    week: {
      activities: weekRows.length,
      km: meters / 1000,
      hours: seconds / 3600,
    },
  };
}

/** Lift the Strava-card fields out of a workout row + its raw_payload JSON. */
function normalizeLatest(row: Record<string, unknown>): LatestActivity {
  const raw = (row.raw_payload ?? {}) as Record<string, unknown>;
  const map = (raw.map ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

  const locationParts = [raw.location_city, raw.location_state, raw.location_country]
    .map(str)
    .filter(Boolean);

  return {
    started_at: String(row.started_at),
    sport: String(row.sport),
    distance_m: num(row.distance_m),
    duration_seconds: num(row.duration_seconds) ?? 0,
    avg_pace_s_per_km: num(row.avg_pace_s_per_km),
    elevation_gain_m: num(row.elevation_gain_m),
    notes: str(row.notes),
    name: str(raw.name) ?? str(row.notes),
    summary_polyline: str(map.summary_polyline),
    achievement_count: num(raw.achievement_count),
    device_name: str(raw.device_name),
    location: locationParts.length ? locationParts.join(", ") : null,
    source_id: str(row.source_id),
  };
}

// ---- Mutations -----------------------------------------------------------
export async function updateProfile(patch: Partial<Profile>): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };
  const allowed: Partial<Profile> = {
    full_name: patch.full_name,
    date_of_birth: patch.date_of_birth,
    sex: patch.sex,
    height_cm: patch.height_cm,
    weight_kg: patch.weight_kg,
    primary_sport: patch.primary_sport,
    experience_level: patch.experience_level,
    resting_hr: patch.resting_hr,
    max_hr: patch.max_hr,
    preferred_philosophy: patch.preferred_philosophy,
  };
  // Strip undefined so we don't blank fields the user didn't touch.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(allowed)) {
    if (v !== undefined && v !== "") clean[k] = v;
  }
  const { error } = await supabase.from("profiles").update(clean).eq("id", user.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
