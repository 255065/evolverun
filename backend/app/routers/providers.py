"""Provider OAuth + sync routes.

The frontend opens the authorize URL we return from /authorize. The provider
redirects back to /callback, we exchange the code, store encrypted tokens,
and trigger an initial sync. The frontend is then redirected to the
connections page with a status param.
"""

from __future__ import annotations

import hmac
import logging
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

# Side-effect imports — provider modules call register_provider() at import time.
from app.services.providers import strava as _strava  # noqa: F401  pylint: disable=unused-import
from app.services.providers import garmin as _garmin  # noqa: F401  pylint: disable=unused-import
from app.config import Settings, get_settings
from app.core.crypto import decrypt, encrypt
from app.core.security import CurrentUser, get_current_user
from app.core.supabase import get_supabase_admin
from app.services.connections import (
    find_user_by_provider_id,
    get_last_sync_at,
    load_tokens,
    mark_status,
    mark_synced,
    upsert_tokens,
)
from app.services.garmin_sync import sync_full as garmin_sync_full
from app.services.oauth_state import verify_state
from app.services.providers import get_provider, list_providers
from app.services.providers.base import ProviderAuthError, ProviderError
from app.services.workouts import upsert_activities, upsert_daily_metrics

log = logging.getLogger(__name__)
router = APIRouter(prefix="/providers", tags=["providers"])

# How far back to pull on first connect. Strava returns only the activities
# that actually exist in the window, so users with less than a year of data
# simply get less.
INITIAL_SYNC_DAYS = 365


class AuthorizeResponse(BaseModel):
    authorize_url: str


class ConnectionStatus(BaseModel):
    provider: str
    connected: bool
    provider_user_id: str | None = None
    expires_at: datetime | None = None
    scope: str | None = None
    last_sync_at: datetime | None = None


class CredentialLoginBody(BaseModel):
    username: str
    password: str


class CredentialLoginReply(BaseModel):
    status: str  # "connected" | "mfa_required"
    pending_token: str | None = None  # opaque blob to pass back with MFA code


class MfaSubmitBody(BaseModel):
    pending_token: str
    mfa_code: str


def _redirect_uri(settings: Settings, provider_slug: str) -> str:
    return f"{settings.backend_public_url.rstrip('/')}/providers/{provider_slug}/callback"


def _safe_next(next_path: str | None) -> str | None:
    """Only allow same-origin in-app paths — no scheme, no protocol-relative //."""
    if next_path and next_path.startswith("/") and not next_path.startswith("//"):
        return next_path
    return None


def _frontend_redirect(
    settings: Settings, status_msg: str, provider_slug: str, next_path: str | None = None
) -> str:
    # `next_path` (e.g. /onboarding) lets the funnel return here instead of the
    # dashboard connections page. It's validated same-origin and carries no
    # query string of its own, so appending ?provider=&status= is safe.
    base = _safe_next(next_path) or "/dashboard/connections"
    return (
        f"{settings.frontend_url.rstrip('/')}{base}"
        f"?provider={provider_slug}&status={status_msg}"
    )


# -- list available providers --------------------------------------------------
@router.get("", response_model=list[str])
def available_providers() -> list[str]:
    """Slugs of providers that are configured and ready to connect."""
    return list_providers()


# -- start OAuth ---------------------------------------------------------------
@router.post("/{provider_slug}/authorize", response_model=AuthorizeResponse)
def authorize(
    provider_slug: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    next_path: Annotated[str | None, Query(alias="next")] = None,
) -> AuthorizeResponse:
    """Build the provider authorize URL the frontend should redirect the user to."""
    try:
        provider = get_provider(provider_slug)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    redirect_uri = _redirect_uri(settings, provider_slug)
    flow = provider.start_oauth(
        user_id=user.id, redirect_uri=redirect_uri, next_path=_safe_next(next_path)
    )
    return AuthorizeResponse(authorize_url=flow.authorize_url)


