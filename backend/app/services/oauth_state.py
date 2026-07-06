"""Signed `state` tokens for OAuth flows.

OAuth callbacks arrive without our session cookie, so we encode the user_id
into the `state` parameter and verify its signature on the way back. This
removes the need for a separate state-tracking table.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from jose import JWTError, jwt

from app.config import get_settings


class VerifiedState(NamedTuple):
    """What a valid state token decodes to."""

    user_id: str
    next_path: str | None  # in-app path to return the user to after the callback


def sign_state(
    *, user_id: str, provider: str, next_path: str | None = None, ttl_seconds: int = 600
) -> str:
    """Mint a state token tying a user to a provider. Default TTL = 10 minutes.

    `next_path` carries the in-app path to send the user back to after the
    provider callback (e.g. `/onboarding`), so it survives the round-trip
    without a session cookie.
    """
    settings = get_settings()
    if not settings.oauth_state_secret:
        raise RuntimeError("OAUTH_STATE_SECRET not configured")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "prov": provider,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=ttl_seconds)).timestamp()),
        "nonce": secrets.token_urlsafe(8),
    }
    if next_path:
        payload["next"] = next_path
    return jwt.encode(payload, settings.oauth_state_secret, algorithm="HS256")


def verify_state(state: str, *, expected_provider: str) -> VerifiedState:
    """Validate state and return the user_id + next_path it was minted for.

    Raises ValueError on failure.
    """
    settings = get_settings()
    if not settings.oauth_state_secret:
        raise RuntimeError("OAUTH_STATE_SECRET not configured")

    try:
        payload = jwt.decode(state, settings.oauth_state_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError(f"Invalid OAuth state: {exc}") from exc

    if payload.get("prov") != expected_provider:
        raise ValueError("OAuth state provider mismatch")

    sub = payload.get("sub")
    if not sub:
        raise ValueError("OAuth state missing subject")
    return VerifiedState(user_id=sub, next_path=payload.get("next"))
