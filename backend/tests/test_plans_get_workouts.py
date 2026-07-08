"""Tests for get_planned_workouts' window vs. active-plan reporting.

plans.py imports get_supabase_admin and get_user_id at module level, so we patch
them on the module. The fake Supabase client is chainable; it returns different
canned data for the two distinct planned_workouts reads by looking at the select
columns ("*" = the forward-window query, "scheduled_date" = the plan-span query).
"""

import pytest

from mcp_server.tools import plans

USER_ID = "11111111-1111-1111-1111-111111111111"
PLAN_ID = "22222222-2222-2222-2222-222222222222"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Chainable query that records the select columns and ignores filters."""

    def __init__(self, table, client):
        self._table = table
        self._client = client
        self._select = None

    def select(self, *a, **k):
        self._select = a[0] if a else None
        return self

    def eq(self, *a, **k):
        return self

    def gte(self, *a, **k):
        return self

    def lte(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        if self._table == "planned_workouts":
            # "*" is the forward-window read; "scheduled_date" is the span read.
            if self._select == "*":
                return _Result(self._client.window_rows)
            return _Result(self._client.span_rows)
        if self._table == "training_plans":
            return _Result(self._client.active_plan)
        return _Result([])


class FakeClient:
    def __init__(self, window_rows=None, active_plan=None, span_rows=None):
        self.window_rows = window_rows or []
        self.active_plan = active_plan or []
        self.span_rows = span_rows or []

    def table(self, name):
        return _Query(name, self)


@pytest.fixture
def patch_client(monkeypatch):
    def _install(client):
        monkeypatch.setattr(plans, "get_supabase_admin", lambda: client)
        monkeypatch.setattr(plans, "get_user_id", lambda: USER_ID)
        return client

    return _install


def _pw(date_str, session_type="easy"):
    return {
        "scheduled_date": date_str,
        "session_type": session_type,
        "sport": "running",
        "duration_min": 45,
        "distance_m": None,
        "description": "steady",
        "rationale": "aerobic base",
        "intensity_zones": {},
        "status": "scheduled",
    }


def test_sessions_in_window_are_returned(patch_client):
    patch_client(FakeClient(window_rows=[_pw("2026-06-02"), _pw("2026-06-04", "long")]))

    result = plans.get_planned_workouts(days_ahead=7)

    assert result["available"] is True
    assert len(result["sessions"]) == 2
    assert result["sessions"][0]["session_type"] == "easy"


def test_active_plan_with_only_past_sessions_reports_range(patch_client):
    """The exact bug: a saved active plan whose sessions are all in the past. The
    window is empty, but we must report the plan (not "no plan") + its date range."""
    span = [{"scheduled_date": d} for d in ("2026-06-01", "2026-06-10", "2026-06-20")]
    patch_client(
        FakeClient(window_rows=[], active_plan=[{"id": PLAN_ID}], span_rows=span)
    )

    result = plans.get_planned_workouts(days_ahead=7)

    assert result["available"] is False
    assert result["active_plan"] is True
    assert result["plan_sessions"] == 3
    assert result["plan_date_range"] == {"first": "2026-06-01", "last": "2026-06-20"}
    assert "2026-06-01" in result["message"] and "2026-06-20" in result["message"]
    # Must NOT fall through to the misleading "no plan" message.
    assert result["message"] != "No active training plan yet."


def test_no_plan_and_no_sessions_reports_no_plan(patch_client):
    patch_client(FakeClient(window_rows=[], active_plan=[], span_rows=[]))

    result = plans.get_planned_workouts(days_ahead=7)

    assert result["available"] is False
    assert result["message"] == "No active training plan yet."
    assert "active_plan" not in result
