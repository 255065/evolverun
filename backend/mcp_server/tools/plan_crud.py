"""Plan CRUD tools — push and delete planned workouts.

Chirona-equivalent surface. Claude/ChatGPT uses these to add or remove
individual sessions from the user's active plan without going through the
full plan_generator (which only runs at race-setup time).

push lets the assistant slot in an ad-hoc session ("add a 6 km easy on
Tuesday"). delete removes a session by id.
"""

import math
import os
import re
from datetime import date
from typing import Any

from app.core.supabase import get_supabase_admin
from mcp_server.context import get_user_id


VALID_SESSION_TYPES = (
    "easy", "long", "tempo", "threshold", "intervals", "vo2max",
    "fartlek", "hills", "recovery", "race", "strength",
    "cross_training", "rest",
)

SESSION_TYPE_ALIASES = {
    "easy_run": "easy",
    "easy-run": "easy",
    "easy run": "easy",
    "rolig": "easy",
    "roligt": "easy",
    "roligt_loeb": "easy",
    "roligt_lob": "easy",
    "long_run": "long",
    "long-run": "long",
    "long run": "long",
    "langtur": "long",
    "recovery_run": "recovery",
    "recovery-run": "recovery",
    "recovery run": "recovery",
    "restitution": "recovery",
    "restitutionsloeb": "recovery",
    "restitutionslob": "recovery",
    "threshold_run": "threshold",
    "threshold-run": "threshold",
    "threshold run": "threshold",
    "taerskel": "threshold",
    "tærskel": "threshold",
    "tempo_run": "tempo",
    "tempo-run": "tempo",
    "tempo run": "tempo",
    "interval": "intervals",
    "interval_run": "intervals",
    "interval-run": "intervals",
    "interval run": "intervals",
    "intervaller": "intervals",
    "vo2": "vo2max",
    "vo2_max": "vo2max",
    "vo2-max": "vo2max",
    "vo2 max": "vo2max",
    "hill": "hills",
    "hill_repeats": "hills",
    "hill-repeats": "hills",
    "hill repeats": "hills",
    "bakke": "hills",
    "bakker": "hills",
    "strength_training": "strength",
    "strength-training": "strength",
    "strength training": "strength",
    "styrke": "strength",
    "cross-training": "cross_training",
    "cross training": "cross_training",
    "crosstraining": "cross_training",
    "easyride": "cross_training",
    "rest_day": "rest",
    "rest-day": "rest",
    "rest day": "rest",
    "hvile": "rest",
    "hviledag": "rest",
}

SPORT_ALIASES = {
    "run": "running",
    "runs": "running",
    "løb": "running",
    "lob": "running",
    "bike": "cycling",
    "ride": "cycling",
    "cykel": "cycling",
    "swim": "swimming",
    "svømning": "swimming",
    "svomning": "swimming",
    "gym": "strength",
}

# Ordered most-specific/dominant root first. Last-resort fuzzy fallback when
# neither an exact alias nor a canonical match is found: catches LLM-invented
# names like "speed_intervals", "long_slow_distance", "progression_easy" by
# the root keyword they contain. Truly ambiguous names (no root here) stay
# unmapped → caller raises a clear error (all-or-nothing).
SESSION_TYPE_KEYWORDS = (
    ("vo2", "vo2max"),
    ("interval", "intervals"),
    ("intervaller", "intervals"),
    ("threshold", "threshold"),
    ("tærskel", "threshold"),
    ("taerskel", "threshold"),
    ("tempo", "tempo"),
    ("fartlek", "fartlek"),
    ("hill", "hills"),
    ("bakke", "hills"),
    ("recovery", "recovery"),
    ("restitution", "recovery"),
    ("langtur", "long"),
    ("lsd", "long"),
    ("long", "long"),
    ("rolig", "easy"),
    ("easy", "easy"),
    ("race", "race"),
    ("styrke", "strength"),
    ("strength", "strength"),
    ("cross", "cross_training"),
    ("hvile", "rest"),
    ("rest", "rest"),
)