# -- OAuth callback ------------------------------------------------------------
@router.get("/{provider_slug}/callback")
async def callback(
    provider_slug: str,
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
):
    """Provider redirects user here with ?code=...&state=... after they approve."""
    error = request.query_params.get("error")
    if error:
        log.warning("Provider %s returned OAuth error: %s", provider_slug, error)
        return RedirectResponse(_frontend_redirect(settings, f"denied:{error}", provider_slug))

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code or not state:
        return RedirectResponse(_frontend_redirect(settings, "missing_params", provider_slug))

    try:
        provider = get_provider(provider_slug)
    except KeyError:
        return RedirectResponse(_frontend_redirect(settings, "unknown_provider", provider_slug))

    try:
        verified = verify_state(state, expected_provider=provider_slug)
    except ValueError as exc:
        log.warning("OAuth state rejected for %s: %s", provider_slug, exc)
        return RedirectResponse(_frontend_redirect(settings, "bad_state", provider_slug))
    user_id = verified.user_id
    next_path = verified.next_path

    redirect_uri = _redirect_uri(settings, provider_slug)
    try:
        tokens = await provider.complete_oauth(code=code, state=state, redirect_uri=redirect_uri)
    except ProviderError as exc:
        log.exception("complete_oauth failed for %s", provider_slug)
        return RedirectResponse(
            _frontend_redirect(settings, f"exchange_failed:{exc}", provider_slug, next_path)
        )

    upsert_tokens(user_id=user_id, provider=provider_slug, tokens=tokens)

    # Best-effort initial sync. Failure here doesn't break the connection —
    # the user can retry via /sync.
    try:
        since = datetime.now(timezone.utc) - timedelta(days=INITIAL_SYNC_DAYS)
        activities = await provider.fetch_activities(tokens, since=since)
        written = upsert_activities(user_id=user_id, activities=activities)
        metrics = await provider.fetch_daily_metrics(tokens, since=since.date())
        m_written = upsert_daily_metrics(user_id=user_id, metrics=metrics)
        mark_synced(user_id=user_id, provider=provider_slug)
        log.info(
            "Initial sync for %s/%s: %d activities, %d daily metrics",
            user_id, provider_slug, written, m_written,
        )
    except ProviderError as exc:
        log.warning("Initial sync failed for %s/%s: %s", user_id, provider_slug, exc)
        return RedirectResponse(
            _frontend_redirect(settings, "connected_no_sync", provider_slug, next_path)
        )

    return RedirectResponse(_frontend_redirect(settings, "connected", provider_slug, next_path))


