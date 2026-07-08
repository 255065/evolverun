"""Tests for save_training_plan's auto-create-plan behaviour.

plan_crud.py imports get_supabase_admin and get_user_id at module level, so we
patch them on the module. The fake Supabase client is chainable (every filter
method returns self) and records the inserts it was asked to perform so the
tests can assert on them.
"""

from datetime import date

import pytest

from mcp_server.tools import plan_crud

USER_ID = "11111111-1111-1111-1111-111111111111"
NEW_PLAN_ID = "99999999-9999-9999-9999-999999999999"
EXISTING_PLAN_ID = "22222222-2222-2222-2222-222222222222"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Chainable query that ignores filters and returns a preset result."""

    def __init__(self, table, client, op):
        self._table = table
        self._client = client
        self._op = op  # "select" | "insert" | "delete"
        self._payload = None

    # filters / modifiers — all no-ops that keep the chain going
    def select(self, *a, **k):
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

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def execute(self):
        if self._op == "insert":
            self._client.inserts.append((self._table, self._payload))
            # Return a fake row for whichever table was inserted into.
            if self._table == "training_plans":
                return _Result([{"id": NEW_PLAN_ID}])
            # planned_workouts: echo a row per session.
            n = len(self._payload) if isinstance(self._payload, list) else 1
            return _Result([{"id": f"pw-{i}"} for i in range(n)])
        if self._op == "delete":
            return _Result(self._client.delete_returns)
        # select
        return _Result(self._client.select_returns.get(self._table, []))


class FakeClient:
    def __init__(self, select_returns=None, delete_returns=None):
        # Per-table canned select results.
        self.select_returns = select_returns or {}
        self.delete_returns = delete_returns or []
        # Recorded (table, payload) tuples for every insert.
        self.inserts = []

    def table(self, name):
        return _Query(name, self, op="select")

    # helpers for assertions
    def inserts_for(self, table):
        return [payload for (t, payload) in self.inserts if t == table]


@pytest.fixture
def patch_client(monkeypatch):
    def _install(client):
        monkeypatch.setattr(plan_crud, "get_supabase_admin", lambda: client)
        monkeypatch.setattr(plan_crud, "get_user_id", lambda: USER_ID)
        return client

    return _install


def _session(d, session_type="easy", **extra):
    base = {"scheduled_date": d, "session_type": session_type}
    base.update(extra)
    return base


def test_auto_create_when_no_active_plan(patch_client):
    client = patch_client(FakeClient(select_returns={"training_plans": []}))
    sessions = [
        _session("2026-06-01", "easy"),
        _session("2026-06-05", "long"),
        _session("2026-06-10", "tempo"),
    ]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is True
    assert result["plan_created"] is True

    plan_inserts = client.inserts_for("training_plans")
    assert len(plan_inserts) == 1
    row = plan_inserts[0]
    assert row["status"] == "active"
    assert row["race_type"] == "general_fitness"
    assert row["philosophy"] == "polarized"
    assert row["plan_json"] == {}
    assert row["start_date"] == date.today().isoformat()
    # span 2026-06-01..2026-06-10 = 9 days; ceil((9+1)/7) = 2
    assert row["weeks"] == 2

    # Sessions attach to the newly created plan.
    pw_inserts = client.inserts_for("planned_workouts")
    assert len(pw_inserts) == 1
    assert all(r["plan_id"] == NEW_PLAN_ID for r in pw_inserts[0])
    assert result["plan_id"] == NEW_PLAN_ID


def test_existing_active_plan_reused(patch_client):
    client = patch_client(
        FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]})
    )
    sessions = [_session("2026-06-01", "easy")]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is True
    assert result["plan_created"] is False
    assert result["plan_id"] == EXISTING_PLAN_ID
    # No new plan created.
    assert client.inserts_for("training_plans") == []
    # Sessions attach to existing plan.
    pw_inserts = client.inserts_for("planned_workouts")
    assert all(r["plan_id"] == EXISTING_PLAN_ID for r in pw_inserts[0])


def test_chatgpt_session_type_aliases_are_normalised(patch_client):
    client = patch_client(
        FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]})
    )
    sessions = [
        _session("2026-06-01", "easy_run", distance_km="8 km"),
        _session("2026-06-02", "long_run", sport="run"),
        _session("2026-06-03", "recovery_run"),
        _session("2026-06-04", "langtur"),
        _session("2026-06-05", "restitution"),
    ]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is True
    rows = client.inserts_for("planned_workouts")[0]
    assert [r["session_type"] for r in rows] == [
        "easy",
        "long",
        "recovery",
        "long",
        "recovery",
    ]
    assert rows[0]["distance_m"] == 8000
    assert rows[1]["sport"] == "running"


def test_mixed_invalid_sessions_write_nothing(patch_client):
    client = patch_client(
        FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]})
    )
    sessions = [
        _session("2026-06-01", "easy"),
        _session("2026-06-02", "qwerty_session"),
    ]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is False
    assert "invalid session_type" in result["errors"][0]
    assert client.inserts_for("training_plans") == []
    assert client.inserts_for("planned_workouts") == []


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("speed_intervals", "intervals"),
        ("long_slow_distance", "long"),
        ("easy recovery jog", "recovery"),  # recovery ordered before easy
        ("VO2 max repeats", "vo2max"),
        ("hill sprints", "hills"),
        ("threshold tempo blend", "threshold"),  # threshold ordered before tempo
        ("rolig restitution", "recovery"),
        ("qwerty_session", None),  # no known root → unmapped
    ],
)
def test_fuzzy_session_type_fallback(raw, expected):
    assert plan_crud._normalise_session_type(raw) == expected


def test_original_bug_week_saves_all_five(patch_client):
    """The exact week from the bug report: a mix of canonical types and the
    rejected aliases (easy_run/long_run/recovery_run). All 5 must now save."""
    client = patch_client(
        FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]})
    )
    sessions = [
        _session("2026-06-15", "easy_run"),
        _session("2026-06-16", "intervals"),
        _session("2026-06-18", "threshold"),
        _session("2026-06-20", "long_run"),
        _session("2026-06-21", "recovery_run"),
    ]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is True
    rows = client.inserts_for("planned_workouts")[0]
    assert [r["session_type"] for r in rows] == [
        "easy",
        "intervals",
        "threshold",
        "long",
        "recovery",
    ]


def test_weeks_formula_multiweek(patch_client):
    client = patch_client(FakeClient(select_returns={"training_plans": []}))
    sessions = [_session("2026-06-01"), _session("2026-06-10")]

    plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert client.inserts_for("training_plans")[0]["weeks"] == 2


def test_weeks_formula_single_day(patch_client):
    client = patch_client(FakeClient(select_returns={"training_plans": []}))
    sessions = [_session("2026-06-01")]

    plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert client.inserts_for("training_plans")[0]["weeks"] == 1


def test_all_invalid_sessions_no_plan_created(patch_client):
    client = patch_client(FakeClient(select_returns={"training_plans": []}))
    sessions = [
        _session("2026-06-01", "not_a_type"),
        {"session_type": "easy"},  # missing scheduled_date
    ]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is False
    assert result["errors"]
    # Nothing written.
    assert client.inserts_for("training_plans") == []
    assert client.inserts_for("planned_workouts") == []


def test_unauthenticated_save_writes_nothing(monkeypatch):
    """Criterion B12: with no bound user, get_user_id() raises and no write
    happens. save_training_plan calls get_user_id() before touching the client,
    so the RuntimeError propagates and the (recording) client sees zero inserts.
    """
    client = FakeClient(select_returns={"training_plans": []})
    monkeypatch.setattr(plan_crud, "get_supabase_admin", lambda: client)

    def _raise():
        raise RuntimeError(
            "MCP server context not bound — neither HTTP auth nor stdio binding present"
        )

    monkeypatch.setattr(plan_crud, "get_user_id", _raise)

    with pytest.raises(RuntimeError):
        plan_crud.save_training_plan(
            sessions=[_session("2026-06-01")], mode="append"
        )

    assert client.inserts == []


def test_save_scopes_active_plan_lookup_to_user(monkeypatch):
    """Criterion B13 (code half): the active-plan lookup is scoped to the
    authenticated user via .eq("user_id", <uid>). RLS on planned_workouts /
    training_plans lives in Postgres and is NOT COVERABLE here — this asserts
    only that the application code passes the user_id filter.
    """
    eq_calls = []

    class _TrackingQuery(_Query):
        def eq(self, col, val):
            eq_calls.append((col, val))
            return self

    class _TrackingClient(FakeClient):
        def table(self, name):
            return _TrackingQuery(name, self, op="select")

    client = _TrackingClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]})
    monkeypatch.setattr(plan_crud, "get_supabase_admin", lambda: client)
    monkeypatch.setattr(plan_crud, "get_user_id", lambda: USER_ID)

    plan_crud.save_training_plan(sessions=[_session("2026-06-01")], mode="append")

    # The training_plans lookup filtered on the authenticated user_id.
    assert ("user_id", USER_ID) in eq_calls


def test_past_dated_sessions_flag_a_warning(patch_client):
    """Sessions before today still save, but the response must flag them so the
    assistant catches a mis-anchored (past-dated) plan rather than reporting a
    silent success on a plan that will be invisible everywhere."""
    patch_client(FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]}))
    # Two past dates + one comfortably-future date.
    sessions = [_session("2026-06-01"), _session("2026-06-02"), _session("2099-01-01")]

    result = plan_crud.save_training_plan(sessions=sessions, mode="append")

    assert result["ok"] is True
    assert result["past_dated_count"] == 2
    assert result["warning"] and "before today" in result["warning"]


def test_future_only_sessions_have_no_warning(patch_client):
    patch_client(FakeClient(select_returns={"training_plans": [{"id": EXISTING_PLAN_ID}]}))

    result = plan_crud.save_training_plan(
        sessions=[_session("2099-01-01"), _session("2099-01-08")], mode="append"
    )

    assert result["ok"] is True
    assert result["past_dated_count"] is None
    assert result["warning"] is None


def test_idempotent_retry_appends_to_existing_plan(patch_client):
    # First call: no active plan -> creates one.
    client1 = patch_client(FakeClient(select_returns={"training_plans": []}))
    first = plan_crud.save_training_plan(
        sessions=[_session("2026-06-01")], mode="append"
    )
    assert first["plan_created"] is True
    assert len(client1.inserts_for("training_plans")) == 1

    # Second call (retry): the plan now exists, so it is reused, not duplicated.
    client2 = patch_client(
        FakeClient(select_returns={"training_plans": [{"id": NEW_PLAN_ID}]})
    )
    second = plan_crud.save_training_plan(
        sessions=[_session("2026-06-01")], mode="append"
    )
    assert second["plan_created"] is False
    assert second["plan_id"] == NEW_PLAN_ID
    assert client2.inserts_for("training_plans") == []