def _slug(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value).strip().lower().replace("_", " "))


def _normalise_session_type(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    compact = raw.lower()
    spaced = _slug(raw)
    underscored = spaced.replace(" ", "_")
    exact = (
        SESSION_TYPE_ALIASES.get(compact)
        or SESSION_TYPE_ALIASES.get(spaced)
        or SESSION_TYPE_ALIASES.get(underscored)
        or (underscored if underscored in VALID_SESSION_TYPES else None)
    )
    if exact:
        return exact
    # Fuzzy fallback: map LLM-invented names via a known root keyword.
    for kw, canon in SESSION_TYPE_KEYWORDS:
        if kw in compact:
            return canon
    return None


def _normalise_sport(value: Any) -> str:
    if value is None:
        return "running"
    spaced = _slug(value)
    underscored = spaced.replace(" ", "_")
    return SPORT_ALIASES.get(spaced) or SPORT_ALIASES.get(underscored) or underscored


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        match = re.search(r"\d+(?:[.,]\d+)?", value)
        if not match:
            return None
        value = match.group(0).replace(",", ".")
    return round(float(value))


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        match = re.search(r"\d+(?:[.,]\d+)?", value)
        if not match:
            return None
        value = match.group(0).replace(",", ".")
    return float(value)


def _distance_m(session: dict[str, Any]) -> int | None:
    if session.get("distance_m") is not None:
        return _optional_int(session.get("distance_m"))
    if session.get("distance_km") is not None:
        km = _optional_float(session.get("distance_km"))
        return round(km * 1000) if km is not None else None
    return None


def push_planned_workout(
    scheduled_date: str,
    session_type: str,
    sport: str = "running",
    duration_min: int = None,
    distance_m: int = None,
    description: str = None,
    rationale: str = None,
) -> dict[str, Any]:
    """Add a planned workout to the user's active training plan.

    Use this when the athlete asks the assistant to slot in an extra session
    ("add a 6 km easy run Tuesday at 6am", "schedule a tempo this Thursday").
    The session is attached to the currently active training plan, or created
    standalone if none exists.

    Args:
        scheduled_date: ISO date YYYY-MM-DD.
        session_type:   easy / long / tempo / threshold / intervals / vo2max /
                        fartlek / hills / recovery / race / strength /
                        cross_training / rest
        sport:          running / cycling / swimming / strength / walking /
                        hiking / other. Default running.
        duration_min:   Estimated duration in minutes.
        distance_m:     Target distance in meters.
        description:    Concrete prescription, e.g. "8x400m @ 3:30/km".
        rationale:      Why this session — the explainability the athlete sees.
    """
    user_id = get_user_id()
    try:
        d = date.fromisoformat(scheduled_date)
    except ValueError as exc:
        return {"error": f"scheduled_date must be YYYY-MM-DD ({exc})"}

    normalised_type = _normalise_session_type(session_type)
    if normalised_type not in VALID_SESSION_TYPES:
        return {
            "error": f"session_type must be one of {list(VALID_SESSION_TYPES)}",
        }

    client = get_supabase_admin()

    # Find the active plan, if any. We allow standalone sessions but prefer
    # to attach to a plan so the dashboard's plan view picks them up.
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
    plan_id = active[0]["id"] if active else None
    if plan_id is None:
        return {
            "error": "No active training plan — generate a plan first or set a placeholder.",
        }

    row = {
        "plan_id": plan_id,
        "user_id": user_id,
        "scheduled_date": d.isoformat(),
        "session_type": normalised_type,
        "sport": _normalise_sport(sport),
        "duration_min": _optional_int(duration_min),
        "distance_m": _optional_int(distance_m),
        "description": description,
        "rationale": rationale,
        "status": "scheduled",
        "ai_adjustments": [{"by": "assistant", "action": "added"}],
    }
    inserted = client.table("planned_workouts").insert(row).execute()
    new_id = inserted.data[0]["id"] if inserted.data else None
    return {
        "ok": True,
        "id": new_id,
        "scheduled_date": d.isoformat(),
        "session_type": normalised_type,
        "sport": _normalise_sport(sport),
        "plan_id": plan_id,
    }


def save_training_plan(
    sessions: list,
    mode: str = "append",
    window_start: str = None,
    window_end: str = None,
    plan_summary: str = None,
) -> dict[str, Any]:
    """Save a full training plan (multiple sessions) the assistant proposed.

    Two modes:
      * mode="append"       — adds the sessions without touching anything else.
      * mode="replace_window" — first deletes every planned_workout whose
                                scheduled_date falls in [window_start, window_end]
                                inclusive, then inserts the new sessions. Use
                                this when the user said "update my plan" /
                                "overwrite next week".

    The assistant MUST confirm with the user before calling this (the
    coaching guide spells out the wording). The response includes the
    dashboard URL so the assistant can tell the user where to see the plan.

    Args:
        sessions: List of dicts. Each session needs at least
            `scheduled_date` (YYYY-MM-DD) and `session_type`. Canonical
            session_type values are: easy, long, tempo, threshold, intervals,
            vo2max, fartlek, hills, recovery, race, strength, cross_training,
            rest. Common aliases like easy_run, long_run, recovery_run,
            "easy run", "langtur", and "restitution" are accepted and stored
            as the canonical value. Optional: `sport`, `duration_min`,
            `distance_m` (or `distance_km`), `description`, `rationale`,
            `intensity_zones` (dict).
        mode: "append" or "replace_window".
        window_start: ISO date YYYY-MM-DD. Required for replace_window.
        window_end: ISO date YYYY-MM-DD. Required for replace_window.
        plan_summary: Optional one-line description of the block. Stored
            on the latest active plan so the dashboard can show it.
    """
    user_id = get_user_id()
    client = get_supabase_admin()

    if mode not in ("append", "replace_window"):
        return {"error": 'mode must be "append" or "replace_window"'}
    if not sessions:
        return {"error": "sessions list is empty — nothing to save"}

    # Validate + normalise rows before touching any plan. We defer setting
    # plan_id (filled in below once we know which plan the rows attach to).
    rows = []
    errors = []
    for i, s in enumerate(sessions):
        if not isinstance(s, dict):
            errors.append(f"session {i}: must be an object")
            continue
        if "scheduled_date" not in s or "session_type" not in s:
            errors.append(f"session {i}: missing scheduled_date or session_type")
            continue
        normalised_type = _normalise_session_type(s["session_type"])
        if normalised_type not in VALID_SESSION_TYPES:
            errors.append(
                f"session {i}: invalid session_type {s['session_type']!r}; "
                f"use one of {list(VALID_SESSION_TYPES)}"
            )
            continue
        try:
            d = date.fromisoformat(s["scheduled_date"])
        except ValueError:
            errors.append(f"session {i}: scheduled_date {s['scheduled_date']!r} not YYYY-MM-DD")
            continue
        rows.append({
            "user_id": user_id,
            "scheduled_date": d.isoformat(),
            "session_type": normalised_type,
            "sport": _normalise_sport(s.get("sport")),
            "duration_min": _optional_int(s.get("duration_min")),
            "distance_m": _distance_m(s),
            "description": s.get("description"),
            "rationale": s.get("rationale"),
            "intensity_zones": s.get("intensity_zones") or {},
            "status": "scheduled",
            "ai_adjustments": [{
                "by": "assistant",
                "mode": mode,
                "plan_summary": plan_summary,
            }],
        })

    if errors:
        return {"ok": False, "errors": errors}

    # Sessions dated before today never surface (dashboard + get-planned-workouts
    # both look forward). Almost always a mis-anchored plan, so flag it loudly in
    # the response rather than silently "succeeding" with an invisible plan.
    today = date.today()
    past_dated = sum(1 for r in rows if date.fromisoformat(r["scheduled_date"]) < today)

    # Find the newest active plan to attach sessions to.
    active = (
        client.table("training_plans")
        .select("id, race_type, race_date, philosophy")
        .eq("user_id", user_id)
        .eq("status", "active")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    plan_created = False
    if active:
        plan_id = active[0]["id"]
    else:
        # No active plan yet — create an open-ended one to hang sessions on so
        # the dashboard's plan view picks them up. Span the validated rows.
        dates = [date.fromisoformat(r["scheduled_date"]) for r in rows]
        span_days = (max(dates) - min(dates)).days
        weeks = max(1, math.ceil((span_days + 1) / 7))
        new_plan = (
            client.table("training_plans")
            .insert({
                "user_id": user_id,
                "race_type": "general_fitness",
                "philosophy": "polarized",
                "start_date": date.today().isoformat(),
                "weeks": weeks,
                "plan_json": {},
                "status": "active",
            })
            .execute()
        )
        plan_id = new_plan.data[0]["id"]
        plan_created = True

    # Attach the validated rows to the resolved plan.
    for r in rows:
        r["plan_id"] = plan_id

    # Replace mode: wipe the window first so we don't end up with stacked sessions.
    deleted_count = 0
    if mode == "replace_window":
        if not window_start or not window_end:
            return {"error": "replace_window requires window_start and window_end"}
        try:
            d_start = date.fromisoformat(window_start)
            d_end = date.fromisoformat(window_end)
        except ValueError as exc:
            return {"error": f"window dates must be YYYY-MM-DD ({exc})"}
        if d_start > d_end:
            return {"error": "window_start must be on or before window_end"}
        wipe = (
            client.table("planned_workouts")
            .delete()
            .eq("user_id", user_id)
            .eq("plan_id", plan_id)
            .gte("scheduled_date", d_start.isoformat())
            .lte("scheduled_date", d_end.isoformat())
            .execute()
        )
        deleted_count = len(wipe.data or [])

    inserted = client.table("planned_workouts").insert(rows).execute()
    inserted_count = len(inserted.data or rows)

    # Frontend URL for the dashboard view. Falls back to the production Vercel
    # URL — the assistant can quote whichever is right for the deployment.
    frontend_url = os.environ.get("FRONTEND_URL") or "https://evovlerun.vercel.app"
    dashboard_url = f"{frontend_url.rstrip('/')}/dashboard/training"

    return {
        "ok": True,
        "mode": mode,
        "plan_id": plan_id,
        "plan_created": plan_created,
        "sessions_saved": inserted_count,
        "sessions_replaced": deleted_count,
        "errors": errors if errors else None,
        "dashboard_url": dashboard_url,
        "past_dated_count": past_dated or None,
        "warning": (
            f"{past_dated} of {len(rows)} session(s) are dated before today "
            f"({today.isoformat()}); they won't appear on the dashboard or in "
            f"get-planned-workouts. Did you mean to anchor the plan to the "
            f"current week?"
        )
        if past_dated
        else None,
        "message": (
            f"Saved {inserted_count} session(s)"
            + (f", replacing {deleted_count} in the window" if deleted_count else "")
            + f". The user can review them at {dashboard_url}."
        ),
    }


def delete_planned_workout(workout_id: str) -> dict[str, Any]:
    """Remove a planned workout by id.

    Use this when the athlete asks the assistant to remove a session they
    no longer want to do, OR to overwrite the auto-generated plan with a
    different session for that day (delete first, then push).

    Args:
        workout_id: The UUID of the planned workout row.
    """
    user_id = get_user_id()
    client = get_supabase_admin()
    result = (
        client.table("planned_workouts")
        .delete()
        .eq("id", workout_id)
        .eq("user_id", user_id)
        .execute()
    )
    deleted = result.data or []
    if not deleted:
        return {"ok": False, "error": "Planned workout not found or not owned by user."}
    return {"ok": True, "deleted_id": workout_id}