# -- status --------------------------------------------------------------------
@router.get("/{provider_slug}/status", response_model=ConnectionStatus)
def connection_status(
    provider_slug: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> ConnectionStatus:
    """Tell the frontend whether this user has a working connection for a provider."""
    tokens = load_tokens(user_id=user.id, provider=provider_slug)
    if not tokens:
        return ConnectionStatus(provider=provider_slug, connected=False)
    return ConnectionStatus(
        provider=provider_slug,
        connected=True,
        provider_user_id=tokens.provider_user_id,
        expires_at=tokens.expires_at,
        scope=tokens.scope,
        last_sync_at=get_last_sync_at(user_id=user.id, provider=provider_slug),
    )


# -- manual sync ---------------------------------------------------------------
@router.post("/{provider_slug}/sync")
async def manual_sync(
    provider_slug: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
    days: int = 30,
) -> dict[str, int | str | list]:
    """User-triggered re-sync for the last N days.

    For Garmin: pulls activities + per-activity splits/zones/weather + daily
    wellness (sleep/HRV/stress/SpO2/respiration) + Garmin's performance
    estimates (VO2max/LT/race predictions/training status) + personal records.

    For other providers: just activities + daily metrics (no deep enrichment yet).
    """
    try:
        provider = get_provider(provider_slug)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    tokens = load_tokens(user_id=user.id, provider=provider_slug)
    if not tokens:
        raise HTTPException(status_code=400, detail=f"Not connected to {provider_slug}")

    # Garmin uses the deep orchestrator. Others stay on the simple two-call sync.
    if provider_slug == "garmin":
        # days=0 means "auto-detect" — ask Garmin for the user's oldest
        # activity and sync from there. Routine syncs (≤180 days) keep the
        # per-activity enrichment (splits/zones/weather); long windows skip
        # it to stay under an hour of wall-clock time.
        days_arg: int | None = None if days == 0 else days
        enrich = days_arg is not None and days_arg <= 180
        report = await garmin_sync_full(user_id=user.id, days_back=days_arg, enrich=enrich)
        if report.get("status") == "auth_expired":
            raise HTTPException(status_code=401, detail="; ".join(report.get("errors") or ["auth expired"]))
        if report.get("status") == "rate_limited":
            raise HTTPException(status_code=429, detail="Garmin rate-limited — try again in a few minutes")
        return {"provider": provider_slug, **report}

    try:
        tokens = await provider.refresh(tokens)
        if tokens.access_token != (load_tokens(user_id=user.id, provider=provider_slug) or tokens).access_token:
            upsert_tokens(user_id=user.id, provider=provider_slug, tokens=tokens)

        since = datetime.now(timezone.utc) - timedelta(days=days)
        activities = await provider.fetch_activities(tokens, since=since)
        written = upsert_activities(user_id=user.id, activities=activities)

        metrics = await provider.fetch_daily_metrics(tokens, since=since.date())
        m_written = upsert_daily_metrics(user_id=user.id, metrics=metrics)

        mark_synced(user_id=user.id, provider=provider_slug)
        return {"provider": provider_slug, "activities": written, "daily_metrics": m_written}
    except ProviderAuthError as exc:
        mark_status(user_id=user.id, provider=provider_slug, status="expired")
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


# -- disconnect ----------------------------------------------------------------
@router.delete("/{provider_slug}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(
    provider_slug: str,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> None:
    """Mark the connection revoked. Token row stays for audit; we just stop using it."""
    mark_status(user_id=user.id, provider=provider_slug, status="revoked")


# -- Credential login (Garmin etc.) -------------------------------------------
@router.post("/{provider_slug}/credential-login", response_model=CredentialLoginReply)
async def credential_login(
    provider_slug: str,
    body: CredentialLoginBody,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CredentialLoginReply:
    """Username/password login for providers without OAuth.

    If the provider requires MFA, returns `status="mfa_required"` and a
    `pending_token` (encrypted blob containing the in-flight session state +
    user credentials). The client posts the MFA code back to `/mfa-submit`.
    """
    try:
        provider = get_provider(provider_slug)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        result = await provider.login_with_credentials(
            user_id=user.id, username=body.username, password=body.password
        )
    except ProviderAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if result.needs_mfa:
        # Bundle pending state + creds + provider so we can resume after MFA.
        pending = encrypt(
            f"{provider_slug}|{user.id}|{body.username}|{body.password}|{result.pending_state}"
        )
        return CredentialLoginReply(status="mfa_required", pending_token=pending)

    assert result.tokens is not None
    upsert_tokens(user_id=user.id, provider=provider_slug, tokens=result.tokens)
    return CredentialLoginReply(status="connected")


@router.post("/{provider_slug}/mfa-submit", response_model=CredentialLoginReply)
async def submit_mfa(
    provider_slug: str,
    body: MfaSubmitBody,
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> CredentialLoginReply:
    """Finish a pending credential login by submitting the MFA code."""
    try:
        decoded = decrypt(body.pending_token).split("|", 4)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Bad pending_token: {exc}") from exc

    if len(decoded) != 5:
        raise HTTPException(status_code=400, detail="Malformed pending_token")
    stored_slug, stored_user, username, password, pending_state = decoded

    if stored_slug != provider_slug or stored_user != user.id:
        raise HTTPException(status_code=403, detail="pending_token does not match request")

    try:
        provider = get_provider(provider_slug)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        tokens = await provider.complete_credential_login(
            user_id=user.id,
            pending_state=pending_state,
            mfa_code=body.mfa_code,
            username=username,
            password=password,
        )
    except ProviderAuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    upsert_tokens(user_id=user.id, provider=provider_slug, tokens=tokens)
    return CredentialLoginReply(status="connected")


# -- Strava webhook ------------------------------------------------------------
# Strava webhooks need TWO endpoints with the same path:
#   GET  → subscription verification (hub challenge echo)
#   POST → event delivery
@router.get("/strava/webhook")
def strava_webhook_verify(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    """Strava sends a one-time GET to verify the endpoint when you create a subscription.

    Strava also does a plain reachability GET (no hub.* params) before sending
    the challenge — that must return 200 or registration fails.
    """
    mode = request.query_params.get("hub.mode")
    if not mode:
        return {}  # reachability probe — just confirm we're alive

    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    if mode != "subscribe" or token != settings.strava_webhook_verify_token or not challenge:
        raise HTTPException(status_code=403, detail="Webhook verification failed")
    return {"hub.challenge": challenge}


async def _ingest_strava_activity(*, user_id: str, activity_id: str) -> None:
    """Background worker: fetch one Strava activity and upsert it.

    Runs after the webhook has already acked, so it's allowed to take its
    time (token refresh + API call). Failures are logged, not raised — a
    missed push is recoverable via the manual "Sync now" button.
    """
    try:
        tokens = load_tokens(user_id=user_id, provider="strava")
        if not tokens:
            log.warning("Webhook ingest: no active Strava connection for %s", user_id)
            return
        provider = get_provider("strava")
        tokens = await provider.refresh(tokens)
        upsert_tokens(user_id=user_id, provider="strava", tokens=tokens)

        activity = await provider.fetch_activity_by_id(tokens, activity_id)
        upsert_activities(user_id=user_id, activities=[activity])
        mark_synced(user_id=user_id, provider="strava")
        log.info("Webhook ingest: synced Strava activity %s for %s", activity_id, user_id)
    except ProviderAuthError:
        mark_status(user_id=user_id, provider="strava", status="expired")
        log.warning("Webhook ingest: Strava auth expired for %s", user_id)
    except ProviderError as exc:
        log.warning("Webhook ingest failed for %s/%s: %s", user_id, activity_id, exc)


@router.post("/strava/webhook", status_code=200)
async def strava_webhook_event(
    request: Request, background_tasks: BackgroundTasks
) -> dict[str, str]:
    """Strava push for create/update/delete events.

    Strava requires a response within 2s, so we resolve the user, schedule a
    background fetch of the single activity, and ack immediately.

    Auth: Strava event pushes carry no HMAC signature and their API does not
    support query parameters in the callback URL, so URL-level token auth is
    not available. Events only carry IDs (no raw data) — actual payloads are
    always fetched via the authenticated Strava API, so a forged create/update
    is harmless. A forged delete requires knowing a valid Strava athlete_id
    that exists in our DB, which is low-risk in practice.
    """

    payload = await request.json()
    log.info("Strava webhook event: %s", payload)

    if payload.get("object_type") != "activity":
        return {"status": "ignored"}  # athlete (deauth) events — nothing to sync

    aspect = payload.get("aspect_type")
    owner_id = payload.get("owner_id")
    activity_id = payload.get("object_id")
    if not owner_id or not activity_id:
        return {"status": "ignored"}

    user_id = find_user_by_provider_id(provider="strava", provider_user_id=str(owner_id))
    if not user_id:
        log.info("Strava webhook for unknown athlete %s — ignoring", owner_id)
        return {"status": "ignored"}

    if aspect in ("create", "update"):
        background_tasks.add_task(
            _ingest_strava_activity, user_id=user_id, activity_id=str(activity_id)
        )
    elif aspect == "delete":
        get_supabase_admin().table("workouts").delete().eq("user_id", user_id).eq(
            "source", "strava"
        ).eq("source_id", str(activity_id)).execute()

    return {"status": "received"}
