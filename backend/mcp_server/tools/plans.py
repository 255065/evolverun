"""Plan tools — current plan summary, upcoming planned workouts, performance summary."""

from datetime import date, datetime, timedelta
from typing import Any

from app.core.supabase import get_supabase_admin
from mcp_server.context import get_user_id


def get_planned_workouts(days_ahead: int = 7) -> dict[str, Any]:
    """Upcoming structured workouts from the user's active training plan.

    Args:
        days_ahead: How far into the future to look. Default 7.

    Returns sessions with rationale (the "why") so Claude can reproduce the
    coaching intent rather than just the prescription.
    """
    user_id = get_user_id()
    today = date.today()
    end = today + timedelta(days=days_ahead)

    client = get_supabase_admin()
    rows = (
        client.table("planned_workouts")
        .select("*")
        .eq("user_id", user_id)
        .gte("scheduled_date", today.isoformat())
        .lte("scheduled_date", end.isoformat())
        .order("scheduled_date")
        .execute()
        .data
        or []
    )

    if not rows:
        # No sessions in the forward window — but an active plan may still exist
        # whose sessions fall outside it (e.g. the dates drifted into the past).
        # Report the truth so the assistant can offer to reschedule rather than
        # claim the plan was never saved.
        active = (
            client.table("training_plans")
            .select("id")
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        if active:
            span = (
                client.table("planned_workouts")
                .select("scheduled_date")
                .eq("user_id", user_id)
                .eq("plan_id", active[0]["id"])
                .order("scheduled_date")
                .execute()
                .data
                or []
            )
            if span:
                first = span[0]["scheduled_date"]
                last = span[-1]["scheduled_date"]
                return {
                    "available": False,
                    "active_plan": True,
                    "window_days": days_ahead,
                    "plan_sessions": len(span),
                    "plan_date_range": {"first": first, "last": last},
                    "message": (
                        f"You have an active plan with {len(span)} sessions dated "
                        f"{first}–{last}, but none fall in the next {days_ahead} days. "
                        f"If those dates are in the past, reschedule the plan to start "
                        f"from today."
                    ),
                }

        return {
            "available": False,
            "message": "No active training plan yet.",
            "window_days": days_ahead,
        }

    return {
        "available": True,
        "window_days": days_ahead,
        "sessions": [
            {
                "date": r["scheduled_date"],
                "session_type": r["session_type"],
                "sport": r.get("sport"),
                "duration_min": r.get("duration_min"),
                "distance_km": (r["distance_m"] / 1000.0) if r.get("distance_m") else None,
                "description": r.get("description"),
                "rationale": r.get("rationale"),
                "intensity_zones": r.get("intensity_zones"),
                "status": r.get("status"),
            }
            for r in rows
        ],
    }


def get_current_plan() -> dict[str, Any]:
    """Summary of the user's active training plan plus the blueprint structure
    (phases, weekly volume, guiding principles, weekly template).

    Returns enough detail for Claude to reason about why a specific session
    was prescribed and how it fits into the larger arc.
    """
    user_id = get_user_id()
    client = get_supabase_admin()
    result = (
        client.table("training_plans")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return {"active": False, "message": "No active training plan yet."}

    p = result.data[0]
    start = datetime.fromisoformat(p["start_date"]).date() if p.get("start_date") else None
    week_of = ((date.today() - start).days // 7 + 1) if start else None
    plan_json = p.get("plan_json") or {}
    blueprint = plan_json.get("blueprint") or {}

    return {
        "active": True,
        "plan_id": p["id"],
        "race_type": p["race_type"],
        "race_date": p.get("race_date"),
        "target_time_seconds": p.get("target_time_seconds"),
        "philosophy": p["philosophy"],
        "current_phase": p.get("current_phase"),
        "total_weeks": p["weeks"],
        "week_of_plan": week_of,
        "phases": blueprint.get("phases"),
        "weekly_template": blueprint.get("weekly_template"),
        "guiding_principles": blueprint.get("guiding_principles"),
        "key_metrics_to_track": blueprint.get("key_metrics_to_track"),
        "auto_adapt_triggers": blueprint.get("auto_adapt_triggers"),
    }


def get_performance_summary() -> dict[str, Any]:
    """Latest physiological snapshot: CTL, ATL, TSB, ACWR, fitness trend.

    Returns the most recent performance_profiles row plus the user's current
    limiter (from limiter_history) if detected.
    """
    user_id = get_user_id()
    client = get_supabase_admin()

    perf_result = (
        client.table("performance_profiles")
        .select(
            "snapshot_date, vo2max_estimated, lactate_threshold_hr, "
            "lactate_threshold_pace_s_per_km, fitness_ctl, fatigue_atl, "
            "form_tsb, acwr"
        )
        .eq("user_id", user_id)
        .order("snapshot_date", desc=True)
        .limit(1)
        .execute()
    )
    limiter_result = (
        client.table("limiter_history")
        .select("detected_at, primary_limiter, secondary_limiter, confidence, recommended_focus")
        .eq("user_id", user_id)
        .order("detected_at", desc=True)
        .limit(1)
        .execute()
    )

    perf = perf_result.data[0] if perf_result.data else None
    limiter = limiter_result.data[0] if limiter_result.data else None

    acwr_zone = None
    if perf and perf.get("acwr") is not None:
        acwr = perf["acwr"]
        if acwr < 0.8:
            acwr_zone = "detraining_or_undertrained"
        elif acwr <= 1.3:
            acwr_zone = "optimal"
        elif acwr <= 1.5:
            acwr_zone = "elevated_risk"
        else:
            acwr_zone = "high_injury_risk"

    return {
        "performance_snapshot_available": perf is not None,
        "snapshot": perf or {},
        "acwr_zone": acwr_zone,
        "current_limiter": limiter or {},
    }
