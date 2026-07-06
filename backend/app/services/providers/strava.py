"""Strava provider implementation.

Docs: https://developers.strava.com/docs/reference/
"""

from __future__ import annotations

import hmac
import logging
from datetime import date, datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.config import get_settings
from app.services.oauth_state import sign_state
from app.services.providers.base import (
    NormalizedActivity,
    NormalizedDailyMetric,
    OAuthFlowResult,
    ProviderAuthError,
    ProviderClient,
    ProviderError,
    ProviderRateLimitError,
    ProviderTokens,
    Sport,
)
from app.services.providers.registry import register_provider

log = logging.getLogger(__name__)

STRAVA_AUTHORIZE_URL = "https://www.strava.com/oauth/authorize"
STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_API_BASE = "https://www.strava.com/api/v3"

# Strava activity types → our internal sport enum. Everything not listed maps to "other".
_SPORT_MAP: dict[str, Sport] = {
    "Run": "running",
    "TrailRun": "running",
    "VirtualRun": "running",
    "Ride": "cycling",
    "VirtualRide": "cycling",
    "EBikeRide": "cycling",
    "MountainBikeRide": "cycling",
    "GravelRide": "cycling",
    "Swim": "swimming",
    "Walk": "walking",
    "Hike": "hiking",
    "WeightTraining": "strength",
    "Workout": "strength",
}


class StravaProvider(ProviderClient):
    slug = "strava"

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.strava_client_id or not settings.strava_client_secret:
            raise ProviderError("Strava client credentials not configured")
        self.client_id = settings.strava_client_id
        self.client_secret = settings.strava_client_secret

    # -- OAuth -------------------------------------------------------------
    def start_oauth(
        self, *, user_id: str, redirect_uri: str, next_path: str | None = None
    ) -> OAuthFlowResult:
        state = sign_state(user_id=user_id, provider=self.slug, next_path=next_path)
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "approval_prompt": "auto",
            "scope": "read,activity:read_all,profile:read_all",
            "state": state,
        }
        return OAuthFlowResult(authorize_url=f"{STRAVA_AUTHORIZE_URL}?{urlencode(params)}", state=state)

    async def complete_oauth(
        self, *, code: str, state: str, redirect_uri: str
    ) -> ProviderTokens:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                STRAVA_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )
        if response.status_code != 200:
            raise ProviderAuthError(f"Strava token exchange failed: {response.status_code} {response.text}")

        data = response.json()
        athlete = data.get("athlete") or {}
        return ProviderTokens(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_at=datetime.fromtimestamp(data["expires_at"], tz=timezone.utc),
            scope=data.get("scope") or "read,activity:read_all,profile:read_all",
            provider_user_id=str(athlete.get("id")) if athlete.get("id") else None,
            extra={"athlete": athlete},
        )

    async def refresh(self, tokens: ProviderTokens) -> ProviderTokens:
        if not tokens.refresh_token:
            raise ProviderAuthError("No refresh token stored — user must reconnect Strava")

        # Strava recommends refreshing only when within 1h of expiry.
        if tokens.expires_at and tokens.expires_at > datetime.now(timezone.utc):
            return tokens

        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                STRAVA_TOKEN_URL,
                data={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "refresh_token",
                    "refresh_token": tokens.refresh_token,
                },
            )
        if response.status_code != 200:
            raise ProviderAuthError(f"Strava refresh failed: {response.status_code} {response.text}")

        data = response.json()
        return ProviderTokens(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token") or tokens.refresh_token,
            expires_at=datetime.fromtimestamp(data["expires_at"], tz=timezone.utc),
            scope=tokens.scope,
            provider_user_id=tokens.provider_user_id,
            extra=tokens.extra,
        )

    # -- Data fetch --------------------------------------------------------
    async def fetch_activities(
        self,
        tokens: ProviderTokens,
        *,
        since: datetime,
        until: datetime | None = None,
    ) -> list[NormalizedActivity]:
        """Paginate /athlete/activities and normalize each row."""
        out: list[NormalizedActivity] = []
        params: dict[str, Any] = {
            "after": int(since.timestamp()),
            "per_page": 200,
            "page": 1,
        }
        if until:
            params["before"] = int(until.timestamp())

        headers = {"Authorization": f"Bearer {tokens.access_token}"}
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            while True:
                response = await client.get(f"{STRAVA_API_BASE}/athlete/activities", params=params)
                if response.status_code == 401:
                    raise ProviderAuthError("Strava token rejected (401)")
                if response.status_code == 429:
                    raise ProviderRateLimitError("Strava rate limited (429)")
                if response.status_code != 200:
                    raise ProviderError(f"Strava activities fetch failed: {response.status_code} {response.text}")

                batch: list[dict[str, Any]] = response.json()
                if not batch:
                    break

                for raw in batch:
                    out.append(_normalize_activity(raw))

                if len(batch) < params["per_page"]:
                    break
                params["page"] += 1

        return out

    async def fetch_activity_by_id(
        self, tokens: ProviderTokens, activity_id: str
    ) -> NormalizedActivity:
        """Fetch a single activity by id — used by the webhook to ingest one push."""
        headers = {"Authorization": f"Bearer {tokens.access_token}"}
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
            response = await client.get(f"{STRAVA_API_BASE}/activities/{activity_id}")
        if response.status_code == 401:
            raise ProviderAuthError("Strava token rejected (401)")
        if response.status_code == 429:
            raise ProviderRateLimitError("Strava rate limited (429)")
        if response.status_code != 200:
            raise ProviderError(
                f"Strava activity fetch failed: {response.status_code} {response.text}"
            )
        return _normalize_activity(response.json())

    async def fetch_daily_metrics(
        self,
        tokens: ProviderTokens,
        *,
        since: date,
        until: date | None = None,
    ) -> list[NormalizedDailyMetric]:
        # Strava has no daily wellness data.
        return []

    # -- Webhooks ----------------------------------------------------------
    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        """Strava webhooks don't use HMAC signatures — they use the verify_token
        echo on subscription creation. For incoming POST events we trust the
        source (Strava's IPs), but you may want to add IP allow-listing in prod.
        """
        return True


