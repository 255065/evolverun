"""The onboarding funnel threads a post-connect `next` path through the OAuth
state token and the callback's frontend redirect. These cover the round-trip
and the same-origin guard that stops the `next` param becoming an open redirect.
"""

from types import SimpleNamespace

import pytest

from app.routers import providers
from app.services import oauth_state


@pytest.fixture(autouse=True)
def _state_secret(monkeypatch):
    monkeypatch.setattr(
        oauth_state, "get_settings", lambda: SimpleNamespace(oauth_state_secret="test-secret")
    )


# ---- state round-trip ----------------------------------------------------
def test_state_round_trip_carries_next_path():
    token = oauth_state.sign_state(user_id="user-1", provider="strava", next_path="/onboarding")
    verified = oauth_state.verify_state(token, expected_provider="strava")
    assert verified.user_id == "user-1"
    assert verified.next_path == "/onboarding"


def test_state_without_next_path_defaults_to_none():
    token = oauth_state.sign_state(user_id="user-1", provider="strava")
    verified = oauth_state.verify_state(token, expected_provider="strava")
    assert verified.user_id == "user-1"
    assert verified.next_path is None


def test_state_provider_mismatch_rejected():
    token = oauth_state.sign_state(user_id="user-1", provider="strava", next_path="/onboarding")
    with pytest.raises(ValueError):
        oauth_state.verify_state(token, expected_provider="garmin")


# ---- same-origin guard ---------------------------------------------------
@pytest.mark.parametrize(
    "raw,expected",
    [
        ("/onboarding", "/onboarding"),
        ("/dashboard/connections", "/dashboard/connections"),
        ("//evil.com", None),
        ("https://evil.com", None),
        ("evil.com", None),
        ("", None),
        (None, None),
    ],
)
def test_safe_next(raw, expected):
    assert providers._safe_next(raw) == expected


def test_frontend_redirect_uses_safe_next_path():
    settings = SimpleNamespace(frontend_url="https://evolverun.app")
    url = providers._frontend_redirect(settings, "connected", "strava", "/onboarding")
    assert url == "https://evolverun.app/onboarding?provider=strava&status=connected"


def test_frontend_redirect_falls_back_on_unsafe_next():
    settings = SimpleNamespace(frontend_url="https://evolverun.app")
    url = providers._frontend_redirect(settings, "connected", "strava", "https://evil.com")
    assert url == "https://evolverun.app/dashboard/connections?provider=strava&status=connected"


def test_frontend_redirect_default_without_next():
    settings = SimpleNamespace(frontend_url="https://evolverun.app")
    url = providers._frontend_redirect(settings, "connected_no_sync", "strava")
    assert url == (
        "https://evolverun.app/dashboard/connections?provider=strava&status=connected_no_sync"
    )
