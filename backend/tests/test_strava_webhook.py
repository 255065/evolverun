"""Tests for the Strava webhook event dispatch.

The handler must ack fast: parse the push, resolve the athlete → user, and
schedule a background ingest (or a delete) — without doing the network fetch
inline. These tests mock the user lookup + Supabase client so no DB/network
is touched; they only assert the routing/dispatch decisions.
"""

from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.routers import providers

OWNER_ID = 108189954
USER_ID = "11111111-1111-1111-1111-111111111111"
ACTIVITY_ID = 18531785177
WEBHOOK_TOKEN = "test-webhook-token"


class _FakeRequest:
    def __init__(self, payload, query=None):
        self._payload = payload
        # Default to a valid token so existing routing tests exercise the
        # happy path; auth tests pass query={} or a wrong token explicitly.
        self.query_params = {"token": WEBHOOK_TOKEN} if query is None else query

    async def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _webhook_secret(monkeypatch):
    """Pin a known webhook verify token so the POST auth gate is deterministic
    regardless of the developer's .env."""
    monkeypatch.setattr(
        providers,
        "get_settings",
        lambda: SimpleNamespace(strava_webhook_verify_token=WEBHOOK_TOKEN),
    )


def _event(**over):
    base = {
        "object_type": "activity",
        "object_id": ACTIVITY_ID,
        "aspect_type": "create",
        "owner_id": OWNER_ID,
    }
    base.update(over)
    return base


@pytest.fixture
def known_user(monkeypatch):
    """Athlete OWNER_ID maps to USER_ID."""
    monkeypatch.setattr(
        providers, "find_user_by_provider_id", lambda **k: USER_ID
    )


@pytest.mark.asyncio
async def test_create_schedules_background_ingest(monkeypatch, known_user):
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(_FakeRequest(_event()), bt)

    assert result == {"status": "received"}
    assert len(bt.tasks) == 1
    task = bt.tasks[0]
    assert task.func is providers._ingest_strava_activity
    assert task.kwargs == {"user_id": USER_ID, "activity_id": str(ACTIVITY_ID)}


@pytest.mark.asyncio
async def test_update_also_ingests(monkeypatch, known_user):
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(
        _FakeRequest(_event(aspect_type="update")), bt
    )
    assert result == {"status": "received"}
    assert len(bt.tasks) == 1


@pytest.mark.asyncio
async def test_unknown_athlete_is_ignored(monkeypatch):
    monkeypatch.setattr(providers, "find_user_by_provider_id", lambda **k: None)
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(_FakeRequest(_event()), bt)
    assert result == {"status": "ignored"}
    assert bt.tasks == []


@pytest.mark.asyncio
async def test_non_activity_event_is_ignored(monkeypatch):
    # athlete (deauthorize) events carry object_type="athlete" — nothing to sync.
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(
        _FakeRequest(_event(object_type="athlete")), bt
    )
    assert result == {"status": "ignored"}
    assert bt.tasks == []


@pytest.mark.asyncio
async def test_delete_event_removes_workout(monkeypatch, known_user):
    deleted = {}

    class _Q:
        def delete(self):
            deleted["delete"] = True
            return self

        def eq(self, col, val):
            deleted[col] = val
            return self

        def execute(self):
            return None

    class _Client:
        def table(self, name):
            deleted["table"] = name
            return _Q()

    monkeypatch.setattr(providers, "get_supabase_admin", lambda: _Client())

    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(
        _FakeRequest(_event(aspect_type="delete")), bt
    )

    assert result == {"status": "received"}
    assert bt.tasks == []  # delete is inline, not backgrounded
    assert deleted["table"] == "workouts"
    assert deleted["source_id"] == str(ACTIVITY_ID)
    assert deleted["user_id"] == USER_ID


@pytest.mark.asyncio
async def test_event_accepted_without_token(monkeypatch):
    """Strava's API does not support query params in the callback URL, so
    events arrive without a token. The handler accepts them — actual data is
    always fetched via the authenticated Strava API, so forged events are
    low-risk (IDs only, no raw data in the payload)."""
    monkeypatch.setattr(providers, "find_user_by_provider_id", lambda **k: USER_ID)
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(
        _FakeRequest(_event(aspect_type="create"), query={}), bt
    )
    assert result == {"status": "received"}
    assert len(bt.tasks) == 1


# --- Personal Garmin sync trigger -------------------------------------------


def _garmin_settings(monkeypatch, athlete=OWNER_ID):
    monkeypatch.setattr(
        providers,
        "get_settings",
        lambda: SimpleNamespace(
            strava_webhook_verify_token=WEBHOOK_TOKEN,
            garmin_sync_github_token="gh-token",
            garmin_sync_repo="owner/garmin-data",
            garmin_sync_strava_athlete_id=str(athlete),
        ),
    )


@pytest.mark.asyncio
async def test_create_triggers_garmin_sync_for_configured_athlete(monkeypatch, known_user):
    _garmin_settings(monkeypatch)
    bt = BackgroundTasks()
    await providers.strava_webhook_event(_FakeRequest(_event()), bt)

    funcs = [t.func for t in bt.tasks]
    assert providers._trigger_garmin_sync in funcs
    assert providers._ingest_strava_activity in funcs  # normal ingest unchanged
    trigger = next(t for t in bt.tasks if t.func is providers._trigger_garmin_sync)
    assert trigger.kwargs == {"repo": "owner/garmin-data", "token": "gh-token", "activity_id": str(ACTIVITY_ID)}


@pytest.mark.asyncio
async def test_garmin_sync_triggers_even_without_evolverun_user(monkeypatch):
    _garmin_settings(monkeypatch)
    monkeypatch.setattr(providers, "find_user_by_provider_id", lambda **k: None)
    bt = BackgroundTasks()
    result = await providers.strava_webhook_event(_FakeRequest(_event()), bt)
    assert result == {"status": "ignored"}
    assert [t.func for t in bt.tasks] == [providers._trigger_garmin_sync]


@pytest.mark.asyncio
async def test_garmin_sync_not_triggered_for_update_or_other_athlete(monkeypatch, known_user):
    _garmin_settings(monkeypatch, athlete=999)
    bt = BackgroundTasks()
    await providers.strava_webhook_event(_FakeRequest(_event()), bt)
    assert providers._trigger_garmin_sync not in [t.func for t in bt.tasks]

    _garmin_settings(monkeypatch)
    bt = BackgroundTasks()
    await providers.strava_webhook_event(_FakeRequest(_event(aspect_type="update")), bt)
    assert providers._trigger_garmin_sync not in [t.func for t in bt.tasks]


@pytest.mark.asyncio
async def test_trigger_posts_repository_dispatch(monkeypatch):
    calls = {}

    class _Resp:
        status_code = 204
        text = ""

    class _Client:
        def __init__(self, **kw): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, url, headers, json):
            calls.update(url=url, headers=headers, json=json)
            return _Resp()

    monkeypatch.setattr(providers.httpx, "AsyncClient", _Client)
    await providers._trigger_garmin_sync(repo="owner/garmin-data", token="gh-token", activity_id="42")
    assert calls["url"] == "https://api.github.com/repos/owner/garmin-data/dispatches"
    assert calls["headers"]["Authorization"] == "Bearer gh-token"
    assert calls["json"]["event_type"] == "garmin-workout"