def _normalize_activity(raw: dict[str, Any]) -> NormalizedActivity:
    """Convert a Strava activity dict into our NormalizedActivity shape."""
    sport_type: Sport = _SPORT_MAP.get(raw.get("type") or raw.get("sport_type") or "", "other")
    started_at = datetime.fromisoformat(raw["start_date"].replace("Z", "+00:00"))
    duration = int(raw.get("moving_time") or raw.get("elapsed_time") or 0)
    distance = raw.get("distance")
    avg_speed = raw.get("average_speed") or 0.0  # m/s

    pace_s_per_km: float | None = None
    if sport_type in ("running", "walking", "hiking") and avg_speed and avg_speed > 0:
        pace_s_per_km = round(1000.0 / avg_speed, 2)

    return NormalizedActivity(
        source="strava",
        source_id=str(raw["id"]),
        sport=sport_type,
        started_at=started_at,
        duration_seconds=duration,
        distance_m=float(distance) if distance is not None else None,
        elevation_gain_m=raw.get("total_elevation_gain"),
        avg_hr=int(raw["average_heartrate"]) if raw.get("average_heartrate") else None,
        max_hr=int(raw["max_heartrate"]) if raw.get("max_heartrate") else None,
        avg_pace_s_per_km=pace_s_per_km,
        avg_power_w=raw.get("average_watts"),
        normalized_power_w=raw.get("weighted_average_watts"),
        trimp=raw.get("suffer_score"),  # HR-based proxy — not strictly TRIMP, but useful
        tss=None,
        perceived_effort=raw.get("perceived_exertion"),
        notes=raw.get("name"),
        raw_payload=raw,
    )


register_provider(StravaProvider.slug, StravaProvider)


# Local helper, exposed for use by webhook signature verification when we
# add that — Strava actually doesn't sign, but keeping the helper for shape.
def _hmac_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
